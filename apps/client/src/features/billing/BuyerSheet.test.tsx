import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { setLanguage } from '../../i18n';
import { en } from '../../i18n/en';
import { ur } from '../../i18n/ur';
import enSource from '../../i18n/en.ts?raw';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import { createLiveBus } from '../staff/shell/live';
import { createPermissions } from '../staff/shell/permissions';
import { createToastBus } from '../staff/shell/toast';
import { acceptedBuyerTypes, BuyerSheet, type BuyerEntry } from './BillSheets';
import type { BillView } from './contracts';
import { TODO_05 } from './urdu-todo-05';

// 05 v1.0.18 §8 (buyer sheet when buyer.required: name + a type from the jurisdiction's accepted types + the ID;
// "Customer refuses" → WaiveBuyerId), §6.11, §6.12 `buyer`, B19 (plan §3.1 task 37, after hub task 18; brief §3.5.3;
// frames Buyer, BuyerWaiveWaiting, BuyerUrdu). Privacy: the ID lives only in the field and the close that sends it.

type Answer = { ok: true; data: unknown } | { ok: false; error: { kind: 'api'; status: number; code: string; details: Record<string, unknown> } | { kind: 'network' } };

const tot = (total_minor: number) => ({ subtotal_minor: total_minor, discount_minor: 0, service_charge_minor: 0, taxes: [], rounding_minor: 0, total_minor });
const RULE = (effective_from: string, types: Array<{ type: string; label: string; pattern: string; strip: string }>) => ({
  effective_from,
  prices_include_tax: false,
  rounding_step_minor: 100,
  rounding_mode: 'half_up',
  rounding_applies_to: 'all',
  mixed_class_rule: 'higher_rate',
  buyer_id: { threshold_minor: 5_000_000, accepted_types: types },
  receipt: { fiscal_number_label: null, tax_reg_labels: [], show_qr: false, qr_url_template: null, buyer_id_on_receipt: true },
  catch_up_window_ms: null,
  credit_support: 'credit_note',
  ref: null,
});
const PK_TYPES = [
  { type: 'CNIC', label: 'CNIC', pattern: '^[0-9]{13}$', strip: '-' },
  { type: 'NTN', label: 'NTN', pattern: '^[A-Za-z0-9]{7,9}$', strip: '' },
];
const SNAPSHOT = {
  currency_code: 'PKR',
  billing: { jurisdiction: { jurisdiction_id: 'PK-PB', adapter_key: 'PRA', currency_code: 'PKR', currency_exponent: 2, rules: [RULE('2026-01-01', [PK_TYPES[1]!]), RULE('2026-07-01', PK_TYPES), RULE('2027-01-01', [])] } },
};

function bill(over: Partial<BillView> = {}): BillView {
  return {
    bill_id: 'B9',
    state: 'open',
    order_type: 'dine_in',
    identifier: 'Family 2',
    lines: [],
    splits: [],
    currency: { code: 'PKR', exponent: 2 },
    as_of_seq: 3,
    service_charge: { rate_bp: 0, removed: false },
    discount: null,
    totals_default: tot(6_078_400),
    open_requests: [],
    prints: [],
    blocks: [],
    reopen_count: 0,
    check_printed_at: null,
    buyer: { required: true, threshold_minor: 5_000_000, waived: false },
    ...over,
  };
}

function setup(o: { answers?: Answer[]; grant?: 'allowed' | 'requires_approval' | null; snapshot?: unknown } = {}) {
  const queue = [...(o.answers ?? [])];
  const command = vi.fn(async (type: string, payload: unknown, opts?: { commandId?: string }): Promise<Answer> => {
    void type;
    void payload;
    void opts;
    return queue.shift() ?? { ok: true, data: { bill_id: 'B9', changed: true } };
  });
  const grants = o.grant === null ? {} : { 'close-without-buyer-id': { grant: o.grant ?? 'allowed', scope: 'branch' } };
  const snapshot = o.snapshot ?? SNAPSHOT;
  const shell = {
    api: { query: vi.fn(), command },
    live: createLiveBus(),
    toasts: createToastBus(),
    permissions: createPermissions(grants as never),
    config: { config: () => null, snapshot: () => snapshot, subscribe: () => () => {} },
    clock: { nowMs: () => Date.UTC(2026, 10, 20, 13, 40), utcOffsetMs: 0 },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  return { shell, command };
}

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  setLanguage('en');
});

async function show(s: ReturnType<typeof setup>, b: BillView = bill(), h: { onUse?: (x: BuyerEntry) => void; onWaived?: (x: string) => void; error?: 'value' | 'type' | null } = {}) {
  view = mount();
  view.render(
    <ShellContext.Provider value={s.shell}>
      <BuyerSheet bill={b} error={h.error ?? null} onUse={h.onUse ?? (() => {})} onWaived={h.onWaived ?? (() => {})} onClose={() => {}} />
    </ShellContext.Provider>,
  );
  await flush();
  return view;
}

const primary = (v: Mounted) => v.container.querySelector<HTMLButtonElement>('.acts .btn--primary')!;
const type = (el: HTMLInputElement | null | undefined, text: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text);
  el!.dispatchEvent(new Event('input', { bubbles: true }));
};
const input = (v: Mounted, label: string) => [...v.container.querySelectorAll('.b5-fld')].find((f) => f.querySelector('span')?.textContent?.startsWith(label))?.querySelector('input');

describe('[05 §8; §6.12 buyer, J-4] accepted buyer ID types', () => {
  it('the rule in force on the hub\'s date (latest effective_from ≤ today): its types with label, pattern and strip', () => {
    expect(acceptedBuyerTypes(SNAPSHOT, '2026-11-20').map((x) => x.type)).toEqual(['CNIC', 'NTN']);
    expect(acceptedBuyerTypes(SNAPSHOT, '2026-03-01').map((x) => x.type)).toEqual(['NTN']);
    expect(acceptedBuyerTypes({ currency_code: 'PKR' }, '2026-11-20')).toEqual([]);
  });
});

describe('[05 §8; brief §3.5.3] buyer sheet (task 37, after hub task 18)', () => {
  it('title, the threshold, the type chips from the jurisdiction; the primary names the missing step', async () => {
    const v = await show(setup());
    expect(v.container.querySelector('.dlg__t h2')?.textContent).toBe('Buyer details');
    expect(v.container.querySelector('.dlg__t .ac__who')?.textContent).toBe('Needed above Rs 50,000.00');
    expect([...v.container.querySelectorAll('.b5-chip')].map((c) => c.textContent)).toEqual(['CNIC', 'NTN']);
    expect(primary(v).textContent).toBe('Type the name');
    type(input(v, 'Name'), 'Sample Traders');
    await flush();
    expect(primary(v).textContent).toBe('Pick an ID type');
    v.click(v.button('CNIC'));
    expect(primary(v).textContent).toBe('Type the ID number');
    type(input(v, 'ID number'), '12345-1234567');
    await flush();
    expect(primary(v).textContent).toBe('Check the ID number');
    expect(primary(v).getAttribute('aria-disabled')).toBe('true');
    type(input(v, 'ID number'), '12345-1234567-1');
    await flush();
    expect(primary(v).textContent).toBe('Use for this close');
    expect(v.text()).toContain('never shown again');
  });

  it('[B19] Use for this close hands the buyer to the close (as typed, the hub strips) and clears the field; nothing is sent from the sheet', async () => {
    const s = setup();
    const used: BuyerEntry[] = [];
    const v = await show(s, bill(), { onUse: (x) => used.push(x) });
    type(input(v, 'Name'), '  Sample Traders ');
    v.click(v.button('CNIC'));
    type(input(v, 'ID number'), '12345-1234567-1');
    await flush();
    v.click(primary(v));
    await flush();
    expect(used).toEqual([{ name: 'Sample Traders', tax_id: { type: 'CNIC', value: '12345-1234567-1' } }]);
    expect(input(v, 'ID number')?.value).toBe('');
    expect(s.command).not.toHaveBeenCalled();
  });

  it('[B19] the ID field is not remembered by the browser and its value is never written to storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const v = await show(setup());
    const id = input(v, 'ID number')!;
    expect(id.getAttribute('autocomplete')).toBe('off');
    type(id, '1234512345671');
    await flush();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('a close refusal on the buyer (VALIDATION_FAILED on buyer.tax_id) reopens with its own text, never the value', async () => {
    const v = await show(setup(), bill(), { error: 'value' });
    expect(v.container.querySelector('.msg')?.textContent).toBe('Check the ID number');
    expect(input(v, 'ID number')?.value).toBe('');
  });

  it('Customer refuses (allowed): WaiveBuyerId { bill_id } → waived', async () => {
    const s = setup();
    const out: string[] = [];
    const v = await show(s, bill(), { onWaived: (x) => out.push(x) });
    expect(v.button('Customer refuses').querySelector('.ntag')).toBeNull();
    v.click(v.button('Customer refuses'));
    await flush();
    expect(s.command.mock.calls[0]).toEqual(['WaiveBuyerId', { bill_id: 'B9' }, expect.anything()]);
    expect(out).toEqual(['waived']);
  });

  it('Customer refuses (requires_approval): Needs approval → pending → the waiting card; not_required → "Not needed for this bill"', async () => {
    const s = setup({ grant: 'requires_approval', answers: [{ ok: true, data: { bill_id: 'B9', pending: { alert_id: 'A4' } } }, { ok: true, data: { bill_id: 'B9', changed: false, reason: 'not_required' } }] });
    const out: string[] = [];
    const v = await show(s, bill(), { onWaived: (x) => out.push(x) });
    expect(v.button('Customer refuses').querySelector('.ntag')?.textContent).toBe('Needs approval');
    v.click(v.button('Customer refuses'));
    await flush();
    expect(v.container.querySelector('.b5-wait b')?.textContent).toBe('Waiting for approval');
    expect(v.container.querySelector('.b5-wait span')?.textContent).toBe('Close without buyer details');
    expect(out).toEqual(['pending']);
    v.unmount();
    view = null;
    const w = await show(s, bill(), { onWaived: (x) => out.push(x) });
    w.click(w.button('Customer refuses'));
    await flush();
    expect(out).toEqual(['pending', 'not_required']);
  });

  it('without close-without-buyer-id there is no Customer refuses', async () => {
    const v = await show(setup({ grant: null }));
    expect(v.buttons().some((b) => b.textContent?.includes('Customer refuses'))).toBe(false);
  });

  it('[frame BuyerUrdu] Urdu: the drawn texts', async () => {
    setLanguage('ur');
    const v = await show(setup());
    expect(v.container.querySelector('.dlg__t h2')?.textContent).toBe('خریدار کی تفصیل');
    expect(v.text()).toContain('شناختی نمبر');
    expect(v.text()).toContain('گاہک انکار کرتا ہے');
  });

  it('[05 §8 Rules] every key of this block is in en and in ur or 05/urdu-todo.md', () => {
    const start = enSource.indexOf('// ---- 05 client (task 37, buyer)');
    expect(start).toBeGreaterThan(0);
    const end = enSource.indexOf('// ----', start + 10);
    const keys = [...enSource.slice(start, end === -1 ? undefined : end).matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) {
      expect(key in en, key).toBe(true);
      expect((ur as Record<string, string | undefined>)[key] !== undefined || TODO_05.has(key), key).toBe(true);
    }
  });
});
