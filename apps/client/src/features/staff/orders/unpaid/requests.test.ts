import { describe, expect, it, vi } from 'vitest';
import type { HubResult } from '../../../../api/hub-admin';
import { createLiveBus } from '../../shell/live';
import { statusOf } from './AskManager';
import { createUnpaidRequests } from './requests';

// 02b-TK L-CLIENT-2 item 4 (02b v1.0.25 §3.7a Ask / Approve / Reject, §6.4a RequestUnpaidHandover, §6.19
// UnpaidHandoverApproved + OpenOrderBillChanged; 01d v1.3.7 To 02b; D2): the page's unpaid hand-over requests.

type Cmd = (type: string, payload: unknown) => Promise<HubResult<unknown>>;
const ok = (data: unknown): HubResult<unknown> => ({ ok: true, data });

function setup(command: Cmd, myRequests: unknown[] = []) {
  const live = createLiveBus();
  const query = vi.fn(async () => ok({ requests: myRequests }));
  const store = createUnpaidRequests({ live, api: { command: command as never, query: query as never } });
  let seq = 0;
  const event = (event_type: string, payload: Record<string, unknown>) => live.frame({ type: 'event', seq: ++seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload } } as never);
  return { live, store, query, event, setRequests: (rows: unknown[]) => (myRequests.splice(0, myRequests.length, ...rows), undefined) };
}

const myRow = (alert_id: string, state: string) => ({
  alert_id,
  kind: 'hand_over_unpaid',
  state,
  close_reason: null,
  decision: state === 'rejected' ? 'reject' : state === 'approved' ? 'approve' : null,
  answerer_name: null,
  raised_at: 1,
  waiting_ms: 0,
  ask_in_person: false,
  lock: { table_code: null, point_code: null, requester_name: null, device_name: null, kind_label_key: 'alert.hand_over_unpaid.lock' },
});

describe('RequestUnpaidHandover results (§6.4a)', () => {
  it('sends { order_id } through the command API; a new request of mine → waiting, mine', async () => {
    const command = vi.fn<Cmd>(async () => ok({ alert_id: 'AL1', is_requester: true }));
    const { store } = setup(command);
    expect(await store.ask('O1', 900)).toEqual({ kind: 'waiting', mine: true });
    expect(command).toHaveBeenCalledWith('RequestUnpaidHandover', { order_id: 'O1' });
    expect(store.stateOf('O1')).toEqual({ kind: 'waiting', alert_id: 'AL1', mine: true, ask_in_person: false });
  });
  it("another person's open request → waiting, not mine (no Withdraw)", async () => {
    const { store } = setup(async () => ok({ alert_id: 'AL1', is_requester: false }));
    expect(await store.ask('O1', 900)).toEqual({ kind: 'waiting', mine: false });
    expect(store.stateOf('O1')).toEqual({ kind: 'waiting', alert_id: 'AL1', mine: false, ask_in_person: false });
  });
  it('{ needed: false } → nothing to ask, no card', async () => {
    const { store } = setup(async () => ok({ needed: false }));
    expect(await store.ask('O1', 900)).toEqual({ kind: 'not_needed' });
    expect(store.stateOf('O1')).toBeNull();
  });
  it('{ approved: true } → approved at the due asked about (D2)', async () => {
    const { store } = setup(async () => ok({ approved: true }));
    expect(await store.ask('O1', 900)).toEqual({ kind: 'approved' });
    expect(store.approvedDue('O1')).toBe(900);
  });
  it('an error is passed on and leaves no card; a lost reply / offline is "offline"', async () => {
    const denied = { kind: 'api' as const, status: 403, code: 'PERMISSION_DENIED', details: {} };
    const a = setup(async () => ({ ok: false, error: denied }));
    expect(await a.store.ask('O1', 900)).toEqual({ kind: 'error', error: denied });
    expect(a.store.stateOf('O1')).toBeNull();
    const b = setup(async () => ({ ok: false, error: { kind: 'network' } }));
    expect(await b.store.ask('O1', 900)).toEqual({ kind: 'offline' });
  });
  it('one ask at a time per order (a double tap sends once)', async () => {
    let release: (v: HubResult<unknown>) => void = () => undefined;
    const command = vi.fn<Cmd>(() => new Promise((r) => (release = r)));
    const { store } = setup(command);
    const first = store.ask('O1', 900);
    const second = store.ask('O1', 900);
    release(ok({ alert_id: 'AL1', is_requester: true }));
    await Promise.all([first, second]);
    expect(command).toHaveBeenCalledTimes(1);
  });
});

describe('frames (§6.19) and the requester result (01d my-requests)', () => {
  it('UnpaidHandoverApproved: the named order is approved at its amount and its waiting card goes', async () => {
    const { store, event } = setup(async () => ok({ alert_id: 'AL1', is_requester: true }));
    await store.ask('O1', 900);
    event('UnpaidHandoverApproved', { order_id: 'O1', alert_id: 'AL1', approved_by_staff_id: 'S_MGR', due_minor: 900 });
    expect(store.approvedDue('O1')).toBe(900);
    expect(store.stateOf('O1')).toBeNull();
    // D2: another order of the same token is not approved
    expect(store.approvedDue('O2')).toBeUndefined();
  });
  it('OpenOrderBillChanged clears the approvals it names; OrdersBilled / OrdersUnbilled end them (bill close / reopen)', () => {
    const { store, event } = setup(async () => ok({}));
    event('UnpaidHandoverApproved', { order_id: 'O1', alert_id: 'A', approved_by_staff_id: 'S', due_minor: 900 });
    event('UnpaidHandoverApproved', { order_id: 'O2', alert_id: 'B', approved_by_staff_id: 'S', due_minor: 500 });
    event('UnpaidHandoverApproved', { order_id: 'O3', alert_id: 'C', approved_by_staff_id: 'S', due_minor: 500 });
    event('OpenOrderBillChanged', { order_ids: ['O1', 'O2'], approval_cleared_order_ids: ['O1'] });
    expect(store.approvedDue('O1')).toBeUndefined();
    expect(store.approvedDue('O2')).toBe(500);
    event('OrdersBilled', { order_ids: ['O2'], bill_id: 'B1' });
    expect(store.approvedDue('O2')).toBeUndefined();
    event('OrdersUnbilled', { order_ids: ['O3'] });
    expect(store.approvedDue('O3')).toBeUndefined();
  });
  it('a request_result: my-requests says rejected → "Manager said no"; approved / closed → the card goes', async () => {
    const rows: unknown[] = [];
    const { store, query, setRequests } = setup(async (_t, p) => ok({ alert_id: (p as { order_id: string }).order_id === 'O1' ? 'AL1' : 'AL2', is_requester: true }), rows);
    await store.ask('O1', 900);
    await store.ask('O2', 400);
    setRequests([myRow('AL1', 'rejected'), myRow('AL2', 'approved')]);
    await store.resultSeen();
    expect(query).toHaveBeenCalledWith('/queries/my-requests');
    expect(store.stateOf('O1')).toEqual({ kind: 'rejected', alert_id: 'AL1' });
    expect(store.stateOf('O2')).toBeNull();
  });
  // ⚠️ 01d v1.3.7 To 02b R3-M-3 (build wording, 2026-11-27: one string per state): "Waiting for a manager…" from the first
  // own-pending response; "Waiting — find a manager" only once my-requests says ask_in_person
  it('[01d R3-M-3] my own pending ask reads my-requests once; ask_in_person follows the row (false → true on a later read)', async () => {
    const rows: unknown[] = [myRow('AL1', 'pending')];
    const { store, query, setRequests } = setup(async () => ok({ alert_id: 'AL1', is_requester: true }), rows);
    await store.ask('O1', 900);
    await vi.waitFor(() => expect(query).toHaveBeenCalledWith('/queries/my-requests'));
    expect(store.stateOf('O1')).toMatchObject({ kind: 'waiting', mine: true, ask_in_person: false });
    setRequests([{ ...myRow('AL1', 'pending'), ask_in_person: true }]);
    await store.resultSeen();
    expect(store.stateOf('O1')).toMatchObject({ kind: 'waiting', mine: true, ask_in_person: true });
  });
  it("[01d R3-M-3] another person's request reads no my-requests (not mine)", async () => {
    const { store, query } = setup(async () => ok({ alert_id: 'AL1', is_requester: false }));
    await store.ask('O1', 900);
    await Promise.resolve();
    expect(query).not.toHaveBeenCalled();
  });
  it('still pending in my-requests → still waiting', async () => {
    const rows: unknown[] = [];
    const { store, setRequests } = setup(async () => ok({ alert_id: 'AL1', is_requester: true }), rows);
    await store.ask('O1', 900);
    setRequests([myRow('AL1', 'pending')]);
    await store.resultSeen();
    expect(store.stateOf('O1')).toMatchObject({ kind: 'waiting', mine: true });
  });
  it('asking again after "Manager said no" sends a new request', async () => {
    const rows: unknown[] = [];
    let calls = 0;
    const command = vi.fn<Cmd>(async () => ok({ alert_id: ++calls === 1 ? 'AL1' : 'AL9', is_requester: true }));
    const { store, setRequests } = setup(command, rows);
    await store.ask('O1', 900);
    setRequests([myRow('AL1', 'rejected')]);
    await store.resultSeen();
    expect(await store.ask('O1', 900)).toEqual({ kind: 'waiting', mine: true });
    expect(store.stateOf('O1')).toEqual({ kind: 'waiting', alert_id: 'AL9', mine: true, ask_in_person: false });
  });
  it('Withdraw sends 01d WithdrawRequest by its alert id and drops the card (also on REQUEST_NOT_PENDING)', async () => {
    const command = vi.fn<Cmd>(async (type) => (type === 'WithdrawRequest' ? { ok: false, error: { kind: 'api', status: 409, code: 'REQUEST_NOT_PENDING', details: {} } } : ok({ alert_id: 'AL1', is_requester: true })));
    const { store } = setup(command);
    await store.ask('O1', 900);
    await store.withdraw('O1');
    expect(command).toHaveBeenLastCalledWith('WithdrawRequest', { alert_id: 'AL1' });
    expect(store.stateOf('O1')).toBeNull();
  });
  it('seed: an open-orders row with the hub flag sets or clears the approval (true at its due, false clears)', () => {
    const { store } = setup(async () => ok({}));
    store.seed([{ order_id: 'O1', bill: { state: 'due', due_minor: 700 }, unpaid_handover_approved: true }]);
    expect(store.approvedDue('O1')).toBe(700);
    store.seed([{ order_id: 'O1', bill: { state: 'due', due_minor: 700 }, unpaid_handover_approved: false }]);
    expect(store.approvedDue('O1')).toBeUndefined();
    // a hub without the field changes nothing
    store.seed([{ order_id: 'O1', bill: { state: 'due', due_minor: 700 } }]);
    expect(store.approvedDue('O1')).toBeUndefined();
  });
});

describe('[01d v1.3.7 To 02b R3-M-3; 02b §3.7a] the requester card: one string per state', () => {
  it('mine → "Waiting for a manager…"; mine + ask_in_person → only "Waiting — find a manager"; another\'s → "Already waiting for a manager"; rejected → "Manager said no"', () => {
    expect(statusOf({ kind: 'waiting', alert_id: 'A', mine: true, ask_in_person: false })).toEqual({ text: 'Waiting for a manager…', sub: null });
    expect(statusOf({ kind: 'waiting', alert_id: 'A', mine: true, ask_in_person: true })).toEqual({ text: 'Waiting — find a manager', sub: null });
    expect(statusOf({ kind: 'waiting', alert_id: 'A', mine: false, ask_in_person: false })).toEqual({ text: 'Already waiting for a manager', sub: null });
    expect(statusOf({ kind: 'rejected', alert_id: 'A' })?.text).toBe('Manager said no');
    expect(statusOf(null)).toBeNull();
  });
});
