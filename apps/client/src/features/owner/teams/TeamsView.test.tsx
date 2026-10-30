import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { BRANCHES, ROLES } from '../staff/fixtures';
import { fakeApi, mount, ok, type Call, type Mounted } from '../test-api';
import { TeamsView } from './TeamsView';
import { BranchNames } from '../branch';

let m: Mounted;

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
  m = mount();
});

afterEach(() => {
  m.unmount();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

const NAMES = new Map(BRANCHES.map((b) => [b.branch_id, b.name]));

const ROOTS = [
  { staff_id: 'S1', display_name: 'Arif', has_pin: true, role_ids: ['R_OWNER'], members: [] },
  {
    staff_id: 'S3',
    display_name: 'Hamza',
    has_pin: true,
    role_ids: ['R_WAITER', 'R_LEAD'],
    members: [
      { staff_id: 'S2', display_name: 'Bilal', has_pin: true, role_ids: ['R_WAITER'], members: [] },
      { staff_id: 'S4', display_name: 'Usman', has_pin: false, role_ids: ['R_WAITER'], members: [] },
    ],
  },
];

function reads(roots: unknown[]) {
  return (call: Call): Response => {
    if (call.url === '/v1/admin/branches/B1/team-tree') return ok({ branch_id: 'B1', roots });
    if (call.url === '/v1/admin/roles') return ok({ roles: ROLES });
    throw new Error(`unexpected ${call.method} ${call.url}`);
  };
}

async function render(roots: unknown[]) {
  const { api } = fakeApi(reads(roots));
  await m.render(
    <BranchNames.Provider value={NAMES}>
      <TeamsView api={api} branchId="B1" branchIds={['B1', 'B2']} onBranch={() => {}} />
    </BranchNames.Provider>,
  );
}

describe('[01b §8] teams', () => {
  it('[owner decision 2026-10-30] the People tab strip sits at the top of the content; teams is current', async () => {
    await render(ROOTS);
    const tabs = m.container.querySelector('main.pos-content > nav.pos-seg.pos-peopletabs');
    expect(tabs).not.toBeNull();
    expect([...tabs!.querySelectorAll('a.pos-seg__opt')].map((a) => a.getAttribute('href'))).toEqual([
      '#/staff',
      '#/roles',
      '#/teams',
      '#/stock-counting',
    ]);
    expect(tabs!.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('#/teams');
  });

  it('[01b §8] team tree indents members and shows "No PIN" when has_pin is false', async () => {
    await render(ROOTS);
    const tree = m.container.querySelector('ul.pos-tree');
    if (tree === null) throw new Error('tree missing');
    const top = [...tree.children].map((li) => li.querySelector('strong')?.textContent);
    expect(top).toEqual(['Arif', 'Hamza']);
    const hamza = tree.children[1]!;
    const members = [...hamza.querySelectorAll(':scope > ul > li')].map((li) => li.querySelector('strong')?.textContent);
    expect(members).toEqual(['Bilal', 'Usman']);
    expect(hamza.textContent).toContain('Bera · Shift lead');
    expect(hamza.textContent).toContain(fill(t('teams.count_team'), { n: '2' }));

    const usman = hamza.querySelectorAll(':scope > ul > li')[1]!;
    expect(usman.textContent).toContain(t('teams.no_pin'));
    expect(hamza.querySelectorAll(':scope > ul > li')[0]!.textContent).not.toContain(t('teams.no_pin'));
    // Each name opens the person (§8: read-only, lines are edited on the person).
    expect(usman.querySelector('a')?.getAttribute('href')).toBe('#/staff/S4');
  });

  it('[01b §8] no lines yet and nobody at the branch have their own texts', async () => {
    await render([ROOTS[0]]);
    expect(m.container.textContent).toContain(t('teams.flat'));
    m.unmount();
    m = mount();
    await render([]);
    expect(m.container.textContent).toContain(fill(t('teams.empty'), { branch: 'Gulberg' }));
  });

  it('[01b §8, hand-off 01b-S10] each row ends in a chevron; "No PIN" is a warn chip with the alert icon', async () => {
    await render(ROOTS);
    const links = [...m.container.querySelectorAll<HTMLAnchorElement>('a.pos-tree__node')];
    expect(links).toHaveLength(4);
    for (const link of links) expect(link.lastElementChild?.matches('svg.pos-icon--flip')).toBe(true);
    const chip = m.container.querySelector('.pos-chip--warn')!;
    expect(chip.textContent).toBe(t('teams.no_pin'));
    expect(chip.querySelector('path')?.getAttribute('d')).toBe('M12 3.5L2.5 20h19L12 3.5z');
  });

  it('[hand-off TeamsPhone] phone: branch select in the content, no intro, the tap hint as the foot', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 760px)', media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    await render(ROOTS);
    expect(m.container.querySelector('.pos-content > .pos-branchpick select')).not.toBeNull();
    expect(m.container.querySelector('.pos-appbar select')).toBeNull();
    expect(m.container.textContent).not.toContain(fill(t('teams.intro'), { branch: 'Gulberg' }));
    expect(m.container.textContent).toContain(t('teams.phone_hint'));
  });
});
