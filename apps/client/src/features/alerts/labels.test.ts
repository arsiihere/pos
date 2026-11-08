import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../../i18n';
import { en } from '../../i18n/en';
import { ur } from '../../i18n/ur';
import todo from '../../../../../docs/design/handoff/01d/urdu-todo.md?raw';
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
  inPersonTitle,
  lockText,
  stepTag,
  timeText,
  waitingText,
} from './labels';
import { view } from './test-fakes';

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
    for (const key of ours) expect(key in ur || todo.includes(`\`${key}\``), key).toBe(true);
    for (const key of ['errors.ALERT_NOT_FOUND', 'errors.REQUEST_NOT_PENDING', 'errors.REQUEST_PIN_REQUIRED']) {
      expect(key in en, key).toBe(true);
      expect(key in ur || todo.includes(`\`${key}\``), key).toBe(true);
    }
  });

  it('[01d §3.12] the card text fills the display parameters; the lock text never shows details', () => {
    const v = view({ alert_id: 'A1', kind: 'test_alert', family: 'info', lock: { kind_label_key: 'alert.test_alert.lock', requester_name: 'Imran' } });
    expect(alertText(v)).toBe('Test alert · from Imran');
    expect(lockText(view({ alert_id: 'A2', card: voidCard }))).toBe('T12 · Request · Hamza');
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
    const unknown = view({ alert_id: 'U1', kind: 'void_approval', lock: { kind_label_key: 'alert.void_approval.lock', table_code: '12', requester_name: 'Hamza' } });
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

  it('[01d §8.1] the §8.1 and brief §6 error texts', () => {
    const e = answerErrorText;
    expect(e('REQUEST_NOT_PENDING', { close_reason: 'answered', decision: 'approve', answered_by_name: 'Sana' })).toBe('Already approved by Sana.');
    expect(e('REQUEST_NOT_PENDING', { close_reason: 'answered', decision: 'reject', answered_by_name: 'Sana' })).toBe('Already rejected by Sana.');
    expect(e('REQUEST_NOT_PENDING', { close_reason: 'withdrawn' }, { requester_name: 'Hamza' })).toBe('Withdrawn by Hamza.');
    expect(e('REQUEST_NOT_PENDING', { close_reason: 'obsolete' })).toBe('This request is already closed.');
    expect(e('PERMISSION_DENIED', { reason: 'out_of_range' })).toBe('Not your team — a manager can approve.');
    expect(e('PERMISSION_DENIED', { reason: 'in_person_elsewhere' })).toBe("In person only on the requester's device.");
    expect(e('PERMISSION_DENIED', { reason: 'self' })).toBe("You can't approve your own request.");
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
    expect(text).toBe('You approved the request on T12 at Hamza’s tablet');
    expect(text).not.toContain('void');
    expect(text).not.toContain('_');
  });
});
