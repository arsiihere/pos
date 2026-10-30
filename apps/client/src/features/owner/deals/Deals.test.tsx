import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CloudAdmin } from '../../../api/cloud-admin';
import { BranchNames } from '../branch';
import { GuardProvider } from '../guard';
import { button, click, fail, fakeApi, flush, mount, ok, setValue, type Call, type Mounted } from '../test-api';
import { DealForm } from './DealForm';
import { DealList } from './DealList';

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
  window.location.hash = '#/deals';
  m = mount();
});

afterEach(() => {
  m.unmount();
  sessionStorage.clear();
});

const route = (branch_id: string) => ({ branch_id, station_id: 'S', program_id: null, stock_program_id: null, price_minor_override: null });
const item = (item_id: string, name: string, category_id: string, price: number, routes: string[], extra: Record<string, unknown> = {}) => ({
  item_id,
  category_id,
  tax_class_id: null,
  name,
  variant_group_id: null,
  variant_name: null,
  description: null,
  sort_order: 0,
  price_minor: price,
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
  routes: routes.map(route),
  ...extra,
});
// Naan is not routed at Gulberg, Roghni naan only at Johar Town: part 2 of the karahi deal has no choice routed
// at Gulberg (the B04 case, test #115).
const KARAHI = item('I1', 'Chicken Karahi — Full', 'C1', 220000, [B1, B2, B3]);
const NAAN = item('I2', 'Naan', 'C2', 3000, [B2, B3]);
const ROGHNI = item('I3', 'Roghni naan', 'C2', 6000, [B2]);
const FISH = item('I4', 'Rahu fish (fried)', 'C1', 340000, [B1], { sale_unit: 'g', requires_weighing: true });
const RICE = item('I5', 'Plain rice', 'C1', 80000, [B1], { sale_unit: 'g' });
const CATEGORIES = [
  { category_id: 'C1', name: 'Karahi', sort_order: 0, archived_at: null, availability_windows: [] },
  { category_id: 'C2', name: 'Breads', sort_order: 1, archived_at: null, availability_windows: [] },
];
const page = (items: unknown[], next_cursor: string | null) => ({
  can_edit_tenant: true,
  tax_classes: [{ tax_class_id: 'T1', name: 'GST', rate_bp: 1600, archived_at: null }],
  categories: CATEGORIES,
  variant_groups: [],
  items,
  next_cursor,
});
const DEAL = {
  deal_id: 'D1',
  name: 'Family karahi deal',
  category_id: 'C1',
  tax_class_id: null,
  description: null,
  sort_order: 0,
  price_minor: 320000,
  archived_at: null,
  availability_windows: [],
  parts: [
    { deal_part_id: 'P1', quantity: 1, sort_order: 0, choices: [{ item_id: 'I1', extra_price_minor: 0, sort_order: 0 }] },
    {
      deal_part_id: 'P2',
      quantity: 4,
      sort_order: 1,
      choices: [
        { item_id: 'I2', extra_price_minor: 0, sort_order: 0 },
        { item_id: 'I3', extra_price_minor: 3000, sort_order: 1 },
      ],
    },
  ],
  archived_parts: [{ deal_part_id: 'P0' }],
  version: 'v1',
  branches: [
    { branch_id: B1, is_sold: true, price_minor_override: null, version: 'r1' },
    { branch_id: B2, is_sold: false, price_minor_override: null, version: 'r2' },
    { branch_id: B3, is_sold: true, price_minor_override: 350000, version: 'r3' },
  ],
};
const BIRYANI = {
  ...DEAL,
  deal_id: 'D2',
  name: 'Biryani + drink',
  sort_order: 1,
  price_minor: 52000,
  parts: [{ deal_part_id: 'P9', quantity: 1, sort_order: 0, choices: [{ item_id: 'I1', extra_price_minor: 0, sort_order: 0 }] }],
  archived_parts: [],
  branches: [B1, B2, B3].map((branch_id) => ({ branch_id, is_sold: false, price_minor_override: null, version: `n-${branch_id}` })),
};
const OLD = { ...BIRYANI, deal_id: 'D3', name: 'Old platter', archived_at: 1 };

function handler(
  write: (call: Call) => Response | undefined = () => undefined,
  o: { canEdit?: boolean; deals?: unknown[]; secondPage?: () => Response | Promise<Response>; archivedFail?: boolean } = {},
) {
  return (call: Call): Response | Promise<Response> => {
    const written = call.method === 'GET' ? undefined : write(call);
    if (written !== undefined) return written;
    if (call.url === '/v1/admin/deals') return ok({ can_edit_tenant: o.canEdit ?? true, deals: o.deals ?? [DEAL, BIRYANI] });
    if (call.url === '/v1/admin/deals?status=archived' && o.archivedFail === true) return fail(503, 'SERVICE_UNAVAILABLE');
    if (call.url === '/v1/admin/deals?status=archived') return ok({ can_edit_tenant: o.canEdit ?? true, deals: [OLD] });
    if (call.url.startsWith('/v1/admin/menu')) {
      if (call.url.includes('cursor=c2')) return o.secondPage?.() ?? ok(page([ROGHNI, FISH, RICE], null));
      return ok(page([KARAHI, NAAN], 'c2'));
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
const form = (api: CloudAdmin, id: string) => render(<DealForm api={api} dealId={id} />);
const row = (name: string) => m.container.querySelector<HTMLElement>(`[data-branch-row="${name}"]`)!;
const part = (n: number) => m.container.querySelector<HTMLElement>(`[data-part="${n}"]`)!;
const texts = (els: Iterable<Element>) => [...els].map((e) => e.textContent);

describe('[01c-S04] deals list', () => {
  it('Deal · Price · Parts · Sold at chips with the branch price; "Not sold anywhere yet"; rows open', async () => {
    const { api } = fakeApi(handler());
    await render(<DealList api={api} />);
    const rows = [...m.container.querySelectorAll<HTMLElement>('.pos-list__row')];
    expect(rows.map((r) => r.querySelector('strong')?.textContent)).toEqual(['Family karahi deal', 'Biryani + drink']);
    const karahi = rows[0]!;
    expect(karahi.querySelector('.pos-deals__price')?.textContent).toBe('Rs 3,200');
    expect(karahi.querySelector('.pos-list__muted')?.textContent).toBe('1 Chicken Karahi — Full + 4 Naan');
    expect(texts(karahi.querySelectorAll('.pos-chip:not(.pos-chip--warn)'))).toEqual(['Gulberg Rs 3,200', 'DHA Rs 3,500']);
    expect(karahi.querySelector('a.pos-rowlink')?.getAttribute('href')).toBe('#/deals/D1');
    const biryani = rows[1]!;
    expect(biryani.querySelector('.pos-list__name span')?.textContent).toBe('Category Karahi · no tax');
    expect(biryani.querySelector('.pos-chip')?.textContent).toBe('Not sold anywhere yet');
  });

  it('[01c #115] while the second menu page loads: "Checking branches…" and no warning; after the last page: the Gulberg warning', async () => {
    let release: (r: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { api } = fakeApi(handler(undefined, { secondPage: () => pending }));
    await render(<DealList api={api} />);
    expect(m.container.querySelector('[data-checking]')?.textContent).toBe('Checking branches…');
    expect(m.container.querySelector('[data-omission]')).toBeNull();
    release(ok(page([ROGHNI, FISH, RICE], null)));
    await flush();
    await flush();
    expect(m.container.querySelector('[data-checking]')).toBeNull();
    expect(texts(m.container.querySelectorAll('[data-omission]'))).toEqual(['Not sold at Gulberg: part 2 has no routed choice']);
  });

  it('[review I1] a failed menu page: no endless "Checking branches…"; an error with Retry that reloads from page 1', async () => {
    let failing = true;
    const { api, calls } = fakeApi(handler(undefined, { secondPage: () => (failing ? fail(500, 'INTERNAL') : ok(page([ROGHNI, FISH, RICE], null))) }));
    await render(<DealList api={api} />);
    expect(m.container.querySelector('[data-checking]')).toBeNull();
    expect(m.container.querySelector('[data-omission]')).toBeNull();
    const banner = m.container.querySelector<HTMLElement>('[data-menu-error]')!;
    expect(banner.querySelector('p')?.firstChild?.textContent).toBe(
      "Couldn't check the branches. Branch warnings are not shown until the menu loads.",
    );
    // A later deal read (Show archived and back) does not wipe the menu error.
    await click(m.container.querySelector<HTMLButtonElement>('.pos-appbar button.pos-more')!);
    await click(button(m.container, 'Show archived deals'));
    expect(m.container.querySelector('[data-menu-error]')).not.toBeNull();
    await click(m.container.querySelector<HTMLButtonElement>('.pos-appbar button.pos-more')!);
    await click(button(m.container, 'Hide archived deals'));
    failing = false;
    const firstPages = calls.filter((c) => c.url.startsWith('/v1/admin/menu') && !c.url.includes('cursor')).length;
    await click(button(m.container.querySelector('[data-menu-error]')!, 'Retry'));
    await flush();
    expect(calls.filter((c) => c.url.startsWith('/v1/admin/menu') && !c.url.includes('cursor')).length).toBe(firstPages + 1);
    expect(m.container.querySelector('[data-menu-error]')).toBeNull();
    expect(texts(m.container.querySelectorAll('[data-omission]'))).toEqual(['Not sold at Gulberg: part 2 has no routed choice']);
  });

  it('search by name; ⋯ Show archived reads status=archived; read-only hides New; empty list card', async () => {
    const { api, calls } = fakeApi(handler());
    await render(<DealList api={api} />);
    expect(m.container.querySelector('a.pos-btn--primary')?.getAttribute('href')).toBe('#/deals/new');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="q"]'), 'biryani');
    expect(texts(m.container.querySelectorAll('.pos-list__row strong'))).toEqual(['Biryani + drink']);
    setValue(m.container.querySelector<HTMLInputElement>('input[name="q"]'), '');
    await click(m.container.querySelector<HTMLButtonElement>('.pos-appbar button.pos-more')!);
    await click(button(m.container, 'Show archived deals'));
    expect(calls.some((c) => c.url === '/v1/admin/deals?status=archived')).toBe(true);
    expect(texts(m.container.querySelectorAll('.pos-list__row strong'))).toEqual(['Old platter']);
    m.unmount();
    m = mount();
    await render(<DealList api={fakeApi(handler(undefined, { canEdit: false })).api} />);
    expect(m.container.querySelector('.pos-btn--primary')).toBeNull();
    m.unmount();
    m = mount();
    await render(<DealList api={fakeApi(handler(undefined, { deals: [] })).api} />);
    expect(m.container.querySelector('.pos-empty h3')?.textContent).toBe('No deals yet');
  });
});

describe('[01c-S05] deal form', () => {
  it('part cards: numbered, quantity with the unit affix, Fixed / Customer picks one, a single choice is Included', async () => {
    const { api } = fakeApi(handler());
    await form(api, 'D1');
    expect(part(1).querySelector('.pos-part__title')?.textContent).toBe('Part 1Fixed');
    expect(part(1).querySelector('.pos-input-affix > span')?.textContent).toBe('pc');
    expect(part(1).querySelector('.pos-choice__fixed')?.textContent).toBe('Included');
    expect(part(2).querySelector('.pos-part__title')?.textContent).toBe('Part 2Customer picks one');
    expect(part(2).querySelector<HTMLInputElement>('input[name="parts.1.quantity"]')?.value).toBe('4');
    expect(part(2).querySelector('.pos-part__head .pos-input-affix > span')?.textContent).toBe('pcs');
    expect(part(2).querySelector('.pos-choice small')?.textContent).toBe('Breads · sold by piece');
    expect(part(2).querySelector<HTMLInputElement>('input[name="parts.1.choices.1.extra_price_minor"]')?.value).toBe('30');
    expect(m.container.querySelector('.pos-removed__row span')?.textContent).toBe('A removed part');
  });

  it('new: POST with an Idempotency-Key and no ids; choices added through the picker; the new deal opens', async () => {
    const created = { ...DEAL, deal_id: 'D9' };
    const { api, calls } = fakeApi(handler((call) => (call.method === 'POST' ? ok({ deal: created }) : undefined)));
    await form(api, 'new');
    expect(m.container.querySelector('[data-parts] .pos-note')?.textContent).toBe('Add the first part, like 1 × Full karahi.');
    expect(m.container.querySelector<HTMLSelectElement>('select[name="category_id"]')?.value).toBe('C1');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'Family karahi deal');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="price_minor"]'), '3,200');
    await click(button(m.container, 'Add part'));
    await click(button(part(1), 'Add choice'));
    const picker = m.container.querySelector<HTMLElement>('[data-choice-picker]')!;
    expect(picker.querySelector('h2')?.textContent).toBe('Choices for part 1');
    await click(picker.querySelector<HTMLButtonElement>('[data-item-id="I1"]')!);
    await click(button(picker, 'Add 1 to part'));
    await click(button(m.container, 'Create deal'));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/v1/admin/deals');
    expect(post.key).toMatch(/^[0-9A-Z]{26}$/);
    expect(post.body).toEqual({
      name: 'Family karahi deal',
      category_id: 'C1',
      tax_class_id: null,
      description: null,
      sort_order: 0,
      price_minor: 320000,
      availability_windows: [],
      parts: [{ quantity: 1, sort_order: 0, choices: [{ item_id: 'I1', extra_price_minor: 0, sort_order: 0 }] }],
    });
    expect(window.location.hash).toBe('#/deals/D9');
  });

  it('[01c-D03] the picker: the part\'s choices ticked, weighed and other-unit items disabled with the reason', async () => {
    const { api } = fakeApi(handler());
    await form(api, 'D1');
    await click(button(part(2), 'Add choice'));
    const picker = m.container.querySelector<HTMLElement>('[data-choice-picker]')!;
    expect(picker.querySelector('.pos-picker__sub')?.textContent).toBe('4 pieces · all choices must be sold by piece');
    const pick = (id: string) => picker.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!;
    expect(pick('I2').getAttribute('aria-checked')).toBe('true');
    expect(pick('I4').classList.contains('is-off')).toBe(true);
    expect(pick('I4').querySelector('small')?.textContent).toBe("Can't be in a deal: weighed when served");
    expect(pick('I5').querySelector('small')?.textContent).toBe("Can't be in this part: sold by weight");
    expect(pick('I1').querySelector('small')?.textContent).toBe('Karahi · by piece · can be in two parts');
    await click(pick('I4'));
    expect(pick('I4').getAttribute('aria-checked')).toBe('false');
    expect(button(picker, 'Add 0 to part').disabled).toBe(true);
  });

  it('edit: PATCH with expected_version, the parts whole with their ids; a removed part is left out and listed', async () => {
    const { api, calls } = fakeApi(handler((call) => (call.method === 'PATCH' ? ok({ deal: DEAL }) : undefined)));
    await form(api, 'D1');
    await click(part(1).querySelector<HTMLButtonElement>('button[aria-label="Remove part 1"]')!);
    expect(texts(m.container.querySelectorAll('.pos-removed__row span'))).toEqual(['1 × Chicken Karahi — Full', 'A removed part']);
    setValue(part(1).querySelector<HTMLInputElement>('input[name="parts.0.choices.1.extra_price_minor"]'), '40');
    await click(button(m.container.querySelector('.pos-appbar')!, 'Save'));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/v1/admin/deals/D1',
      body: {
        expected_version: 'v1',
        parts: [
          {
            deal_part_id: 'P2',
            quantity: 4,
            sort_order: 0,
            choices: [
              { item_id: 'I2', extra_price_minor: 0, sort_order: 0 },
              { item_id: 'I3', extra_price_minor: 4000, sort_order: 1 },
            ],
          },
        ],
      },
    });
    expect(Object.keys(calls.find((c) => c.method === 'PATCH')!.body as object)).toEqual(['expected_version', 'parts']);
  });

  it('Restore an archived part sends its id with the choices picked again', async () => {
    const { api, calls } = fakeApi(handler((call) => (call.method === 'PATCH' ? ok({ deal: DEAL }) : undefined)));
    await form(api, 'D1');
    await click(button(m.container.querySelector('.pos-removed')!, 'Restore'));
    expect(m.container.querySelector('.pos-removed')).toBeNull();
    expect(part(3).querySelector('.pos-note')?.textContent).toBe('Restored part: add its choices again, then save.');
    await click(button(part(3), 'Add choice'));
    await click(m.container.querySelector<HTMLButtonElement>('[data-choice-picker] [data-item-id="I2"]')!);
    await click(button(m.container.querySelector('[data-choice-picker]')!, 'Add 1 to part'));
    await click(button(m.container.querySelector('.pos-appbar')!, 'Save'));
    const body = calls.find((c) => c.method === 'PATCH')!.body as { parts: { deal_part_id?: string }[] };
    expect(body.parts.map((p) => p.deal_part_id)).toEqual(['P1', 'P2', 'P0']);
  });

  it('422 choice_unit_mismatch at parts.1.choices: part 2 shows the error and one summary banner links "Part 2"', async () => {
    const { api } = fakeApi(
      handler((call) => (call.method === 'PATCH' ? fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'parts.1.choices', reason: 'choice_unit_mismatch' }) : undefined)),
    );
    await form(api, 'D1');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="price_minor"]'), '3300');
    await click(button(m.container.querySelector('.pos-appbar')!, 'Save'));
    expect(part(2).classList.contains('is-error')).toBe(true);
    expect(part(1).classList.contains('is-error')).toBe(false);
    expect(part(2).querySelector('[data-part-error]')?.textContent).toBe(
      'All choices in a part must be sold the same way — all by piece or all by weight.',
    );
    const summary = m.container.querySelectorAll('[data-fix-summary]');
    expect(summary).toHaveLength(1);
    expect(texts(summary[0]!.querySelectorAll('a'))).toEqual(['Part 2']);
  });

  it('422 weighed_item_in_deal at parts.0.choices.0.item_id maps to that choice row as sent', async () => {
    const { api } = fakeApi(
      handler((call) =>
        call.method === 'PATCH' ? fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'parts.0.choices.0.item_id', reason: 'weighed_item_in_deal' }) : undefined,
      ),
    );
    await form(api, 'D1');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'Karahi deal');
    await click(button(m.container.querySelector('.pos-appbar')!, 'Save'));
    expect(part(1).querySelector('.pos-choice.is-error')?.getAttribute('data-choice')).toBe('I1');
    expect(part(1).querySelector('[data-part-error]')?.textContent).toBe("Chicken Karahi — Full: Items weighed when served can't be in a deal.");
  });

  it('409 CONFIG_STALE: the banner, the draft kept, Save disabled; Reload re-reads', async () => {
    const { api, calls } = fakeApi(handler((call) => (call.method === 'PATCH' ? fail(409, 'CONFIG_STALE', { entity: 'deal', id: 'D1' }) : undefined)));
    await form(api, 'D1');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'Karahi deal');
    await click(button(m.container.querySelector('.pos-appbar')!, 'Save'));
    expect(m.container.querySelector('[data-stale]')).not.toBeNull();
    expect(m.container.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe('Karahi deal');
    expect(button(m.container.querySelector('.pos-appbar')!, 'Save').disabled).toBe(true);
    const reads = calls.filter((c) => c.url === '/v1/admin/deals').length;
    await click(button(m.container.querySelector('[data-stale]')!, 'Reload'));
    expect(calls.filter((c) => c.url === '/v1/admin/deals').length).toBe(reads + 1);
  });

  it('404: an unknown id and DEAL_NOT_FOUND both replace the form', async () => {
    const { api } = fakeApi(handler((call) => (call.method === 'PATCH' ? fail(404, 'DEAL_NOT_FOUND', { deal_id: 'D1' }) : undefined)));
    await form(api, 'NOPE');
    expect(m.container.querySelector('.pos-gone h2')?.textContent).toBe("This deal isn't here any more");
    m.unmount();
    m = mount();
    await form(api, 'D1');
    setValue(m.container.querySelector<HTMLInputElement>('input[name="name"]'), 'Karahi deal');
    await click(button(m.container.querySelector('.pos-appbar')!, 'Save'));
    expect(m.container.querySelector('.pos-gone button')?.textContent).toBe('Back to Deals');
  });

  it('[review I2] a failed archived read shows an error, not "This deal isn\'t here any more"', async () => {
    const { api } = fakeApi(handler(undefined, { archivedFail: true }));
    await form(api, 'D3');
    expect(m.container.querySelector('.pos-gone')).toBeNull();
    expect(m.container.querySelector('.pos-banner--danger')).not.toBeNull();
    m.unmount();
    m = mount();
    // An active deal still opens when only the archived read fails.
    await form(api, 'D1');
    expect(m.container.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe('Family karahi deal');
  });

  it('[review I3] Hours keep the edited window across close and reopen', async () => {
    const { api } = fakeApi(handler());
    await form(api, 'D1');
    const toggle = () => m.container.querySelector<HTMLButtonElement>('#deal-hours')!;
    await click(toggle());
    await click(button(m.container.querySelector('#deal-hours-body')!, 'Only at set hours'));
    setValue(m.container.querySelector<HTMLInputElement>('#deal-hours-body input[name="start"]'), '12:00');
    setValue(m.container.querySelector<HTMLInputElement>('#deal-hours-body input[name="end"]'), '15:00');
    await click(toggle());
    expect(toggle().textContent).toContain('12:00–15:00');
    await click(toggle());
    expect(m.container.querySelector<HTMLInputElement>('#deal-hours-body input[name="start"]')?.value).toBe('12:00');
    expect(m.container.querySelector<HTMLInputElement>('#deal-hours-body input[name="end"]')?.value).toBe('15:00');
  });

  it('read-only: tenant fields disabled, no Save, no Add part; branch rows stay editable', async () => {
    const { api } = fakeApi(handler(undefined, { canEdit: false }));
    await form(api, 'D1');
    expect(m.container.querySelector<HTMLInputElement>('input[name="name"]')?.disabled).toBe(true);
    expect([...m.container.querySelectorAll('button')].some((b) => b.textContent === 'Save' || b.textContent === 'Add part')).toBe(false);
    await click(row('Johar Town').querySelector<HTMLButtonElement>('.pos-brow__toggle')!);
    expect(row('Johar Town').querySelector<HTMLButtonElement>('button[role="switch"]')?.disabled).toBe(false);
  });
});

describe('[01c-S11] deal at each branch', () => {
  it('chips: Sold here + Deal price / the branch price; the B04 warning on Gulberg', async () => {
    const { api } = fakeApi(handler());
    await form(api, 'D1');
    expect(texts(row('Gulberg').querySelectorAll('.pos-chip'))).toEqual(['Sold here', 'Deal price', 'Not sold at Gulberg: part 2 has no routed choice']);
    expect(texts(row('Johar Town').querySelectorAll('.pos-chip'))).toEqual(['Not sold here']);
    expect(texts(row('DHA').querySelectorAll('.pos-chip'))).toEqual(['Sold here', 'Rs 3,500']);
  });

  it('Sold here + Price here PUT that row with its version and no key; a withdraw sends no price and re-reads', async () => {
    const saved = { branch_id: B2, is_sold: true, price_minor_override: 340000, version: 'r2b' };
    const { api, calls } = fakeApi(handler((call) => (call.method === 'PUT' ? ok({ branch: call.url.endsWith(B2) ? saved : null }) : undefined)));
    await form(api, 'D1');
    expect(m.container.querySelector('.pos-btn--row')).toBeNull();
    await click(row('Johar Town').querySelector<HTMLButtonElement>('.pos-brow__toggle')!);
    expect(row('Johar Town').querySelector<HTMLInputElement>('input[name="price_minor_override"]')?.disabled).toBe(true);
    await click(row('Johar Town').querySelector<HTMLButtonElement>('button[role="switch"]')!);
    setValue(row('Johar Town').querySelector<HTMLInputElement>('input[name="price_minor_override"]'), '3,400');
    await click(row('Johar Town').querySelector<HTMLButtonElement>('.pos-btn--row')!);
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      url: `/v1/admin/deals/D1/branches/${B2}`,
      key: undefined,
      body: { expected_version: 'r2', is_sold: true, price_minor_override: 340000 },
    });
    expect(row('Johar Town').querySelector('.pos-btn--row')).toBeNull();
    await click(row('DHA').querySelector<HTMLButtonElement>('.pos-brow__toggle')!);
    await click(row('DHA').querySelector<HTMLButtonElement>('button[role="switch"]')!);
    const reads = calls.filter((c) => c.url === '/v1/admin/deals').length;
    await click(row('DHA').querySelector<HTMLButtonElement>('.pos-btn--row')!);
    expect(calls.filter((c) => c.method === 'PUT')[1]?.body).toEqual({ expected_version: 'r3', is_sold: false, price_minor_override: null });
    expect(calls.filter((c) => c.url === '/v1/admin/deals').length).toBe(reads + 1);
  });

  it('409 CONFIG_STALE on a row: the banner in that row only, the draft stays, the page Save stays enabled', async () => {
    const { api } = fakeApi(handler((call) => (call.method === 'PUT' ? fail(409, 'CONFIG_STALE', { entity: 'deal_branch', id: 'D1' }) : undefined)));
    await form(api, 'D1');
    await click(row('Johar Town').querySelector<HTMLButtonElement>('.pos-brow__toggle')!);
    await click(row('Johar Town').querySelector<HTMLButtonElement>('button[role="switch"]')!);
    await click(row('Johar Town').querySelector<HTMLButtonElement>('.pos-btn--row')!);
    expect(row('Johar Town').querySelector('[data-stale]')).not.toBeNull();
    expect(m.container.querySelectorAll('[data-stale]')).toHaveLength(1);
    expect(row('Johar Town').querySelector('button[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
    expect(button(m.container.querySelector('.pos-appbar')!, 'Save').disabled).toBe(false);
  });
});
