// ⚠️ 00 v1.14 M101 (owner 2026-11-28 Q8; QA BUG-12): the signed-in person's input on the page is activity for the hub's
// idle timer. A pointerdown or keydown on the document sends the light activity signal (GET /queries/activity) at most
// once per INPUT_ACTIVITY_MS; the first input after a quiet minute sends at once. Nothing else sends it — no timer, no
// socket frame, no poll, no focus or visibility change — so watching a live screen still idles out (M59).

export const INPUT_ACTIVITY_MS = 60_000;

const INPUT_EVENTS = ['pointerdown', 'keydown'] as const;

export interface InputActivityTarget {
  addEventListener(type: string, fn: () => void, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, fn: () => void, options?: boolean | EventListenerOptions): void;
}

export function createInputActivity(o: { send: () => void; now: () => number; target: InputActivityTarget }): { attach(): () => void } {
  let last = Number.NEGATIVE_INFINITY;
  const onInput = () => {
    const now = o.now();
    if (now - last < INPUT_ACTIVITY_MS) return;
    last = now;
    o.send();
  };
  return {
    attach() {
      for (const type of INPUT_EVENTS) o.target.addEventListener(type, onInput, { capture: true, passive: true });
      return () => {
        for (const type of INPUT_EVENTS) o.target.removeEventListener(type, onInput, { capture: true });
      };
    },
  };
}
