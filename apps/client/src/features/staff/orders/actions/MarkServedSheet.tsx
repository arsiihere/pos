import { useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import type { EnqueueMeta } from '../../tables/contracts';
import type { LineView, MarkServedPayload } from '../contracts';
import { showEnqueued, Sheet } from '../view/LineActions';
import { stageText, type Stage } from '../view/stage';

// 02b v1.0.11 §8 Table view, §3.7, §6.4 (frame 02-D08 MarkServed): pick the lines to mark served. Only lines the
// kitchen has (fired), out of the engine or with no station are offered; ready lines are pre-ticked. MarkServed is
// queueable (§3.12): it goes through the one Enqueue (Q-3), so offline it queues; "Served" only after a 2xx.

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
}

/** One `{ order_id, order_item_ids }` per order, in the candidates' order (§6.4). */
export function servedPayload(lines: readonly LineView[]): MarkServedPayload {
  const byOrder = new Map<string, string[]>();
  for (const l of lines) byOrder.set(l.order_id, [...(byOrder.get(l.order_id) ?? []), l.order_item_id]);
  return { lines: [...byOrder].map(([order_id, order_item_ids]) => ({ order_id, order_item_ids })) };
}

export function MarkServedSheet({ ident, candidates, meta, onClose, onDone, onChanged }: MarkServedSheetProps) {
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
  const send = async () => {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    const result = await shell.enqueue('MarkServed', servedPayload(picked), meta(`${t('served.title')} · ${ident}`));
    setBusy(false);
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
          <button type="button" className="btn btn--primary" disabled={picked.length === 0 || busy} onClick={() => void send()}>
            <Ico name="check" />
            {fill(t('served.mark_n'), { n: String(picked.length) })}
          </button>
        </>
      }
    >
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
