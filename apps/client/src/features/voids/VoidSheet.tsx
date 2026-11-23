import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { VOID_DISPOSITIONS, type VoidDisposition, type VoidReasonCode } from '@pos/domain';
import { newUlid } from '../../app/ulid';
import { t, type MessageKey } from '../../i18n';
import { fill } from '../../i18n/en';
import { Ico } from '../alerts/ui';
import { useShell } from '../staff/shell/hooks';
import { definitiveRefusal } from '../staff/tables/errors';
import type { SeatingLine } from '../staff/orders/contracts';
import { MONEY_DIR, money } from '../staff/orders/money';
import type { LineOrder } from '../staff/orders/view/LineActions';
import { isWeightPending, lineStage, stageText } from '../staff/orders/view/stage';
import type { HubError } from '../../api/hub-admin';
import { voidItems, voidPreview } from './api';
import type { VoidItemsPayload, VoidPreview, VoidPreviewTouched } from './contracts';
import { voidErrorText, type VoidErrorText } from './errors';
import { VIco } from './icons';
import {
  defaultDisposition,
  dispositionEnabled,
  movedPartly,
  outcomeOf,
  primaryStep,
  REASON_CHIPS,
  REASON_KEY,
  STEP_KEY,
  VOID_NOTE_MAX,
  voidPayload,
  weighedWhole,
  type SheetChoice,
} from './model';
import { rememberVoid } from './pending';
import { BLOCK_KEY, DISPOSITION_KEY, OffButton, OutcomeChip, VoidDialog, VoidMsg } from './ui';

// 04 §8 Void sheet (frames Main, VoidSheetOpen, VoidSheetAllowed, VoidDeal, VoidWeighed, VoidSheetOther, VoidKiosk,
// VoidPortrait, VoidPhone, VoidSheetUrdu, VoidCompPending, VoidWrongStage; handoff decisions 2–8, 11). Opens with one
// void-preview; units stepper (piece lines, deal portions; a g/ml item is whole); "What happens" per touched line;
// "Where it goes" from `dispositions` (moved pre-selected when enabled, else wastage; disabled rows with their reason);
// the five V12 reasons; Ask for approval / Void. Online only, never queued (V15): offline, nothing is sent. One
// submission = one command_id until a 2xx or a definitive refusal (D32), as 02b's sheets.

export interface VoidSheetProps {
  line: SeatingLine;
  order: LineOrder;
  onClose(): void;
  /** sent: the view reads again */
  onDone(): void;
  onChanged(): void;
  /** ITEM_WRONG_STAGE {stage: added}: open 02b's Remove instead (VoidWrongStage) */
  onRemove?: (() => void) | undefined;
}

type Failure = { text: VoidErrorText } | null;

export function VoidSheet({ line, order, onClose, onDone, onChanged, onRemove }: VoidSheetProps) {
  const shell = useShell();
  const whole = weighedWhole(line);
  const max = Math.max(1, line.live_units);
  const [units, setUnits] = useState(1);
  /** the preview with the units it was read for: a preview of other units is never shown or sent on (money) */
  const [read, setRead] = useState<{ preview: VoidPreview | null; units: number | undefined } | null>(null);
  const [loadError, setLoadError] = useState<HubError | null>(null);
  const [reason, setReason] = useState<VoidReasonCode | null>(null);
  const [note, setNote] = useState('');
  const [disposition, setDisposition] = useState<VoidDisposition | null>(null);
  const [dispositionNote, setDispositionNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const [reloads, setReloads] = useState(0);
  const attempt = useRef<{ commandId: string; payload: VoidItemsPayload } | null>(null);
  /** D32: a sent submission whose answer was lost is retried as it is; every input stays frozen until then */
  const [frozen, setFrozen] = useState(false);
  const online = shell.online;
  const sentUnits = whole ? undefined : units;
  const preview = read !== null && read.units === sentUnits ? read.preview : null;

  useEffect(() => {
    if (!online) return;
    let live = true;
    // 02b v1.0.21 §8 (STAB-5): a grouped row previews its first n parts
    const parts = (line as { part_ids?: string[] }).part_ids;
    void voidPreview(shell.api, parts === undefined ? { order_id: order.order_id, order_item_ids: [line.order_item_id], ...(sentUnits === undefined ? {} : { units: sentUnits }) } : { order_id: order.order_id, order_item_ids: parts.slice(0, sentUnits ?? parts.length) }).then((answer) => {
      if (!live) return;
      if (!answer.ok) {
        setLoadError(answer.error);
        return;
      }
      const p = answer.data.previews[0] ?? null;
      setLoadError(null);
      setRead({ preview: p, units: sentUnits });
      // a choice the new preview no longer allows goes back to the default
      if (p !== null) setDisposition((cur) => (cur !== null && dispositionEnabled(p, cur) ? cur : defaultDisposition(p)));
    });
    return () => {
      live = false;
    };
  }, [online, shell.api, order.order_id, line.order_item_id, sentUnits, reloads]);

  const chosen: VoidDisposition = disposition ?? (preview === null ? 'wastage' : defaultDisposition(preview));
  const choice: SheetChoice = { reason, note, disposition: chosen, dispositionNote };
  const step = primaryStep({ online, preview, choice });
  const approval = preview?.needs_approval ?? shell.permissions.resolution('void-item').grant === 'requires_approval';
  const partIds = (line as { part_ids?: string[] }).part_ids;
  const payload = voidPayload({ order_id: order.order_id, order_item_id: line.order_item_id, units: sentUnits, choice, ...(partIds === undefined ? {} : { part_ids: partIds }) });

  const send = async () => {
    if (busy || !online) return;
    const a = attempt.current ?? (payload === null || (step !== 'ask' && step !== 'void') ? null : { commandId: newUlid(), payload });
    if (a === null) return;
    attempt.current = a;
    setBusy(true);
    setFailure(null);
    const answer = await voidItems(shell.api, a.payload, { commandId: a.commandId });
    setBusy(false);
    if (!answer.ok) {
      const e = answer.error;
      if (definitiveRefusal(e) === null && e.kind !== 'signed_out') {
        // no answer: the same command_id goes again on the next tap
        setFailure({ text: { key: 'line.err.lost', tone: 'danger', reload: false, remove: false } });
        setFrozen(true);
        return;
      }
      attempt.current = null;
      setFrozen(false);
      const text = voidErrorText(e);
      setFailure({ text });
      if (text.reload) setReloads((n) => n + 1);
      if (e.kind === 'api' && (e.code === 'ORDER_BILLED' || e.code === 'ORDER_NOT_FOUND')) onChanged();
      return;
    }
    attempt.current = null;
    setFrozen(false);
    const r = answer.data;
    const n = String(a.payload.lines[0]?.units ?? line.live_units);
    if ('pending' in r) {
      for (const p of r.pending) rememberVoid(shell, { alert_id: p.alert_id, reason: a.payload.reason_code, disposition: a.payload.lines[0]!.disposition });
      shell.toasts.show({ text: t('void.toast.asked'), sub: fill(t('void.toast.asked.sub'), { item: line.name, n }) });
    } else {
      const off = r.voided.reduce((s, v) => s + v.refund_minor, 0);
      shell.toasts.show({ text: t('void.toast.voided'), sub: fill(t('void.toast.voided.sub'), { item: line.name, n, amount: money(off) }) });
    }
    onDone();
  };

  // -------------------------------------------------------------------------------------------- the parts
  const messages: ReactNode[] = [];
  if (!online) messages.push(<VoidMsg key="off" tone="danger" icon="wifioff" text={t('answer.error.offline')} hint={t('void.err.offline.hint')} />);
  else if (loadError !== null) {
    const e = voidErrorText(loadError);
    messages.push(<VoidMsg key="load" tone={e.tone} text={t(e.key)} />);
  } else if (preview?.group === 'remove') messages.push(<WrongStage key="stage" onRemove={onRemove} />);
  else if (preview?.pending != null) messages.push(<VoidMsg key="pend" tone="warn" text={t('void.err.VOID_PENDING')} />);
  else if (step === 'comp_waiting') messages.push(<VoidMsg key="comp" tone="warn" text={t('void.err.COMP_PENDING')} hint={t('void.err.COMP_PENDING.hint')} />);
  if (failure !== null && online) {
    const f = failure.text;
    messages.push(f.remove ? <WrongStage key="fail" onRemove={onRemove} /> : <VoidMsg key="fail" tone={f.tone} text={t(f.key)} hint={f.hint === undefined ? undefined : t(f.hint)} />);
  }

  const ready = online && preview !== null && preview.group === 'void';
  // frames VoidPortrait / VoidPhone: no "What happens" / "Where it goes" labels on a bottom sheet
  const labels = !shell.phone && !shell.portrait;
  const unitsBlock = (
    <div className="qline" key="units">
      <b>{line.line_kind === 'deal' ? t('void.deal_portions') : t('comp.units')}</b>
      <span className="qv">
        {whole ? (
          <span className="fix num">×1</span>
        ) : (
          <>
            <span className="step" aria-disabled={max <= 1 ? 'true' : undefined}>
              <button type="button" aria-label="-" disabled={units <= 1 || busy || frozen} onClick={() => setUnits(Math.max(1, units - 1))}>
                −
              </button>
              <output className="num">{units}</output>
              <button type="button" aria-label="+" disabled={units >= max || busy || frozen} onClick={() => setUnits(Math.min(max, units + 1))}>
                +
              </button>
            </span>
            <span className="of">{fill(t('void.of'), { n: String(max) })}</span>
          </>
        )}
      </span>
    </div>
  );
  const wholeNote = whole ? (
    <p className="dlg__sub" key="whole">
      {t('void.weighed_whole')}
    </p>
  ) : null;

  const what = ready ? (
    <Fragment key="what">
      {labels && <span className="vlab">{t('void.what_happens')}</span>}
      <div className="vts">
        {preview.touched.map((x) => (
          <TouchedRow key={x.order_item_id} x={x} named={x.order_item_id === line.order_item_id} preview={preview} disposition={chosen} lines={order.lines} />
        ))}
      </div>
    </Fragment>
  ) : online && loadError === null && preview === null ? (
    <div key="what" className="vts" aria-busy="true" aria-label={t('void.loading')}>
      <div className="sk sk--row" />
      <div className="sk sk--row" />
    </div>
  ) : null;

  const partly = ready && movedPartly(preview, order.lines);
  const where = ready ? (
    <Fragment key="where">
      {labels && <span className="vlab">{t('void.where')}</span>}
      <div className="pick pick--d" role="radiogroup" aria-label={t('void.where')}>
        {VOID_DISPOSITIONS.map((d) => {
          const row = preview.dispositions.find((x) => x.disposition === d);
          if (row === undefined) return null;
          const k = DISPOSITION_KEY[d];
          const label = d === 'moved' && partly ? t('void.disposition.moved_partly') : t(k.label);
          const hint = d === 'moved' && partly ? t('void.disposition.moved_partly.hint') : t(k.hint);
          const on = chosen === d && row.enabled;
          return (
            <div
              key={d}
              className="pick__r"
              role="radio"
              tabIndex={0}
              aria-checked={on}
              aria-disabled={row.enabled ? undefined : 'true'}
              data-disposition={d}
              onClick={() => row.enabled && !frozen && setDisposition(d)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  if (row.enabled && !frozen) setDisposition(d);
                }
              }}
            >
              <span className="radio" />
              <span className={`ar__ic c-${k.tone}`}>
                <VIco name={k.icon} />
              </span>
              <span>
                <b>
                  {label}
                  {d === 'moved' && row.enabled && <span className="pre">{t('void.suggested')}</span>}
                </b>
                {row.enabled || row.block === null ? (
                  <small>{hint}</small>
                ) : (
                  <small className="why">
                    <Ico name="lock" />
                    {t(BLOCK_KEY[row.block])}
                  </small>
                )}
                {d === 'other' && on && (
                  <input
                    className="inp"
                    dir="auto"
                    maxLength={VOID_NOTE_MAX}
                    aria-label={t('void.disposition.other.placeholder')}
                    placeholder={t('void.disposition.other.placeholder')}
                    value={dispositionNote}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    readOnly={frozen}
                    onChange={(e) => setDispositionNote(e.target.value)}
                  />
                )}
              </span>
            </div>
          );
        })}
      </div>
    </Fragment>
  ) : null;

  const noteEmpty = reason === 'other' && note.trim() === '';
  const reasonBlock = (
    <div className="fld" key="reason">
      <span className="vlab">
        {t('comp.reason')}
        <small>{t('comp.required')}</small>
      </span>
      <div className="chips--r">
        {REASON_CHIPS.map((code) => (
          <button key={code} type="button" className="chip" aria-pressed={reason === code} disabled={frozen} onClick={() => setReason(code)}>
            {t(REASON_KEY[code])}
          </button>
        ))}
      </div>
      {reason === 'other' && (
        <label className="vnote">
          <span className="lbl">
            {t('void.note.label')} <span className="cnt">{fill(t('void.note.count'), { n: String(note.length) })}</span>
          </span>
          <input
            className={noteEmpty ? 'inp err' : 'inp'}
            dir="auto"
            maxLength={VOID_NOTE_MAX}
            placeholder={t('void.note.placeholder')}
            aria-invalid={noteEmpty}
            value={note}
            readOnly={frozen}
            onChange={(e) => setNote(e.target.value)}
          />
          {noteEmpty && (
            <span className="fld__e">
              <Ico name="warn" />
              {t('void.note.required')}
            </span>
          )}
        </label>
      )}
    </div>
  );

  const pendingWeight = isWeightPending(line);
  const amount = (compact: boolean) => (
    <div className="vsum" key="sum">
      <span>{t('void.amount')}</span>
      <strong className="num" dir={MONEY_DIR}>
        {preview === null ? '—' : money(preview.refund_minor)}
      </strong>
      {!compact && (
        <small>
          {pendingWeight ? (
            <>
              {t('void.amount.not_weighed')}{' '}
              {approval && (
                <span className="appr">
                  <Ico name="shield" />
                  {t('void.amount.still_answers')}
                </span>
              )}
            </>
          ) : approval ? (
            <span className="appr">
              <Ico name="shield" />
              {t('void.amount.approval')}
            </span>
          ) : (
            t('void.amount.direct')
          )}
        </small>
      )}
    </div>
  );

  const finalKey = approval ? STEP_KEY.ask : STEP_KEY.void;
  const label = step === 'blocked' ? t(finalKey) : t(STEP_KEY[step]);
  const off = busy || (attempt.current === null && step !== 'ask' && step !== 'void');
  const acts = (
    <div className="acts" key="acts">
      <button type="button" className="btn" onClick={onClose}>
        {t('common.cancel')}
      </button>
      <OffButton off={off} className={approval ? 'btn btn--primary' : 'btn btn--danger'} onClick={() => void send()}>
        {approval ? <Ico name="shield" /> : <VIco name="bin" />}
        {label}
      </OffButton>
    </div>
  );

  let body: ReactNode;
  if (shell.phone) {
    body = (
      <>
        <div className="vbody">
          <div className="vcol">
            {messages}
            {reasonBlock}
            {unitsBlock}
            {wholeNote}
            {what}
            {where}
          </div>
        </div>
        <div className="vfoot">
          {amount(true)}
          {acts}
        </div>
      </>
    );
  } else if (shell.portrait) {
    body = (
      <div className="vcol">
        {messages}
        {unitsBlock}
        {wholeNote}
        {what}
        {where}
        {reasonBlock}
        {amount(false)}
        {acts}
      </div>
    );
  } else {
    body = (
      <div className="vgrid">
        <div className="vcol">
          {messages}
          {unitsBlock}
          {wholeNote}
          {what}
          {where}
        </div>
        <div className="vcol">
          {reasonBlock}
          <div className="grow" />
          {amount(false)}
          {acts}
        </div>
      </div>
    );
  }

  return (
    <VoidDialog
      variant="v"
      title={fill(t('void.title'), { item: line.name })}
      sub={approval ? t('comp.needs_manager') : t('void.can_void')}
      ident={order.ident}
      onClose={onClose}
    >
      {body}
    </VoidDialog>
  );
}

function WrongStage({ onRemove }: { onRemove?: (() => void) | undefined }) {
  return (
    <VoidMsg
      tone="danger"
      text={t('void.err.ITEM_WRONG_STAGE')}
      hint={t('void.err.ITEM_WRONG_STAGE.hint')}
      action={
        onRemove === undefined ? undefined : (
          <button type="button" className="btn" onClick={onRemove}>
            <Ico name="x" />
            {t('line.remove')}
          </button>
        )
      }
    />
  );
}

function TouchedRow({ x, named, preview, disposition, lines }: { x: VoidPreviewTouched; named: boolean; preview: VoidPreview; disposition: VoidDisposition; lines: readonly SeatingLine[] }) {
  const shell = useShell();
  const line = lines.find((l) => l.order_item_id === x.order_item_id);
  // the stage chip as the line shows it in the table view (02b `lineStage`); the preview's word when not drawn there
  const stage = line === undefined ? null : lineStage(line);
  const header = line?.line_kind === 'deal';
  return (
    <div className={named ? 'vt' : 'vt child'} data-line={x.order_item_id}>
      <span>
        <b>{!named && line?.line_kind === 'option_child' ? `+ ${x.name}` : x.name}</b>
        <small className="num">×{x.units}</small>
      </span>
      {stage !== null ? (
        <span className={`stg c-${stage.tone}`}>
          <Ico name={stage.icon} />
          {stageText(stage, shell.clock.utcOffsetMs)}
        </span>
      ) : header ? (
        <span />
      ) : (
        <span className="stg c-mute">{t(`void.stage.${x.stage}` as MessageKey)}</span>
      )}
      <OutcomeChip outcome={outcomeOf(preview, disposition, x, lines)} />
    </div>
  );
}
