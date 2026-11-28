import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';

// S35 i: UI kit PIN pad for the admin login (and 02's staff login). Digits stay in this component
// until submit; the typed PIN is never rendered, only filled dots.
export const PIN_MAX_LENGTH = 6;

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function PinPad({
  onSubmit,
  disabled = false,
  error = false,
}: {
  onSubmit: (pin: string) => void;
  disabled?: boolean;
  error?: boolean;
}) {
  const [pin, setPin] = useState('');

  const press = (digit: string) => setPin((p) => (p.length < PIN_MAX_LENGTH ? p + digit : p));
  const submit = () => {
    if (pin === '') return;
    onSubmit(pin);
    setPin('');
  };
  // ⚠️ 01a v2.12 QS-3 (BUG-22): the keyboard too — digits (main row and keypad), Backspace, Enter — while the pad is
  // enabled; a key typed in a text field stays that field's
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (disabled || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const target = e.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(target.type)))) return;
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      press(e.key);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      setPin((p) => p.slice(0, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`pos-pin${error ? ' is-error' : ''}${disabled ? ' is-locked' : ''}`}>
      <div className="pos-pin__dots" aria-label={t('pin.label')}>
        {Array.from({ length: PIN_MAX_LENGTH }, (_, i) => (
          <span key={i} className={`pos-pin__dot${i < pin.length ? ' is-filled' : ''}`} />
        ))}
      </div>
      <div className="pos-pin__keys">
        {DIGITS.map((d) => (
          <button key={d} type="button" className="pos-pin__key" disabled={disabled} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button
          type="button"
          className="pos-pin__key pos-pin__key--fn"
          disabled={disabled}
          onClick={() => setPin((p) => p.slice(0, -1))}
        >
          {t('pin.delete')}
        </button>
        <button type="button" className="pos-pin__key" disabled={disabled} onClick={() => press('0')}>
          0
        </button>
        <button type="button" className="pos-pin__key pos-pin__key--fn" disabled={disabled} onClick={submit}>
          {t('pin.submit')}
        </button>
      </div>
    </div>
  );
}
