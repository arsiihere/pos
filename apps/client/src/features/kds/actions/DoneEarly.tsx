import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { KdsRow } from '../store';
import { clockText } from '../station/LineTimer';
import { buttonFor, undoLeft, type CompletionMode, type RowState } from './actions';

// 03b §3.2 (K3; frames 03b-B01, 03b-B02, 03b-B03, KdsKarahi): the row's stage button — Start, then Done, then
// "Undo m:ss" for UNDO_DONE_MS. `422 ITEM_DONE_CONFIRM_REQUIRED` turns Done into the inline confirm "Done already?
// 2:00 of 6:00 — tap again" (no modal); its tap sends DoneItem { confirm: true }. After "Tap Start first" the Start
// button shows (highlighted) whatever the mode said. A sent tap shows busy on that button only.

const ICON = {
  start: 'M8 5.5v13l10-6.5z',
  done: 'M5 12.5l4.5 4.5L19 7.5',
  undo: 'M9 14.5L4 9.5l5-5M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11',
};

function Icon({ d }: { d: string }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function DoneEarly({ elapsed_ms, cook_ms, disabled, onTap }: { elapsed_ms: number; cook_ms: number; disabled: boolean; onTap: () => void }) {
  const [before, after = ''] = t('kds.done_early').split('{elapsed}');
  const text = fill(after, { cook: clockText(cook_ms) });
  return (
    <button type="button" className="btn btn--confirm" disabled={disabled} onClick={onTap}>
      <Icon d={ICON.done} />
      {before}
      <span className="num">{clockText(elapsed_ms)}</span>
      {text}
    </button>
  );
}

export function RowActions({
  row,
  mode,
  nowMs,
  up,
  state,
  onTap,
}: {
  row: KdsRow;
  mode: CompletionMode;
  nowMs: number;
  up: boolean;
  state: RowState;
  onTap: (action: 'start' | 'done' | 'undo', confirm?: boolean) => void;
}) {
  const disabled = !up || state.busy !== null;
  if (state.msg?.kind === 'confirm' && row.stage !== 'done') {
    return <DoneEarly elapsed_ms={state.msg.elapsed_ms} cook_ms={state.msg.cook_ms} disabled={disabled} onTap={() => onTap('done', true)} />;
  }
  const startFirst = state.msg?.kind === 'start_first' && row.stage === 'added';
  const which = startFirst ? 'start' : buttonFor(row, mode, nowMs);
  if (which === null) return null;
  const busy = state.busy === which ? ' busy' : '';
  if (which === 'undo') {
    return (
      <button type="button" className={`btn btn--undo${busy}`} disabled={disabled} aria-busy={busy !== ''} onClick={() => onTap('undo')}>
        <Icon d={ICON.undo} />
        {t('kds.undo').split('{time}')[0]}
        <span className="num">{clockText(undoLeft(row, nowMs))}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`btn btn--${which}${startFirst ? ' hot' : ''}${busy}`}
      disabled={disabled}
      aria-busy={busy !== ''}
      onClick={() => onTap(which)}
    >
      <Icon d={ICON[which]} />
      {t(which === 'start' ? 'kds.start' : 'kds.done')}
    </button>
  );
}
