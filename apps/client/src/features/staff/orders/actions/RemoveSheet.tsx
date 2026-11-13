import { useState } from 'react';
import { newUlid } from '../../../../app/ulid';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import type { RemoveItemsPayload } from '../contracts';
import { definitiveRefusal } from '../../tables/errors';
import { showOrderError, Sheet, type LineOrder } from '../view/LineActions';
import { atStageOne, lineStage, stageText } from '../view/stage';

// 02b v1.0.11 §8 Table view, §3.5, §6.2 (frame 02b-D31 Remove): remove units of one order's lines before the kitchen
// starts (stage 1), free, no approval. A line past stage 1 points to Void, which stays disabled until module 04 is
// built (Q-24). RemoveItems is online only (not queueable, §3.12); a dine-in order sends its seating_id.
// One submission = one command_id (D32 / M19): after a lost reply (network, 5xx) the payload is frozen and "Remove"
// sends it again with the SAME command_id, so a removal the hub already committed is answered from its stored
// response, never applied twice; the id is dropped on a 2xx or a definitive refusal (then the ticks start over).

export interface RemoveSheetProps {
  order: LineOrder;
  /** the line the sheet was opened from: ticked, 1 unit (frame) */
  from: string;
  onClose(): void;
  onDone(): void;
  onChanged(): void;
}

export function RemoveSheet({ order, from, onClose, onDone, onChanged }: RemoveSheetProps) {
  const shell = useShell();
  // top-level lines only: a remove cascades to option children and deal parts (§3.4)
  const rows = order.lines.filter((l) => l.parent_order_item_id === null && l.live_units > 0);
  const [units, setUnits] = useState<ReadonlyMap<string, number>>(() => new Map([[from, 1]]));
  const [busy, setBusy] = useState(false);
  /** a sent submission whose answer was lost: retried as it is */
  const [pending, setPending] = useState<{ commandId: string; payload: RemoveItemsPayload } | null>(null);
  const voidGrant = shell.permissions.resolution('void-item').grant;
  const showVoid = voidGrant === 'allowed' || voidGrant === 'requires_approval';
  const set = (id: string, n: number | null) => {
    if (pending !== null) return;
    setUnits((cur) => {
      const next = new Map(cur);
      if (n === null) next.delete(id);
      else next.set(id, n);
      return next;
    });
  };
  const total = pending === null ? [...units.values()].reduce((a, b) => a + b, 0) : pending.payload.lines.reduce((a, l) => a + (l.units ?? 0), 0);
  const send = async () => {
    if (total === 0 || busy) return;
    const attempt = pending ?? {
      commandId: newUlid(),
      payload: {
        order_id: order.order_id,
        ...(order.seating_id === undefined ? {} : { seating_id: order.seating_id }),
        lines: [...units].map(([order_item_id, n]) => ({ order_item_id, units: n })),
      },
    };
    setPending(attempt);
    setBusy(true);
    const answer = await shell.api.command<{ removed: Array<{ order_item_id: string; units: number }> }>('RemoveItems', attempt.payload, { commandId: attempt.commandId });
    setBusy(false);
    if (answer.ok) {
      setPending(null);
      shell.toasts.show({ text: t('stage.badge.removed') });
      onDone();
      return;
    }
    if (definitiveRefusal(answer.error) === null && answer.error.kind !== 'signed_out') {
      // no answer: keep the id and the payload for the retry
      shell.toasts.show({ text: t('line.err.lost'), tone: 'warn' });
      return;
    }
    setPending(null);
    setUnits(new Map());
    showOrderError(shell, answer.error, onChanged);
  };
  return (
    <Sheet
      title={t('remove.title')}
      sub={t('remove.sub')}
      ident={order.ident}
      wide
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--tone c-danger" disabled={total === 0 || busy} onClick={() => void send()}>
            <Ico name="x" />
            {fill(t('remove.n'), { n: String(total) })}
          </button>
        </>
      }
    >
      <div className="pick">
        {rows.map((line) => {
          if (!atStageOne(line, order.lines)) {
            return (
              <div key={line.order_item_id} className="ckr" aria-disabled="true" data-line={line.order_item_id}>
                <span className="chk" />
                <span>
                  <b>{line.name}</b>
                  <small>{t('remove.use_void')}</small>
                </span>
                {showVoid ? (
                  <button type="button" className="btn btn--quiet" disabled title={t('line.void_later')}>
                    {t('line.void')}
                    <small>{t('line.void_later')}</small>
                  </button>
                ) : (
                  <span />
                )}
              </div>
            );
          }
          const n = units.get(line.order_item_id);
          const on = n !== undefined;
          const stage = lineStage(line);
          const stageWord = stage === null ? '' : stageText(stage, shell.clock.utcOffsetMs);
          const sub = on
            ? fill(t('remove.of'), { n: String(n), m: String(line.live_units) })
            : line.line_kind === 'deal'
              ? fill(t('remove.parts_follow'), { stage: t('stage.later') })
              : stageWord;
          return (
            <div
              key={line.order_item_id}
              className="ckr"
              role="checkbox"
              aria-checked={on}
              aria-disabled={pending !== null}
              tabIndex={0}
              data-line={line.order_item_id}
              onClick={() => set(line.order_item_id, on ? null : 1)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  set(line.order_item_id, on ? null : 1);
                }
              }}
            >
              <span className="chk">{on && <Ico name="check" />}</span>
              <span>
                <b>{line.name}</b>
                <small>{sub}</small>
              </span>
              {on && line.live_units > 1 ? (
                <span className="step" onClick={(e) => e.stopPropagation()}>
                  <button type="button" aria-label="-" disabled={n <= 1} onClick={() => set(line.order_item_id, Math.max(1, n - 1))}>
                    −
                  </button>
                  <output className="num">{n}</output>
                  <button type="button" aria-label="+" disabled={n >= line.live_units} onClick={() => set(line.order_item_id, Math.min(line.live_units, n + 1))}>
                    +
                  </button>
                </span>
              ) : (
                <span />
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
