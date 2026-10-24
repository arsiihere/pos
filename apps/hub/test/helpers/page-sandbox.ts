import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';

// Runs a hub-served page's inline script with stub DOM, IndexedDB, sessionStorage and timers.
// fetch is the test's; timers only fire through advance(), so backoff delays are observable.

interface StubElement {
  tagName: string;
  textContent: string;
  innerHTML: string;
  className: string;
  children: StubElement[];
  appendChild(child: StubElement): StubElement;
  replaceChildren(...children: StubElement[]): void;
  addEventListener(): void;
}

function element(tagName: string): StubElement {
  const el: StubElement = {
    tagName,
    textContent: '',
    innerHTML: '',
    className: '',
    children: [],
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      el.children = children;
      el.textContent = '';
    },
    addEventListener() {},
  };
  return el;
}

function idbRequest<T>(result: () => T): { result?: T; onsuccess?: () => void; onerror?: () => void } {
  const request: { result?: T; onsuccess?: () => void; onerror?: () => void } = {};
  queueMicrotask(() => {
    request.result = result();
    request.onsuccess?.();
  });
  return request;
}

export interface PageSandbox {
  screen: StubElement;
  body: StubElement;
  store: Map<string, unknown>;
  delays: number[];
  advance(): Promise<boolean>;
  settle(): Promise<void>;
}

export async function runPage(
  html: string,
  o: { fetch: (url: string, init?: unknown) => Promise<unknown>; store?: Record<string, unknown>; search?: string },
): Promise<PageSandbox> {
  const script = html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
  const store = new Map<string, unknown>(Object.entries(o.store ?? {}));
  const screen = element('div');
  const body = element('body');
  const timers: Array<() => void> = [];
  const delays: number[] = [];
  const objectStore = {
    get: (key: string) => idbRequest(() => store.get(key)),
    put: (value: unknown, key: string) => idbRequest(() => void store.set(key, value)),
    delete: (key: string) => idbRequest(() => void store.delete(key)),
  };
  const db = { objectStoreNames: { contains: () => true }, transaction: () => ({ objectStore: () => objectStore }) };
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  runInNewContext(script, {
    document: {
      getElementById: (id: string) => (id === 'screen' ? screen : null),
      createElement: element,
      body,
    },
    indexedDB: { open: () => idbRequest(() => db) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { search: o.search ?? '', hash: '', pathname: '/pair' },
    history: { replaceState() {} },
    navigator: { userAgent: 'test' },
    window: { prompt: () => null },
    crypto: webcrypto,
    URLSearchParams,
    JSON,
    Math,
    BigInt,
    Number,
    Promise,
    fetch: o.fetch,
    setTimeout: (fn: () => void, ms: number) => {
      delays.push(ms);
      timers.push(fn);
    },
  });
  await settle();
  return {
    screen,
    body,
    store,
    delays,
    settle,
    async advance() {
      const next = timers.shift();
      if (next === undefined) return false;
      next();
      await settle();
      return true;
    },
  };
}

export function jsonResponse(status: number, body: unknown): { status: number; json: () => Promise<unknown> } {
  return { status, json: async () => body };
}
