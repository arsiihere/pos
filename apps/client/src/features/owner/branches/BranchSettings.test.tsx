import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { GuardProvider } from '../guard';
import { button, click, fakeApi, mount, ok, setValue, type Call, type Mounted } from '../test-api';
import { BranchSettings } from './BranchSettings';

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

const STORED = {
  branch_id: 'B1',
  name: 'Gulberg',
  status: 'active',
  hub_last_seen_at: null,
  hub_synced_at: null,
  tax_enabled: false,
  day_stale_after_hours: 16,
  day_min_gap_hours: 4,
  version: 'v1',
};

async function render() {
  const { api, calls } = fakeApi((call: Call) => {
    if (call.method === 'GET') return ok({ branch: STORED });
    return ok({ branch: { ...STORED, ...(call.body as object), version: 'v2' } });
  });
  await m.render(
    <GuardProvider>
      <BranchSettings api={api} branchId="B1" />
    </GuardProvider>,
  );
  return calls;
}

const field = (name: string) => m.container.querySelector<HTMLInputElement>(`input[name="${name}"]`);

describe('[01b §8] branch settings', () => {
  it('[01b §8] settings form keeps stale > gap before sending', async () => {
    const calls = await render();
    setValue(field('day_stale_after_hours'), '10');
    setValue(field('day_min_gap_hours'), '10');
    await click(button(m.container, t('branches.save_settings')));
    expect(m.container.textContent).toContain(fill(t('branches.gap_not_less'), { n: '10' }));
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);

    setValue(field('day_stale_after_hours'), '60');
    setValue(field('day_min_gap_hours'), '4');
    await click(button(m.container, t('branches.save_settings')));
    expect(m.container.textContent).toContain(t('branches.stale_range'));
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);

    // Only what changed is sent.
    setValue(field('day_stale_after_hours'), '10');
    await click(m.container.querySelector<HTMLButtonElement>('[role="switch"]')!);
    await click(button(m.container, t('branches.save_settings')));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/v1/admin/branches/B1/settings',
      body: { expected_version: 'v1', tax_enabled: true, day_stale_after_hours: 10 },
    });
    expect(m.container.textContent).toContain(fill(t('branches.settings_saved'), { name: 'Gulberg' }));

    // B23: the next save sends the version the last save answered.
    setValue(field('day_stale_after_hours'), '11');
    await click(button(m.container, t('branches.save_settings')));
    expect(calls.filter((c) => c.method === 'PATCH').at(-1)).toMatchObject({ body: { expected_version: 'v2', day_stale_after_hours: 11 } });
  });

  it('[01b §8, S50 c] phone: the back arrow asks before dropping changes', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 760px)', media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    try {
      window.location.hash = '#/branches/B1/settings';
      await render();
      const back = m.container.querySelector<HTMLAnchorElement>(`a[aria-label="${t('branches.back')}"]`)!;
      expect(back.textContent).toBe('');
      setValue(m.container.querySelector<HTMLInputElement>('input[name="day_stale_after_hours"]'), '20');
      await click(back);
      expect(window.location.hash).toBe('#/branches/B1/settings');
      const dialog = m.container.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.textContent).toContain(t('discard.keep'));
      await click(button(dialog, t('discard.discard')));
      expect(window.location.hash).toBe('#/branches');
    } finally {
      vi.unstubAllGlobals();
      window.location.hash = '';
    }
  });
});
