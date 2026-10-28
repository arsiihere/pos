import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { createCloudAdmin } from '../../api/cloud-admin';

// Test-only helpers for the 01b owner views (tasks 51–55): a cloud client over a fake fetch, a mounted
// root, and DOM actions. Kept out of the views; vitest picks up only *.test.* files as tests.

export interface Call {
  method: string;
  url: string;
  key: string | undefined;
  body: unknown;
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function ok(data: unknown): Response {
  return json(200, { data });
}

export function fail(status: number, code: string, details: Record<string, unknown> = {}): Response {
  return json(status, { error: { code, message: code, details } });
}

export function fakeApi(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const api = createCloudAdmin({
    onLoggedOut: () => {},
    fetch: async (url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const call: Call = {
        method: init?.method ?? 'GET',
        url,
        key: headers['Idempotency-Key'],
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      };
      calls.push(call);
      return handler(call);
    },
  });
  return { api, calls };
}

export interface Mounted {
  container: HTMLDivElement;
  render: (node: ReactNode) => Promise<void>;
  unmount: () => void;
}

export function mount(): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  return {
    container,
    render: async (node) => {
      act(() => root.render(node));
      await flush();
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export function setValue(el: HTMLInputElement | HTMLSelectElement | null | undefined, value: string): void {
  if (!el) throw new Error('field missing');
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

export function button(within: ParentNode, label: string): HTMLButtonElement {
  const found = [...within.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`button ${label} missing`);
  return found;
}

export async function click(el: HTMLElement): Promise<void> {
  await act(async () => el.click());
  await flush();
}
