import { useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { CloseX, Dialog } from '../../../alerts/ui';

// 02-D05 / D06 (handoff KitchenNote): kitchen note ≤ 80, order note ≤ 200 (02b §8 Ordering screen), typing only —
// no quick chips (CHANGES Q2) — `dir="auto"` so Urdu and English notes each read their own way. Empty = no note.

export const KITCHEN_NOTE_MAX = 80;
export const ORDER_NOTE_MAX = 200;

/** Cut to `max` UTF-16 units without splitting a surrogate pair (an IME may pass maxLength while composing). */
export function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

export function NoteSheet({
  title,
  max,
  initial,
  sheet,
  onSave,
  onClose,
}: {
  title: string;
  max: typeof KITCHEN_NOTE_MAX | typeof ORDER_NOTE_MAX;
  initial: string | undefined;
  sheet: boolean;
  onSave(note: string | undefined): void;
  onClose(): void;
}) {
  const [text, setText] = useState(clamp(initial ?? '', max));
  // counted in UTF-16 units, as the hub's z.string().max() counts (submit-order.ts :46, :62)
  const length = text.length;
  return (
    <Dialog sheet={sheet} labelledBy="note-t" onClose={onClose}>
      <div className="dlg__h">
        <div className="dlg__t">
          <h2 id="note-t">{title}</h2>
          <div className="ac__who">{t('note.sub')}</div>
        </div>
        <CloseX onClose={onClose} />
      </div>
      <label className="fld">
        <span className="fld__l">
          {t('note.label')}
          <span className="cntr num">{fill(t('note.count'), { n: String(length), max: String(max) })}</span>
        </span>
        <textarea className="inp inp--note" dir="auto" maxLength={max} value={text} onChange={(e) => setText(clamp(e.target.value, max))} />
      </label>
      <div className="acts">
        <button type="button" className="btn" onClick={onClose}>
          {t('note.cancel')}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            const note = clamp(text, max).trim();
            onSave(note === '' ? undefined : note);
          }}
        >
          {t('note.save')}
        </button>
      </div>
    </Dialog>
  );
}
