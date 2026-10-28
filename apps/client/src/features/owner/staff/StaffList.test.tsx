import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { button, click, fakeApi, mount, ok, setValue, type Call, type Mounted } from '../test-api';
import { BRANCHES, ROLES, STAFF, person } from './fixtures';
import { BranchNames } from '../branch';
import { StaffList } from './StaffList';

const NAMES = new Map(BRANCHES.map((b) => [b.branch_id, b.name]));

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

function reads(staff = STAFF, left = [person({ staff_id: 'S8', display_name: 'Kashif', is_active: false, left_at: 5 })]) {
  return (call: Call): Response => {
    if (call.url === '/v1/admin/staff') return ok({ staff });
    if (call.url === '/v1/admin/staff?status=left') return ok({ staff: left });
    if (call.url === '/v1/admin/roles') return ok({ roles: ROLES });
    if (call.url === '/v1/admin/branches') return ok({ branches: BRANCHES, hub_stale_after_ms: 180_000 });
    throw new Error(`unexpected ${call.method} ${call.url}`);
  };
}

function names(): string[] {
  return [...m.container.querySelectorAll('.pos-list__row .pos-list__name strong')].map((n) => n.textContent ?? '');
}

describe('[01b §8] staff list', () => {
  it('[01b §8] shows roles, branches and PIN state; search, branch filter and Left are client-side', async () => {
    const { api, calls } = fakeApi(reads());
    await m.render(
      <BranchNames.Provider value={NAMES}>
        <StaffList api={api} branchIds={['B1', 'B2']} />
      </BranchNames.Provider>,
    );
    expect(names()).toEqual(['Arif', 'Bilal', 'Hamza', 'Usman']);
    expect(m.container.textContent).toContain('Gulberg, Johar Town');
    expect(m.container.textContent).toContain(t('staff.pin_not_set_help'));
    expect(button(m.container, t('staff.set_pin'))).toBeTruthy();

    setValue(m.container.querySelector<HTMLInputElement>('input[type="search"]'), 'bil');
    expect(names()).toEqual(['Bilal']);
    setValue(m.container.querySelector<HTMLInputElement>('input[type="search"]'), 'zz');
    expect(m.container.textContent).toContain(fill(t('staff.no_match'), { q: 'zz' }));

    setValue(m.container.querySelector<HTMLInputElement>('input[type="search"]'), '');
    setValue(m.container.querySelector<HTMLSelectElement>('select'), 'B2');
    expect(names()).toEqual(['Arif', 'Hamza']);

    setValue(m.container.querySelector<HTMLSelectElement>('select'), '');
    await click(button(m.container, `${t('staff.left')}1`));
    expect(names()).toEqual(['Kashif']);
    expect(calls.filter((c) => c.url.startsWith('/v1/admin/staff')).length).toBe(2);
  });

  it('[01b §8] first run shows the empty state with the ready roles', async () => {
    const { api } = fakeApi(reads([], []));
    await m.render(<StaffList api={api} branchIds={['B1']} />);
    expect(m.container.textContent).toContain(t('staff.empty_title'));
    expect(m.container.textContent).toContain('Owner, Waiter, Shift lead');
  });
});
