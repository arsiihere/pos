import type { AlertCard, RequestToAnswerRow } from '@pos/events';
import type { AlertRow } from '../src/features/alerts/store';

// 01d task 41: sample rows for the staff entry's component tests (the hand-off's void on T12 by Hamza).

export const VOID_CARD: AlertCard = {
  kind_label_key: 'alert.void_approval.card',
  table_code: '12',
  point_code: null,
  requester_name: 'Hamza',
  device_name: null,
  details: { item: 'Chicken Karahi — Full', quantity: 1, amount: 220_000, reason: 'Customer changed mind' },
};

export const MIN = 60_000;
/** 2:04 PM in UTC (utcOffsetMs 0 in the tests) */
export const NOW = Date.UTC(2026, 10, 2, 14, 4);

export function row(over: Partial<AlertRow> & { alert_id: string }): AlertRow {
  return {
    kind: 'void_approval',
    family: 'urgent',
    step: 0,
    escalation: false,
    set: 'answerer',
    for_staff_id: null,
    lock: { kind_label_key: 'alert.void_approval.lock', table_code: '12', point_code: null, requester_name: 'Hamza' },
    raised_at: NOW - 2 * MIN,
    seen_by_me: false,
    from_business_day: null,
    moved_to_name: null,
    for_staff_name: null,
    state: 'open',
    close_reason: null,
    decision: null,
    by_name: null,
    ...over,
  };
}

export type RequestRow = ReturnType<(typeof RequestToAnswerRow)['parse']>;

export function requestRow(over: Partial<RequestRow> & { alert_id: string }): RequestRow {
  return {
    kind: 'void_approval',
    family: 'urgent',
    step: 0,
    escalation: false,
    set: 'answerer',
    for_staff_id: null,
    lock: { kind_label_key: 'alert.void_approval.lock', table_code: '12', point_code: null, requester_name: 'Hamza' },
    card: VOID_CARD,
    raised_at: NOW - 2 * MIN,
    answers: ['approve', 'reject'],
    needs_pin: 'always',
    can_answer: true,
    seen_by_me: false,
    from_business_day: null,
    ...over,
  };
}
