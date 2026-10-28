import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  it('[01b §8] team tree indents members and shows "No PIN" when has_pin is false', async () => {
    await render(ROOTS);
    const tree = m.container.querySelector('ul.pos-tree');
    if (tree === null) throw new Error('tree missing');
    const top = [...tree.children].map((li) => li.querySelector('strong')?.textContent);
    expect(top).toEqual(['Arif', 'Hamza']);
    const hamza = tree.children[1]!;
    const members = [...hamza.querySelectorAll(':scope > ul > li')].map((li) => li.querySelector('strong')?.textContent);
    expect(members).toEqual(['Bilal', 'Usman']);
    expect(hamza.textContent).toContain('Waiter · Shift lead');
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
});
