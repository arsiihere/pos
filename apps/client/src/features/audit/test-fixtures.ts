import type { Resolution } from '../staff/api';
import type { Shell } from '../staff/shell/hooks';
import { createPermissions } from '../staff/shell/permissions';
import type { AuditApi, AuditEntryView, AuditPage, AuditQuery } from './api';

// 04 VU2 test fixtures (no test runner imports): §6.5 AuditEntryView rows as the Audit frame draws them, a fake hub for
// audit-log / audit-staff, a staff shell, an IntersectionObserver stand-in.

export const OFFSET = 5 * 3_600_000; // PKT
export const NOW = Date.UTC(2026, 10, 17, 16, 40); // Tue 17 Nov 2026, 9:40 PM hub time
export const TODAY = Date.UTC(2026, 10, 17) - OFFSET; // hub midnight
export const DAY = 86_400_000;
export const at = (h: number, m: number) => TODAY + (h * 60 + m) * 60_000;

export function entry(over: Partial<AuditEntryView> = {}): AuditEntryView {
  return {
    seq: 1,
    event_id: '01JDQ00000000000000000EV01',
    recorded_at: at(21, 32),
    action: 'item_voided',
    actor_staff_id: 'S-HAMZA',
    approver_staff_id: 'S-IMRAN',
    method: null,
    device_id: 'D-T3',
    subject_type: 'order',
    subject_id: 'O1',
    order_id: 'O1',
    table_code: 'T12',
    table_id: 'TB12',
    reason: 'customer_changed_mind',
    outcome: 'moved',
    amount_minor: 240_000,
    detail_json: JSON.stringify({ envelope_actor_id: 'S-IMRAN', order_item_id: 'L1', units: 1 }),
    actor_name: 'Hamza',
    approver_name: 'Imran',
    table_name: 'T12',
    ...over,
  };
}

export const ROWS: AuditEntryView[] = [
  entry({ seq: 10 }),
  entry({ seq: 9, action: 'void_answered', reason: null, outcome: 'approved', amount_minor: null, method: 'in_person', detail_json: JSON.stringify({ envelope_actor_id: 'S-IMRAN', on_requester_device: false }) }),
  entry({
    seq: 8,
    recorded_at: at(21, 28),
    action: 'void_requested',
    approver_staff_id: null,
    approver_name: null,
    detail_json: JSON.stringify({ envelope_actor_id: 'S-HAMZA', item: 'Mutton Karahi — Full', units: 1 }),
  }),
  entry({
    seq: 7,
    recorded_at: at(20, 58),
    action: 'void_answered',
    actor_staff_id: 'S-BILAL',
    actor_name: 'Bilal',
    approver_staff_id: 'S-SANA',
    approver_name: 'Sana',
    method: 'session',
    reason: null,
    outcome: 'rejected',
    amount_minor: null,
    table_code: 'T3',
    table_name: 'T3',
    detail_json: JSON.stringify({ envelope_actor_id: 'S-SANA', on_requester_device: true }),
  }),
  entry({
    seq: 6,
    recorded_at: at(19, 55),
    action: 'device_paired',
    actor_staff_id: '01JDQ5Z8K2M4N6P8R0T2V4G7Q2',
    actor_name: null,
    approver_staff_id: null,
    approver_name: null,
    subject_type: 'device',
    order_id: null,
    table_code: null,
    table_id: null,
    table_name: null,
    reason: null,
    outcome: null,
    amount_minor: null,
    detail_json: JSON.stringify({ envelope_actor_id: null, device_name: 'Tablet 5' }),
  }),
];

export const ALLOWED: Record<string, Resolution> = { 'view-audit-log': { grant: 'allowed', scope: 'branch' } };

/** A fake §6.5 hub: pages keyed by cursor (null = first). */
export function fakeApi(pages: Record<string, AuditPage | 'network' | 'refused'>, staff: Array<{ staff_id: string; display_name: string; in_directory: boolean }> = []) {
  const calls: Array<{ q: AuditQuery; cursor: string | null; limit: number | undefined }> = [];
  const staffCalls: number[] = [];
  const api: AuditApi = {
    auditLog: async (q, cursor, limit) => {
      calls.push({ q, cursor, limit });
      const page = pages[cursor ?? 'first'];
      if (page === undefined || page === 'network') return { ok: false as const, error: { kind: 'network' as const } };
      if (page === 'refused') return { ok: false as const, error: { kind: 'api' as const, status: 400, code: 'VALIDATION_FAILED', details: {} } };
      return { ok: true as const, data: page };
    },
    auditStaff: async () => {
      staffCalls.push(1);
      return { ok: true as const, data: staff };
    },
  };
  return { api, calls, staffCalls };
}

export function shellFor(perms: Record<string, Resolution> = ALLOWED, nowMs = NOW, api: AuditApi = fakeApi({}).api): Shell {
  return {
    device: { token: 'DEV', id: 'D-LAP', type: 'tablet' },
    meta: { tenantId: 'T', branchId: 'B', branchName: 'Gulberg', hubNowMs: nowMs, utcOffsetMs: OFFSET },
    api: { sessionToken: () => 'SESS', ...api },
    permissions: createPermissions(perms),
    clock: { nowMs: () => nowMs, utcOffsetMs: OFFSET },
    me: { staff_id: 'S-IMRAN', name: 'Imran' },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
}

/** IntersectionObserver stand-in: `fire()` brings every observed element into view. */
export class FakeIO {
  static all: FakeIO[] = [];
  observed: Element[] = [];
  constructor(private readonly cb: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void) {
    FakeIO.all.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {
    this.observed = [];
  }
  unobserve() {}
  static fire() {
    for (const io of FakeIO.all) if (io.observed.length > 0) io.cb(io.observed.map((target) => ({ isIntersecting: true, target })));
  }
}

