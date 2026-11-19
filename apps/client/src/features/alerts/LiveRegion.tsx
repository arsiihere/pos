import { useEffect, useState } from 'react';

// 01d v1.3 §3.13.6 (n4): the staff shell's one polite live region. A deep link moves no keyboard focus; it says
// "Opened <place>" here instead. Visually hidden (.sr), not the toast. The staff shell mounts it once (cs6).

let said: { text: string; n: number } = { text: '', n: 0 };
const listeners = new Set<() => void>();

/** Puts `text` in the live region. The same text again is a new node, so a screen reader reads the repeat. */
export function announce(text: string): void {
  said = { text, n: said.n + 1 };
  for (const l of listeners) l();
}

/** Starts empty: only what is said while it is mounted is shown, so a remount (sign-in, a new session) reads
 *  nothing old. */
export function LiveRegion() {
  const [{ text, n }, setSaid] = useState({ text: '', n: 0 });
  useEffect(() => {
    const l = () => setSaid(said);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return (
    <div className="sr" role="status" aria-live="polite" aria-atomic="true">
      {text !== '' && <span key={n}>{text}</span>}
    </div>
  );
}
