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

export interface ScreenlessActionsProps {
  line: PointLine;
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

export function ScreenlessActions({ line, api, up, nowMs, clock, doneAt, onMessage }: ScreenlessActionsProps) {
  const busy = useRef(false);
  const [confirm, setConfirm] = useState(false);
  const id = line.order_item_id;

  const run = async (action: 'start' | 'done' | 'undo') => {
    if (busy.current) return;
    busy.current = true;
    try {
      const answer =
        action === 'start' ? await api.startItem({ order_item_id: id }) : action === 'done' ? await api.doneItem({ order_item_id: id, ...(confirm ? { confirm: true } : {}) }) : await api.undoDone({ order_item_id: id });
      if (answer.ok) {
        if (action === 'done') {
          doneAt.set(id, clock());
          setConfirm(false);
        }
        if (action === 'undo') doneAt.delete(id);
        onMessage(null);
        return;
      }
      if (action === 'done' && answer.error.kind === 'api' && answer.error.code === 'ITEM_DONE_CONFIRM_REQUIRED') {
        const e = answer.error.details['elapsed_ms'];
        const c = answer.error.details['cook_ms'];
        setConfirm(true);
        onMessage({ text: fill(t('kds.done_early'), { elapsed: clockText(typeof e === 'number' ? e : 0), cook: clockText(typeof c === 'number' ? c : 0) }), tone: 'warn' });
        return;
      }
      onMessage(refusal(answer, action));
    } finally {
      busy.current = false;
    }
  };

  const btn = (action: 'start' | 'done' | 'undo', label: string) => (
    <button key={action} type="button" className={`btn btn--${action}`} disabled={!up} onClick={() => void run(action)}>
      <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d={ICON[action]} />
        {action === 'undo' && <path d="M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11" />}
      </svg>
      {label}
    </button>
  );

  if (line.handed_over) return null;
  if (line.stage === 'added') return <div className="pl__a">{[btn('start', t('kds.start')), btn('done', t('kds.done'))]}</div>;
  if (line.stage === 'cooking') return <div className="pl__a pl__a--1">{btn('done', t('kds.done'))}</div>;
  const at = doneAt.get(id);
  if (at === undefined || nowMs - at > UNDO_DONE_MS) return null;
  return <div className="pl__a pl__a--1">{btn('undo', fill(t('kds.undo'), { time: clockText(UNDO_DONE_MS - (nowMs - at)) }))}</div>;
}
