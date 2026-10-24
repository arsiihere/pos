import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';

// Runs a hub-served page's inline script with stub DOM, IndexedDB, sessionStorage and timers.
// fetch is the test's; timers only fire through advance(), so backoff delays are observable.

interface StubElement {
  tagName: string;
  textContent: string;
  innerHTML: string;
  className: string;
  name: string;
  value: string;
  inputMode: string;
  dataset: Record<string, string>;
  options: Array<{ text: string; value: string }>;
  listeners: Record<string, (event: unknown) => void>;
  children: StubElement[];
  appendChild(child: StubElement): StubElement;
  replaceChildren(...children: StubElement[]): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  add(option: { text: string; value: string }): void;
}

function element(tagName: string): StubElement {
  const el: StubElement = {
    tagName,
    textContent: '',
    innerHTML: '',
    className: '',
    name: '',
    value: '',
    inputMode: '',
    dataset: {},
    options: [],
    listeners: {},
    children: [],
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      el.children = children;
      el.textContent = '';
    },
    addEventListener(type, listener) {
      el.listeners[type] = listener;
    },
    add(option) {
      el.options.push(option);
      if (el.options.length === 1) el.value = option.value;
    },
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
  find(name: string): StubElement | undefined;
  submit(form: StubElement): Promise<void>;
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
    Option: function Option(text: string, value?: string) {
      return { text, value: value ?? text };
    },
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
    find(name) {
      const walk = (el: StubElement): StubElement | undefined =>
        el.name === name ? el : el.children.map(walk).find((found) => found !== undefined);
      return walk(screen);
    },
    async submit(form) {
      form.listeners.submit?.({ preventDefault() {}, target: form });
      await settle();
    },
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
