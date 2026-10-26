// Kit .pos-switch: a native button (Space and Enter work) with role="switch".
export function Switch({
  checked,
  label,
  onChange,
  disabled = false,
  name,
}: {
  checked: boolean;
  label: string;
  // The thing it switches when the visible word is only its state ("Selling" for "On").
  name?: string;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="pos-switch"
      role="switch"
      aria-checked={checked}
      aria-label={name}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="pos-switch__track" />
      {label}
    </button>
  );
}
