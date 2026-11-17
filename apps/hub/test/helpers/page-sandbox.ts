import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';

// Runs a hub-served page's inline script with stub DOM, IndexedDB, sessionStorage and timers.
// fetch is the test's; timers only fire through advance(), so backoff delays are observable.
// getElementById returns one stub per id (created on first use), so a test can fill in a
// server-rendered input before submitting its form.

export interface StubElement {
  tagName: string;
  id: string;
  textContent: string;
  innerHTML: string;
  className: string;
  name: string;
  value: string;
  type: string;
  href: string;
  inputMode: string;
  hidden: boolean;
  disabled: boolean;
  isConnected: boolean;
  style: Record<string, string>;
  [extra: string]: unknown;
  dataset: Record<string, string>;
  attributes: Record<string, string>;
  options: Array<{ text: string; value: string }>;
  listeners: Record<string, (event: unknown) => void>;
  children: StubElement[];
  classList: { add(name: string): void; remove(name: string): void; contains(name: string): boolean; toggle(name: string, on?: boolean): void };
  appendChild(child: StubElement): StubElement;
  removeChild(child: StubElement): StubElement;
  replaceChildren(...children: StubElement[]): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  focus(): void;
  add(option: { text: string; value: string }): void;
}

// The element last focused (document.activeElement in the page script).
let focused: StubElement | null = null;

export function element(tagName: string): StubElement {
  const classes = (): string[] => el.className.split(/\s+/).filter(Boolean);
  const el: StubElement = {
    tagName,
    id: '',
    textContent: '',
    innerHTML: '',
    className: '',
    name: '',
    value: '',
    type: '',
    href: '',
    inputMode: '',
    hidden: false,
    disabled: false,
    isConnected: true,
    style: {},
    dataset: {},
    attributes: {},
    options: [],
    listeners: {},
    children: [],
    classList: {
      add(name) {
        if (!classes().includes(name)) el.className = [...classes(), name].join(' ');
      },
      remove(name) {
        el.className = classes()
          .filter((item) => item !== name)
          .join(' ');
      },
      contains(name) {
        return classes().includes(name);
      },
      toggle(name, on) {
        if (on ?? !classes().includes(name)) el.classList.add(name);
        else el.classList.remove(name);
      },
    },
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    removeChild(child) {
      el.children = el.children.filter((item) => item !== child);
      return child;
    },
    replaceChildren(...children) {
      el.children = children;
      el.textContent = '';
    },
    addEventListener(type, listener) {
      el.listeners[type] = listener;
    },
    setAttribute(name, value) {
      el.attributes[name] = value;
    },
    getAttribute(name) {
      return el.attributes[name] ?? null;
    },
    removeAttribute(name) {
      delete el.attributes[name];
    },
    focus() {
      focused = el;
    },
    add(option) {
      el.options.push(option);
      if (el.options.length === 1) el.value = option.value;
    },
  };
  return el;
}

// All visible text under an element, depth first.
export function textOf(el: StubElement | undefined): string {
  if (el === undefined) return '';
  return [el.textContent, ...el.children.map(textOf)].filter(Boolean).join(' ');
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
  documentElement: { lang: string; dir: string; theme: string };
  local: Map<string, string>;
  body: StubElement;
  store: Map<string, unknown>;
  session: Map<string, string>;
  delays: number[];
  /** every location.assign(url) the page made, in order */
  assigned: string[];
  prompts: number;
  // document.activeElement: the element the script focused last.
  active: StubElement | null;
  byId(id: string): StubElement;
  find(name: string, root?: StubElement): StubElement | undefined;
  findAll(match: (el: StubElement) => boolean, root?: StubElement): StubElement[];
  submit(form: StubElement): Promise<void>;
  click(el: StubElement): Promise<void>;
  advance(): Promise<boolean>;
  settle(): Promise<void>;
}

export async function runPage(
  html: string,
  o: {
    fetch: (url: string, init?: unknown) => Promise<unknown>;
    store?: Record<string, unknown>;
    session?: Record<string, string>;
    search?: string;
    hash?: string;
    userAgent?: string;
    language?: string;
    local?: Record<string, string>;
    innerWidth?: number;
  },
): Promise<PageSandbox> {
  focused = null;
  const script = html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
  const store = new Map<string, unknown>(Object.entries(o.store ?? {}));
  const session = new Map<string, string>(Object.entries(o.session ?? {}));
  const ids = new Map<string, StubElement>();
  const local = new Map<string, string>(Object.entries(o.local ?? {}));
  const documentElement = {
    lang: 'en',
    dir: 'ltr',
    theme: '',
    setAttribute(name: string, value: string) {
      if (name === 'data-theme') documentElement.theme = value;
    },
  };
  const byId = (id: string): StubElement => {
    let found = ids.get(id);
    if (found === undefined) {
      found = element('div');
      found.id = id;
      ids.set(id, found);
    }
    return found;
  };
  const screen = byId('screen');
  const body = element('body');
  const timers: Array<{ id: number; fn: () => void }> = [];
  const delays: number[] = [];
  const assigned: string[] = [];
  let nextTimer = 1;
  const counters = { prompts: 0 };
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
      getElementById: byId,
      createElement: element,
      createTextNode: (text: string) => Object.assign(element('#text'), { textContent: text }),
      body,
      documentElement,
      get activeElement() {
        return focused;
      },
    },
    localStorage: {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => void local.set(key, String(value)),
    },
    URL,
    indexedDB: { open: () => idbRequest(() => db) },
    sessionStorage: {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => void session.set(key, String(value)),
      removeItem: (key: string) => void session.delete(key),
    },
    location: { search: o.search ?? '', hash: o.hash ?? '', pathname: '/pair', assign: (url: string) => void assigned.push(String(url)) },
    history: { replaceState() {} },
    navigator: { userAgent: o.userAgent ?? 'test', language: o.language ?? 'en-US' },
    window: {
      innerWidth: o.innerWidth ?? 1280,
      prompt: () => {
        counters.prompts += 1;
        return null;
      },
    },
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
      const id = nextTimer;
      nextTimer += 1;
      delays.push(ms);
      timers.push({ id, fn });
      return id;
    },
    clearTimeout: (id: number) => {
      const at = timers.findIndex((timer) => timer.id === id);
      if (at !== -1) timers.splice(at, 1);
    },
  });
  await settle();
  const findAll = (match: (el: StubElement) => boolean, root: StubElement = screen): StubElement[] => {
    const out: StubElement[] = [];
    const walk = (el: StubElement): void => {
      if (match(el)) out.push(el);
      el.children.forEach(walk);
    };
    walk(root);
    return out;
  };
  return {
    screen,
    documentElement,
    local,
    body,
    store,
    session,
    delays,
    assigned,
    get prompts() {
      return counters.prompts;
    },
    get active() {
      return focused;
    },
    byId,
    settle,
    findAll,
    find(name, root) {
      return findAll((el) => el.name === name, root)[0];
    },
    async submit(form) {
      form.listeners.submit?.({ preventDefault() {}, target: form, currentTarget: form });
      await settle();
    },
    async click(el) {
      el.listeners.click?.({ preventDefault() {}, target: el, currentTarget: el });
      await settle();
    },
    async advance() {
      const next = timers.shift();
      if (next === undefined) return false;
      next.fn();
      await settle();
      return true;
    },
  };
}

export function jsonResponse(status: number, body: unknown): { status: number; ok: boolean; json: () => Promise<unknown> } {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}
