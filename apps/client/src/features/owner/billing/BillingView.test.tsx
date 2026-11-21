import { defaultBillingSettings, type BillingSettingsWire, type JurisdictionWire } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { t } from '../../../i18n';
import { GuardProvider } from '../guard';
import { act } from 'react';
import { button, click, fail, fakeApi, flush, mount, ok, setValue as setInputValue, type Call, type Mounted } from '../test-api';
import { BillingView } from './BillingView';
import { documentOf } from './form-state';

let m: Mounted;

// test-api's setValue covers input and select; the header and footer boxes are textareas.
function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null | undefined, value: string): void {
  if (el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  } else setInputValue(el, value);
}

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
  m = mount();
});

afterEach(() => {
  m.unmount();
  sessionStorage.clear();
});

const DEFAULTS = defaultBillingSettings({ currency_code: 'PKR', currency_exponent: 2 });
const DOC: BillingSettingsWire = { ...DEFAULTS, branch_id: 'B1', version: 'v1' };
// A jurisdiction with profile rows (the PK-PB shape): two categories, so a class can be unset.
const DOC_PB: BillingSettingsWire = { ...DOC, jurisdiction_id: 'PK-PB' };

const RULE = {
  effective_from: '2026-01-01',
  prices_include_tax: false,
  rounding_step_minor: 100,
  rounding_mode: 'nearest' as const,
  rounding_applies_to: 'all' as const,
  mixed_class_rule: 'higher_rate',
  buyer_id: { threshold_minor: null, accepted_types: [] },
  receipt_fiscal: null,
  catch_up_window_ms: null,
  credit_support: 'credit_invoice' as const,
  ref: null,
};
const J_NONE: JurisdictionWire = { jurisdiction_id: 'none', name: 'No authority', adapter_key: 'none', currency_code: null, rules: [{ ...RULE, rounding_step_minor: null }], profile_taxes: [], tax_rates: [] };
const J_PK: JurisdictionWire = { jurisdiction_id: 'PK', name: 'Pakistan', adapter_key: 'none', currency_code: 'PKR', rules: [RULE], profile_taxes: [], tax_rates: [] };
const J_PB: JurisdictionWire = {
  jurisdiction_id: 'PK-PB',
  name: 'Punjab (PRA)',
  adapter_key: 'PRA',
  currency_code: 'PKR',
  rules: [
    {
      ...RULE,
      receipt_fiscal: {
        fiscal_number_label: 'PRA invoice no.',
        tax_reg_labels: [{ code: 'NTN', label: 'NTN' }],
        show_qr: true,
        qr_url_template: null,
        buyer_id_on_receipt: false,
      },
    },
  ],
  profile_taxes: [
    { fiscal_category: 'standard', seq: 1, tax_code: 'ST', label: 'Sales tax', compound: false },
    { fiscal_category: 'reduced', seq: 1, tax_code: 'RT', label: 'Reduced tax', compound: false },
  ],
  tax_rates: [],
};

const TAX_CLASSES = [
  { tax_class_id: 'TC1', name: 'Food', rate_bp: 1600, fiscal_category: null, archived_at: null },
  { tax_class_id: 'TC2', name: 'Drinks', rate_bp: 800, fiscal_category: 'standard', archived_at: null },
  { tax_class_id: 'TC3', name: 'Old', rate_bp: 0, fiscal_category: null, archived_at: 5 },
];

interface Setup {
  doc?: BillingSettingsWire;
  canEditTenant?: boolean;
  taxClasses?: typeof TAX_CLASSES;
  onWrite?: (call: Call) => Response | undefined;
}

async function render(setup: Setup = {}) {
  const doc = setup.doc ?? DOC;
  const { api, calls } = fakeApi((call: Call) => {
    if (call.method === 'GET' && call.url.includes('/billing')) return ok({ billing: doc });
    if (call.method === 'GET' && call.url.includes('/v1/admin/jurisdictions')) return ok({ jurisdictions: [J_NONE, J_PK, J_PB] });
    if (call.method === 'GET' && call.url.includes('/v1/admin/menu')) {
      return ok({ can_edit_tenant: setup.canEditTenant ?? true, tax_classes: setup.taxClasses ?? TAX_CLASSES, categories: [], items: [], variant_groups: [], next_cursor: null });
    }
    const answer = setup.onWrite?.(call);
    if (answer !== undefined) return answer;
    if (call.method === 'PUT') {
      return ok({ billing: { ...(call.body as object), branch_id: 'B1', version: 'v2' } });
    }
    if (call.method === 'PATCH') return ok({ tax_class: { tax_class_id: call.url.split('/').pop(), ...(call.body as object) } });
    return fail(500, 'INTERNAL');
  });
  await m.render(
    <GuardProvider>
      <BillingView api={api} branchId="B1" branchIds={['B1']} onBranch={() => {}} />
    </GuardProvider>,
  );
  return calls;
}

const input = (name: string) => m.container.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${CSS.escape(name)}"]`);
const fieldOf = (name: string) => input(name)?.closest('.pos-field');
const preview = () => m.container.querySelector('pre.pos-billing__preview')?.textContent ?? '';
const writes = (calls: Call[], method: string) => calls.filter((c) => c.method === method);
const save = () => click(button(m.container, t('billing.save')));

describe('[01a v2.7.1 §8.1 A-1 (6)] billing settings form', () => {
  it('[A-1 (6)] an untouched document round-trips: the PUT carries the document and its version, nothing else', async () => {
    const calls = await render();
    await save();
    const [put] = writes(calls, 'PUT');
    expect(put?.url).toBe('/v1/admin/branches/B1/billing');
    expect(put?.body).toEqual({ ...documentOf(DOC), expected_version: 'v1' });
  });

  it('[A-1 (6)] an edit changes only its field; the next save carries the new version', async () => {
    const calls = await render();
    setValue(input('service_charge_bp.dine_in') as HTMLInputElement, '5');
    setValue(input('receipt.header_lines') as HTMLTextAreaElement, 'Welcome\nTo Arif');
    setValue(input('fiscal.environment') as HTMLSelectElement, 'production');
    await save();
    const [put] = writes(calls, 'PUT');
    const body = put?.body as typeof DOC & { expected_version: string };
    expect(body.expected_version).toBe('v1');
    expect(body.service_charge_bp).toEqual({ dine_in: 500, takeaway: 0, parking: 0, delivery: 0 });
    expect(body.receipt.header_lines).toEqual(['Welcome', 'To Arif']);
    expect(body.fiscal.environment).toBe('production');
    expect(body.payment_modes).toEqual(DOC.payment_modes);
    expect(body.discount_reasons).toEqual(DOC.discount_reasons);
    expect(m.container.textContent).toContain(t('billing.saved'));
    // the answer's version is the next expected_version
    setValue(input('max_discount_pct') as HTMLInputElement, '50');
    await save();
    expect((writes(calls, 'PUT')[1]?.body as { expected_version: string }).expected_version).toBe('v2');
  });

  it('[A-1 (3)] a value outside the A-1 (3) bounds is refused before sending', async () => {
    const calls = await render();
    setValue(input('service_charge_bp.dine_in') as HTMLInputElement, '31');
    setValue(input('receipt.header_lines') as HTMLTextAreaElement, '1\n2\n3\n4\n5\n6\n7');
    await save();
    expect(writes(calls, 'PUT')).toEqual([]);
    expect(fieldOf('service_charge_bp.dine_in')?.classList.contains('pos-field--error')).toBe(true);
    expect(fieldOf('receipt.header_lines')?.classList.contains('pos-field--error')).toBe(true);
  });

  it('[A-1 (4)] 409 CONFIG_STALE shows the stale banner and Reload reads the document again', async () => {
    const calls = await render({ onWrite: (c) => (c.method === 'PUT' ? fail(409, 'CONFIG_STALE', { entity: 'billing_settings', id: 'B1' }) : undefined) });
    await save();
    expect(m.container.querySelector('[data-stale]')).not.toBeNull();
    const before = calls.filter((c) => c.method === 'GET' && c.url.includes('/billing')).length;
    await click(button(m.container, t('stale.reload')));
    expect(calls.filter((c) => c.method === 'GET' && c.url.includes('/billing')).length).toBe(before + 1);
  });

  it('[A-2] a 422 CONFIG_REFERENCE_INVALID { field } lands on that field', async () => {
    await render({
      doc: DOC_PB,
      onWrite: (c) => (c.method === 'PUT' ? fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'fiscal.default_pos_id' }) : undefined),
    });
    await save();
    expect(fieldOf('fiscal.default_pos_id')?.classList.contains('pos-field--error')).toBe(true);
    expect(fieldOf('fiscal.default_pos_id')?.querySelector('.pos-field__error')?.textContent).toBe(t('billing.err.reference'));
  });

  it('[A-2, reason] a 422 with reason not_found shows the reference text for it, on a nested field', async () => {
    await render({
      onWrite: (c) => (c.method === 'PUT' ? fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'jurisdiction_id', reason: 'currency_mismatch' }) : undefined),
    });
    await save();
    expect(fieldOf('jurisdiction_id')?.querySelector('.pos-field__error')?.textContent).toBe(t('billing.err.currency_mismatch'));
  });

  it('[R-36] 422 { field: "fiscal.integration_status" } lands on the integration status field', async () => {
    await render({
      doc: DOC_PB,
      onWrite: (c) => (c.method === 'PUT' ? fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'fiscal.integration_status' }) : undefined),
    });
    await save();
    const field = fieldOf('fiscal.integration_status');
    expect(field?.classList.contains('pos-field--error')).toBe(true);
    expect(field?.querySelector('.pos-field__error')?.textContent).toBe(t('billing.err.integration_status'));
    expect(m.container.querySelector('.pos-banner--danger')).toBeNull();
  });

  it('[A-2] a 422 field the page has no input for (payment_modes) shows a banner naming the section', async () => {
    await render({ onWrite: (c) => (c.method === 'PUT' ? fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'payment_modes' }) : undefined) });
    await save();
    expect(m.container.querySelector('.pos-banner--danger')?.textContent).toContain(t('billing.payment_modes'));
  });

  it('[A-2, C6] a 400 VALIDATION_FAILED issue path maps to its field', async () => {
    await render({
      onWrite: (c) =>
        c.method === 'PUT' ? fail(400, 'VALIDATION_FAILED', { issues: [{ path: 'rounding_step_minor', message: 'at most 1000000' }, { path: 'max_discount_pct', message: 'x' }] }) : undefined,
    });
    await save();
    expect(fieldOf('max_discount_pct')?.classList.contains('pos-field--error')).toBe(true);
  });

  it('[B22] no secret field is ever shown: no token, key or password input', async () => {
    await render();
    expect(m.container.querySelector('input[type="password"]')).toBeNull();
    expect(m.container.innerHTML).not.toMatch(/token|secret|password/i);
  });
});

describe('[01a v2.7.1 §8.1] receipt preview (renderText)', () => {
  it('[A-1 (6)] shows header lines, shown parts and footer; hiding a part removes it; width switches 48 / 32', async () => {
    await render();
    setValue(input('receipt.header_lines') as HTMLTextAreaElement, 'Arif Chatkhara');
    setValue(input('receipt.footer_lines') as HTMLTextAreaElement, 'Thank you');
    setValue(input('receipt.address') as HTMLInputElement, '12 Mall Road');
    setValue(input('receipt.invoice_prefix') as HTMLInputElement, 'AC-');
    const lines = preview().split('\n');
    expect(lines.every((l) => l.length <= 48)).toBe(true);
    expect(lines.find((l) => l.includes('Arif Chatkhara'))?.startsWith(' ')).toBe(true); // centered
    expect(preview()).toContain('12 Mall Road');
    expect(preview()).toContain('AC-0001');
    expect(preview()).toContain('Thank you');
    await click(m.container.querySelector<HTMLButtonElement>('button[aria-label="' + t('billing.show.address') + '"]')!);
    expect(preview()).not.toContain('12 Mall Road');
    setValue(input('preview_width') as HTMLSelectElement, '32');
    expect(preview().split('\n').every((l) => l.length <= 32)).toBe(true);
  });

  it('[A-1 (6)] the jurisdiction\'s receipt labels appear (fiscal number label, registration label, QR)', async () => {
    await render({ doc: { ...DOC_PB, receipt: { ...DOC_PB.receipt, tax_registrations: [{ code: 'NTN', number: '1234567-8' }] } } });
    expect(preview()).toContain('PRA invoice no.');
    expect(preview()).toContain('NTN');
    expect(preview()).toContain('1234567-8');
    expect(preview()).toContain('[QR]');
  });
});

describe('[05 P0.G G-23] built-in defaults', () => {
  it('[G-23] with no saved document (the cloud answers the defaults) the page shows them and a first save sends them', async () => {
    const calls = await render();
    expect((input('jurisdiction_id') as HTMLSelectElement).value).toBe('PK');
    expect(m.container.textContent).toContain('Cash');
    expect((input('max_discount_pct') as HTMLInputElement).value).toBe('100');
    expect((input('open_bill_flag_minutes') as HTMLInputElement).value).toBe('240');
    expect((input('receipt.header_lines') as HTMLTextAreaElement).value).toBe('');
    expect((input('receipt.invoice_prefix') as HTMLInputElement).value).toBe('');
    expect(preview()).not.toBe('');
    await save();
    const [put] = writes(calls, 'PUT');
    expect((put?.body as { jurisdiction_id: string }).jurisdiction_id).toBe('PK');
  });

  it('[G-23] the page still opens when the jurisdiction catalog is unreachable (the document alone)', async () => {
    const { api } = fakeApi((c) => {
      if (c.url.includes('/billing')) return ok({ billing: DOC });
      if (c.url.includes('/jurisdictions')) return fail(500, 'INTERNAL');
      return ok({ can_edit_tenant: true, tax_classes: [], categories: [], items: [], variant_groups: [], next_cursor: null });
    });
    await m.render(
      <GuardProvider>
        <BillingView api={api} branchId="B1" branchIds={['B1']} onBranch={() => {}} />
      </GuardProvider>,
    );
    expect(input('max_discount_pct')).not.toBeNull();
    expect(m.container.querySelector('.pos-banner--danger')).not.toBeNull();
  });
});

describe('[01a v2.7.1 §8.1] jurisdiction view', () => {
  it('[§6.26] shows the chosen jurisdiction\'s adapter, rounding, profile taxes; switching the picker shows the other one', async () => {
    await render();
    const view = () => m.container.querySelector('.pos-billing__jurisdiction')?.textContent ?? '';
    expect(view()).toContain('Pakistan');
    setValue(input('jurisdiction_id') as HTMLSelectElement, 'PK-PB');
    expect(view()).toContain('Punjab (PRA)');
    expect(view()).toContain('PRA');
    expect(view()).toContain('Sales tax');
    expect(view()).toContain('Reduced tax');
  });
});

const picker = (id: string) => m.container.querySelector<HTMLSelectElement>(`select[name="fiscal_category.${id}"]`);

describe('[01a v2.7.1 §8.1 R-32, G-31] Tax categories', () => {
  it('[R-32] lists each active class with a Fiscal category picker: the branch jurisdiction\'s categories plus None', async () => {
    await render({ doc: DOC_PB });
    expect(picker('TC3')).toBeNull();
    const options = [...picker('TC1')!.options].map((o) => o.value);
    expect(options).toEqual(['', 'reduced', 'standard']);
    expect(picker('TC2')!.value).toBe('standard');
    expect(picker('TC1')!.value).toBe('');
  });

  it('[R-32] picker round-trip: a pick PATCHes the class, None sends null, the list keeps the answer', async () => {
    const calls = await render({ doc: DOC_PB });
    setValue(picker('TC1'), 'reduced');
    await flush();
    const [first] = writes(calls, 'PATCH');
    expect(first?.url).toBe('/v1/admin/tax-classes/TC1');
    expect(first?.body).toEqual({ fiscal_category: 'reduced' });
    expect(picker('TC1')!.value).toBe('reduced');
    setValue(picker('TC2'), '');
    await flush();
    expect(writes(calls, 'PATCH')[1]?.body).toEqual({ fiscal_category: null });
    expect(picker('TC2')!.value).toBe('');
  });

  it('[S8, R-32] 403 PERMISSION_DENIED { reason: tenant_wide_write } is shown and the pick is undone', async () => {
    await render({
      doc: DOC_PB,
      onWrite: (c) => (c.method === 'PATCH' ? fail(403, 'PERMISSION_DENIED', { reason: 'tenant_wide_write' }) : undefined),
    });
    setValue(picker('TC1'), 'standard');
    await flush();
    expect(m.container.querySelector('.pos-banner--danger')?.textContent).toContain(t('errors.PERMISSION_DENIED'));
    expect(picker('TC1')!.value).toBe('');
  });

  it('[S8, R-32] an owner not covering every branch sees the list read-only, with the reason', async () => {
    await render({ doc: DOC_PB, canEditTenant: false });
    expect(picker('TC1')!.disabled).toBe(true);
    expect(m.container.textContent).toContain(t('billing.tax_read_only'));
  });

  it('[G-31] "Needs a category" flags a class with no category while the jurisdiction has profile rows; it clears when set', async () => {
    await render({ doc: DOC_PB });
    const row = (id: string) => m.container.querySelector(`[data-tax-class-id="${id}"]`)!;
    expect(row('TC1').textContent).toContain(t('billing.needs_category'));
    expect(row('TC2').textContent).not.toContain(t('billing.needs_category'));
    setValue(picker('TC1'), 'standard');
    await flush();
    expect(row('TC1').textContent).not.toContain(t('billing.needs_category'));
  });

  it('[G-31] no flag under jurisdiction none, nor under PK (no profile rows: the PUT would not refuse)', async () => {
    await render({ doc: { ...DOC, jurisdiction_id: 'none' } });
    expect(m.container.textContent).not.toContain(t('billing.needs_category'));
  });

  it('[R-32] the PATCH sends nothing but fiscal_category and the #/menu form has no such field', async () => {
    const calls = await render({ doc: DOC_PB });
    setValue(picker('TC1'), 'reduced');
    await flush();
    expect(Object.keys(writes(calls, 'PATCH')[0]?.body as object)).toEqual(['fiscal_category']);
  });
});
