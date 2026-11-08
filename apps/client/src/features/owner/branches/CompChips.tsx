import { Icon } from '../../../components/Icon';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';

// 01a v2.3 §5.2a (02b A-1, 02b §3.9): the reasons offered when an order taker comps a line, as a list of
// 1–10 labels of 1–30 characters. The list is replaced as a whole. "Other" is a label like the rest; that a
// reason called other always needs a note is the order screen's rule, not this form's.
export const DEFAULT_CHIPS = ['Late', 'Wrong item', 'Quality', 'Guest', 'Other'];
const MAX_CHIPS = 10;
const MAX_LENGTH = 30;

export const chipsOf = (base: { comp_reason_chips?: string[] }): string[] => base.comp_reason_chips ?? DEFAULT_CHIPS;

// The chips as a PATCH value (trimmed), or null when unchanged; `error` is the text to show when a label or the count is out of range.
export function chipsPatch(chips: readonly string[], base: readonly string[]): { patch: string[] | null; error: string | null } {
  const trimmed = chips.map((c) => c.trim());
  if (trimmed.length < 1 || trimmed.length > MAX_CHIPS || trimmed.some((c) => c.length < 1 || c.length > MAX_LENGTH)) {
    return { patch: null, error: fill(t('branches.chips.range'), { max: String(MAX_LENGTH), n: String(MAX_CHIPS) }) };
  }
  return { patch: JSON.stringify(trimmed) === JSON.stringify(base) ? null : trimmed, error: null };
}

export function CompChips({ chips, onChange, error }: { chips: string[]; onChange: (next: string[]) => void; error: string | undefined }) {
  return (
    <section className="pos-section pos-settings" data-group="comp-chips">
      <div className="pos-section__head">
        <h2>{t('branches.chips')}</h2>
        <p>{t('branches.chips_help')}</p>
      </div>
      <div className={`pos-stack${error !== undefined ? ' pos-field--error' : ''}`}>
        {chips.map((chip, i) => (
          <div key={i} className="pos-row">
            <input
              className="pos-input"
              name="comp_reason_chips"
              aria-label={fill(t('branches.chips.label_n'), { n: String(i + 1) })}
              value={chip}
              onChange={(e) => onChange(chips.map((c, j) => (j === i ? e.target.value : c)))}
            />
            <button
              type="button"
              className="pos-btn"
              data-chip-remove=""
              aria-label={fill(t('branches.chips.remove_n'), { name: chip })}
              disabled={chips.length <= 1}
              onClick={() => onChange(chips.filter((_, j) => j !== i))}
            >
              <Icon name="x" />
            </button>
          </div>
        ))}
        {error !== undefined && <span className="pos-field__error">{error}</span>}
        <div className="pos-row">
          <button type="button" className="pos-btn" disabled={chips.length >= MAX_CHIPS} onClick={() => onChange([...chips, ''])}>
            <Icon name="plus" />
            {t('branches.chips.add')}
          </button>
        </div>
      </div>
    </section>
  );
}
