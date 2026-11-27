import { UNDO_DONE_MS } from '@pos/domain';
import { useRef, useState } from 'react';
import type { HubResult } from '../../../api/hub-admin';
import { t } from '../../../i18n';
import { errorKey, fill } from '../../../i18n/en';
import type { KdsApi } from '../../kds/contracts';
import type { PointLine } from '../contracts';
import { clockText, type CardMessage } from './ready';

// 03b v1.0.8 §3.2, §3.4 (Q-45; P3; frames 03b-C10–C13 / B13 in PassCards, Pass): Start / Done / Undo for a line of a
// screenless station (`stations[].screenless`; the caller shows this only for those — before HK2 never), on the staff
// session (`run-pass`, the KDS command shapes). Waiting → Start + Done; cooking → Done; done → Undo m:ss for
// UNDO_DONE_MS after this tablet's own Done (hub clock), then nothing.
// Refusals (brief B13 / §3.2): Start on an unfired line → 409 ITEM_WRONG_STAGE { stage: 'added' } → "Not due yet"
// (the Pass cannot tell fired from not, brief Q-12); Done before Start → "Tap Start first"; 422
// ITEM_DONE_CONFIRM_REQUIRED → "Done already? m:ss of m:ss — tap again", the next Done sends `confirm: true`;
// ITEM_WRONG_STAGE cooking / done (another device was first, #72) → nothing; Undo after the window → "Too late to
// undo". One tap at a time per line (ref guard); the KdsApi re-sends a lost reply with the same command_id.
// 03b v1.0.11 §3.4 (STAB-5, owner Q1 = b): a grouped row (`parts`, a split line's parts in one stage) acts on all its
// parts, one command per part. ⚠️ v1.0.12 (STAB-5 Q5): Done sends the part that started last first (`started_at`, an
// unknown start last); `422 ITEM_DONE_CONFIRM_REQUIRED` stops the row, asks once, and the next Done
// sends every part with `confirm: true`. Undo shows while a part is inside this tablet's own Undo window and undoes
// those parts. The row shows the first refusal.

export interface ScreenlessActionsProps {
  line: PointLine;
  /** v1.0.11 (STAB-5): the lines a grouped row stands for; default the line alone */
  parts?: readonly PointLine[];
  api: KdsApi;
  up: boolean;
  nowMs: number;
  /** hub clock now, at the reply */
  clock: () => number;
  /** order_item_id → hub ms of this tablet's own Done (shared by the screen) */
  doneAt: Map<string, number>;
  /** the card's line; null clears it */
  onMessage(message: CardMessage | null): void;
}

type Refused = Exclude<HubResult<unknown>, { ok: true }>;

function refusal(answer: Refused, action: 'start' | 'done' | 'undo'): CardMessage | null {
  if (answer.error.kind !== 'api') return { text: t('answer.error.offline'), tone: 'danger' };
  const { code, details } = answer.error;
  if (code === 'ITEM_WRONG_STAGE') {
    if (details['stage'] === 'added') return { text: t(action === 'start' ? 'pass.not_due' : 'kds.start_first'), tone: 'warn' };
    if (details['stage'] === 'cooking' || details['stage'] === 'done') return null;
    if (details['stage'] === 'out_of_engine') return { text: t('pass.gone'), tone: 'danger' };
  }
  if (code === 'ITEM_UNDO_WINDOW_CLOSED') return { text: t('pass.undo_closed'), tone: 'danger' };
  if (code === 'PERMISSION_DENIED') return { text: t('pass.read_only'), tone: 'danger' };
  return { text: t(errorKey(code)), tone: 'danger' };
}

const ICON = {
  start: 'M12 21c-4 0-6.5-2.6-6.5-6.2 0-3.6 2.8-5.6 4-8.8 2.2 1.4 2.8 3.6 2.6 5.4 1.2-.4 2-1.6 2.2-3 2 1.8 2.2 4.2 2.2 6.4C16.5 18.4 15 21 12 21z',
  done: 'M5 12.5l4.5 4.5L19 7.5',
  undo: 'M9 14.5L4 9.5l5-5',
};

export function ScreenlessActions({ line, parts = [line], api, up, nowMs, clock, doneAt, onMessage }: ScreenlessActionsProps) {
  const busy = useRef(false);
  const [confirm, setConfirm] = useState(false);
  const ids = parts.map((p) => p.order_item_id);
  /** the parts this tablet marked Done whose Undo window is still open */
  const undoable = ids.filter((id) => {
    const at = doneAt.get(id);
    return at !== undefined && nowMs - at <= UNDO_DONE_MS;
  });

  const send = (action: 'start' | 'done' | 'undo', id: string) =>
    action === 'start' ? api.startItem({ order_item_id: id }) : action === 'done' ? api.doneItem({ order_item_id: id, ...(confirm ? { confirm: true } : {}) }) : api.undoDone({ order_item_id: id });

  const run = async (action: 'start' | 'done' | 'undo') => {
    if (busy.current) return;
    busy.current = true;
    try {
      // ⚠️ 03b v1.0.12 §3.4 (STAB-5 Q5): Done by started_at, latest first (unknown last, then the later part first)
      const byStart = parts
        .map((p, i) => ({ id: p.order_item_id, at: p.started_at ?? Number.NEGATIVE_INFINITY, i }))
        .sort((a, b) => b.at - a.at || b.i - a.i)
        .map((p) => p.id);
      const targets = action === 'done' ? byStart : action === 'undo' ? undoable : ids;
      let message: CardMessage | null = null;
      let failed = false;
      for (const id of targets) {
        const answer = await send(action, id);
        if (answer.ok) {
          if (action === 'done') doneAt.set(id, clock());
          if (action === 'undo') doneAt.delete(id);
          continue;
        }
        if (action === 'done' && answer.error.kind === 'api' && answer.error.code === 'ITEM_DONE_CONFIRM_REQUIRED') {
          const e = answer.error.details['elapsed_ms'];
          const c = answer.error.details['cook_ms'];
          setConfirm(true);
          onMessage({ text: fill(t('kds.done_early'), { elapsed: clockText(typeof e === 'number' ? e : 0), cook: clockText(typeof c === 'number' ? c : 0) }), tone: 'warn' });
          return;
        }
        failed = true;
        message ??= refusal(answer, action);
      }
      // a lost reply keeps the confirm, so the retap re-sends the same command (same id)
      if (action === 'done' && !failed) setConfirm(false);
      onMessage(message);
    } finally {
      busy.current = false;
    }
  };

  // ⚠️ 03b v1.0.17 §8 (QA design review): the actions are small icon buttons in the line's own row (44 px targets);
  // the word stays for screen readers (and for the Undo the time stays visible)
  const btn = (action: 'start' | 'done' | 'undo', label: string, shown?: string) => (
    <button key={action} type="button" className={`btn btn--icon pl__ib btn--${action}`} disabled={!up} title={label} onClick={() => void run(action)}>
      <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d={ICON[action]} />
        {action === 'undo' && <path d="M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11" />}
      </svg>
      <span className="sr">{label}</span>
      {shown !== undefined && (
        <span className="num" aria-hidden="true">
          {shown}
        </span>
      )}
    </button>
  );

  if (line.handed_over) return null;
  if (line.stage === 'added') return <span className="pl__ia">{[btn('start', t('kds.start')), btn('done', t('kds.done'))]}</span>;
  if (line.stage === 'cooking') return <span className="pl__ia">{btn('done', t('kds.done'))}</span>;
  if (undoable.length === 0) return null;
  const latest = Math.max(...undoable.map((id) => doneAt.get(id) ?? 0));
  const left = clockText(UNDO_DONE_MS - (nowMs - latest));
  return <span className="pl__ia">{btn('undo', fill(t('kds.undo'), { time: left }), left)}</span>;
}
