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
      return ok({ floors: [{ floor_id: 'F1', name: 'Ground floor', sort_order: 0, archived_at: null, tables: [] }] });
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
    // Owner decision 2026-10-30: the People tabs are on the list pages only; the form keeps its back link.
    expect(m.container.querySelector('.pos-peopletabs')).toBeNull();
    setValue(m.container.querySelector<HTMLInputElement>('input[name="display_name"]'), 'Bilal K.');
    await click(button(m.container, t('staff.save')));

    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toBe('/v1/admin/staff/S2');
    expect(patch?.body).toEqual({ expected_version: 'v-S2', display_name: 'Bilal K.' });
    expect(m.container.textContent).toContain(t('errors.CONFIG_STALE'));
    // B03: Reload is the one primary; the page's Save is off while the banner shows.
    expect(button(m.container, t('staff.save')).disabled).toBe(true);
    expect([...m.container.querySelectorAll('.pos-btn--primary')].map((b) => b.textContent?.trim())).toEqual([t('staff.reload')]);

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
});

