import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supportText } from '../../../app/support';
import { fill } from '../../../i18n/en';
import { setLanguage, t } from '../../../i18n';
import { button, click, fail, fakeApi, mount, ok, setValue, type Mounted } from '../test-api';
import { BranchesView } from './BranchesView';

let m: Mounted;
const NOW = Date.UTC(2026, 9, 28, 8, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
  m = mount();
});

afterEach(() => {
  m.unmount();
  sessionStorage.clear();
  setLanguage('en');
  vi.useRealTimers();
});

function branch(id: string, name: string, gap: number) {
  return { branch_id: id, name, status: 'active', hub_last_seen_at: NOW - 60_000, hub_synced_at: NOW - 60_000 - gap };
}

async function render(branches: unknown[], staleAfter: number) {
  const { api, calls } = fakeApi((call) => {
    if (call.url === '/v1/admin/branches') return ok({ branches, hub_stale_after_ms: staleAfter });
    if (call.method === 'PATCH') return fail(409, 'CONFIG_NAME_TAKEN', { entity: 'branch', name: 'Johar Town' });
    throw new Error(`unexpected ${call.method} ${call.url}`);
  });
  await m.render(<BranchesView api={api} />);
  return calls;
}

function rowOf(name: string): HTMLElement {
  const found = [...m.container.querySelectorAll<HTMLElement>('.pos-list__row')].find((r) => r.querySelector('strong')?.textContent?.startsWith(name));
  if (!found) throw new Error(`row ${name} missing`);
  return found;
}

const warned = (name: string) => rowOf(name).querySelector('.pos-hub.is-warn') !== null;

describe('[01b #78] B19 on the owner page', () => {
  for (const lang of ['en', 'ur'] as const) {
    it(`[01b #78] shows Hub checked in and Up to date; warns past the response threshold (${lang})`, async () => {
      setLanguage(lang);
      await render([branch('B1', 'Gulberg', 180_000), branch('B2', 'Johar Town', 180_001)], 180_000);
      expect(rowOf('Gulberg').textContent).toContain(fill(t('branches.hub_ok'), { seen: fill(t('branches.ago_min'), { n: '1' }), synced: fill(t('branches.ago_min'), { n: '4' }) }));
      expect(warned('Gulberg')).toBe(false);
      expect(warned('Johar Town')).toBe(true);
      expect(rowOf('Johar Town').textContent).toContain(supportText('branches.behind_body'));

      // The page uses the response value, not a constant.
      m.unmount();
      m = mount();
      await render([branch('B1', 'Gulberg', 90_000)], 60_000);
      expect(warned('Gulberg')).toBe(true);
    });
  }

  it('[01b #78] an away hub keeps the B19 Up to date line, with its warning when it is also behind', async () => {
    const seen = NOW - 5 * 60_000;
    await render(
      [
        { branch_id: 'B1', name: 'Gulberg', status: 'active', hub_last_seen_at: seen, hub_synced_at: seen },
        { branch_id: 'B2', name: 'Johar Town', status: 'active', hub_last_seen_at: seen, hub_synced_at: seen - 2 * 3_600_000 },
      ],
      180_000,
    );
    const five = fill(t('branches.ago_min'), { n: '5' });
    const gulberg = rowOf('Gulberg').textContent ?? '';
    expect(gulberg).toContain(fill(t('branches.away'), { branch: 'Gulberg', seen: five }));
    expect(gulberg).toContain(fill(t('branches.behind'), { synced: five }));
    expect(gulberg).not.toContain(supportText('branches.behind_body'));

    const johar = rowOf('Johar Town').textContent ?? '';
    expect(johar).toContain(fill(t('branches.away'), { branch: 'Johar Town', seen: five }));
    expect(johar).toContain(fill(t('branches.behind'), { synced: fill(t('branches.ago_h'), { n: '2' }) }));
    expect(johar).toContain(supportText('branches.behind_body'));
  });

  it('[01b §8] a branch with no hub says so; rename shows CONFIG_NAME_TAKEN on the field', async () => {
    const calls = await render(
      [branch('B1', 'Gulberg', 0), { branch_id: 'B3', name: 'DHA', status: 'pending_hub', hub_last_seen_at: null, hub_synced_at: null }],
      180_000,
    );
    expect(rowOf('DHA').textContent).toContain(t('branches.no_hub'));
    expect(rowOf('DHA').textContent).toContain(t('branches.not_open'));
    await click(button(rowOf('Gulberg'), t('branches.rename')));
    setValue(m.container.querySelector<HTMLInputElement>('[role="dialog"] input'), 'Johar Town');
    await click(button(m.container.querySelector<HTMLElement>('[role="dialog"]')!, t('branches.rename')));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: '/v1/admin/branches/B1', body: { name: 'Johar Town' } });
    expect(m.container.textContent).toContain(fill(t('branches.name_taken'), { name: 'Johar Town' }));
  });
});
