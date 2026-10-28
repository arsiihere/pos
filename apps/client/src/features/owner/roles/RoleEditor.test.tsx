import { PERMISSION_SCOPES } from '@pos/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CloudAdmin } from '../../../api/cloud-admin';
import { t } from '../../../i18n';
import { GuardProvider } from '../guard';
import { ROLES } from '../staff/fixtures';
import { button, click, fail, fakeApi, mount, ok, type Call, type Mounted } from '../test-api';
import { RoleEditor } from './RoleEditor';

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

function handler(write: (call: Call) => Response) {
  return (call: Call): Response => {
    if (call.method !== 'GET') return write(call);
    if (call.url === '/v1/admin/roles') return ok({ roles: ROLES });
    throw new Error(`unexpected ${call.method} ${call.url}`);
  };
}

function grantRow(label: string): HTMLElement {
  const row = [...m.container.querySelectorAll<HTMLElement>('.pos-grant')].find(
    (li) => li.querySelector('.pos-grant__label')?.textContent === label,
  );
  if (!row) throw new Error(`grant ${label} missing`);
  return row;
}

async function render(api: CloudAdmin, roleId: string) {
  await m.render(
    <GuardProvider>
      <RoleEditor api={api} roleId={roleId} />
    </GuardProvider>,
  );
}

describe('[01b §8] role editor', () => {
  it('[01b §8] "Approved by" is a multi-select of role chips; "Where" offers only PERMISSION_SCOPES[permission]', async () => {
    const { api, calls } = fakeApi(handler((call) => ok({ role: { ...ROLES[2], ...(call.body as object) }, changed_versions: { staff: [], roles: [], responsibilities: [] } })));
    await render(api, 'R_LEAD');

    // "Where" lists exactly the permission's scopes; a branch-only permission has no "Where".
    const where = grantRow(t('perm.approve-void')).querySelector<HTMLSelectElement>('select');
    expect([...(where?.options ?? [])].map((o) => o.value)).toEqual([...PERMISSION_SCOPES['approve-void']]);
    await click(button(grantRow(t('perm.reprint-ticket')), t('roles.grant.allowed')));
    expect(grantRow(t('perm.reprint-ticket')).querySelector('select')).toBeNull();

    // Needs approval opens role chips; several can be picked.
    const row = () => grantRow(t('perm.boost-order'));
    await click(button(row(), t('roles.grant.requires_approval')));
    expect(row().textContent).toContain(t('roles.approval_help'));
    await click(button(row(), 'Malik'));
    await click(button(row(), 'Bera'));
    expect(button(row(), 'Malik').getAttribute('aria-pressed')).toBe('true');
    expect(button(row(), 'Bera').getAttribute('aria-pressed')).toBe('true');

    await click(button(m.container, t('roles.save')));
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toBe('/v1/admin/roles/R_LEAD');
    const body = patch?.body as { expected_version: string; grants: { permission: string; approver_role_ids: string[] }[] };
    expect(body.expected_version).toBe('v-R_LEAD');
    expect(body.grants.find((g) => g.permission === 'boost-order')).toEqual({
      permission: 'boost-order',
      grant_type: 'requires_approval',
      approver_role_ids: ['R_OWNER', 'R_WAITER'],
      scope: 'branch',
    });
    expect(body.grants.find((g) => g.permission === 'reprint-ticket')).toEqual({
      permission: 'reprint-ticket',
      grant_type: 'allowed',
      approver_role_ids: [],
      scope: 'branch',
    });
  });

  it('[01b §8] OWN_ADMIN_ACCESS shows "You can\'t remove your own admin access. Call support."', async () => {
    const { api } = fakeApi(handler(() => fail(409, 'OWN_ADMIN_ACCESS', { branch_ids: ['B1'] })));
    await render(api, 'R_OWNER');
    await click(button(grantRow(t('perm.access-hub-admin')), t('roles.grant.not_granted')));
    await click(button(m.container, t('roles.save')));
    expect(m.container.textContent).toContain("You can't remove your own admin access. Call support.");
    // The grant snaps back to the stored value.
    expect(button(grantRow(t('perm.access-hub-admin')), t('roles.grant.allowed')).getAttribute('aria-pressed')).toBe('true');
  });

  it('[01b §8] a needs-approval grant with no approver is refused before any request', async () => {
    const { api, calls } = fakeApi(handler(() => ok({})));
    await render(api, 'R_LEAD');
    await click(button(grantRow(t('perm.boost-order')), t('roles.grant.requires_approval')));
    await click(button(m.container, t('roles.save')));
    expect(grantRow(t('perm.boost-order')).textContent).toContain(t('roles.approver_required'));
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
});
