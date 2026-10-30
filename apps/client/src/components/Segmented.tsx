import { useRef, type KeyboardEvent } from 'react';

// Kit .pos-seg: one pressed option; arrow keys move in reading direction (left is "next" in RTL).
export interface SegOption<V extends string> {
  value: V;
  label: string;
  count?: number;
}

export function Segmented<V extends string>({
  label,
  options,
  value,
  onChange,
  block = false,
  locked = false,
}: {
  label: string;
  options: readonly SegOption<V>[];
  value: V;
  onChange: (value: V) => void;
  block?: boolean;
  // Only the pressed option can be chosen (the other options are disabled), e.g. a station type in use.
  locked?: boolean;
}) {
  const group = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (locked) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const rtl = group.current?.closest('[dir]')?.getAttribute('dir') === 'rtl';
    const forward = (event.key === 'ArrowRight') !== rtl;
    const at = options.findIndex((o) => o.value === value);
    const next = Math.min(options.length - 1, Math.max(0, at + (forward ? 1 : -1)));
    const option = options[next];
    if (option === undefined) return;
    event.preventDefault();
    onChange(option.value);
    group.current?.querySelectorAll<HTMLButtonElement>('.pos-seg__opt')[next]?.focus();
  };

  return (
    <div
      ref={group}
      className={`pos-seg${block ? ' pos-seg--block' : ''}`}
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="pos-seg__opt"
          aria-pressed={o.value === value}
          disabled={locked && o.value !== value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span className="pos-seg__count pos-ltr">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
