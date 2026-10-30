import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CloudAdmin } from '../../../api/cloud-admin';
import { GuardProvider } from '../guard';
import { button, click, fail, fakeApi, mount, ok, setValue, type Call, type Mounted } from '../test-api';
import { SizeGroupForm } from './SizeGroupForm';
import { SizeGroupList } from './SizeGroupList';

let m: Mounted;

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
  window.location.hash = '#/size-groups';
  m = mount();
});

afterEach(() => {
  m.unmount();
  sessionStorage.clear();
});

const item = (item_id: string, name: string, variant_name: string | null, price_minor: number, extra: Record<string, unknown> = {}) => ({
  item_id,
  category_id: 'C1',
  tax_class_id: null,
  name,
  variant_group_id: variant_name === null ? null : 'VG1',
  variant_name,
  description: null,
  sort_order: 0,
  price_minor,
  serve_mode: 'cook_to_order',
  prep_buffer_ms: 0,
  cook_time_ms: 600000,
  stock_time_ms: null,
  out_of_stock_behaviour: 'hide',
  sale_unit: 'piece',
  requires_weighing: false,
  stock_draws: [],
  availability_windows: [],
  archived_at: null,
  routes: [],
  ...extra,
});
const group = (id: string, name: string, sort_order: number, member_ids: string[], extra: Record<string, unknown> = {}) => ({
  variant_group_id: id,
  name,
  category_id: 'C1',
  description: null,
  sort_order,
  archived_at: null,
  member_ids,
  version: `v-${id}`,
  ...extra,
});
const ITEMS = [
  item('I1', 'Chicken Karahi — Half', 'Half', 115000, { stock_draws: [{ stock_item_id: 'SI1', quantity_per_sale_unit: 500 }] }),
  item('I2', 'Chicken Karahi — Full', 'Full', 220000, { sort_order: 1 }),
  item('I3', 'Mutton Karahi — Half', 'Half', 145000),
];
const GROUPS = [group('VG2', 'Mutton Karahi', 1, ['I3']), group('VG1', 'Chicken Karahi', 0, ['I1', 'I2']), group('VG3', 'Old platter', 0, [], { archived_at: 1 })];
const CATEGORIES = [
  { category_id: 'C1', name: 'Karahi', sort_order: 0, archived_at: null, availability_windows: [] },
  { category_id: 'C2', name: 'Rice', sort_order: 1, archived_at: null, availability_windows: [] },
];
const STOCK = [{ stock_item_id: 'SI1', name: 'Karahi pot', stock_unit: 'g', carries_over: false, archived_at: null, version: 's1', branches: [], drawers: [] }];

function handler(write: (call: Call) => Response | undefined = () => undefined, canEdit = true) {
  return (call: Call): Response => {
    const written = call.method === 'GET' ? undefined : write(call);
    if (written !== undefined) return written;
    if (call.url.startsWith('/v1/admin/menu')) {
      const archived = call.url.includes('status=archived');
      return ok({
        can_edit_tenant: canEdit,
        tax_classes: [],
        categories: CATEGORIES,
        variant_groups: GROUPS,
        items: archived ? [] : ITEMS,
        next_cursor: null,
      });
    }
    if (call.url.startsWith('/v1/admin/stock-items')) return ok({ can_edit_tenant: canEdit, stock_items: STOCK });
    throw new Error(`unexpected ${call.method} ${call.url}`);
  };
}

async function render(node: React.ReactNode) {
  await m.render(<GuardProvider>{node}</GuardProvider>);
}
const form = (api: CloudAdmin, id: string) => render(<SizeGroupForm api={api} groupId={id} />);

describe('[01c-S08] size groups list', () => {
  it('lists active groups by sort_order then name, with the category and "Half Rs 1,150" chips; rows open the form', async () => {
    const { api } = fakeApi(handler());
    await render(<SizeGroupList api={api} />);
    const rows = [...m.container.querySelectorAll('.pos-list__row')];
    expect(rows.map((r) => r.querySelector('strong')?.textContent)).toEqual(['Chicken Karahi', 'Mutton Karahi']);
    expect(rows[0]?.querySelector('.pos-list__name span')?.textContent).toBe('2 sizes');
    expect(rows[0]?.querySelector('.pos-list__muted')?.textContent).toBe('Karahi');
    expect([...rows[0]!.querySelectorAll('.pos-chip')].map((c) => c.textContent)).toEqual(['Half Rs 1,150', 'Full Rs 2,200']);
    expect(rows[0]?.querySelector('a.pos-rowlink')?.getAttribute('href')).toBe('#/size-groups/VG1');
    expect(m.container.querySelector('.pos-appbar a.pos-btn--primary')?.getAttribute('href')).toBe('#/size-groups/new');
  });

  it('search by name; ⋯ Show archived lists archived groups with the "Archived shown" chip', async () => {
    const { api } = fakeApi(handler());
    await render(<SizeGroupList api={api} />);
    setValue(m.container.querySelector<HTMLInputElement>('input[name="q"]'), 'mutton');
    expect([...m.container.querySelectorAll('.pos-list__row strong')].map((s) => s.textContent)).toEqual(['Mutton Karahi']);
    setValue(m.container.querySelector<HTMLInputElement>('input[name="q"]'), '');
    await click(m.container.querySelector<HTMLButtonElement>('.pos-appbar button.pos-more')!);
    await click(button(m.container, 'Show archived size groups'));
    expect([...m.container.querySelectorAll('.pos-list__row strong')].map((s) => s.textContent)).toEqual(['Old platter']);
    await click(m.container.querySelector<HTMLButtonElement>('.pos-filterchip')!);
    expect(m.container.querySelectorAll('.pos-list__row')).toHaveLength(2);
  });

  it('read-only (can_edit_tenant false): no New size group', async () => {
    const { api } = fakeApi(handler(undefined, false));
    await render(<SizeGroupList api={api} />);
    expect(m.container.querySelectorAll('.pos-list__row')).toHaveLength(2);
    expect(m.container.querySelector('.pos-btn--primary')).toBeNull();
  });
});

describe('[01c-S09] size group form', () => {
  it('new: POST with an Idempotency-Key and the body; then the group opens to add sizes; Add a size waits for the save', async () => {
    const { api, calls } = fakeApi(handler((call) => (call.method === 'POST' ? ok({ variant_group: group('VG9', 'Seekh Kebab', 0, []) }) : undefined)));
    await form(api, 'new');
    expect(m.container.querySelector('.pos-appbar__title')?.textContent).toBe('New size group');
    expect(button(m.container, 'Add a size').disabled).toBe(true);
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), '  Seekh Kebab ');
    setValue(m.container.querySelector<HTMLSelectElement>('select[name="category_id"]'), 'C2');
    await click(button(m.container, 'Create size group'));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/v1/admin/variant-groups');
    expect(post.key).toMatch(/^[0-9A-Z]{26}$/);
    expect(post.body).toEqual({ name: 'Seekh Kebab', category_id: 'C2', description: null, sort_order: 0 });
    expect(window.location.hash).toBe('#/size-groups/VG9');
  });

  it('edit: sizes read-only with price, On sale and Open; PATCH sends expected_version and only the changed fields', async () => {
    const { api, calls } = fakeApi(handler((call) => (call.method === 'PATCH' ? ok({ variant_group: GROUPS[1] }) : undefined)));
    await form(api, 'VG1');
    const sizes = [...m.container.querySelectorAll('[data-sizes] .pos-list__row')];
    expect(sizes.map((r) => r.querySelector('strong')?.textContent)).toEqual(['Chicken Karahi — Half', 'Chicken Karahi — Full']);
    expect(sizes[0]?.querySelector('.pos-list__name span')?.textContent).toBe('Draws 0.5 kg from Karahi pot');
    expect(sizes[0]?.querySelector('.pos-list__num')?.textContent).toBe('Rs 1,150');
    expect(sizes[0]?.querySelector('.pos-chip--ok')?.textContent).toBe('On sale');
    expect(sizes[0]?.querySelector('a.pos-btn')?.getAttribute('href')).toBe('#/menu?item=I1');
    expect(m.container.querySelector('[data-sizes] .pos-fold__head a.pos-btn')?.getAttribute('href')).toBe('#/menu?new_size_of=VG1');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'Chicken Karahi Special');
    await click(button(m.container, 'Save'));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/v1/admin/variant-groups/VG1',
      key: undefined,
      body: { expected_version: 'v-VG1', name: 'Chicken Karahi Special' },
    });
    expect(window.location.hash).toBe('#/size-groups');
  });

  it('409 CONFIG_STALE: "Changed elsewhere" with Reload, the draft kept and editable, Save disabled; Reload re-reads', async () => {
    const { api, calls } = fakeApi(handler((call) => (call.method === 'PATCH' ? fail(409, 'CONFIG_STALE', { entity: 'variant_group', id: 'VG1' }) : undefined)));
    await form(api, 'VG1');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'My draft');
    await click(button(m.container, 'Save'));
    expect(m.container.querySelector('[data-stale]')).not.toBeNull();
    const name = m.container.querySelector<HTMLInputElement>('input[name="name"]')!;
    expect(name.value).toBe('My draft');
    expect(name.disabled).toBe(false);
    expect(button(m.container, 'Save').disabled).toBe(true);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    const reads = calls.length;
    await click(button(m.container, 'Reload'));
    expect(calls.length).toBeGreaterThan(reads);
    expect(m.container.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe('Chicken Karahi');
    expect(m.container.querySelector('[data-stale]')).toBeNull();
  });

  it('404 VARIANT_GROUP_NOT_FOUND replaces the form with the gone block and Back to Size groups', async () => {
    const { api } = fakeApi(handler((call) => (call.method === 'PATCH' ? fail(404, 'VARIANT_GROUP_NOT_FOUND') : undefined)));
    await form(api, 'VG1');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'X');
    await click(button(m.container, 'Save'));
    const gone = m.container.querySelector('.pos-gone')!;
    expect(gone.querySelector('h2')?.textContent).toBe("This size group isn't here any more");
    expect(m.container.querySelector('input[name="name"]')).toBeNull();
    window.location.hash = '#/size-groups/VG1';
    await click(button(gone, 'Back to Size groups'));
    expect(window.location.hash).toBe('#/size-groups');
  });

  it('an id that is not in the menu read shows the gone block', async () => {
    const { api } = fakeApi(handler());
    await form(api, 'NOPE');
    expect(m.container.querySelector('.pos-gone h2')?.textContent).toBe("This size group isn't here any more");
  });

  it('Archive (⋯) blocked by 409 CONFIG_IN_USE → 01c-D04 naming the active sizes with Open', async () => {
    const { api, calls } = fakeApi(
      handler((call) =>
        call.method === 'PATCH'
          ? fail(409, 'CONFIG_IN_USE', { entity: 'variant_group', id: 'VG1', used_by: { entity: 'menu_item', ids: ['I1', 'I2'] } })
          : undefined,
      ),
    );
    await form(api, 'VG1');
    await click(m.container.querySelector<HTMLButtonElement>('.pos-appbar button.pos-more')!);
    expect(m.container.querySelector('.pos-menu__info span')?.textContent).toBe('Only when it has no active sizes.');
    await click(button(m.container, 'Archive size group'));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ expected_version: 'v-VG1', archived: true });
    const dialog = m.container.querySelector('[role="alertdialog"]')!;
    expect(dialog.querySelector('h2')?.textContent).toBe("Chicken Karahi can't be archived yet");
    expect([...dialog.querySelectorAll('.pos-inuse__row span')].map((s) => s.textContent?.trim())).toEqual([
      'Chicken Karahi — Half',
      'Chicken Karahi — Full',
    ]);
    await click(button(dialog as HTMLElement, 'Close'));
    expect(m.container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('422 too_many_groups at category_id marks the category field and the error summary', async () => {
    const { api } = fakeApi(
      handler((call) =>
        call.method === 'PATCH' ? fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'category_id', reason: 'too_many_groups' }) : undefined,
      ),
    );
    await form(api, 'VG1');
    setValue(m.container.querySelector<HTMLSelectElement>('select[name="category_id"]'), 'C2');
    await click(button(m.container, 'Save'));
    const field = m.container.querySelector('select[name="category_id"]')!.closest('.pos-field')!;
    expect(field.classList.contains('pos-field--error')).toBe(true);
    expect(field.querySelector('.pos-field__error')?.textContent).toBe('An item can have up to 20 choice groups. Remove one first.');
    expect(m.container.querySelector('[data-fix-summary] p')?.firstChild?.textContent).toBe('1 thing to fix before saving');
  });

  it('409 CONFIG_NAME_TAKEN marks the name; an empty name is caught before sending', async () => {
    const { api, calls } = fakeApi(handler((call) => (call.method === 'PATCH' ? fail(409, 'CONFIG_NAME_TAKEN', { entity: 'variant_group' }) : undefined)));
    await form(api, 'VG1');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), ' ');
    await click(button(m.container, 'Save'));
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    expect(m.container.querySelector('.pos-field--error .pos-field__error')?.textContent).toBe('Type a name, up to 60 letters.');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'Mutton Karahi');
    await click(button(m.container, 'Save'));
    expect(m.container.querySelector('.pos-field--error .pos-field__error')?.textContent).toBe('That name is already used. Choose another name.');
  });

  it('read-only (can_edit_tenant false): fields disabled, no Save, no More, no Add a size', async () => {
    const { api } = fakeApi(handler(undefined, false));
    await form(api, 'VG1');
    expect(m.container.querySelector<HTMLInputElement>('input[name="name"]')?.disabled).toBe(true);
    expect(m.container.querySelector<HTMLSelectElement>('select[name="category_id"]')?.disabled).toBe(true);
    expect([...m.container.querySelectorAll('button')].some((b) => b.textContent === 'Save')).toBe(false);
    expect(m.container.querySelector('.pos-appbar .pos-more')).toBeNull();
    expect(m.container.querySelector('[data-sizes] .pos-fold__head a')).toBeNull();
  });
});
