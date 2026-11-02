import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// 01d task 41: a mounted React tree for component tests (the pattern of the admin-stock tests, shared).

export interface Mounted {
  container: HTMLDivElement;
  render(node: ReactNode): void;
  text(): string;
  /** the first button (or role=button) whose text contains `label` */
  button(label: string, within?: ParentNode): HTMLElement;
  buttons(): HTMLElement[];
  click(el: Element | null | undefined): void;
  key(el: Element | null | undefined, key: string): void;
  unmount(): void;
}

export function mount(): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const all = (within: ParentNode = container) => [...within.querySelectorAll<HTMLElement>('button, [role="button"], a')];
  return {
    container,
    render(node) {
      act(() => root.render(node));
    },
    text: () => container.textContent ?? '',
    buttons: () => all(),
    button(label, within) {
      const found = all(within).find((b) => (b.textContent ?? '').includes(label) || b.getAttribute('aria-label') === label);
      if (found === undefined) throw new Error(`no button "${label}" in: ${(within ?? container).textContent ?? ''}`);
      return found;
    },
    click(el) {
      if (el === null || el === undefined) throw new Error('nothing to click');
      act(() => (el as HTMLElement).click());
    },
    key(el, key) {
      if (el === null || el === undefined) throw new Error('nothing to press');
      act(() => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Lets pending promises (fetch replies) settle inside act. */
export async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

export function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
