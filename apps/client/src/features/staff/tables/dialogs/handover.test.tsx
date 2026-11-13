import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import type { HubResult } from '../../../../api/hub-admin';
import type { Resolution } from '../../api';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { HandoverCandidate, MapTile, TableMapBody, TablesApi } from '../contracts';
import { createLocalFlags } from '../local-flags';
import { TableSheet } from '../sheet/TableSheet';

// 02a §8 Table sheet, §3.8, §6.7, §6.8, §6.18 (02a-D20 HandOver, HandOverGone; 02a-D21 ForceMove).

vi.mock('../../orders/table-view/OrdersPart', () => ({ OrdersPart: () => null }));

const ME = 'ST-ALI';
const NOW = 1_700_000_000_000;
const allow: Resolution = { grant: 'allowed', scope: 'branch' };

function tile(over: Partial<MapTile> = {}): MapTile {
  return {
    table_id: 'TB2',
    name: 'F2',
    seats: 4,
    archived: false,
    state: 'ORDERED',
    seating_id: 'S2',
    party_size: null,
    primary_table_id: 'TB2',
    joined_table_names: ['F2'],
    holder: { staff_id: ME, name: 'Ali' },
    assignee: null,
    lock: null,
    opened_at: NOW - 60_000,
    bill_requested_at: null,
    live_order_count: 1,
    ...over,
  };
}
const mapOf = (t: MapTile): TableMapBody => ({ as_of_seq: 1, floors: [{ floor_id: 'FL1', name: 'Hall', archived: false, zones: [{ zone_id: 'Z1', name: 'Z', tables: [t] }] }] });

const SARA: HandoverCandidate = { staff_id: 'ST-SAR', name: 'Sara', is_assignee: true, working: true, tables_held: 2 };
const HAMZA: HandoverCandidate = { staff_id: 'ST-HAM', name: 'Hamza', is_assignee: false, working: true, tables_held: 1 };
const MUHAMMAD: HandoverCandidate = { staff_id: 'ST-MUH', name: 'Muhammad', is_assignee: false, working: false, tables_held: 0 };

type Call = { name: keyof TablesApi; payload: unknown };
function fakeShell(o: { perms: string[] | Record<string, Resolution>; tile?: MapTile; candidates?: HandoverCandidate[][]; answers?: Partial<Record<keyof TablesApi, Array<HubResult<unknown>>>>; online?: boolean; candidatesFail?: number }) {
  const calls: Call[] = [];
  const answers = o.answers ?? {};
  const lists = [...(o.candidates ?? [[MUHAMMAD, SARA, HAMZA]])];
  let fails = o.candidatesFail ?? 0;
  const tables = new Proxy({} as TablesApi, {
    get: (_t, name: keyof TablesApi) => async (payload: unknown) => {
      calls.push({ name, payload });
      if (name === 'tableMap') return { ok: true, data: mapOf(o.tile ?? tile()) };
      if (name === 'handoverCandidates' && fails > 0) {
        fails -= 1;
        return { ok: false, error: { kind: 'network' } };
      }
      if (name === 'handoverCandidates') return { ok: true, data: { staff: lists.length > 1 ? lists.shift() : lists[0] } };
      return answers[name]?.shift() ?? { ok: false, error: { kind: 'network' } };
    },
  });
  const perms = Array.isArray(o.perms) ? Object.fromEntries(o.perms.map((p) => [p, allow])) : o.perms;
  const shell: Shell = {
    device: { token: 'T', id: 'DEV1', type: 'tablet' },
    meta: { tenantId: 'TEN', branchId: 'BR', branchName: 'Gulberg', hubNowMs: NOW, utcOffsetMs: 0 },
    api: {} as never,
    tables,
    orders: {} as never,
    live: createLiveBus(),
    config: {} as never,
    permissions: createPermissions(perms),
    toasts: createToastBus(),
    enqueue: {} as never,
    localFlags: createLocalFlags(),
    clock: { nowMs: () => NOW, utcOffsetMs: 0 },
    me: { staff_id: ME, name: 'Ali' },
    online: o.online ?? true,
    phone: false,
    portrait: false,
  };
  return { shell, calls };
}

let m: Mounted;
beforeEach(() => {
  window.location.hash = '/tables/TB2?seating_id=S2';
});
afterEach(() => m?.unmount());

async function render(shell: Shell) {
  m = mount();
  m.render(
    <ShellContext.Provider value={shell}>
      <TableSheet table_id="TB2" seating_id="S2" />
    </ShellContext.Provider>,
  );
  await flush();
}
const dlg = () => m.container.querySelector<HTMLElement>('.dlg');
const rows = () => [...dlg()!.querySelectorAll<HTMLElement>('[role="radio"]')];
const row = (name: string) => rows().find((r) => r.querySelector('b')?.textContent === name)!;

describe('[02a §8 Table sheet] hand over and force move', () => {
  it('[02a §8 Table sheet] Hand over lists handover-candidates working first, "Assigned here", "Has n tables"; not-working greyed; no note field', async () => {
    const { shell, calls } = fakeShell({ perms: ['take-order'], answers: { requestTableHandover: [{ ok: true, data: { alert_id: 'AL1' } }] } });
    await render(shell);
    m.click(m.button('Hand over'));
    await flush();
    expect(calls.find((c) => c.name === 'handoverCandidates')?.payload).toBe('TB2');
    const box = dlg()!;
    expect(box.textContent).toContain('Hand F2 to…');
    expect(box.textContent).toContain('They must accept. Working people first.');
    expect(rows().map((r) => r.querySelector('b')?.textContent)).toEqual(['Sara', 'Hamza', 'Muhammad']);
    expect(row('Sara').textContent).toContain('Assigned here');
    expect(row('Sara').textContent).toContain('Has 2 tables');
    expect(row('Hamza').textContent).toContain('Has 1 table');
    expect(row('Hamza').textContent).not.toContain('Assigned here');
    expect(row('Muhammad').textContent).toContain('Not signed in');
    expect(row('Muhammad').getAttribute('aria-disabled')).toBe('true');
    expect(box.querySelector('input, textarea')).toBeNull();
    const send = m.button('Send request', box) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    m.click(row('Muhammad'));
    expect(row('Muhammad').getAttribute('aria-checked')).toBe('false');
    m.click(row('Sara'));
    expect(row('Sara').getAttribute('aria-checked')).toBe('true');
    m.click(send);
    await flush();
    expect(calls.find((c) => c.name === 'requestTableHandover')?.payload).toEqual({ table_id: 'TB2', seating_id: 'S2', to_staff_id: 'ST-SAR' });
    expect(shell.toasts.current()?.text).toBe('Sent to Sara');
    expect(dlg()).toBeNull();
  });

  it('[02a §8 Table sheet] 409 HANDOVER_TARGET_UNAVAILABLE not_working → HandOverGone, list refreshed', async () => {
    const { shell, calls } = fakeShell({
      perms: ['take-order'],
      candidates: [[SARA, HAMZA], [{ ...SARA, working: false }, HAMZA]],
      answers: { requestTableHandover: [{ ok: false, error: { kind: 'api', status: 409, code: 'HANDOVER_TARGET_UNAVAILABLE', details: { reason: 'not_working' } } }] },
    });
    await render(shell);
    m.click(m.button('Hand over'));
    await flush();
    m.click(row('Sara'));
    m.click(m.button('Send request', dlg()!));
    await flush();
    expect(dlg()?.textContent).toContain("Sara isn't signed in now. Pick someone else.");
    expect(calls.filter((c) => c.name === 'handoverCandidates')).toHaveLength(2);
    expect(rows().map((r) => r.querySelector('b')?.textContent)).toEqual(['Hamza', 'Sara']);
    expect(row('Sara').getAttribute('aria-disabled')).toBe('true');
    expect(rows().some((r) => r.getAttribute('aria-checked') === 'true')).toBe(false);
  });

  it('[02a §8 Table sheet] Hand over: 409 TABLE_HANDOVER_PENDING → toast, the dialog closes', async () => {
    const { shell } = fakeShell({
      perms: ['take-order'],
      answers: { requestTableHandover: [{ ok: false, error: { kind: 'api', status: 409, code: 'TABLE_HANDOVER_PENDING', details: { alert_id: 'A0', to_staff_id: 'ST-HAM' } } }] },
    });
    await render(shell);
    m.click(m.button('Hand over'));
    await flush();
    m.click(row('Hamza'));
    m.click(m.button('Send request', dlg()!));
    await flush();
    expect(shell.toasts.current()?.text).toBe('A handover is already waiting for an answer');
    expect(dlg()).toBeNull();
  });

  it('[02a §8 Table sheet] a failed handover-candidates read shows an error with Try again, never "Loading…" forever (review #166)', async () => {
    const { shell, calls } = fakeShell({ perms: ['take-order'], candidatesFail: 1 });
    await render(shell);
    m.click(m.button('Hand over'));
    await flush();
    expect(dlg()!.textContent).toContain('That did not work. Try again.');
    expect(dlg()!.textContent).not.toContain('Loading');
    m.click(m.button('Try again', dlg()!));
    await flush();
    expect(calls.filter((c) => c.name === 'handoverCandidates')).toHaveLength(2);
    expect(rows().map((r) => r.querySelector('b')?.textContent)).toEqual(['Sara', 'Hamza', 'Muhammad']);
  });

  it('[02a §8 Table sheet] Force move: "Me" row only with take-order covering the floor; reason token required', async () => {
    const theirs = tile({ holder: { staff_id: 'ST-BIL', name: 'Bilal' } });
    const { shell, calls } = fakeShell({
      perms: ['take-order', 'force-release-table-lock'],
      tile: theirs,
      candidates: [[SARA, HAMZA]],
      answers: { forceMoveTable: [{ ok: true, data: { changed: true } }] },
    });
    await render(shell);
    m.click(m.button('Force move'));
    await flush();
    const box = dlg()!;
    expect(rows().map((r) => r.querySelector('b')?.textContent)).toEqual(['Me', 'Sara', 'Hamza']);
    expect(row('Me').textContent).toContain('Ali · you');
    for (const chip of ['Shift ended', 'Went home', 'Rebalance', 'Other']) expect(m.button(chip, box)).toBeTruthy();
    const give = m.button('Give table', box) as HTMLButtonElement;
    m.click(row('Me'));
    expect(box.textContent).toContain('Give F2 to Me now?');
    expect(give.disabled).toBe(true); // the reason is required
    m.click(m.button('Shift ended', box));
    expect(give.disabled).toBe(false);
    m.click(give);
    await flush();
    expect(calls.find((c) => c.name === 'forceMoveTable')?.payload).toEqual({ table_id: 'TB2', seating_id: 'S2', to_staff_id: ME, reason: 'shift_ended' });
    expect(dlg()).toBeNull();
    m.unmount();

    // without take-order (or only own_tables) there is no Me row
    const variants: Array<Record<string, Resolution>> = [{ 'force-release-table-lock': allow }, { 'force-release-table-lock': allow, 'take-order': { grant: 'allowed', scope: 'own_tables' } }];
    for (const perms of variants) {
      const other = fakeShell({ perms, tile: theirs, candidates: [[SARA]] });
      await render(other.shell);
      m.click(m.button('Force move'));
      await flush();
      expect(rows().map((r) => r.querySelector('b')?.textContent)).toEqual(['Sara']);
      m.unmount();
    }
    m = mount();
  });
});
