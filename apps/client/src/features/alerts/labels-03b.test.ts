import type { AlertCard, AlertLock } from '@pos/events';
import { describe, expect, it, vi } from 'vitest';
import { en } from '../../i18n/en';
import { ur } from '../../i18n/ur';
import {
  ALERT_KINDS_03B,
  closedText03b,
  createPrintSkipDismiss,
  escalatedWho03b,
  helpText03b,
  is03bKind,
  params03b,
  printSkipAction,
  text03b,
  title03b,
} from './labels-03b';

// 03b §6.21, 03c §6.10 / §6.12 (task A5). The W0.6 hook in labels.ts (Q-66) calls these functions for the four
// 03b / 03c kinds; until it lands these tests call them directly (the hook's stand-in is `text03b` itself).

const lock = (over: Partial<AlertLock> & { kind_label_key: string }): AlertLock => ({
  table_code: null,
  point_code: null,
  requester_name: null,
  device_name: null,
  ...over,
});

const BRANCH = { grant: 'allowed', scope: 'branch' } as const;
const NOT_GRANTED = { grant: 'not_granted' } as const;

const card = (over: Partial<AlertLock> & { kind_label_key: string }, details: AlertCard['details']): AlertCard => ({ ...lock(over), details });

function row(kind: string, l: Partial<AlertLock>, c?: { over?: Partial<AlertLock>; details: AlertCard['details'] }) {
  return {
    kind,
    lock: lock({ kind_label_key: `alert.${kind}.lock`, ...l }),
    card: c === undefined ? undefined : card({ kind_label_key: `alert.${kind}.card`, ...l, ...c.over }, c.details),
  };
}

describe('03b / 03c alert labels (A5)', () => {
  it('[03b §6.21] the four kinds have card and lock texts in EN and UR (or the 03b Urdu to-do)', () => {
    expect([...ALERT_KINDS_03B].sort()).toEqual(['kds_offline', 'printer_problem', 'ready_to_serve', 'served_card']);
    for (const kind of ALERT_KINDS_03B) {
      expect(is03bKind(kind)).toBe(true);
      for (const level of ['card', 'lock']) {
        expect(`alert.${kind}.${level}` in en, `${kind}.${level}`).toBe(true);
        expect(`alert.${kind}.${level}` in ur, `${kind}.${level}`).toBe(true);
      }
    }
    expect(is03bKind('test_alert')).toBe(false);
    for (const key of ['alerts.closed.moved_plain', 'alerts.closed.served', 'alert.ready_to_serve.escalated']) {
      expect(key in en, key).toBe(true);
      expect(key in ur, key).toBe(true);
    }
  });

  it('[03b §6.21] ready_to_serve, served_card, kds_offline cards and lock lines with identifier / table / point', () => {
    const ready = row('ready_to_serve', { table_code: '4', point_code: 'Pass' }, { details: { identifier: 'T4 + T5' } });
    expect(text03b(ready, 'card')).toBe('Ready to serve · T4 + T5 · Pass');
    // the lock line: kind, table and point only — never the identifier (01d two-level rule, frame AlertLock)
    expect(text03b(ready, 'lock')).toBe('Ready to serve · T4 · Pass');
    expect(title03b(ready)).toBe('Ready to serve');
    // takeaway: no table on the lock line, the token on the card
    const token = row('ready_to_serve', { point_code: 'Pass' }, { details: { identifier: '#12 10 Nov' } });
    expect(text03b(token, 'card')).toBe('Ready to serve · #12 10 Nov · Pass');
    expect(text03b(token, 'lock')).toBe('Ready to serve · Pass');
    // a named table ("Family 2") is shown as-is
    expect(text03b(row('ready_to_serve', { table_code: 'Family 2', point_code: 'Pass' }), 'lock')).toBe('Ready to serve · Family 2 · Pass');

    const served = row('served_card', { table_code: '4' }, { details: { identifier: 'T4' } });
    expect(text03b(served, 'card')).toBe("Food handed to you · T4 — tap Served when it's on the table");
    expect(text03b(served, 'lock')).toBe('Food handed over · T4');
    expect(title03b(served)).toBe('Food handed to you');
    // frame AlertCards: the served card's help line
    expect(helpText03b(served)).toBe("Tap Served when it's on the table");

    const dark = row('kds_offline', {}, { details: { station_name: 'Tandoor' } });
    expect(text03b(dark, 'card')).toBe('Tandoor screen offline');
    // the lock line never names the station (frame AlertLock)
    expect(text03b(dark, 'lock')).toBe('Kitchen screen offline');
    expect(title03b(dark)).toBe('Tandoor screen offline');
    expect(helpText03b(dark)).toBe("Its tickets are on the Pass tablet. Check the screen's cable and power.");
    // a row with no card (lock only) uses the lock text
    expect(text03b({ ...dark, card: undefined }, 'card')).toBe('Kitchen screen offline');
    // params for labels.ts: card details only
    expect(params03b(dark.card)).toEqual({ identifier: null, station: 'Tandoor', printer: null, problem: null });
    expect(params03b(undefined)).toEqual({ identifier: null, station: null, printer: null, problem: null });
  });

  it('[03c Q-57] printer_problem card "Tandoor printer · Out of paper" (no waiting count)', () => {
    const paper = row('printer_problem', {}, { details: { printer_name: 'Tandoor printer', problem: 'paper_out' } });
    expect(text03b(paper, 'card')).toBe('Tandoor printer · Out of paper');
    expect(text03b(paper, 'card')).not.toMatch(/waiting/);
    expect(text03b(paper, 'lock')).toBe('Printer problem');
    expect(helpText03b(paper)).toBe('Put in a new roll. Waiting tickets print by themselves.');
    const offline = row('printer_problem', {}, { details: { printer_name: 'Tandoor printer', problem: 'offline' } });
    expect(text03b(offline, 'card')).toBe('Tandoor printer · Offline');
    expect(helpText03b(offline)).toBe("Check the printer's power and cable.");
    expect(text03b(row('printer_problem', {}, { details: { printer_name: 'Tandoor printer', problem: 'not_printing' } }), 'card')).toBe(
      'Tandoor printer · Not printing',
    );
    // an unknown problem word is never shown raw: the part is dropped
    const odd = row('printer_problem', {}, { details: { printer_name: 'Tandoor printer', problem: 'jam_x' } });
    expect(text03b(odd, 'card')).toBe('Tandoor printer');
    expect(helpText03b(odd)).toBeNull();
  });

  it('[03c §6.12 Q-53] ticket_not_built: Dismiss only for force-release-table-lock at branch → DismissPrintSkip; "Stays until day close"; closed done → "Dismissed" without a name', async () => {
    const skip = row('printer_problem', {}, { details: { printer_name: 'Tandoor printer', problem: 'ticket_not_built' } });
    expect(text03b(skip, 'card')).toBe("Tandoor printer · A ticket couldn't be built");
    expect(helpText03b(skip)).toBe('Check that order on the kitchen screen. It may not be on paper.');
    expect(printSkipAction(skip, { open: true, grant: BRANCH })).toEqual({ kind: 'dismiss', label: 'Dismiss' });
    expect(printSkipAction(skip, { open: true, grant: NOT_GRANTED })).toEqual({ kind: 'stays', label: 'Stays until day close' });
    expect(printSkipAction(skip, { open: false, grant: BRANCH })).toBeNull();
    // no other alert kind and no other printer problem gets Dismiss
    expect(printSkipAction(row('printer_problem', {}, { details: { printer_name: 'P', problem: 'paper_out' } }), { open: true, grant: BRANCH })).toBeNull();
    expect(printSkipAction(row('kds_offline', {}, { details: { station_name: 'Tandoor' } }), { open: true, grant: BRANCH })).toBeNull();
    // a lock-only row (no details): no Dismiss
    expect(printSkipAction({ ...skip, card: undefined }, { open: true, grant: BRANCH })).toBeNull();

    type Send = (type: string, payload: Record<string, unknown>, id: string) => Promise<{ ok: true; data: { dismissed: boolean } }>;
    const send = vi.fn<Send>(async () => ({ ok: true as const, data: { dismissed: true } }));
    const refresh = vi.fn();
    const { dismiss } = createPrintSkipDismiss(send, refresh);
    expect(await dismiss('AL1')).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith('DismissPrintSkip', { alert_id: 'AL1' }, expect.any(String));
    expect(refresh).not.toHaveBeenCalled();

    expect(closedText03b('printer_problem', { close_reason: 'done', problem: 'ticket_not_built' })).toBe('Dismissed');
    expect(closedText03b('printer_problem', { close_reason: 'done', problem: 'ticket_not_built' })).not.toMatch(/·/);
  });

  it('[03c §6.12] 404 ALERT_NOT_FOUND / 409 ALERT_ALREADY_CLOSED → card refreshed', async () => {
    const answers = [
      { ok: false as const, error: { kind: 'api' as const, status: 404, code: 'ALERT_NOT_FOUND', details: {} } },
      { ok: false as const, error: { kind: 'api' as const, status: 409, code: 'ALERT_ALREADY_CLOSED', details: { reason: 'done' } } },
    ];
    const send = vi.fn(async () => answers.shift()!);
    const refresh = vi.fn();
    const { dismiss } = createPrintSkipDismiss(send, refresh);
    expect(await dismiss('AL1')).toEqual({ ok: false, refreshed: true });
    expect(refresh).toHaveBeenCalledWith('AL1');
    expect(await dismiss('AL2')).toEqual({ ok: false, refreshed: true });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('[00 M47 03c §6.12] a Dismiss after a network failure resends the same command_id; a double tap sends once', async () => {
    let release: () => void = () => {};
    const results: Array<() => Promise<unknown>> = [
      async () => ({ ok: false, error: { kind: 'network' } }),
      () => new Promise((r) => (release = () => r({ ok: true, data: { dismissed: true } }))),
    ];
    const send = vi.fn<(type: string, payload: Record<string, unknown>, id: string) => Promise<never>>(() => results.shift()!() as Promise<never>);
    const { dismiss } = createPrintSkipDismiss(send, () => {});
    expect(await dismiss('AL1')).toEqual({ ok: false, refreshed: false, text: 'No connection to the hub — try again.' });
    const first = dismiss('AL1');
    const second = dismiss('AL1');
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(2);
    release();
    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });
    expect(send.mock.calls[1]![2]).toBe(send.mock.calls[0]![2]);
    // after a definitive answer a later dismiss (another alert) is a new command
    results.push(async () => ({ ok: true, data: { dismissed: true } }));
    await dismiss('AL2');
    expect(send.mock.calls[2]![2]).not.toBe(send.mock.calls[0]![2]);
  });

  it('[03b §3.5] closed lines: undone, moved ("Moved to T9"; "Moved" when no table is known), screen_back, screen_removed, printing_again, dismissed', () => {
    expect(closedText03b('ready_to_serve', { close_reason: 'undone' })).toBe('Pass took it back');
    expect(closedText03b('ready_to_serve', { close_reason: 'obsolete', moved_to: '9' })).toBe('Moved to T9');
    expect(closedText03b('ready_to_serve', { close_reason: 'obsolete', moved_to: 'Family 2' })).toBe('Moved to Family 2');
    expect(closedText03b('ready_to_serve', { close_reason: 'obsolete' })).toBe('Moved');
    expect(closedText03b('ready_to_serve', { close_reason: 'done' })).toBe('Served');
    expect(closedText03b('kds_offline', { close_reason: 'done' })).toBe('Screen back');
    expect(closedText03b('kds_offline', { close_reason: 'obsolete' })).toBe('Screen removed');
    expect(closedText03b('printer_problem', { close_reason: 'done', problem: 'paper_out' })).toBe('Printing again');
    expect(closedText03b('printer_problem', { close_reason: 'done', problem: 'ticket_not_built' })).toBe('Dismissed');
    // not ours, or a reason the kind does not name: labels.ts keeps its own text
    expect(closedText03b('printer_problem', { close_reason: 'obsolete', problem: 'paper_out' })).toBeNull();
    expect(closedText03b('ready_to_serve', { close_reason: 'expired' })).toBeNull();
    // AlertCards / AlertCardsUrdu: a served card closed done reads "Served"
    expect(closedText03b('served_card', { close_reason: 'done' })).toBe('Served');
    expect(closedText03b('test_alert', { close_reason: 'done' })).toBeNull();
  });

  it('[03b §6.21 IR-22] the escalated Ready banner (PassEscalated): "Pass · nobody came for 2 min"; not on other steps or kinds', () => {
    const ready = { ...row('ready_to_serve', { table_code: '4', point_code: 'Pass' }, { details: { identifier: 'T4 + T5' } }), escalation: true, raised_at: 1_000 };
    expect(escalatedWho03b(ready, 1_000 + 2 * 60_000 + 5_000)).toBe('Pass · nobody came for 2 min');
    expect(escalatedWho03b({ ...ready, lock: { ...ready.lock, point_code: null } }, 1_000 + 3 * 60_000)).toBe('nobody came for 3 min');
    expect(escalatedWho03b({ ...ready, escalation: false }, 1_000 + 2 * 60_000)).toBeNull();
    expect(escalatedWho03b({ ...ready, kind: 'kds_offline' }, 1_000 + 2 * 60_000)).toBeNull();
    // the banner title and table chip come from labels.ts; the title is the kind's ("Ready to serve")
    expect(title03b(ready)).toBe('Ready to serve');
  });
  it('[03c §3.10 §6.12] Dismiss needs force-release-table-lock allowed at branch scope; any other grant or scope shows "Stays until day close"', () => {
    const skip = row('printer_problem', {}, { details: { printer_name: 'Tandoor printer', problem: 'ticket_not_built' } });
    const stays = { kind: 'stays', label: 'Stays until day close' };
    expect(printSkipAction(skip, { open: true, grant: { grant: 'allowed', scope: 'branch' } })).toEqual({ kind: 'dismiss', label: 'Dismiss' });
    expect(printSkipAction(skip, { open: true, grant: { grant: 'allowed', scope: 'my_floors' } })).toEqual(stays);
    expect(printSkipAction(skip, { open: true, grant: { grant: 'allowed', scope: 'own_tables' } })).toEqual(stays);
    expect(printSkipAction(skip, { open: true, grant: { grant: 'requires_approval', approver_role_ids: ['R1'], scope: 'branch' } })).toEqual(stays);
    expect(printSkipAction(skip, { open: true, grant: { grant: 'denied' } })).toEqual(stays);
    expect(printSkipAction(skip, { open: true, grant: { grant: 'not_granted' } })).toEqual(stays);
    expect(printSkipAction(skip, { open: true, grant: undefined })).toEqual(stays);
  });

  it('[03c §6.12] a 403 PERMISSION_DENIED (outside_scope too) on Dismiss hides the action: "Stays until day close", no new words', async () => {
    const skip = row('printer_problem', {}, { details: { printer_name: 'Tandoor printer', problem: 'ticket_not_built' } });
    const send = vi.fn(async () => ({
      ok: false as const,
      error: { kind: 'api' as const, status: 403, code: 'PERMISSION_DENIED', details: { permission: 'force-release-table-lock', reason: 'outside_scope' } },
    }));
    const refresh = vi.fn();
    const d = createPrintSkipDismiss(send, refresh);
    expect(d.denied()).toBe(false);
    expect(await d.dismiss('AL1')).toEqual({ ok: false, refreshed: true });
    expect(refresh).toHaveBeenCalledWith('AL1');
    expect(d.denied()).toBe(true);
    expect(printSkipAction(skip, { open: true, grant: BRANCH, denied: d.denied() })).toEqual({ kind: 'stays', label: 'Stays until day close' });
  });
});
