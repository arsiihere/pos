import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { BranchNames } from '../branch';
import { BRANCHES, ROLES, STAFF } from '../staff/fixtures';
import { button, click, fail, fakeApi, mount, ok, type Call, type Mounted } from '../test-api';
import { StockCountingView } from './StockCountingView';

let m: Mounted;

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
  m = mount();
});

afterEach(() => {
  m.unmount();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

const NAMES = new Map(BRANCHES.map((b) => [b.branch_id, b.name]));

function station(id: string, name: string, archived_at: number | null = null) {
  return {
    station_id: id,
    name,
    location_label: null,
    station_type: 'slot',
    capacity: 1,
    freshness_window_ms: null,
    completion_mode: 'two_tap',
    archived_at,
    programs: [],
  };
}

const SET = {
  version: 'rv1',
  responsibilities: [
    { responsibility: 'count_stock', station_id: 'ST1', staff_ids: ['S4'], role_ids: ['R_OWNER'] },
    { responsibility: 'count_stock', station_id: 'ST2', staff_ids: ['S4'], role_ids: [] },
  ],
};

function handler(write: (call: Call) => Response) {
  return (call: Call): Response => {
    if (call.method !== 'GET') return write(call);
    if (call.url === '/v1/admin/branches/B1/responsibilities') return ok(SET);
    if (call.url === '/v1/admin/branches/B1/stations') {
      return ok({ stations: [station('ST1', 'Degh'), station('ST2', 'BBQ grill'), station('ST3', 'Drinks counter'), station('ST9', 'Old', 5)] });
    }
    if (call.url === '/v1/admin/staff?branch_id=B1') return ok({ staff: STAFF });
    if (call.url === '/v1/admin/roles') return ok({ roles: ROLES });
    throw new Error(`unexpected ${call.method} ${call.url}`);
  };
}

function row(name: string): HTMLElement {
  const found = [...m.container.querySelectorAll<HTMLElement>('.pos-list__row')].find((r) => r.querySelector('strong')?.textContent === name);
  if (!found) throw new Error(`row ${name} missing`);
  return found;
}

async function render(write: (call: Call) => Response) {
  const { api, calls } = fakeApi(handler(write));
  await m.render(
    <BranchNames.Provider value={NAMES}>
      <StockCountingView api={api} branchId="B1" branchIds={['B1', 'B2']} onBranch={() => {}} />
    </BranchNames.Provider>,
  );
  return calls;
}

describe('[01b §8] stock counting', () => {
  it('[owner decision 2026-10-30] the People tab strip sits at the top of the content; stock-counting is current', async () => {
    await render(() => ok({}));
    const tabs = m.container.querySelector('main.pos-content > nav.pos-seg.pos-peopletabs');
    expect(tabs).not.toBeNull();
    expect([...tabs!.querySelectorAll('a.pos-seg__opt')].map((a) => a.getAttribute('href'))).toEqual([
      '#/staff',
      '#/roles',
      '#/teams',
      '#/stock-counting',
    ]);
    expect(tabs!.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('#/stock-counting');
  });

  it('[01b §8] stock-counting PUT sends the whole active set with expected_version', async () => {
    const calls = await render((call) => ok({ ...(call.body as object), version: 'rv2', changed_versions: { staff: [], roles: [], responsibilities: [] } }));
    expect(row('Degh').textContent).toContain('Usman');
    expect(row('Degh').textContent).toContain(fill(t('counting.everyone_with'), { role: 'Malik' }));
    expect(row('Drinks counter').textContent).toContain(t('counting.nobody'));
    expect(m.container.textContent).not.toContain('Old');
    expect(button(m.container, t('counting.save')).disabled).toBe(true);

    // Change one station: Bilal and the Bera role count Drinks counter.
    await click(button(row('Drinks counter'), t('counting.change')));
    const dialog = () => m.container.querySelector<HTMLElement>('[role="dialog"]')!;
    await click(button(dialog(), 'Bilal'));
    await click(button(dialog(), 'Bera'));
    await click(button(dialog(), t('counting.done')));
    expect(m.container.textContent).toContain(t('counting.unsaved_one'));

    await click(button(m.container, t('counting.save')));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('/v1/admin/branches/B1/responsibilities');
    expect(put?.body).toEqual({
      expected_version: 'rv1',
      responsibilities: [
        { responsibility: 'count_stock', station_id: 'ST1', staff_ids: ['S4'], role_ids: ['R_OWNER'] },
        { responsibility: 'count_stock', station_id: 'ST2', staff_ids: ['S4'], role_ids: [] },
        { responsibility: 'count_stock', station_id: 'ST3', staff_ids: ['S2'], role_ids: ['R_WAITER'] },
      ],
    });
    expect(m.container.textContent).toContain(fill(t('counting.saved'), { branch: 'Gulberg' }));
  });

  it('[01b §8] CONFIG_STALE shows Reload; a 422 says something changed', async () => {
    let answer = fail(409, 'CONFIG_STALE', { entity: 'responsibility', id: 'B1' });
    await render(() => answer);
    await click(button(row('Degh'), t('counting.change')));
    await click(button(m.container.querySelector<HTMLElement>('[role="dialog"]')!, 'Bilal'));
    await click(button(m.container, t('counting.done')));
    await click(button(m.container, t('counting.save')));
    expect(m.container.querySelector('[data-stale]')?.textContent).toContain(t('stale.title'));
    expect(button(m.container, t('stale.reload'))).toBeTruthy();

    await click(button(m.container, t('stale.reload')));
    await click(button(row('Degh'), t('counting.change')));
    await click(button(m.container.querySelector<HTMLElement>('[role="dialog"]')!, 'Bilal'));
    await click(button(m.container, t('counting.done')));
    answer = fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'responsibilities.0.staff_ids.0', reason: 'not_at_branch' });
    await click(button(m.container, t('counting.save')));
    expect(m.container.textContent).toContain(t('counting.changed'));
  });

  it('[hand-off 01b-S05] one summary warn banner names every station nobody counts; the help line is a note', async () => {
    await render(() => ok({}));
    await click(button(row('BBQ grill'), t('counting.change')));
    await click(button(m.container.querySelector<HTMLElement>('[role="dialog"]')!, 'Usman'));
    await click(button(m.container, t('counting.done')));
    expect(row('BBQ grill').querySelector('.pos-chip--warn')?.textContent).toBe(t('counting.nobody'));
    expect(row('Drinks counter').querySelector('.pos-chip--warn')?.textContent).toBe(t('counting.nobody'));
    const warns = m.container.querySelectorAll('.pos-banner--warn');
    expect(warns).toHaveLength(1);
    expect(warns[0]!.textContent).toContain(fill(t('counting.nobody_counts'), { station: 'BBQ grill, Drinks counter', branch: 'Gulberg' }));
    expect(m.container.querySelector('p.pos-note')?.textContent).toBe(t('counting.explain'));
  });

  it('[owner decision 2026-10-30, 01b P1] CONFIG_STALE keeps the picks until Reload; nothing is retried', async () => {
    let stale = true;
    const calls = await render((call) =>
      stale ? fail(409, 'CONFIG_STALE', { entity: 'responsibility', id: 'B1' }) : ok({ ...(call.body as object), version: 'rv2' }),
    );
    await click(button(row('Degh'), t('counting.change')));
    await click(button(m.container.querySelector<HTMLElement>('[role="dialog"]')!, 'Bilal'));
    await click(button(m.container, t('counting.done')));
    await click(button(m.container, t('counting.save')));
    const banner = m.container.querySelector<HTMLElement>('[data-stale]');
    expect(banner?.textContent).toContain(t('stale.title'));
    expect(banner?.textContent).toContain(t('stale.body'));
    // The draft stays on screen and can still be changed; Save stays off and nothing is sent again.
    expect(row('Degh').textContent).toContain('Bilal');
    await click(button(row('BBQ grill'), t('counting.change')));
    await click(button(m.container.querySelector<HTMLElement>('[role="dialog"]')!, 'Bilal'));
    await click(button(m.container, t('counting.done')));
    expect(row('BBQ grill').textContent).toContain('Bilal');
    expect(button(m.container, t('counting.save')).disabled).toBe(true);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);

    // Reload drops the picks and reads the current set; Save is primary again once something changes.
    stale = false;
    const gets = calls.filter((c) => c.method === 'GET').length;
    await click(button(m.container, t('stale.reload')));
    expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThan(gets);
    expect(m.container.querySelector('[data-stale]')).toBeNull();
    expect(row('Degh').textContent).not.toContain('Bilal');
    expect(row('BBQ grill').textContent).not.toContain('Bilal');
    await click(button(row('Degh'), t('counting.change')));
    await click(button(m.container.querySelector<HTMLElement>('[role="dialog"]')!, 'Bilal'));
    await click(button(m.container, t('counting.done')));
    const save = button(m.container, t('counting.save'));
    expect(save.disabled).toBe(false);
    expect(save.classList.contains('pos-btn--primary')).toBe(true);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });

  it('[hand-off B03] while Reload shows it is the one primary; Save is disabled and secondary', async () => {
    await render(() => fail(409, 'CONFIG_STALE', { entity: 'responsibility', id: 'B1' }));
    await click(button(row('Degh'), t('counting.change')));
    await click(button(m.container.querySelector<HTMLElement>('[role="dialog"]')!, 'Bilal'));
    await click(button(m.container, t('counting.done')));
    expect(button(m.container, t('counting.save')).classList.contains('pos-btn--primary')).toBe(true);
    await click(button(m.container, t('counting.save')));
    const save = button(m.container, t('counting.save'));
    expect(save.disabled).toBe(true);
    expect(save.classList.contains('pos-btn--primary')).toBe(false);
    expect([...m.container.querySelectorAll('.pos-btn--primary')].map((b) => b.textContent)).toEqual([t('stale.reload')]);
  });

  it('[hand-off ResponsibilitiesPhone] phone: branch select in the content, Save in the bottom action bar', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 760px)', media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    await render(() => ok({}));
    expect(m.container.querySelector('.pos-content > .pos-branchpick select')).not.toBeNull();
    expect(m.container.querySelector('.pos-actionbar')?.textContent).toBe(t('counting.save'));
    expect(m.container.querySelector('.pos-appbar .pos-btn--primary')).toBeNull();
    expect(row('Degh').querySelector('.pos-prow')).not.toBeNull();
  });
});
