import { useRef, useState } from 'react';
import { newUlid } from '../../../../app/ulid';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import { definitiveRefusal } from '../../tables/errors';
import type { SeatingLine, SeatingOrder } from '../contracts';
import { showOrderError, Sheet } from '../view/LineActions';
import { lineStage, stageText } from '../view/stage';
import { partnersOf } from './late-groups';

// 02b v1.0.11 §3.8, §6.5, §8 Late cards (frame 02b-C04 ReleaseSheet): "Send what's ready" for a late card — the ready
// (done) lines ticked "Send now", their goes-with partners that are not done ticked "hurry it" (03a D12; the client's
// pre-ticks), other waiting lines unticked. One `ReleaseItems { order_ids: every order of the card, released: ticked
// done lines, expedite: ticked lines not done }` (planRelease keeps only done lines in `released`).

export interface ReleaseSheetProps {
  ident: string;
  orders: SeatingOrder[];
  /** how many late warnings the card holds (the sub line) */
  groups: number;
  onClose(): void;
  onDone(): void;
  onChanged(): void;
}

/** The lines a release can name: live, in the engine, not served, not a deal header. */
export function releasable(orders: readonly SeatingOrder[]): SeatingLine[] {
  return orders.flatMap((o) => o.lines).filter((l) => l.line_kind !== 'deal' && l.live_units > 0 && l.served_at === null && (l.stage === 'added' || l.stage === 'cooking' || l.stage === 'done'));
}

export function ReleaseSheet({ ident, orders, groups, onClose, onDone, onChanged }: ReleaseSheetProps) {
  const shell = useShell();
  const lines = releasable(orders);
  const ready = lines.filter((l) => l.stage === 'done');
  const config = shell.config.snapshot();
  const partnerOf = new Map<string, SeatingLine>();
  for (const r of ready) for (const p of partnersOf(config, r, lines)) if (p.stage !== 'done' && !partnerOf.has(p.order_item_id)) partnerOf.set(p.order_item_id, r);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set([...ready.map((l) => l.order_item_id), ...partnerOf.keys()]));
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) =>
    attempt.current === null &&
    setTicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  /** one submission = one command_id and payload until a 2xx or a definitive refusal (D32: a lost reply replays) */
  const attempt = useRef<{ commandId: string; payload: { order_ids: string[]; released: string[]; expedite: string[] } } | null>(null);
  const send = async () => {
    if (busy || (attempt.current === null && ticked.size === 0)) return;
    if (attempt.current === null) {
      const picked = lines.filter((l) => ticked.has(l.order_item_id));
      attempt.current = {
        commandId: newUlid(),
        payload: {
          order_ids: orders.map((o) => o.order_id),
          released: picked.filter((l) => l.stage === 'done').map((l) => l.order_item_id),
          expedite: picked.filter((l) => l.stage !== 'done').map((l) => l.order_item_id),
        },
      };
    }
    const a = attempt.current;
    setBusy(true);
    const answer = await shell.api.command<{ alerts_closed: number }>('ReleaseItems', a.payload, { commandId: a.commandId });
    setBusy(false);
    if (!answer.ok) {
      if (definitiveRefusal(answer.error) === null && answer.error.kind !== 'signed_out') {
        shell.toasts.show({ text: t('line.err.lost'), tone: 'warn' });
        return;
      }
      attempt.current = null;
      showOrderError(shell, answer.error, onChanged);
      return;
    }
    attempt.current = null;
    shell.toasts.show({ text: t('send.sent') });
    onDone();
  };
  return (
    <Sheet
      title={t('late.send_ready')}
      sub={groups > 1 ? fill(t('late.groups'), { n: String(groups) }) : undefined}
      ident={ident}
      wide
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" disabled={busy || ticked.size === 0} onClick={() => void send()}>
            <Ico name="send" />
            {t('late.send')}
          </button>
        </>
      }
    >
      <div className="pick">
        {lines.map((l) => {
          const on = ticked.has(l.order_item_id);
          const stage = lineStage(l);
          const partner = partnerOf.get(l.order_item_id);
          const sub = l.stage === 'done' ? t('late.send_now') : partner !== undefined ? fill(t('late.goes_with'), { item: partner.name }) : t('late.hurry');
          return (
            <button key={l.order_item_id} type="button" className="ckr" role="checkbox" aria-checked={on} data-line={l.order_item_id} onClick={() => toggle(l.order_item_id)}>
              <span className="chk">{on && <Ico name="check" />}</span>
              <span>
                <b>
                  {l.name}
                  {l.live_units > 1 ? ` ×${l.live_units}` : ''}
                </b>
                <small>{sub}</small>
              </span>
              {stage === null ? (
                <span />
              ) : (
                <span className={`stg c-${stage.tone}`}>
                  <Ico name={stage.icon} />
                  {stageText(stage, shell.clock.utcOffsetMs)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
