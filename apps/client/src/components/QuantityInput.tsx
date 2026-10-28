import { useEffect, useState } from 'react';
import { formatQuantity, parseQuantity, type Unit } from '@pos/domain';
import { t } from '../i18n';

// S44: quantities are integers in the smallest unit; the input shows pieces, kg or L.
const UNIT_LABEL = { piece: 'quantity.pieces', g: 'quantity.kg', ml: 'quantity.l' } as const;

function shown(value: number | null, unit: Unit): string {
  // formatQuantity adds " kg" / " L" for g / ml; the unit is shown beside the input instead.
  return value === null ? '' : (formatQuantity(value, unit).split(' ')[0] ?? '');
}

function parsedValue(text: string, unit: Unit): number | null | undefined {
  if (text.trim() === '') return null;
  const parsed = parseQuantity(text, unit);
  return parsed.ok ? parsed.value : undefined;
}

export function QuantityInput({
  unit,
  value,
  onChange,
  compact = false,
  showUnit = true,
  label,
}: {
  unit: Unit;
  value: number | null;
  onChange: (value: number | null) => void;
  // Inside the kit's .pos-count cell (the stock row): the input and its unit, no field wrapper.
  compact?: boolean;
  // A compact input next to another one in the same unit can leave the unit out.
  showUnit?: boolean;
  label?: string;
}) {
  const [text, setText] = useState(() => shown(value, unit));

  // Follow a new value or unit from the parent unless the typed text already means it.
  useEffect(() => {
    setText((current) => (parsedValue(current, unit) === value ? current : shown(value, unit)));
  }, [value, unit]);

  const invalid = parsedValue(text, unit) === undefined;
  const input = (
    <input
      className="pos-input pos-input--mono"
      type="text"
      inputMode={unit === 'piece' ? 'numeric' : 'decimal'}
      autoComplete="off"
      aria-label={label}
      aria-invalid={invalid}
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const v = parsedValue(next, unit);
        if (v !== undefined) onChange(v);
      }}
    />
  );

  if (compact) {
    return (
      <>
        {input}
        {showUnit && <span className="pos-count__unit">{t(unit === 'piece' ? 'quantity.pcs' : UNIT_LABEL[unit])}</span>}
        {invalid && <span className="pos-field__error">{t('quantity.invalid')}</span>}
      </>
    );
  }

  return (
    <div className={`pos-field${invalid ? ' pos-field--error' : ''}`}>
      <div className="pos-row pos-ltr">
        {input}
        <span>{t(UNIT_LABEL[unit])}</span>
      </div>
      {invalid && <p className="pos-field__error">{t('quantity.invalid')}</p>}
    </div>
  );
}
