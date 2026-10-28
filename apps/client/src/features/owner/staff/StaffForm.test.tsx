import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { GuardProvider } from '../guard';
import { button, click, fail, fakeApi, mount, ok, setValue, type Call, type Mounted } from '../test-api';
import { BRANCHES, ROLES, STAFF } from './fixtures';
import { StaffForm } from './StaffForm';

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

// The reads every staff form makes; `write` answers PATCH and POST.
function handler(write: (call: Call) => Response, staff = STAFF) {
  return (call: Call): Response => {
    if (call.method !== 'GET') return write(call);
    if (call.url === '/v1/admin/staff') return ok({ staff });
    if (call.url === '/v1/admin/staff?status=left') return ok({ staff: [] });
    if (call.url === '/v1/admin/roles') return ok({ roles: ROLES });
    if (call.url === '/v1/admin/branches') return ok({ branches: BRANCHES, hub_stale_after_ms: 180_000 });
    if (call.url.endsWith('/floors')) {
      return ok({ floors: [{ floor_id: 'F1', name: 'Ground floor', sort_order: 0, archived_at: null, tables: [] }] });
    }
    throw new Error(`unexpected ${call.method} ${call.url}`);
  };
}

function headings(): string[] {
  return [...m.container.querySelectorAll('h2')].map((h) => h.textContent ?? '');
}

describe('[01b §8] staff form', () => {
  it('[01b §8] sends expected_version and shows the reload message on CONFIG_STALE', async () => {
    let stale = true;
    const { api, calls } = fakeApi(
      handler((call) => {
        if (call.method === 'PATCH' && stale) return fail(409, 'CONFIG_STALE', { entity: 'staff', id: 'S2' });
        throw new Error('unexpected write');
      }),
    );
    await m.render(
      <GuardProvider>
        <StaffForm api={api} staffId="S2" branchIds={['B1', 'B2']} />
      </GuardProvider>,
    );
    setValue(m.container.querySelector<HTMLInputElement>('input[name="display_name"]'), 'Bilal K.');
    await click(button(m.container, t('staff.save')));

    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toBe('/v1/admin/staff/S2');
    expect(patch?.body).toEqual({ expected_version: 'v-S2', display_name: 'Bilal K.' });
    expect(m.container.textContent).toContain(t('errors.CONFIG_STALE'));

    // Reload keeps nothing of the stale form (B23).
    stale = false;
    await click(button(m.container, t('staff.reload')));
    expect(m.container.querySelector<HTMLInputElement>('input[name="display_name"]')?.value).toBe('Bilal');
    expect(m.container.textContent).not.toContain(t('errors.CONFIG_STALE'));
  });

  it('[01b §8] floors field hidden without a my_floors grant', async () => {
    const { api } = fakeApi(handler(() => ok({})));
    await m.render(
      <GuardProvider>
        <StaffForm api={api} staffId="S2" branchIds={['B1', 'B2']} />
      </GuardProvider>,
    );
    expect(headings()).not.toContain(t('staff.floors'));

    // Shift lead grants take-order-anywhere on "my_floors".
    await click(button(m.container, 'Shift lead'));
    expect(headings()).toContain(t('staff.floors'));
    expect(m.container.textContent).toContain('Ground floor');
  });

  it('[01b §8] STAFF_LINKED_TO_OWNER shows its message on the Left switch', async () => {
    const { api, calls } = fakeApi(handler(() => fail(409, 'STAFF_LINKED_TO_OWNER', { staff_id: 'S1' })));
    await m.render(
      <GuardProvider>
        <StaffForm api={api} staffId="S1" branchIds={['B1', 'B2']} />
      </GuardProvider>,
    );
    await click(button(m.container, t('staff.mark_left')));
    const dialog = m.container.querySelector('[role="dialog"]');
    if (dialog === null) throw new Error('dialog missing');
    await click(button(dialog, t('staff.mark_left')));

    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ expected_version: 'v-S1', is_active: false });
    expect(m.container.textContent).toContain(t('errors.STAFF_LINKED_TO_OWNER'));
  });

  it('[01b §8] the Left dialog maps OWN_ADMIN_ACCESS by reason and names the branches on LAST_ADMIN_REQUIRED', async () => {
    let answer = () => fail(409, 'OWN_ADMIN_ACCESS', { reason: 'owner_not_linked' });
    const { api } = fakeApi(handler(() => answer()));
    await m.render(
      <GuardProvider>
        <StaffForm api={api} staffId="S2" branchIds={['B1', 'B2']} />
      </GuardProvider>,
    );
    async function markLeft(): Promise<void> {
      await click(button(m.container, t('staff.mark_left')));
      const dialog = m.container.querySelector('[role="dialog"]');
      if (dialog === null) throw new Error('dialog missing');
      await click(button(dialog, t('staff.mark_left')));
    }
    await markLeft();
    expect(m.container.textContent).toContain(t('errors.OWN_ADMIN_ACCESS_owner_not_linked'));
    expect(m.container.textContent).not.toContain(t('errors.OWN_ADMIN_ACCESS'));
    await click(button(m.container, t('common.close')));

    answer = () => fail(409, 'LAST_ADMIN_REQUIRED', { branch_ids: ['B2'] });
    await markLeft();
    expect(m.container.textContent).toContain(fill(t('roles.last_admin_body'), { branches: 'Johar Town' }));
  });

  it('[01b §8] a new person is created with the form key and the picked roles and branches', async () => {
    const { api, calls } = fakeApi(
      handler((call) => ok({ staff: { ...STAFF[1], ...(call.body as object), staff_id: 'S9' }, changed_versions: { staff: [], roles: [], responsibilities: [] } })),
    );
    await m.render(
      <GuardProvider>
        <StaffForm api={api} staffId={null} branchIds={['B1', 'B2']} />
      </GuardProvider>,
    );
    await click(button(m.container, t('staff.save')));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(m.container.textContent).toContain(t('staff.roles_required'));

    setValue(m.container.querySelector<HTMLInputElement>('input[name="display_name"]'), 'Ali R.');
    await click(button(m.container, 'Waiter'));
    await click(button(m.container, 'Gulberg'));
    await click(button(m.container, t('staff.save')));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.key).toMatch(/^[0-9A-Z]{26}$/);
    expect(post?.body).toEqual({ display_name: 'Ali R.', role_ids: ['R_WAITER'], branch_ids: ['B1'], denied_permissions: [], reports_to: [], floors: [] });
  });
});
