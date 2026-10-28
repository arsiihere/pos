import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { Chip } from './Chip';

// S50 d: the Saved chip shows for 3 s near what changed.
export const SAVED_MS = 3_000;
// S50 b: a table or program archive can be undone for 8 s.
export const UNDO_MS = 8_000;

export function useFlash(ms: number = SAVED_MS): { shown: boolean; flash: () => void } {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const flash = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    setShown(true);
    timer.current = setTimeout(() => setShown(false), ms);
  }, [ms]);
  return { shown, flash };
}

export function SavedChip({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return (
    <span role="status">
      <Chip tone="ok">{t('common.saved')}</Chip>
    </span>
  );
}

// While `paused` (cloud unreachable, S53) the chip stays; it gets a full 8 s once the pause ends.
export function UndoChip({ onUndo, onDone, paused = false }: { onUndo: () => void; onDone: () => void; paused?: boolean }) {
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onDone, UNDO_MS);
    return () => clearTimeout(timer);
  }, [paused, onDone]);
  return (
    <span className="pos-row" role="status">
      <Chip tone="ok">{t('archive.archived')}</Chip>
      <button type="button" className="pos-btn" onClick={onUndo}>
        {t('common.undo')}
      </button>
    </span>
  );
}
