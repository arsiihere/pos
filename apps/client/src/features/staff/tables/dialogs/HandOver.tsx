import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import type { HubError } from '../../../../api/hub-admin';
import { useShell } from '../../shell/hooks';
import type { HandoverCandidate, SeatingRef } from '../contracts';
import { DialogFrame } from './TableBusy';

// 02a §3.8, §6.7, §6.18 (02a-D20 HandOver, HandOverGone): `handover-candidates` (holder and caller excluded,
// working first); people not signed in are greyed and cannot be picked; no note field (AD-18: the hub does not
// store it). `409 HANDOVER_TARGET_UNAVAILABLE` → a message at the top and the list read again. The receiver must
// accept (01d request).

export interface CandidateRow {
  staff_id: string;
  name: string;
  /** "Ali · you" (Force move's Me row) or the working / tables line */
  sub: ReactNode;
  pickable: boolean;
  me?: boolean;
}

export function candidateSub(c: HandoverCandidate): ReactNode {
  return (
    <>
      <span className={c.working ? 'on is-on' : 'on'}>{c.working ? t('handover.working') : t('handover.not_signed_in')}</span>
      {c.working && <> · {c.tables_held === 1 ? t('handover.has_one') : fill(t('handover.has_tables'), { n: String(c.tables_held) })}</>}
      {c.is_assignee && <span className="tagx">{t('handover.assigned_here')}</span>}
    </>
  );
}

/** working first, keeping the hub's order inside each group */
export function workingFirst(list: HandoverCandidate[]): HandoverCandidate[] {
  return [...list.filter((c) => c.working), ...list.filter((c) => !c.working)];
}

export function CandidatePick({ rows, picked, onPick }: { rows: CandidateRow[]; picked: string | null; onPick(staff_id: string): void }) {
  return (
    <div className="pick" role="radiogroup">
      {rows.map((r) => (
        <button
          key={r.staff_id}
          type="button"
          className="cand"
          role="radio"
          aria-checked={picked === r.staff_id}
          aria-disabled={r.pickable ? undefined : 'true'}
          onClick={() => {
            if (r.pickable) onPick(r.staff_id);
          }}
        >
          <span className="radio" />
          <span className={r.me === true ? 'av av--me' : 'av'}>{(r.name || '?').slice(0, 1).toUpperCase()}</span>
          <span>
            <b>{r.name}</b>
            <small>{r.sub}</small>
          </span>
          <span className="end" />
        </button>
      ))}
    </div>
  );
}

/** Reads `handover-candidates` for the table; `reload()` reads again (HandOverGone, Try again). */
export function useCandidates(table_id: string): { list: HandoverCandidate[] | null; failed: boolean; reload: () => Promise<void> } {
  const { tables } = useShell();
  const [list, setList] = useState<HandoverCandidate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(async () => {
    setFailed(false);
    const answer = await tables.handoverCandidates(table_id);
    if (answer.ok) setList(workingFirst(answer.data.staff));
    else setFailed(true);
  }, [tables, table_id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { list, failed, reload };
}

/** The list's place while it is not there: loading, or a failed read with Try again (never "Loading…" forever). */
export function CandidatesPending({ failed, onRetry }: { failed: boolean; onRetry(): void }) {
  if (!failed) return <p className="dlg__line">{t('common.loading')}</p>;
  return (
    <div className="msg c-danger" role="alert">
      <span>{t('tables.err.unknown')}</span>
      <button type="button" className="btn" onClick={onRetry}>
        {t('tables.retry')}
      </button>
    </div>
  );
}

export interface HandOverProps {
  code: string;
  seating: SeatingRef;
  /** 02a-D25 MoveOtherOwner: the assignee to preset (Q-25) */
  preset?: string | null;
  onClose(): void;
  onSent(to: { staff_id: string; name: string; alert_id: string }): void;
  onFailed(error: HubError): void;
}

export function HandOver({ code, seating, preset = null, onClose, onSent, onFailed }: HandOverProps) {
  const { tables } = useShell();
  const { list, failed, reload } = useCandidates(seating.table_id);
  const [picked, setPicked] = useState<string | null>(preset);
  const [gone, setGone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** one send at a time (a ref: two taps before the re-render cannot both send) */
  const inflight = useRef(false);
  const chosen = list?.find((c) => c.staff_id === picked && c.working) ?? null;

  async function send(): Promise<void> {
    if (chosen === null || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    const answer = await tables.requestTableHandover({ ...seating, to_staff_id: chosen.staff_id });
    inflight.current = false;
    setBusy(false);
    if (answer.ok) {
      onSent({ staff_id: chosen.staff_id, name: chosen.name, alert_id: answer.data.alert_id });
      return;
    }
    const e = answer.error;
    if (e.kind === 'api' && e.code === 'HANDOVER_TARGET_UNAVAILABLE') {
      setGone(chosen.name);
      setPicked(null);
      await reload();
      return;
    }
    onFailed(e);
  }

  return (
    <DialogFrame code={code} title={fill(t('handover.title'), { table: code })} sub={t('handover.sub')} wide onClose={onClose}>
      {gone !== null && (
        <div className="msg c-danger" role="alert">
          <span>{fill(t('handover.gone'), { name: gone })}</span>
        </div>
      )}
      {list === null ? (
        <CandidatesPending failed={failed} onRetry={() => void reload()} />
      ) : (
        <CandidatePick rows={list.map((c) => ({ staff_id: c.staff_id, name: c.name, sub: candidateSub(c), pickable: c.working }))} picked={chosen?.staff_id ?? null} onPick={setPicked} />
      )}
      <div className="acts">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--primary" disabled={chosen === null || busy} onClick={() => void send()}>
          {t('handover.send')}
        </button>
      </div>
    </DialogFrame>
  );
}
