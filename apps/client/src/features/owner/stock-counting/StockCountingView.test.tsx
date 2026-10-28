import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    expect(m.container.textContent).toContain(t('errors.CONFIG_STALE'));
    expect(button(m.container, t('staff.reload'))).toBeTruthy();

    await click(button(m.container, t('staff.reload')));
    await click(button(row('Degh'), t('counting.change')));
    await click(button(m.container.querySelector<HTMLElement>('[role="dialog"]')!, 'Bilal'));
    await click(button(m.container, t('counting.done')));
    answer = fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'responsibilities.0.staff_ids.0', reason: 'not_at_branch' });
    await click(button(m.container, t('counting.save')));
    expect(m.container.textContent).toContain(t('counting.changed'));
  });
});
