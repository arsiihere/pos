import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { ownAdminText } from '../form';
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
      return ok({
        floors: [
          {
            floor_id: 'F1',
            name: 'Ground floor',
            sort_order: 0,
            archived_at: null,
            zones: [
              { zone_id: 'Z1', name: 'Patio', sort_order: 0, archived_at: null, routes: [], stock_items: [] },
              { zone_id: 'Z9', name: 'Old corner', sort_order: 1, archived_at: 5, routes: [], stock_items: [] },
              { zone_id: 'Z8', name: 'Closed zone', sort_order: 2, archived_at: 5, routes: [], stock_items: [] },
            ],
            tables: [
              { table_id: 'T1', name: 'Table 1', seats: 4, sort_order: 0, zone_id: 'Z1', archived_at: null },
              { table_id: 'T2', name: 'Table 2', seats: 2, sort_order: 1, zone_id: null, archived_at: null },
              { table_id: 'T9', name: 'Table 9', seats: 2, sort_order: 2, zone_id: null, archived_at: 5 },
            ],
          },
        ],
      });
    }
    throw new Error(`unexpected ${call.method} ${call.url}`);
  };
}

// Mark as left sits in the app bar's More menu (hand-off 01b-S02).
async function openMarkLeft(name: string): Promise<void> {
  const more = m.container.querySelector<HTMLButtonElement>(`button.pos-more[aria-label="${t('staff.more')}"]`);
  if (more === null) throw new Error('More missing');
  await click(more);
  await click(button(m.container, fill(t('staff.menu_left'), { name })));
}

function headings(): string[] {
  return [...m.container.querySelectorAll('h2')].map((h) => h.textContent ?? '');
}

describe('[01b §8] staff form', () => {
  it('[01b §8] sends expected_version; CONFIG_STALE keeps the draft until Reload [owner decision 2026-10-30, 01b P1]', async () => {
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
    // Owner decision 2026-10-30: the People tabs are on the list pages only; the form keeps its back link.
    expect(m.container.querySelector('.pos-peopletabs')).toBeNull();
    setValue(m.container.querySelector<HTMLInputElement>('input[name="display_name"]'), 'Bilal K.');
    await click(button(m.container, t('staff.save')));

    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toBe('/v1/admin/staff/S2');
    expect(patch?.body).toEqual({ expected_version: 'v-S2', display_name: 'Bilal K.' });
    const banner = m.container.querySelector<HTMLElement>('[data-stale]');
    expect(banner?.textContent).toContain(t('stale.title'));
    expect(banner?.textContent).toContain(t('stale.body'));
    // B03: Reload is the one primary; the page's Save is off while the banner shows.
    expect(button(m.container, t('staff.save')).disabled).toBe(true);
    expect([...m.container.querySelectorAll('.pos-btn--primary')].map((b) => b.textContent?.trim())).toEqual([t('stale.reload')]);
    // The draft stays: what was typed is still in the field and can still be edited (and copied).
    const field = () => m.container.querySelector<HTMLInputElement>('input[name="display_name"]')!;
    expect(field().value).toBe('Bilal K.');
    expect(field().disabled).toBe(false);
    setValue(field(), 'Bilal Khan');
    expect(field().value).toBe('Bilal Khan');
    expect(button(m.container, t('staff.save')).disabled).toBe(true);
    // Nothing is retried.
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);

    // Reload discards the draft and reads the current version.
    stale = false;
    const gets = calls.filter((c) => c.method === 'GET').length;
    await click(button(m.container, t('stale.reload')));
    expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThan(gets);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    expect(field().value).toBe('Bilal');
    expect(m.container.querySelector('[data-stale]')).toBeNull();
    expect(button(m.container, t('staff.save')).disabled).toBe(false);
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

  it('[owner decision 2026-10-30, 01b P1] a Mark-as-left 409 CONFIG_STALE keeps the draft and sends nothing again', async () => {
    const { api, calls } = fakeApi(handler(() => fail(409, 'CONFIG_STALE', { entity: 'staff', id: 'S2' })));
    await m.render(
      <GuardProvider>
        <StaffForm api={api} staffId="S2" branchIds={['B1', 'B2']} />
      </GuardProvider>,
    );
    const field = () => m.container.querySelector<HTMLInputElement>('input[name="display_name"]')!;
    setValue(field(), 'Bilal K.');
    await openMarkLeft('Bilal');
    await click(button(m.container.querySelector<HTMLElement>('[role="dialog"]')!, t('staff.mark_left')));
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([
      expect.objectContaining({ body: { expected_version: 'v-S2', is_active: false } }),
    ]);
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    expect(m.container.querySelector('[data-stale]')?.textContent).toContain(t('stale.title'));
    expect(field().value).toBe('Bilal K.');
    expect(button(m.container, t('staff.save')).disabled).toBe(true);
    // Mark as left stays off until Reload.
    await click(m.container.querySelector<HTMLButtonElement>(`button.pos-more[aria-label="${t('staff.more')}"]`)!);
    const left = button(m.container, fill(t('staff.menu_left'), { name: 'Bilal' }));
    expect(left.disabled).toBe(true);
    await click(left);
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('[01b §8] STAFF_LINKED_TO_OWNER shows its message on the Left switch', async () => {
    const { api, calls } = fakeApi(handler(() => fail(409, 'STAFF_LINKED_TO_OWNER', { staff_id: 'S1' })));
    await m.render(
      <GuardProvider>
        <StaffForm api={api} staffId="S1" branchIds={['B1', 'B2']} />
      </GuardProvider>,
    );
    await openMarkLeft('Arif');
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
      await openMarkLeft('Bilal');
      const dialog = m.container.querySelector('[role="dialog"]');
      if (dialog === null) throw new Error('dialog missing');
      await click(button(dialog, t('staff.mark_left')));
    }
    await markLeft();
    expect(m.container.textContent).toContain(ownAdminText({ reason: 'owner_not_linked' }));
    expect(m.container.textContent).not.toContain(ownAdminText({}));
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
    await click(button(m.container, 'Bera'));
    await click(button(m.container, 'Gulberg'));
    await click(button(m.container, t('staff.save')));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.key).toMatch(/^[0-9A-Z]{26}$/);
    expect(post?.body).toEqual({ display_name: 'Ali R.', role_ids: ['R_WAITER'], branch_ids: ['B1'], denied_permissions: [], reports_to: [], floors: [] });
  });

  it('[hand-off 01b-S02] Mark as left is a More item on an edit only; the Status section keeps its text', async () => {
    const { api } = fakeApi(handler(() => ok({})));
    await m.render(
      <GuardProvider>
        <StaffForm api={api} staffId="S2" branchIds={['B1', 'B2']} />
      </GuardProvider>,
    );
    expect([...m.container.querySelectorAll('main button')].some((b) => b.textContent?.trim() === t('staff.mark_left'))).toBe(false);
    expect(m.container.textContent).toContain(t('staff.status_working'));
    await openMarkLeft('Bilal');
    expect(m.container.querySelector('[role="dialog"]')?.textContent).toContain(fill(t('staff.left_title'), { name: 'Bilal' }));
    m.unmount();

    m = mount();
    await m.render(
      <GuardProvider>
        <StaffForm api={api} staffId={null} branchIds={['B1', 'B2']} />
      </GuardProvider>,
    );
    expect(m.container.querySelector('button.pos-more')).toBeNull();
  });

  it('[hand-off 01b-S02] Never allow is folded into the Advanced disclosure, open when the person has a block', async () => {
    const blocked = STAFF.map((s) => (s.staff_id === 'S3' ? { ...s, denied_permissions: ['approve-void' as const] } : s));
    const { api } = fakeApi(handler(() => ok({}), blocked));
    await m.render(
      <GuardProvider>
        <StaffForm api={api} staffId="S2" branchIds={['B1', 'B2']} />
      </GuardProvider>,
    );
    const toggle = m.container.querySelector<HTMLButtonElement>('button.pos-disclosure');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.textContent).toContain(t('staff.advanced_never'));
    expect(toggle?.textContent).toContain(t('staff.never_none'));
    expect(headings()).not.toContain(t('staff.never'));
    await click(toggle as HTMLButtonElement);
    expect(headings()).toContain(t('staff.never'));
    expect(button(m.container, t('staff.never_add'))).toBeTruthy();
    m.unmount();

    m = mount();
    await m.render(
      <GuardProvider>
        <StaffForm api={api} staffId="S3" branchIds={['B1', 'B2']} />
      </GuardProvider>,
    );
    expect(headings()).toContain(t('staff.never'));
    expect(m.container.querySelector('button.pos-disclosure')).toBeNull();
    // StaffFormImran: one row per block, Remove keeps the old "Allow … again" name and action.
    const row = m.container.querySelector('.pos-never .pos-list__row');
    expect(row?.textContent).toContain(t('perm.approve-void'));
    expect(row?.textContent).toContain(t('staff.never_row_help'));
    const remove = button(row as Element, t('staff.never_remove_short'));
    expect(remove.getAttribute('aria-label')).toBe(fill(t('staff.never_remove'), { permission: t('perm.approve-void') }));
    await click(remove);
    expect(m.container.querySelector('.pos-never')).toBeNull();
    expect(m.container.textContent).toContain(t('staff.never_none'));
  });

  it('[hand-off 01b-C02] What {name} can do is closed with grant counts that follow the roles live', async () => {
    const { api } = fakeApi(handler(() => ok({})));
    await m.render(
      <GuardProvider>
        <StaffForm api={api} staffId="S2" branchIds={['B1', 'B2']} />
      </GuardProvider>,
    );
    const toggle = m.container.querySelector<HTMLButtonElement>('button.pos-cando__toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.textContent).toContain(fill(t('staff.can_title'), { name: 'Bilal' }));
    expect(m.container.querySelector('.pos-can')).toBeNull();
    const sum = () => [...m.container.querySelectorAll('.pos-cando__sum .pos-chip')].map((c) => c.textContent?.trim());
    // Bera: void-item needs approval.
    expect(sum()).toEqual([fill(t('cando.count_approval'), { n: '1' })]);

    await click(button(m.container, 'Shift lead'));
    expect(sum()).toEqual([fill(t('cando.count_allowed'), { n: '2' }), fill(t('cando.count_approval'), { n: '1' })]);

    await click(toggle as HTMLButtonElement);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(m.container.querySelector('.pos-can')).not.toBeNull();
  });

  it('[hand-off 01b-C02] a person with nothing allowed shows "Nothing allowed yet"', async () => {
    const { api } = fakeApi(handler(() => ok({})));
    await m.render(
      <GuardProvider>
        <StaffForm api={api} staffId={null} branchIds={['B1', 'B2']} />
      </GuardProvider>,
    );
    expect([...m.container.querySelectorAll('.pos-cando__sum .pos-chip')].map((c) => c.textContent?.trim())).toEqual([t('cando.none')]);
  });

  it('[01b §8] phone: the back arrow asks before dropping changes (S50 c)', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 760px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    try {
      window.location.hash = '#/staff/S2';
      const { api } = fakeApi(handler(() => ok({})));
      await m.render(
        <GuardProvider>
          <StaffForm api={api} staffId="S2" branchIds={['B1', 'B2']} />
        </GuardProvider>,
      );
      const back = m.container.querySelector<HTMLAnchorElement>(`a[aria-label="${t('staff.back')}"]`)!;
      expect(back.textContent).toBe('');
      setValue(m.container.querySelector<HTMLInputElement>('input[name="display_name"]'), 'Bilal K.');
      await click(back);
      expect(window.location.hash).toBe('#/staff/S2');
      const dialog = m.container.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.textContent).toContain(t('discard.keep'));
      await click(button(dialog, t('discard.discard')));
      expect(window.location.hash).toBe('#/staff');
    } finally {
      vi.unstubAllGlobals();
      window.location.hash = '';
    }
  });

  // 01b v1.7 §3.2 rule 7 (AD-21–AD-32): zones and tables per branch.
  const held = STAFF.map((p) => (p.staff_id === 'S2' ? { ...p, assignments: [{ branch_id: 'B1', zone_ids: ['Z9'], table_ids: [] }] } : p));

  it('[02p U-3 client] the staff form shows zones and tables per branch and sends assignments', async () => {
    const { api, calls } = fakeApi(
      handler((call) => {
        if (call.method === 'PATCH') return ok({ staff: { ...held[1], version: 'v2' } });
        throw new Error('unexpected write');
      }, held),
    );
    await m.render(
      <GuardProvider>
        <StaffForm api={api} staffId="S2" branchIds={['B1', 'B2']} />
      </GuardProvider>,
    );
    expect(headings()).toContain(t('staff.assigned'));
    const labels = [...m.container.querySelectorAll('button.pos-chip')].map((b) => b.textContent?.trim());
    expect(labels).toContain('Patio');
    expect(labels).toContain('Table 1');
    // The archived zone the person holds shows, marked; archived ones they do not hold are not offered.
    expect(labels).toContain(`Old corner (${t('staff.assigned_archived')})`);
    expect(labels.some((l) => l?.startsWith('Closed zone'))).toBe(false);
    expect(labels.some((l) => l?.startsWith('Table 9'))).toBe(false);

    await click(button(m.container, 'Table 1'));
    await click(button(m.container, t('staff.save')));
    const patch = calls.find((c) => c.method === 'PATCH');
    // Whole entry for the changed branch (the archived zone kept); the unchanged branch is not sent.
    expect(patch?.body).toEqual({ expected_version: 'v-S2', assignments: [{ branch_id: 'B1', zone_ids: ['Z9'], table_ids: ['T1'] }] });
  });

  it('[02p U-3 client] already_assigned shows errors.reference.already_assigned on the field', async () => {
    const { api } = fakeApi(
      handler((call) => {
        if (call.method === 'PATCH') {
          return fail(422, 'CONFIG_REFERENCE_INVALID', { field: 'assignments', reason: 'already_assigned', staff_id: 'S3' });
        }
        throw new Error('unexpected write');
      }, held),
    );
    await m.render(
      <GuardProvider>
        <StaffForm api={api} staffId="S2" branchIds={['B1', 'B2']} />
      </GuardProvider>,
    );
    await click(button(m.container, 'Patio'));
    await click(button(m.container, t('staff.save')));
    const field = m.container.querySelector('[data-field="assignments"]');
    expect(field?.textContent).toContain(t('errors.reference.already_assigned'));
    expect(field?.textContent).toContain('Hamza');
  });
});
