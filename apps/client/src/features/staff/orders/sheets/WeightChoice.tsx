import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico } from '../../../alerts/ui';

// 02-D04 OptionsWeight / OptionsWeighLater (02b §3.6, 01c V18): a weighed item is added with its weight now — typed
// in kg (or L) on the pad, rounded to 50 g, 50 g … 50 kg (set-line-weight's range) — or "Weigh later": quantity
// null, "Weight pending", the price after weighing.

export const WEIGHT_STEP = 50;
export const WEIGHT_MIN = 50;
export const WEIGHT_MAX = 50_000;

export type WeightMode = 'now' | 'later';

/**
 * "1.25" kg → 1250 g: the text read as whole grams (no float), rounded half-up to 50 g in integers; null when empty,
 * not a number, or outside 50 … 50 000 (set-line-weight's range).
 */
export function gramsOf(text: string): number | null {
  const m = /^(\d*)(?:\.(\d{0,3}))?$/.exec(text);
  if (m === null || text === '' || text === '.') return null;
  const whole = m[1] === '' ? 0 : Number.parseInt(m[1]!, 10);
  const milli = Number.parseInt((m[2] ?? '').padEnd(3, '0'), 10);
  const g = whole * 1000 + milli;
  const grams = Math.floor((g * 2 + WEIGHT_STEP) / (2 * WEIGHT_STEP)) * WEIGHT_STEP;
  return grams >= WEIGHT_MIN && grams <= WEIGHT_MAX ? grams : null;
}

/** The pad: digits, one '.', at most 3 decimals; Delete takes the last character. */
export function typed(text: string, key: string): string {
  if (key === 'del') return text.slice(0, -1);
  if (key === '.') return text.includes('.') ? text : `${text === '' ? '0' : text}.`;
  const next = text === '0' ? key : text + key;
  const [whole, dec] = next.split('.');
  if ((dec ?? '').length > 3 || (whole ?? '').length > 2) return text;
  return next;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const;

export function WeightChoice({
  mode,
  text,
  unit,
  canLater,
  onMode,
  onText,
}: {
  mode: WeightMode;
  text: string;
  /** the pad's unit word ("kg" for g items, "L" for ml) */
  unit: 'kg' | 'L';
  /** only an item that requires weighing may be weighed later */
  canLater: boolean;
  onMode(mode: WeightMode): void;
  onText(text: string): void;
}) {
  return (
    <>
      {canLater && (
        <div className="on-light">
          <div className="seg seg--fill" role="radiogroup">
            <button type="button" aria-pressed={mode === 'now'} onClick={() => onMode('now')}>
              {t('weight.now')}
            </button>
            <button type="button" aria-pressed={mode === 'later'} onClick={() => onMode('later')}>
              {t('weight.later')}
            </button>
          </div>
        </div>
      )}
      {mode === 'now' ? (
        <>
          <div className="inp inp--big num" dir="ltr" role="status" aria-label={t('weight.entered')}>
            {text === '' ? '0' : text} <span className="unit">{unit}</span>
          </div>
          <div className="wpad">
            {KEYS.map((k) => (
              <button key={k} type="button" className={k === 'del' ? 'btn btn--fn' : 'btn'} onClick={() => onText(typed(text, k))}>
                {k === 'del' ? t('weight.delete') : k}
              </button>
            ))}
          </div>
          {text !== '' && gramsOf(text) === null && (
            <div className="ro c-warn" role="alert">
              <Ico name="warn" />
              <span>{fill(t('weight.range'), { unit })}</span>
            </div>
          )}
        </>
      ) : (
        <div className="ro" role="status">
          <Ico name="info" />
          <span>{t('weight.later_note')}</span>
        </div>
      )}
    </>
  );
}
