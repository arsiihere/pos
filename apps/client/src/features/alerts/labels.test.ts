import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../../i18n';
import { en } from '../../i18n/en';
import { ur } from '../../i18n/ur';
import todo from '../../../../../docs/design/handoff/01d/urdu-todo.md?raw';
import { TODO_05 } from '../billing/urdu-todo-05';
import {
  ALERT_KINDS_01D,
  alertText,
  answerErrorText,
  badgeText,
  bindText,
  closedText,
  detailsText,
  familyText,
  fromDayText,
  handoverDetailsText,
  inPersonTitle,
  lockText,
  reasonText,
  stepTag,
  tableLabel,
  timeText,
  titleText,
  waitingText,
} from './labels';
import { view } from './test-fakes';
import { tableOf } from './ui';
import { text03b, title03b } from './labels-03b';

afterEach(() => setLanguage('en'));

const PKT = 5 * 3_600_000;
// 2026-11-02 09:02 UTC = 2:02 PM in the hub zone (+5 h)
const AT = Date.UTC(2026, 10, 2, 9, 2);

const voidCard = {
  kind_label_key: 'alert.void_approval.card',
  table_code: '12',
  point_code: null,
  requester_name: 'Hamza',
  details: { item: 'Chicken Karahi — Full', quantity: 1, amount: 220_000, reason: 'Customer changed mind' },
};

describe('[01d §3.12] labels', () => {
  it('[01d §3.12] every 01d kind has card and lock texts in EN; every 01d key is in UR or in the 01d Urdu to-do list', () => {
    expect([...ALERT_KINDS_01D].sort()).toEqual(
      ['answered_on_requester_device', 'approval_receipt', 'no_approver', 'pin_use_failed', 'request_result', 'test_alert'],
    );
    for (const kind of ALERT_KINDS_01D) {
      expect(`alert.${kind}.card` in en, kind).toBe(true);
      expect(`alert.${kind}.lock` in en, kind).toBe(true);
    }
    const ours = Object.keys(en).filter((k) => /^(alert|alerts|requests|answer|notice|bind|lock|test|receipts)\./.test(k));
    expect(ours.length).toBeGreaterThan(60);
    // 05 task 43a: the 05 kinds' labels (alert.discount.*, …) are listed in the 05 hand-off's Urdu to-do
    for (const key of ours) expect(key in ur || todo.includes(`\`${key}\``) || TODO_05.has(key), key).toBe(true);
    for (const key of ['errors.ALERT_NOT_FOUND', 'errors.REQUEST_NOT_PENDING', 'errors.REQUEST_PIN_REQUIRED']) {
      expect(key in en, key).toBe(true);
      expect(key in ur || todo.includes(`\`${key}\``), key).toBe(true);
    }
  });

  it('[01d §3.12] the card text fills the display parameters; the lock text never shows details', () => {
    const v = view({ alert_id: 'A1', kind: 'test_alert', family: 'info', lock: { kind_label_key: 'alert.test_alert.lock', requester_name: 'Imran' } });
    expect(alertText(v)).toBe('Test alert · from Imran');
    expect(lockText(view({ alert_id: 'A2', card: voidCard }))).toBe('T12 · Void · Hamza'); // 04 §8: alert.void_approval.lock
    expect(lockText(view({ alert_id: 'A2', card: voidCard }))).not.toMatch(/2,200|Karahi|changed/);
  });

  it('[01d §3.12] a row with no card (lock only, AD-162/163) uses the lock text', () => {
    const v = view({
      alert_id: 'P1',
      kind: 'pin_use_failed',
      family: 'info',
      lock: { kind_label_key: 'alert.pin_use_failed.lock', device_name: 'Tablet 3' },
    });
    expect(alertText(v)).toBe('Your PIN was used on Tablet 3');
    const withCard = { ...v, card: { kind_label_key: 'alert.pin_use_failed.card', device_name: 'Tablet 3', details: null } };
    expect(alertText(withCard)).toBe('Your PIN was entered on Tablet 3 and the answer failed');
  });

  it('[01d §3.12] an empty parameter drops its part of the line; never a kind key or a permission key', () => {
    const noTable = view({
      alert_id: 'R1',
      kind: 'request_result',
      family: 'info',
      outcome: 'approved',
      lock: { kind_label_key: 'alert.request_result.lock', table_code: null },
    });
    expect(alertText(noTable)).toBe('Request approved');
    const noApprover = view({ alert_id: 'N1', kind: 'no_approver', family: 'info', lock: { kind_label_key: 'alert.no_approver.lock' } });
    expect(alertText(noApprover)).toBe('No one can approve requests'); // a manager's lock-only row
    expect(alertText({ ...noApprover, card: { kind_label_key: 'alert.no_approver.card', details: null } })).toBe(
      'No one can approve requests right now',
    );
    // a kind this client has no text for (void_approval has its own since 04 §8)
    const unknown = view({ alert_id: 'U1', kind: 'future_request', lock: { kind_label_key: 'alert.future_request.lock', table_code: '12', requester_name: 'Hamza' } });
    expect(alertText(unknown)).toBe('T12 · Request · Hamza');
    for (const text of [alertText(noTable), alertText(noApprover), alertText(unknown)]) {
      expect(text).not.toMatch(/alert\.|approve-|manage-|\{/);
    }
  });

  it('[01d §3.12] request_result: one text per outcome (AD-82)', () => {
    const r = (outcome: 'approved' | 'rejected' | 'withdrawn' | 'obsolete' | 'overridden') =>
      alertText(view({ alert_id: 'R', kind: 'request_result', family: 'info', outcome, lock: { kind_label_key: 'alert.request_result.lock', table_code: '12' } }));
    expect([r('approved'), r('rejected'), r('withdrawn'), r('obsolete'), r('overridden')]).toEqual([
      'Request approved · T12',
      'Request rejected · T12',
      'You withdrew the request · T12',
      'Request closed · T12',
      'Request overridden · T12',
    ]);
  });

  it('[01d §3.12] details line: item × quantity · amount · reason (card only)', () => {
    expect(detailsText(voidCard.details)).toBe('Chicken Karahi — Full ×1 · Rs 2,200 · “Customer changed mind”');
    expect(detailsText({ amount: 65_000 })).toBe('Rs 650');
    expect(detailsText(null)).toBeNull();
    expect(detailsText({})).toBeNull();
  });

  it('[03a §3.8, AD-37 (3)] a slip card reads "≈ N min late" in EN and UR', () => {
    expect(detailsText({ minutes_late: 3, lines: [{ name: 'Mutton Karahi', quantity: 1, state: 'added' }] })).toBe('≈ 3 min late');
    expect(detailsText({ minutes_late: 8, lines: [] })).toBe('≈ 8 min late');
    setLanguage('ur');
    expect(detailsText({ minutes_late: 3, lines: [] })).toBe('≈ 3 منٹ دیر');
  });

  it('[01d §3.12] family words, step tags, badge', () => {
    expect([familyText('urgent'), familyText('action'), familyText('info'), familyText('info', true)]).toEqual([
      'Urgent',
      'Action',
      'Info',
      'Receipt',
    ]);
    expect(stepTag({ step: 0, escalation: false })).toBeNull();
    expect(stepTag({ step: 1, escalation: false })).toBe('Reminder');
    expect(stepTag({ step: 2, escalation: true })).toBe('Escalated');
    expect([badgeText(0), badgeText(3), badgeText(99), badgeText(100)]).toEqual([null, '3', '99', '99+']);
  });
});

describe('[01d #61 client] earlier business day label (BF-4)', () => {
  it('[01d #61 client] from_business_day → "from 1 Nov"; none → nothing', () => {
    expect(fromDayText('2026-11-01')).toBe('from 1 Nov');
    expect(fromDayText(null)).toBeNull();
    setLanguage('ur');
    expect(fromDayText('2026-11-01')).toBe('1 نومبر سے');
  });
});

describe('[01d §8.1] times, header and errors', () => {
  it('[01d §8.1] times are 12-hour in the hub zone (AD-167)', () => {
    expect(timeText(AT, PKT)).toBe('2:02 PM');
    expect(timeText(Date.UTC(2026, 10, 2, 19, 5), PKT)).toBe('12:05 AM');
    expect(timeText(Date.UTC(2026, 10, 2, 7, 0), PKT)).toBe('12:00 PM');
    expect(timeText(Date.UTC(2026, 10, 2, 4, 9), PKT)).toBe('9:09 AM');
    expect(waitingText(AT, AT + 2 * 60_000 + 59_000)).toBe('waiting 2 min');
  });

  it('[01d §8.1] tablet header: "Alerts: <name> — pauses at <time>", "Alerts paused", "Alerts: none"', () => {
    expect(bindText({ name: 'Ali', until: AT }, AT - 1, PKT)).toBe('Alerts: Ali — pauses at 2:02 PM');
    expect(bindText({ name: 'Ali', until: AT }, AT, PKT)).toBe('Alerts paused');
    expect(bindText(null, AT, PKT)).toBe('Alerts: none');
  });

  it('[01d §8.1] closed rows: approved / rejected by name and time, withdrawn, bill closed, expired', () => {
    expect(closedText({ close_reason: 'answered', decision: 'approve', by_name: 'Imran', at: AT }, PKT)).toBe('Approved by Imran 2:02 PM');
    expect(closedText({ close_reason: 'answered', decision: 'decline', by_name: 'Imran', at: AT }, PKT)).toBe('Rejected by Imran 2:02 PM');
    expect(closedText({ close_reason: 'withdrawn' }, PKT)).toBe('Withdrawn');
    expect(closedText({ close_reason: 'obsolete' }, PKT)).toBe('Closed');
    expect(closedText({ close_reason: 'answered', decision: 'approve', by_name: null }, PKT)).toBe('Approved');
    expect(closedText({ close_reason: 'answered', decision: 'accept', by_name: 'Sana' }, PKT)).toBe('Approved by Sana');
    expect(closedText({ close_reason: 'expired' }, PKT)).toBe('Expired');
    expect(closedText({ close_reason: 'done' }, PKT)).toBe('Closed');
  });

  it('[UX; 02b §3.7a Close, §6.19] an unpaid hand-over request closed by its owner says why (manager card, requester result), never bare "Closed"', () => {
    // the manager's card: the alert_closed frame has no note → the kind's own line
    expect(closedText({ close_reason: 'obsolete', kind: 'hand_over_unpaid' }, PKT)).toBe('No longer needed — the bill or the order changed');
    // with the closer's note (where the place has it)
    expect(closedText({ close_reason: 'obsolete', kind: 'hand_over_unpaid', note: 'due_changed' }, PKT)).toBe('Bill went up — ask again');
    expect(closedText({ close_reason: 'obsolete', kind: 'hand_over_unpaid', note: 'bill_closed' }, PKT)).toBe('Bill paid');
    // answered / withdrawn keep their words
    expect(closedText({ close_reason: 'withdrawn', kind: 'hand_over_unpaid' }, PKT)).toBe('Withdrawn');
    // the requester's request_result: its details.reason is the note
    const card = { kind_label_key: 'alert.hand_over_unpaid.card' };
    expect(reasonText('due_changed', card)).toBe('Bill went up — ask again');
    expect(reasonText('handed_over', card)).toBe('Already handed over');
    expect(reasonText('order_cancelled', card)).toBe('Order cancelled');
    expect(reasonText('day_closed', card)).toBe('Day closed');
    expect(reasonText('something_else', card)).toBe('something_else');
    setLanguage('ur');
    expect(reasonText('due_changed', card)).toBe('بل بڑھ گیا — دوبارہ پوچھیں');
    expect(closedText({ close_reason: 'obsolete', kind: 'hand_over_unpaid' }, PKT)).toBe('اب ضرورت نہیں — بل یا آرڈر بدل گیا');
  });

  it('[01d §8.1] the §8.1 and brief §6 error texts', () => {
    const e = answerErrorText;
    expect(e('REQUEST_NOT_PENDING', { close_reason: 'answered', decision: 'approve', answered_by_name: 'Sana' })).toBe('Already approved by Sana.');
    expect(e('REQUEST_NOT_PENDING', { close_reason: 'answered', decision: 'reject', answered_by_name: 'Sana' })).toBe('Already rejected by Sana.');
    expect(e('REQUEST_NOT_PENDING', { close_reason: 'withdrawn' }, { requester_name: 'Hamza' })).toBe('Withdrawn by Hamza.');
    expect(e('REQUEST_NOT_PENDING', { close_reason: 'obsolete' })).toBe('This request is already closed.');
    expect(e('PERMISSION_DENIED', { reason: 'out_of_range' })).toBe('Not your team — a manager can approve.');
    expect(e('PERMISSION_DENIED', { reason: 'in_person_elsewhere' })).toBe("In person only on the requester's device.");
    expect(e('PERMISSION_DENIED', { reason: 'self' })).toBe("You can't approve your own request.");
    // 05a §8 Errors
    expect(e('PERMISSION_DENIED', { reason: 'listed_device_only' })).toBe('Do this on your own phone');
    expect(e('DEVICE_ACCESS_DENIED', { device_id: 'D1' })).toBe('This device is not set up for you');
    expect(e('DEVICE_NOT_OWNED', {})).toBe('This device is not set up for you');
    expect(e('DEVICE_ACCESS_SELF', { device_id: 'D1' })).toBe('You would lose access on this device');
    expect(e('PERMISSION_DENIED', { reason: 'not_approver' })).toBe("You can't approve this.");
    expect(e('PIN_INVALID', {})).toBe('Wrong PIN.');
    expect(e('PIN_LOCKED_OUT', { retry_after_ms: 90_000 })).toBe('Too many tries — wait 2 min.');
    expect(e('DEVICE_LOCKED_OUT', { retry_after_ms: 1 })).toBe('Too many tries — wait 1 min.');
    expect(e('ALERT_NOT_FOUND', {})).toBe('This request is no longer there.');
    expect(e('STAFF_NOT_FOUND', {})).toBe("That person can't approve here.");
    expect(e('SERVICE_UNAVAILABLE', {})).toBe('Busy — try again.');
    expect(e('VALIDATION_FAILED', {})).toBe('Something went wrong. Try again.');
    expect(e('NETWORK', {})).toBe('No connection to the hub — try again.');
    expect(e('SOMETHING_ELSE', {})).toBe('Something went wrong. Try again.');
  });
});

describe('[01d review fix round 1] labels', () => {
  it('[01d §8.1] familyText reads "Receipt" for the silent kind even without the silent field (lock / alert mode)', () => {
    expect(familyText('info', { kind: 'approval_receipt' })).toBe('Receipt');
    expect(familyText('info', { kind: 'test_alert' })).toBe('Info');
  });

  it('[01d §3.12] notice.in_person_title is filled from a label, never from a kind key', () => {
    const lock = { kind_label_key: 'alert.answered_on_requester_device.lock', table_code: '12', point_code: null, requester_name: 'Hamza' };
    const text = inPersonTitle({ kind: 'void_approval', lock });
    expect(text).toBe('You approved the Void request on T12 at Hamza’s tablet'); // 04 §8: the kind's card label
    expect(text).not.toMatch(/void_approval|alert\./);
    expect(text).not.toContain('_');
  });
});

describe('[01d v1.2.1 P-1] table chip', () => {
  it('[01d v1.2.1 P-1] the table chip shows T{code} for an all-digit table_code and the name as-is otherwise', () => {
    expect(tableLabel('12')).toBe('T12');
    expect(tableLabel('7')).toBe('T7');
    expect(tableLabel('Patio 3')).toBe('Patio 3');
    expect(tableLabel('12A')).toBe('12A');
    expect(tableLabel('')).toBeNull();
    expect(tableLabel(null)).toBeNull();
    const lock = { kind_label_key: 'alert.void_approval.lock', table_code: 'Patio 3', point_code: null, requester_name: 'Hamza' };
    expect(tableOf({ lock })).toBe('Patio 3');
    expect(tableOf({ lock: { ...lock, table_code: '12' } })).toBe('T12');
    const text = alertText(view({ alert_id: 'P1', kind: 'void_approval', lock }));
    expect(text).toContain('Patio 3');
    expect(text).not.toContain('TPatio');
  });
});

describe('[02a §8, 02b §3.9] 02 kinds (23b)', () => {
  const handoverLock = { kind_label_key: 'alert.table_handover.lock', table_code: 'F4 + F5', point_code: null, requester_name: 'Ali' };

  it('[02a Q-25] alert.table_handover.lock fills {requester}', () => {
    expect(lockText(view({ alert_id: 'H1', kind: 'table_handover', family: 'action', lock: handoverLock }))).toBe('F4 + F5 · Table handover · Ali');
  });

  it('[02a §6.15] a handover card reads "3 orders · Rs 14,250"; no live order → nothing', () => {
    expect(handoverDetailsText({ quantity: 3, amount: 1_425_000 })).toBe('3 orders · Rs 14,250');
    expect(handoverDetailsText({})).toBeNull();
    expect(handoverDetailsText(null)).toBeNull();
  });

  it('[02a §8 Table sheet] TABLE_HANDOVER_STALE → "Bill paid, waiting for cleaning"', () => {
    expect(answerErrorText('TABLE_HANDOVER_STALE', {})).toContain('Bill paid, waiting for cleaning');
  });

  it('[02b Q-25] a comp without a table reads "Comp · Takeaway order"; with a table the 01d text', () => {
    const takeaway = view({
      alert_id: 'C1',
      kind: 'comp',
      lock: { kind_label_key: 'alert.comp.lock', table_code: null, point_code: null, requester_name: 'Bilal' },
      card: { kind_label_key: 'alert.comp.card', table_code: null, point_code: null, requester_name: 'Bilal', device_name: null, details: null },
    });
    expect(titleText(takeaway)).toBe('Comp · Takeaway order');
    expect(alertText(takeaway)).toBe('Comp · Takeaway order');
    const dineIn = view({ alert_id: 'C2', kind: 'comp', lock: { kind_label_key: 'alert.comp.lock', table_code: 'F4', point_code: null, requester_name: 'Bilal' } });
    expect(lockText(dineIn)).toBe('F4 · Comp · Bilal');
  });
});

// 03b W0.6 (Q-58, Q-66): labels.ts consults lane A's labels-03b.ts for the 03b / 03c kinds; other kinds are unchanged.
describe('[03b W0.6] labels hook', () => {
  it('[03b W0.6] labels.ts consults labels-03b.ts kinds; an 01d / 02 card is unchanged', () => {
    const ready = {
      kind: 'ready_to_serve',
      family: 'action' as const,
      lock: { kind_label_key: 'alert.ready_to_serve.lock', table_code: '4', point_code: 'Pass' },
      card: { kind_label_key: 'alert.ready_to_serve.card', table_code: '4', point_code: 'Pass', requester_name: null, device_name: null, details: { identifier: '#12' } },
    };
    expect(alertText(ready)).toBe(text03b(ready, 'card'));
    expect(alertText(ready)).toBe('Ready to serve · #12 · Pass');
    expect(lockText(ready)).toBe(text03b(ready, 'lock'));
    expect(lockText(ready)).toBe('Ready to serve · T4 · Pass');
    expect(titleText(ready)).toBe(title03b(ready));
    // the closed line: the 03b text for its kind and reason, else the 01d default
    expect(closedText({ close_reason: 'undone', kind: 'ready_to_serve' }, 0)).toBe('Pass took it back');
    expect(closedText({ close_reason: 'done', kind: 'printer_problem', problem: 'ticket_not_built' }, 0)).toBe('Dismissed');
    expect(closedText({ close_reason: 'expired', kind: 'ready_to_serve' }, 0)).toBe('Expired');
    expect(closedText({ close_reason: 'done', kind: 'void_approval' }, 0)).toBe('Closed');
    expect(closedText({ close_reason: 'done' }, 0)).toBe('Closed');
    // an 01d kind reads as before
    const test = { kind: 'test_alert', family: 'info' as const, lock: { kind_label_key: 'alert.test_alert.lock', requester_name: 'Arif' } };
    expect(alertText(test)).toBe(en['alert.test_alert.lock'].replace('{requester}', 'Arif'));
  });
});

describe('[04 §8, §9] answer errors of a void request', () => {
  it('[04 §9] VOID_NOT_ALLOWED: served meanwhile with the hint, else the §8 reason text', () => {
    expect(answerErrorText('VOID_NOT_ALLOWED', { reason: 'not_movable_stage', hint: 'withdraw_and_reask' })).toContain('Served meanwhile — ask the requester');
    expect(answerErrorText('VOID_NOT_ALLOWED', { reason: 'not_movable_stage' })).toBe('Not cooking or cooked');
    expect(answerErrorText('VOID_NOT_ALLOWED', { reason: 'stock_not_tracked' })).toBe('Stock not tracked for this item');
    expect(answerErrorText('VOID_NOT_ALLOWED', { reason: 'day_closed' })).toBe('Business day closed');
  });
});

// 02b-TK L-CLIENT-2 item 4 (02b v1.0.25 §6.12a (R3-m-4), §3.7a; 01d v1.3.7 To 02b): the manager's request card
describe('[02b-TK L-CLIENT-2 item 4; 02b §6.12a] hand_over_unpaid labels', () => {
  const row = (card: boolean) =>
    view({
      alert_id: 'AL1',
      kind: 'hand_over_unpaid',
      answers: ['approve', 'reject'],
      lock: { kind_label_key: 'alert.hand_over_unpaid.lock', table_code: null, point_code: null, requester_name: 'Ali' },
      ...(card ? { card: { kind_label_key: 'alert.hand_over_unpaid.card', table_code: null, point_code: null, requester_name: 'Ali', details: { identifier: '#48', amount: 119_000 } } } : {}),
    });
  it('signed-in card "Hand over unpaid {identifier}" with the amount; the lock is label-only; EN and UR', () => {
    expect(alertText(row(true))).toBe('Hand over unpaid #48');
    expect(titleText(row(true))).toBe('Hand over unpaid #48');
    expect(detailsText(row(true).card!.details)).toBe('Rs 1,190');
    expect(lockText(row(true))).toBe('Unpaid hand-over request');
    expect(alertText(row(false))).toBe('Unpaid hand-over request');
    expect(inPersonTitle(row(false))).toContain('Unpaid hand-over');
    setLanguage('ur');
    expect(alertText(row(true))).toBe('#48 بغیر ادائیگی حوالے کریں');
    expect(lockText(row(true))).toBe('بغیر ادائیگی حوالگی کی درخواست');
  });
  it('the identifier is PARKING for a parking order', () => {
    const r = row(true);
    expect(alertText({ ...r, card: { ...r.card!, details: { identifier: 'PARKING', amount: 40_000 } } })).toBe('Hand over unpaid PARKING');
  });
});


// ⚠️ 02b v1.0.27 §6.12a, 01d v1.3.8 (owner 2026-11-28 Q10): the manager's card names an addition-only bill "(addition)",
// and a closed request row carries the alert_closed frame's note into the line that says why.
describe('[01d v1.3.8 owner 2026-11-28 Q10] hand_over_unpaid manager card', () => {
  const unpaidView = (disposition?: string) =>
    view({
      alert_id: 'AH1',
      kind: 'hand_over_unpaid',
      lock: { kind_label_key: 'alert.hand_over_unpaid.lock', table_code: null, point_code: null, requester_name: 'Ali' },
      card: { kind_label_key: 'alert.hand_over_unpaid.card', table_code: null, point_code: null, requester_name: 'Ali', details: { identifier: '#14', amount: 4_000, ...(disposition === undefined ? {} : { disposition }) } },
    });
  it('"Hand over unpaid #14 (addition)" for an addition-only bill; plain "#14" otherwise', () => {
    expect(titleText(unpaidView('alert.hand_over_unpaid.addition'))).toBe('Hand over unpaid #14 (addition)');
    expect(titleText(unpaidView())).toBe('Hand over unpaid #14');
  });
});
