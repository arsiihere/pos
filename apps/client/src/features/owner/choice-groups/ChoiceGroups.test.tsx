import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CloudAdmin } from '../../../api/cloud-admin';
import { BranchNames } from '../branch';
import { GuardProvider } from '../guard';
import { button, click, fail, fakeApi, flush, mount, ok, setValue, type Call, type Mounted } from '../test-api';
import { ChoiceGroupForm } from './ChoiceGroupForm';
import { ChoiceGroupList } from './ChoiceGroupList';

let m: Mounted;
const B1 = 'B-GULBERG';
const B2 = 'B-JOHAR';
const B3 = 'B-DHA';
const NAMES = new Map([
  [B1, 'Gulberg'],
  [B2, 'Johar Town'],
  [B3, 'DHA'],
]);

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
  window.location.hash = '#/choice-groups';
  m = mount();
});

afterEach(() => {
  m.unmount();
  sessionStorage.clear();
});

const route = (branch_id: string) => ({ branch_id, station_id: 'S', program_id: null, stock_program_id: null, price_minor_override: null });
const item = (item_id: string, name: string, category_id: string, routes: string[], extra: Record<string, unknown> = {}) => ({
  item_id,
  category_id,
  tax_class_id: null,
  name,
  variant_group_id: null,
  variant_name: null,
  description: null,
  sort_order: 0,
  price_minor: 5000,
  serve_mode: 'cook_to_order',
  prep_buffer_ms: 0,
  cook_time_ms: 60000,
  stock_time_ms: null,
  out_of_stock_behaviour: 'hide',
  sale_unit: 'piece',
  requires_weighing: false,
  stock_draws: [],
  availability_windows: [],
  archived_at: null,
  routes: routes.map(route),
  ...extra,
});
const CATS = [
  { category_id: 'C1', name: 'Karahi', sort_order: 0, archived_at: null, availability_windows: [] },
  { category_id: 'C2', name: 'Breads', sort_order: 1, archived_at: null, availability_windows: [] },
];
const VGS = [{ variant_group_id: 'VG1', name: 'Chicken Karahi', category_id: 'C1', description: null, sort_order: 0, archived_at: null, member_ids: [], version: 'vg' }];
const PAGE1 = [item('I1', 'Chicken Karahi — Half', 'C1', [B1, B2, B3], { variant_group_id: 'VG1', variant_name: 'Half' }), item('I2', 'Lassi', 'C1', [B1, B2, B3])];
// Naan is routed at Gulberg and Johar Town only (not DHA); it arrives on the second menu page.
const PAGE2 = [item('N1', 'Naan', 'C2', [B1, B2]), item('N2', 'Roghni naan', 'C2', [B1, B2, B3]), item('W1', 'Naan (per kg)', 'C2', [B1], { sale_unit: 'g' })];

const branches = (rows: Record<string, unknown[]> = {}) =>
  [B1, B2, B3].map((branch_id) => ({ branch_id, options: rows[branch_id] ?? [], version: `bv-${branch_id}` }));
const opt = (option_id: string, name: string, sort_order: number, extra: Record<string, unknown> = {}) => ({
  option_id,
  name,
  price_minor: 0,
  max_quantity: 1,
  is_default: false,
  linked_item_id: null,
  sort_order,
  ...extra,
});
const SPICE = {
  modifier_group_id: 'MG1',
  name: 'Spice level',
  min_choices: 1,
  max_choices: 1,
  sort_order: 0,
  archived_at: null,
  options: [opt('O1', 'Mild', 0), opt('O2', 'Normal', 1, { is_default: true }), opt('O3', 'Hot', 2)],
  archived_options: [],
  links: [
    { target_kind: 'category', target_id: 'C1', mode: 'attach' },
    { target_kind: 'item', target_id: 'I2', mode: 'detach' },
  ],
  // Gulberg switched every option off: F1.
  branches: branches({ [B1]: ['O1', 'O2', 'O3'].map((option_id) => ({ option_id, is_offered: false, price_minor_override: null })) }),
  version: 'v1',
};
const BREAD = {
  modifier_group_id: 'MG2',
  name: 'Bread',
  min_choices: 0,
  max_choices: 6,
  sort_order: 1,
  archived_at: null,
  options: [
    opt('O4', 'Naan', 0, { price_minor: null, max_quantity: 6, linked_item_id: 'N1' }),
    opt('O5', 'Roghni naan', 1, { price_minor: null, max_quantity: 6, linked_item_id: 'N2' }),
    opt('O6', 'Garlic naan', 2, { price_minor: 6000, max_quantity: 6 }),
    opt('O7', 'Butter naan', 3, { price_minor: 5000 }),
  ],
  archived_options: [{ option_id: 'O9', name: 'Kulcha' }],
  links: [{ target_kind: 'variant_group', target_id: 'VG1', mode: 'attach' }],
  branches: branches({ [B2]: [{ option_id: 'O6', is_offered: true, price_minor_override: 7000 }] }),
  version: 'v2',
};

interface Options {
  write?: (call: Call) => Response | undefined;
  canEdit?: boolean;
  groups?: unknown[];
  page2?: () => Promise<Response>;
}
function handler(o: Options = {}) {
  return (call: Call): Response | Promise<Response> => {
    const written = call.method === 'GET' ? undefined : o.write?.(call);
    if (written !== undefined) return written;
    const canEdit = o.canEdit ?? true;
    if (call.url === '/v1/admin/modifier-groups') return ok({ can_edit_tenant: canEdit, modifier_groups: o.groups ?? [SPICE, BREAD] });
    if (call.url === '/v1/admin/modifier-groups?status=archived') return ok({ can_edit_tenant: canEdit, modifier_groups: [] });
    if (call.url.startsWith('/v1/admin/menu')) {
      const base = { can_edit_tenant: canEdit, tax_classes: [], categories: CATS, variant_groups: VGS };
      if (call.url.includes('cursor=P2')) return o.page2 ? o.page2() : ok({ ...base, items: PAGE2, next_cursor: null });
      return ok({ ...base, items: PAGE1, next_cursor: 'P2' });
    }
    throw new Error(`unexpected ${call.method} ${call.url}`);
  };
}

async function render(node: ReactNode) {
  await m.render(
    <GuardProvider>
      <BranchNames.Provider value={NAMES}>{node}</BranchNames.Provider>
    </GuardProvider>,
  );
}
const form = (api: CloudAdmin, id: string) => render(<ChoiceGroupForm api={api} groupId={id} />);
const branchRow = (name: string) => m.container.querySelector<HTMLElement>(`[data-branch-row="${name}"]`)!;
const optRow = (i: number) => m.container.querySelector<HTMLElement>(`[data-option-row="${i}"]`)!;
const save = () => click(button(m.container.querySelector('.pos-appbar')!, 'Save'));
const lastWrite = (calls: Call[]) => calls.filter((c) => c.method !== 'GET').at(-1)!;

describe('[01c-S02] choice groups list', () => {
  it('Name · Customers pick · Options (first 3 + "+N") · Applies to, sorted; rows open', async () => {
    const { api } = fakeApi(handler());
    await render(<ChoiceGroupList api={api} />);
    const rows = [...m.container.querySelectorAll<HTMLElement>('.pos-list__row')];
    expect(rows.map((r) => r.querySelector('strong')?.textContent)).toEqual(['Spice level', 'Bread']);
    const cells = (r: HTMLElement) => [...r.querySelectorAll('.pos-list__muted')].map((c) => c.textContent);
    expect(rows[0]!.querySelector('.pos-list__name span')?.textContent).toBe('Required');
    expect(cells(rows[0]!)).toEqual(['Pick 1', 'Mild, Normal, Hot', 'Category Karahi · not on Lassi']);
    expect(cells(rows[1]!)).toEqual(['Up to 6', 'Naan, Roghni naan, Garlic naan +1', 'Size group Chicken Karahi']);
    expect(rows[1]!.querySelector('a.pos-rowlink')?.getAttribute('href')).toBe('#/choice-groups/MG2');
  });

  it('[#115] "Checking branches…" and no omission warning until the last menu page; then "Not offered at DHA"', async () => {
    let release: (r: Response) => void = () => {};
    const page2 = () => new Promise<Response>((resolve) => (release = resolve));
    const { api } = fakeApi(handler({ page2 }));
    await render(<ChoiceGroupList api={api} />);
    const bread = () => m.container.querySelector<HTMLElement>('[data-group-id="MG2"]')!;
    expect(m.container.querySelector('[data-checking]')?.textContent).toBe('Checking branches…');
    expect(bread().textContent).not.toContain('Not offered at');
    expect(m.container.textContent).not.toContain('Not offered at');
    release(ok({ can_edit_tenant: true, tax_classes: [], categories: CATS, variant_groups: VGS, items: PAGE2, next_cursor: null }));
    await flush();
    await flush();
    expect(m.container.querySelector('[data-checking]')).toBeNull();
    expect([...bread().querySelectorAll('.pos-chip--warn')].map((c) => c.textContent)).toEqual(['Not offered at DHA: its item is not sold there']);
  });

  it('[01c-B05] a required group with nothing offered at a branch shows a chip; read-only hides New; empty card', async () => {
    const { api } = fakeApi(handler({ canEdit: false }));
    await render(<ChoiceGroupList api={api} />);
    const spice = m.container.querySelector<HTMLElement>('[data-group-id="MG1"]')!;
    expect([...spice.querySelectorAll('.pos-chip--warn')].map((c) => c.textContent)).toEqual(['Nothing offered at Gulberg — required']);
    expect(m.container.querySelector('.pos-btn--primary')).toBeNull();
    m.unmount();
    m = mount();
    const empty = fakeApi(handler({ groups: [] }));
    await render(<ChoiceGroupList api={empty.api} />);
    expect(m.container.querySelector('.pos-empty h3')?.textContent).toBe('No choice groups yet');
    expect(m.container.querySelector('.pos-empty a.pos-btn--primary')?.getAttribute('href')).toBe('#/choice-groups/new');
  });

  it('search filters by name; ⋯ Show archived reads status=archived', async () => {
    const { api, calls } = fakeApi(handler());
    await render(<ChoiceGroupList api={api} />);
    setValue(m.container.querySelector<HTMLInputElement>('input[name="q"]'), 'bre');
    expect([...m.container.querySelectorAll('.pos-list__row strong')].map((s) => s.textContent)).toEqual(['Bread']);
    await click(m.container.querySelector<HTMLButtonElement>('.pos-appbar button.pos-more')!);
    await click(button(m.container, 'Show archived choice groups'));
    expect(calls.some((c) => c.url === '/v1/admin/modifier-groups?status=archived')).toBe(true);
  });
});

describe('[01c-S03] choice group form', () => {
  it('new: POST with the Idempotency-Key, options without ids, links; then the group opens', async () => {
    const created = { ...SPICE, modifier_group_id: 'MG9' };
    const { api, calls } = fakeApi(handler({ write: (c) => (c.method === 'POST' ? json201(created) : undefined) }));
    await form(api, 'new');
    expect(m.container.querySelector('[data-branches]')).toBeNull();
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'Extras');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="options.0.name"]'), 'Raita');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="options.0.price"]'), '80');
    await click(button(m.container, 'Add option'));
    setValue(m.container.querySelector<HTMLInputElement>('input[name="options.1.name"]'), 'Naan');
    setValue(m.container.querySelector<HTMLSelectElement>('select[name="options.1.linked_item_id"]'), 'N1');
    await click(button(m.container, 'Create choice group'));
    const post = lastWrite(calls);
    expect(post.method).toBe('POST');
    expect(post.url).toBe('/v1/admin/modifier-groups');
    expect(post.key).toMatch(/^[0-9A-Z]{26}$/);
    expect(post.body).toEqual({
      name: 'Extras',
      min_choices: 0,
      max_choices: 1,
      options: [
        { name: 'Raita', price_minor: 8000, max_quantity: 1, is_default: false, linked_item_id: null, sort_order: 0 },
        { name: 'Naan', price_minor: null, max_quantity: 1, is_default: false, linked_item_id: 'N1', sort_order: 1 },
      ],
      links: [],
    });
    expect(window.location.hash).toBe('#/choice-groups/MG9');
  });

  it('the kitchen picker offers only items sold by piece; a plain option needs a price', async () => {
    const { api, calls } = fakeApi(handler());
    await form(api, 'new');
    const values = [...m.container.querySelectorAll<HTMLOptionElement>('select[name="options.0.linked_item_id"] option')].map((o) => o.value);
    expect(values).toContain('N1');
    expect(values).not.toContain('W1');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'Extras');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="options.0.name"]'), 'Raita');
    await click(button(m.container, 'Create choice group'));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(optRow(0).querySelector('.pos-field__error')?.textContent).toContain('Type a price');
    expect(m.container.querySelector('[data-fix-summary]')?.textContent).toContain('Option 1');
  });

  it('edit: PATCH with expected_version and only the changed fields; an unchanged Save sends nothing', async () => {
    const { api, calls } = fakeApi(handler({ write: (c) => (c.method === 'PATCH' ? ok({ modifier_group: BREAD }) : undefined) }));
    await form(api, 'MG2');
    await save();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    setValue(m.container.querySelector<HTMLInputElement>('input[name="max_choices"]'), '4');
    await save();
    expect(lastWrite(calls)).toMatchObject({ method: 'PATCH', url: '/v1/admin/modifier-groups/MG2', body: { expected_version: 'v2', max_choices: 4 } });
    expect(Object.keys(lastWrite(calls).body as object).sort()).toEqual(['expected_version', 'max_choices']);
  });

  it('[01c-B06] a removed row is left out (archived on save); Restore brings an archived option back by its id', async () => {
    const { api, calls } = fakeApi(handler({ write: (c) => (c.method === 'PATCH' ? ok({ modifier_group: BREAD }) : undefined) }));
    await form(api, 'MG2');
    expect([...m.container.querySelectorAll('[data-removed-id]')].map((r) => r.getAttribute('data-removed-id'))).toEqual(['O9']);
    await click(m.container.querySelector<HTMLButtonElement>('button[aria-label="Remove Butter naan"]')!);
    expect([...m.container.querySelectorAll('[data-removed-id]')].map((r) => r.getAttribute('data-removed-id'))).toEqual(['O7', 'O9']);
    await click(button(m.container.querySelector('[data-removed-id="O9"]')!, 'Restore'));
    setValue(m.container.querySelector<HTMLInputElement>('input[name="options.3.price"]'), '40');
    await save();
    const body = lastWrite(calls).body as { options: { option_id?: string; name: string; price_minor: number | null }[] };
    expect(body.options.map((o) => o.option_id)).toEqual(['O4', 'O5', 'O6', 'O9']);
    expect(body.options[3]).toMatchObject({ name: 'Kulcha', price_minor: 4000, sort_order: 3 });
  });

  it('[01c-B01] 422 options.N.linked_item_id marks row N as sent, with one summary banner', async () => {
    const { api } = fakeApi(
      handler({ write: () => fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'options.1.linked_item_id', reason: 'linked_item_not_piece' }) }),
    );
    await form(api, 'MG2');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'Breads');
    await save();
    expect(optRow(1).classList.contains('is-error')).toBe(true);
    expect(optRow(1).querySelector('.pos-field__error')?.textContent).toBe('Only items sold by piece can be an option.');
    expect(m.container.querySelectorAll('[data-fix-summary]')).toHaveLength(1);
    expect(m.container.querySelector('[data-fix-summary]')?.textContent).toContain('Option 2');
  });

  it('[01c-B01] 422 defaults_exceed_max at min_choices marks "Customers pick"', async () => {
    const { api } = fakeApi(handler({ write: () => fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'min_choices', reason: 'defaults_exceed_max' }) }));
    await form(api, 'MG1');
    await click(m.container.querySelector<HTMLButtonElement>('button[aria-label="Default: Mild"]')!);
    await save();
    expect(m.container.querySelector('[data-pick] .pos-field__error')?.textContent).toBe("Too many options are set as default. Untick some or raise 'at most'.");
  });

  it('[01c-B03] 409 CONFIG_STALE shows the banner, keeps the draft and disables Save; Reload re-reads', async () => {
    const { api, calls } = fakeApi(handler({ write: () => fail(409, 'CONFIG_STALE', { entity: 'modifier_group', id: 'MG2' }) }));
    await form(api, 'MG2');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'Breads');
    await save();
    expect(m.container.querySelector('[data-stale]')).not.toBeNull();
    expect(m.container.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe('Breads');
    expect(button(m.container.querySelector('.pos-appbar')!, 'Save').disabled).toBe(true);
    const reads = calls.filter((c) => c.url === '/v1/admin/modifier-groups').length;
    await click(button(m.container.querySelector('[data-stale]')!, 'Reload'));
    expect(calls.filter((c) => c.url === '/v1/admin/modifier-groups').length).toBe(reads + 1);
    expect(m.container.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe('Bread');
  });

  it('404: an unknown id or MODIFIER_GROUP_NOT_FOUND replaces the form', async () => {
    const { api } = fakeApi(handler());
    await form(api, 'MG404');
    expect(m.container.querySelector('.pos-gone h2')?.textContent).toBe("This choice group isn't here any more");
    m.unmount();
    m = mount();
    const gone = fakeApi(handler({ write: () => fail(404, 'MODIFIER_GROUP_NOT_FOUND') }));
    await form(gone.api, 'MG2');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'Breads');
    await save();
    expect(m.container.querySelector('.pos-gone button')?.textContent).toBe('Back to Choice groups');
  });

  it('read-only (can_edit_tenant false): tenant fields locked, no Save or Applies to; branch rows stay editable', async () => {
    const { api } = fakeApi(handler({ canEdit: false }));
    await form(api, 'MG2');
    expect(m.container.querySelector<HTMLInputElement>('input[name="name"]')?.disabled).toBe(true);
    expect([...m.container.querySelectorAll('.pos-appbar button')].some((b) => b.textContent === 'Save')).toBe(false);
    expect([...m.container.querySelectorAll('button')].some((b) => b.textContent === 'Applies to…')).toBe(false);
    await click(branchRow('DHA').querySelector<HTMLButtonElement>('.pos-brow__toggle')!);
    expect(branchRow('DHA').querySelector<HTMLButtonElement>('button[role="switch"]')?.disabled).toBe(false);
  });
});

describe('[01c-D02] applies to', () => {
  it('categories offer only — / Use; Use and Not here update the strip; Done puts the links in the PATCH', async () => {
    const { api, calls } = fakeApi(handler({ write: (c) => (c.method === 'PATCH' ? ok({ modifier_group: BREAD }) : undefined) }));
    await form(api, 'MG2');
    await click(button(m.container, 'Applies to…'));
    const dialog = () => m.container.querySelector<HTMLElement>('[data-applies-to]')!;
    expect(dialog().querySelector('h2')?.textContent).toBe('Where is “Bread” offered?');
    const karahi = dialog().querySelector<HTMLElement>('[data-target="C1"]')!;
    expect([...karahi.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['—', 'Use']);
    await click(button(karahi, 'Use'));
    await click(button(dialog(), 'Items5'));
    expect([...dialog().querySelectorAll('.pos-target__group')].map((g) => g.textContent)).toEqual(['Karahi', 'Breads']);
    await click(button(dialog().querySelector<HTMLElement>('[data-target="I2"]')!, 'Not here'));
    expect(dialog().querySelector('[data-strip]')?.textContent).toContain('Used on 2 · Not here on 1');
    await click(button(dialog(), 'Done'));
    expect(m.container.querySelector('[data-applies-to]')).toBeNull();
    expect([...m.container.querySelectorAll('[data-applies] .pos-chip')].map((c) => c.textContent)).toEqual([
      'Size group: Chicken Karahi',
      'Category: Karahi',
      'Item: Lassi — not here',
    ]);
    await save();
    expect((lastWrite(calls).body as { links: unknown[] }).links).toEqual([
      { target_kind: 'variant_group', target_id: 'VG1', mode: 'attach' },
      { target_kind: 'category', target_id: 'C1', mode: 'attach' },
      { target_kind: 'item', target_id: 'I2', mode: 'detach' },
    ]);
  });
});

describe('[01c-S10] at each branch', () => {
  it('a row PUT sends the whole difference list with that row\'s version, no key; chips name overrides', async () => {
    const stored = { branch_id: B3, options: [{ option_id: 'O5', is_offered: false, price_minor_override: null }, { option_id: 'O6', is_offered: true, price_minor_override: 7000 }], version: 'bv-new' };
    const { api, calls } = fakeApi(handler({ write: (c) => (c.method === 'PUT' ? ok({ branch: stored }) : undefined) }));
    await form(api, 'MG2');
    expect([...branchRow('Johar Town').querySelectorAll('.pos-chip')].map((c) => c.textContent)).toEqual(['All 4 offered', 'Garlic naan Rs 70']);
    // DHA: Naan has no route there → 01c-B04 chip after the last menu page.
    expect(branchRow('DHA').textContent).toContain('Not offered at DHA: its item is not sold there');
    await click(branchRow('DHA').querySelector<HTMLButtonElement>('.pos-brow__toggle')!);
    await click(branchRow('DHA').querySelector<HTMLButtonElement>('button[aria-label="Offered here: Roghni naan"]')!);
    setValue(branchRow('DHA').querySelector<HTMLInputElement>('input[aria-label="Price here: Garlic naan"]'), '70');
    await click(branchRow('DHA').querySelector<HTMLButtonElement>('.pos-btn--row')!);
    const put = lastWrite(calls);
    expect(put).toMatchObject({ method: 'PUT', url: '/v1/admin/modifier-groups/MG2/branches/B-DHA', key: undefined });
    expect(put.body).toEqual({
      expected_version: 'bv-B-DHA',
      options: [
        { option_id: 'O5', is_offered: false, price_minor_override: null },
        { option_id: 'O6', is_offered: true, price_minor_override: 7000 },
      ],
    });
    expect(branchRow('DHA').querySelector('.pos-btn--row')).toBeNull();
  });

  it('[01c-B05] F1: a required group with nothing offered warns inside the row and still saves', async () => {
    const { api, calls } = fakeApi(handler({ write: (c) => (c.method === 'PUT' ? ok({ branch: SPICE.branches[1] }) : undefined) }));
    await form(api, 'MG1');
    await click(branchRow('Johar Town').querySelector<HTMLButtonElement>('.pos-brow__toggle')!);
    for (const name of ['Mild', 'Normal', 'Hot'])
      await click(branchRow('Johar Town').querySelector<HTMLButtonElement>(`button[aria-label="Offered here: ${name}"]`)!);
    expect(branchRow('Johar Town').querySelector('[data-f1]')?.textContent).toContain(
      "Nothing is offered here, so items that need “Spice level” can't be ordered at Johar Town.",
    );
    await click(branchRow('Johar Town').querySelector<HTMLButtonElement>('.pos-btn--row')!);
    expect((lastWrite(calls).body as { options: unknown[] }).options).toHaveLength(3);
  });

  it('[01c-B03] a stale row shows the banner in that row only; the page Save stays enabled', async () => {
    const { api } = fakeApi(handler({ write: () => fail(409, 'CONFIG_STALE', { entity: 'modifier_group_branch', id: 'MG2' }) }));
    await form(api, 'MG2');
    await click(branchRow('Gulberg').querySelector<HTMLButtonElement>('.pos-brow__toggle')!);
    await click(branchRow('Gulberg').querySelector<HTMLButtonElement>('button[aria-label="Offered here: Naan"]')!);
    await click(branchRow('Gulberg').querySelector<HTMLButtonElement>('.pos-btn--row')!);
    expect(branchRow('Gulberg').querySelector('[data-stale]')).not.toBeNull();
    expect(m.container.querySelectorAll('[data-stale]')).toHaveLength(1);
    expect(button(m.container.querySelector('.pos-appbar')!, 'Save').disabled).toBe(false);
  });
});

function json201(group: unknown): Response {
  return new Response(JSON.stringify({ data: { modifier_group: group } }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}
