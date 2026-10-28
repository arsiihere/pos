import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { ROLES, role } from '../staff/fixtures';
import { button, click, fail, fakeApi, flush, mount, ok, setValue, type Call, type Mounted } from '../test-api';
import { BranchNames } from '../branch';
import { ownAdminText } from '../form';
import { RoleList } from './RoleList';

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

const RUNNER = role({ role_id: 'R_RUN', name: 'Runner', archived_at: Date.UTC(2026, 9, 12) });

function handler(write: (call: Call) => Response) {
  return (call: Call): Response => {
    if (call.method !== 'GET') return write(call);
    if (call.url === '/v1/admin/roles') return ok({ roles: ROLES });
    if (call.url === '/v1/admin/roles?archived=true') return ok({ roles: [RUNNER] });
    if (call.url === '/v1/admin/staff') return ok({ staff: [] });
    throw new Error(`unexpected ${call.method} ${call.url}`);
  };
}

function idleInput(name: string): HTMLInputElement {
  const input = m.container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);
  if (!input) throw new Error(`idle input ${name} missing`);
  return input;
}

async function blur(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  await flush();
}

describe('[01b §8] roles list', () => {
  it('[01b §8] inline idle edit sends { expected_version, idle_minutes }', async () => {
    const { api, calls } = fakeApi(
      handler(() => ok({ role: { ...ROLES[1], idle_minutes: 45, version: 'v2' }, changed_versions: { staff: [], roles: [], responsibilities: [] } })),
    );
    await m.render(<RoleList api={api} />);
    setValue(idleInput('Bera'), '45');
    await blur(idleInput('Bera'));
    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]?.url).toBe('/v1/admin/roles/R_WAITER');
    expect(patches[0]?.body).toEqual({ expected_version: 'v-R_WAITER', idle_minutes: 45 });
    expect(m.container.textContent).toContain(t('common.saved'));

    // The next save uses the version from the answer; out of range sends nothing.
    setValue(idleInput('Bera'), '30');
    await blur(idleInput('Bera'));
    expect(calls.filter((c) => c.method === 'PATCH')[1]?.body).toEqual({ expected_version: 'v2', idle_minutes: 30 });
    setValue(idleInput('Bera'), '500');
    await blur(idleInput('Bera'));
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2);
    expect(m.container.textContent).toContain(t('roles.idle_range'));
  });

  it('[01b §8] a stale idle edit shows the reload message', async () => {
    const { api } = fakeApi(handler(() => fail(409, 'CONFIG_STALE', { entity: 'role', id: 'R_WAITER' })));
    await m.render(<RoleList api={api} />);
    setValue(idleInput('Bera'), '45');
    await blur(idleInput('Bera'));
    expect(m.container.textContent).toContain(t('errors.CONFIG_STALE'));
    expect(button(m.container, t('staff.reload'))).toBeTruthy();
  });

  it('[01b §8] archive in use shows the D03 blocked variant; archived roles can be restored', async () => {
    const { api, calls } = fakeApi(
      handler((call) => {
        if (call.url === '/v1/admin/roles/R_OWNER') {
          return fail(409, 'CONFIG_IN_USE', { entity: 'role', id: 'R_OWNER', used_by: { entity: 'role', ids: ['R_WAITER'] } });
        }
        return ok({ role: { ...RUNNER, archived_at: null }, changed_versions: { staff: [], roles: [], responsibilities: [] } });
      }),
    );
    await m.render(<RoleList api={api} />);
    const owner = [...m.container.querySelectorAll<HTMLElement>('.pos-list__row')][0]!;
    await click(button(owner, t('roles.archive')));
    const dialog = m.container.querySelector<HTMLElement>('[role="dialog"]')!;
    await click(button(dialog, fill(t('roles.archive_confirm'), { name: 'Malik' })));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ expected_version: 'v-R_OWNER', archived: true });
    expect(m.container.textContent).toContain(fill(t('roles.blocked_title'), { name: 'Malik' }));
    expect(m.container.textContent).toContain(fill(t('roles.blocked_role'), { name: 'Malik', names: 'Bera' }));
    await click(button(m.container, t('common.close')));

    await click(button(m.container, `${t('roles.archived')}1`));
    await click(button(m.container, t('roles.restore')));
    expect(calls.filter((c) => c.method === 'PATCH')[1]).toMatchObject({ url: '/v1/admin/roles/R_RUN', body: { expected_version: 'v-R_RUN', archived: false } });
  });

  it('[01b §8] the archive blocked dialog names the branches on LAST_ADMIN_REQUIRED and maps OWN_ADMIN_ACCESS by reason', async () => {
    let answer = () => fail(409, 'LAST_ADMIN_REQUIRED', { branch_ids: ['B2'] });
    const { api } = fakeApi(handler(() => answer()));
    await m.render(
      <BranchNames.Provider value={new Map([['B1', 'Gulberg'], ['B2', 'Johar Town']])}>
        <RoleList api={api} />
      </BranchNames.Provider>,
    );
    async function archiveOwner(): Promise<void> {
      const owner = [...m.container.querySelectorAll<HTMLElement>('.pos-list__row')][0]!;
      await click(button(owner, t('roles.archive')));
      const dialog = m.container.querySelector<HTMLElement>('[role="dialog"]')!;
      await click(button(dialog, fill(t('roles.archive_confirm'), { name: 'Malik' })));
    }
    await archiveOwner();
    expect(m.container.textContent).toContain(fill(t('roles.last_admin_body'), { branches: 'Johar Town' }));
    await click(button(m.container, t('common.close')));

    answer = () => fail(409, 'OWN_ADMIN_ACCESS', { reason: 'owner_not_linked' });
    await archiveOwner();
    expect(m.container.textContent).toContain(ownAdminText({ reason: 'owner_not_linked' }));
  });
});
