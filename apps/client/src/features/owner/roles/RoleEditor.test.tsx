import { PERMISSION_SCOPES } from '@pos/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CloudAdmin } from '../../../api/cloud-admin';
import { fill } from '../../../i18n/en';
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

// The label's own text (a snapped-back row adds a <small> line under it).
function grantRow(label: string): HTMLElement {
  const row = [...m.container.querySelectorAll<HTMLElement>('.pos-grant')].find(
    (li) => li.querySelector('.pos-grant__label')?.firstChild?.textContent === label,
  );
  if (!row) throw new Error(`grant ${label} missing`);
  return row;
}

// Permission groups are disclosures (Pulse 01b-S04); only the first starts open.
function groupToggle(group: string): HTMLButtonElement {
  const found = [...m.container.querySelectorAll<HTMLButtonElement>('button.pos-group__toggle')].find(
    (b) => b.querySelector('.pos-group__name')?.firstChild?.textContent === t(`roles.group.${group}` as Parameters<typeof t>[0]),
  );
  if (!found) throw new Error(`group ${group} missing`);
  return found;
}

async function openGroup(group: string): Promise<void> {
  if (groupToggle(group).getAttribute('aria-expanded') !== 'true') await click(groupToggle(group));
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
    await openGroup('kitchen');
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
    await openGroup('people');
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

  it('[01b §8] Pulse: groups are disclosures with a count summary; the first is open; the explain box is an info hint', async () => {
    const { api } = fakeApi(handler(() => ok({})));
    await render(api, 'R_LEAD');
    const toggles = [...m.container.querySelectorAll<HTMLButtonElement>('button.pos-group__toggle')];
    expect(toggles.map((b) => b.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false']);
    expect(groupToggle('orders').querySelector('small')?.textContent).toBe(
      `${fill(t('role_editor.count_allowed'), { n: '2' })} · ${fill(t('role_editor.count_not'), { n: '3' })}`,
    );
    expect(groupToggle('kitchen').querySelector('small')?.textContent).toBe(fill(t('role_editor.count_not'), { n: '3' }));
    expect(m.container.querySelector('.pos-grant__label')?.textContent).toBeTruthy();
    expect(() => grantRow(t('perm.reprint-ticket'))).toThrow();

    // The summary follows the controls live.
    await click(button(grantRow(t('perm.boost-order')), t('roles.grant.allowed')));
    expect(groupToggle('orders').querySelector('small')?.textContent).toBe(
      `${fill(t('role_editor.count_allowed'), { n: '3' })} · ${fill(t('role_editor.count_not'), { n: '2' })}`,
    );

    const hint = m.container.querySelector<HTMLButtonElement>('button.pos-hint')!;
    expect(hint.textContent).toBe(t('role_editor.grants_help'));
    expect(hint.getAttribute('aria-label')).toContain(t('roles.explain_approval_text').trim());
    expect(hint.getAttribute('title')).toBe(hint.getAttribute('aria-label'));
    expect(m.container.querySelector('.pos-explain')).toBeNull();
  });

  it('[01b §8] Pulse: a closed group with an error or a snapped-back control opens on Save', async () => {
    const { api } = fakeApi(handler(() => fail(409, 'OWN_ADMIN_ACCESS', { branch_ids: ['B1'] })));
    await render(api, 'R_OWNER');
    await openGroup('kitchen');
    await click(button(grantRow(t('perm.reprint-ticket')), t('roles.grant.requires_approval')));
    await click(groupToggle('kitchen'));
    expect(groupToggle('kitchen').getAttribute('aria-expanded')).toBe('false');
    await click(button(m.container, t('roles.save')));
    expect(groupToggle('kitchen').getAttribute('aria-expanded')).toBe('true');
    expect(grantRow(t('perm.reprint-ticket')).className).toContain('is-error');

    await click(button(grantRow(t('perm.reprint-ticket')), t('roles.grant.not_granted')));
    await openGroup('people');
    await click(button(grantRow(t('perm.access-hub-admin')), t('roles.grant.not_granted')));
    await click(groupToggle('people'));
    await click(button(m.container, t('roles.save')));
    expect(groupToggle('people').getAttribute('aria-expanded')).toBe('true');
    const snapped = grantRow(t('perm.access-hub-admin'));
    expect(snapped.className).toContain('is-snapped');
    expect(snapped.querySelector('.pos-grant__label small')?.textContent).toBe(t('roles.snapped'));
  });

  it('[01b §8] Pulse B03: while stale, Reload is the one primary and Save role is disabled', async () => {
    const { api } = fakeApi(handler(() => fail(409, 'CONFIG_STALE', { entity: 'role', id: 'R_LEAD' })));
    await render(api, 'R_LEAD');
    await click(button(grantRow(t('perm.boost-order')), t('roles.grant.allowed')));
    await click(button(m.container, t('roles.save')));
    const save = button(m.container, t('roles.save'));
    expect(save.disabled).toBe(true);
    expect(save.className).not.toContain('pos-btn--primary');
    expect(m.container.querySelectorAll('.pos-btn--primary')).toHaveLength(1);
    expect(button(m.container, t('staff.reload')).className).toContain('pos-btn--primary');
  });

  it('[01b §8] Pulse: a picked approver chip shows a check', async () => {
    const { api } = fakeApi(handler(() => ok({})));
    await render(api, 'R_LEAD');
    await click(button(grantRow(t('perm.boost-order')), t('roles.grant.requires_approval')));
    await click(button(grantRow(t('perm.boost-order')), 'Malik'));
    expect(button(grantRow(t('perm.boost-order')), 'Malik').querySelector('svg')).not.toBeNull();
    expect(button(grantRow(t('perm.boost-order')), 'Bera').querySelector('svg')).toBeNull();
  });
});
