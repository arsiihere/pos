import { useState } from 'react';
import type { GroupedLine } from '../view/parts';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import type { EnqueueMeta } from '../../tables/contracts';
import type { LineView, MarkServedPayload } from '../contracts';
import { showEnqueued, Sheet } from '../view/LineActions';
import { stageText, type Stage } from '../view/stage';
import { AskManager } from '../unpaid/AskManager';
import { checkHandover, lineIds, type CandidateOrder } from '../unpaid/candidate';
import { unpaidRequestsOf } from '../unpaid/requests';

// 02b v1.0.11 §8 Table view, §3.7, §6.4 (frame 02-D08 MarkServed): pick the lines to mark served. Only lines the
// kitchen has (fired), out of the engine or with no station are offered; ready lines are pre-ticked. MarkServed is
// queueable (§3.12): it goes through the one Enqueue (Q-3), so offline it queues; "Served" only after a 2xx.
// ⚠️ 02b-TK L-CLIENT-2 item 4 (02b v1.0.25 §3.7a, §6.4, §8 OR-7 "parking / per-line sheet"; D2): for a takeaway /
// parking order (`unpaid`) the ticked lines go through the shared candidate check — the last live line of a Due,
// unapproved order is not given (Mark served greyed, "Take payment first" + Ask a manager; unknown billing: "Waiting
// for the bill") — and the send says `customer_handover: true`; the hub's unpaid refusal says ask a manager.

export interface ServedCandidate {
  line: LineView;
  /** null in the order-view fallback (no stages yet, Q-8) */
  stage: Stage | null;
  ready: boolean;
  /** "Round 2" under the name, in the table view */
  round?: string;
}

export interface MarkServedSheetProps {
  ident: string;
  candidates: ServedCandidate[];
  meta(label: string): EnqueueMeta;
  onClose(): void;
  onDone(): void;
  onChanged(): void;
  /** ⚠️ OR-7: a takeaway / parking order — its candidate orders (live line ids, gate) */
  unpaid?: { orders: CandidateOrder[] } | undefined;
}

/** One `{ order_id, order_item_ids }` per order, in the candidates' order (§6.4). */
export function servedPayload(lines: readonly LineView[]): MarkServedPayload {
  const byOrder = new Map<string, string[]>();
  // 02b v1.0.21 §8 (STAB-5): a grouped row serves all its parts
  for (const l of lines) byOrder.set(l.order_id, [...(byOrder.get(l.order_id) ?? []), ...((l as GroupedLine).part_ids ?? [l.order_item_id])]);
  return { lines: [...byOrder].map(([order_id, order_item_ids]) => ({ order_id, order_item_ids })) };
}

export function MarkServedSheet({ ident, candidates, meta, onClose, onDone, onChanged, unpaid }: MarkServedSheetProps) {
  const shell = useShell();
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(candidates.filter((c) => c.ready).map((c) => c.line.order_item_id)));
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) =>
    setTicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const picked = candidates.filter((c) => ticked.has(c.line.order_item_id)).map((c) => c.line);
  const check = unpaid === undefined ? ({ ok: true } as const) : checkHandover(unpaid.orders, lineIds(picked));
  const send = async () => {
    if (picked.length === 0 || busy || !check.ok) return;
    setBusy(true);
    const payload = unpaid === undefined ? servedPayload(picked) : { ...servedPayload(picked), customer_handover: true as const };
    const result = await shell.enqueue('MarkServed', payload, meta(`${t('served.title')} · ${ident}`));
    setBusy(false);
    if (result.status === 'refused' && result.error.status === 403 && result.error.details['reason'] === 'unpaid_handover_approval_required') {
      const order_id = result.error.details['order_id'];
      if (typeof order_id === 'string') unpaidRequestsOf(shell).refused(order_id);
      shell.toasts.show({ text: t('unpaid.refused'), tone: 'warn' });
      return onChanged();
    }
    if (showEnqueued(shell, result, 'order.toast.served', onChanged)) onDone();
  };
  return (
    <Sheet
      title={t('served.title')}
      sub={t('served.sub')}
      ident={ident}
      wide
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" disabled={picked.length === 0 || busy || !check.ok} onClick={() => void send()}>
            <Ico name="check" />
            {fill(t('served.mark_n'), { n: String(picked.length) })}
          </button>
        </>
      }
    >
      {!check.ok && check.reason === 'due' && <AskManager order_id={check.order_id} due_minor={check.due_minor} variant="sheet" onChanged={onChanged} />}
      {!check.ok && check.reason === 'unknown' && <p className="muted">{t('pass.waiting_bill')}</p>}
      <div className="pick">
        {candidates.map((c) => {
          const on = ticked.has(c.line.order_item_id);
          return (
            <button
              key={c.line.order_item_id}
              type="button"
              className="ckr"
              role="checkbox"
              aria-checked={on}
              data-line={c.line.order_item_id}
              onClick={() => toggle(c.line.order_item_id)}
            >
              <span className="chk">{on && <Ico name="check" />}</span>
              <span>
                <b>
                  {c.line.live_units}× {c.line.name}
                </b>
                {c.round !== undefined && <small>{c.round}</small>}
              </span>
              {c.stage === null ? (
                <span />
              ) : (
                <span className={`stg c-${c.stage.tone}`}>
                  <Ico name={c.stage.icon} />
                  {stageText(c.stage, shell.clock.utcOffsetMs)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
