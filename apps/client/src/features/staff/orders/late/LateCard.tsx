import { useRef, useState } from 'react';
import { newUlid } from '../../../../app/ulid';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico, Ring } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import type { SeatingOrder } from '../contracts';
import { definitiveRefusal } from '../../tables/errors';
import { showOrderError } from '../view/LineActions';
import { lineStage, stageText } from '../view/stage';
import type { LateCardModel } from './late-groups';
import { releasable, ReleaseSheet } from './ReleaseSheet';

// 02b v1.0.11 §8 Late cards (frame 02b-C04 TableViewLate; O18, Q-10): "F4 + F5 — about 6 min late", the late lines
// with their stages, Wait / Send what's ready. A grouped card (H5) opens the release sheet and sends one ReleaseItems
// for all its orders; an interim card (no H5) answers its own slip_warning request (AnswerRequest accept / decline,
// the hub pre-ticks). Wait = decline.

export interface LateCardProps {
  model: LateCardModel;
  ident: string;
  /** this seating's orders (a grouped card uses those it names) */
  orders: SeatingOrder[];
  /** alerts of this card the signed-in person was sent (their alert rows): only a named receiver answers (03a) */
  receiverOf: readonly string[];
  /** the card's alerts are answered / released on this device */
  onAnswered(alert_ids: string[]): void;
  onChanged(): void;
}

export function LateCard({ model, ident, orders, receiverOf, onAnswered, onChanged }: LateCardProps) {
  const shell = useShell();
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const ids = model.mode === 'grouped' ? model.alert_ids : [model.alert_id];
  const cardOrders = model.mode === 'grouped' ? orders.filter((o) => model.order_ids.includes(o.order_id)) : [];
  /**
   * One command_id per alert until its 2xx or a definitive refusal; an alert answered on this card is not sent again,
   * and a REQUEST_NOT_PENDING (closed meanwhile) counts as answered — so a retry after a lost reply finishes the card.
   */
  const ids_ = useRef(new Map<string, string>());
  const done = useRef(new Set<string>());
  // Wait / accept: the slip_warning request is answered by its named receiver only (03a `right: named`); "Send
  // what's ready" sends ReleaseItems, which needs mark-served. Anyone else sees the card read-only.
  const mine = ids.filter((id) => receiverOf.includes(id));
  const canWait = mine.length > 0;
  const canSend = shell.permissions.allowed('mark-served') && (model.mode === 'grouped' || canWait);
  const offline = () => {
    if (shell.online) return false;
    shell.toasts.show({ text: t('tables.toast.needs_hub'), tone: 'warn' });
    return true;
  };
  const answer = async (decision: 'accept' | 'decline') => {
    if (busy || offline()) return;
    setBusy(true);
    for (const alert_id of mine) {
      if (done.current.has(alert_id)) continue;
      // keyed by alert AND decision: a lost-reply Wait never lends its id to a Send what's ready (another payload)
      const key = `${alert_id}:${decision}`;
      const commandId = ids_.current.get(key) ?? newUlid();
      ids_.current.set(key, commandId);
      const r = await shell.api.command('AnswerRequest', { alert_id, decision, method: 'session' }, { commandId });
      if (r.ok || (r.error.kind === 'api' && r.error.code === 'REQUEST_NOT_PENDING')) {
        done.current.add(alert_id);
        ids_.current.delete(key);
        continue;
      }
      setBusy(false);
      if (definitiveRefusal(r.error) === null && r.error.kind !== 'signed_out') {
        shell.toasts.show({ text: t('line.err.lost'), tone: 'warn' });
        return;
      }
      ids_.current.delete(key);
      showOrderError(shell, r.error, onChanged);
      return;
    }
    setBusy(false);
    onAnswered(mine);
    onChanged();
  };
  const title = model.minutes === null ? fill(t('late.title_unknown'), { table: ident }) : fill(t('late.title'), { table: ident, n: String(model.minutes) });
  return (
    <div className="lc" data-alerts={ids.join()}>
      <div className="lc__h">
        <Ring size={56} pct={null} tone="warn">
          <Ico name="clock" />
        </Ring>
        <b>{title}</b>
      </div>
      <div className="lc__ls">
        {model.mode === 'grouped'
          ? releasable(cardOrders).map((l) => {
              const stage = lineStage(l);
              return (
                stage !== null && (
                  <span key={l.order_item_id} className={`stg c-${stage.tone}`}>
                    <Ico name={stage.icon} />
                    {l.name} · {stageText(stage, shell.clock.utcOffsetMs)}
                  </span>
                )
              );
            })
          : model.lines.map((l, i) => (
              <span key={i} className="stg c-mute">
                {l.quantity > 1 ? `${l.quantity}× ` : ''}
                {l.name}
              </span>
            ))}
      </div>
      {(canWait || canSend) && (
        <div className="lc__a">
          {canWait && (
            <button type="button" className="btn" disabled={busy} onClick={() => void answer('decline')}>
              {t('late.wait')}
            </button>
          )}
          {canSend && (
            <button
              type="button"
              className="btn btn--tone c-warn"
              disabled={busy}
              onClick={() => {
                if (offline()) return;
                if (model.mode === 'grouped') setSheet(true);
                else void answer('accept');
              }}
            >
              <Ico name="send" />
              {t('late.send_ready')}
            </button>
          )}
        </div>
      )}
      {sheet && (
        <ReleaseSheet
          ident={ident}
          orders={cardOrders}
          groups={ids.length}
          onClose={() => setSheet(false)}
          onDone={() => {
            setSheet(false);
            onAnswered(ids);
            onChanged();
          }}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
