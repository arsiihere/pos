import { vi } from 'vitest';
import type { Resolution } from '../staff/api';
import type { Shell } from '../staff/shell/hooks';
import { createLiveBus } from '../staff/shell/live';
import { createPermissions } from '../staff/shell/permissions';
import { createToastBus } from '../staff/shell/toast';
import type { SeatingLine } from '../staff/orders/contracts';
import type { LineOrder } from '../staff/orders/view/LineActions';
import type { PendingVoid, VoidPreview, VoidPreviewDisposition } from './contracts';

// 04 VU1 test fakes: a staff shell whose api answers void-preview / pending-voids / VoidItems from the test, and the
// line / preview shapes of 02b `seating-orders` and 04 §6.3 / §6.4.

export const OFFSET = 5 * 3_600_000;
export const NOW = Date.UTC(2026, 10, 17, 15, 21);

export function sline(order_item_id: string, over: Partial<SeatingLine> = {}): SeatingLine {
  return {
    order_item_id,
    order_id: 'O1',
    parent_order_item_id: null,
    line_kind: 'item',
    item_id: `I-${order_item_id}`,
    deal_id: null,
    name: order_item_id,
    sale_unit: 'piece',
    quantity: 1,
    units: 1,
    live_units: 1,
    comped_units: 0,
    removed_units: 0,
    voided_units: 0,
    returned_units: 0,
    refundable_minor: 220_000,
    comp_minor: 0,
    comp_voided_minor: 0,
    removed_minor: 0,
    refund_minor: 0,
    line_total_minor: 220_000,
    billed_minor: 220_000,
    return_of: null,
    served_from_zone_id: null,
    zone_served: false,
    added_at: NOW - 10 * 60_000,
    served_at: null,
    served_source: null,
    is_food: true,
    kitchen_note: null,
    stage: 'cooking',
    fired: true,
    ...over,
  };
}

export const dineIn = (lines: SeatingLine[], over: Partial<LineOrder> = {}): LineOrder => ({
  order_id: 'O1',
  order_type: 'dine_in',
  ident: 'F4 + F5',
  billed: false,
  lines,
  seating_id: 'S4',
  table_id: 'F4',
  ...over,
});

const disp = (disposition: VoidPreviewDisposition['disposition'], enabled: boolean, lines: Record<string, VoidPreviewDisposition['line_dispositions'][string]>, block: VoidPreviewDisposition['block'] = null): VoidPreviewDisposition => ({
  disposition,
  enabled,
  block: enabled ? null : block,
  line_dispositions: enabled ? lines : {},
});

/** A §6.3 preview of a single line (touched = the line, plus `children` released when not started). */
export function preview(id: string, over: Partial<VoidPreview> & { moved?: boolean | VoidPreviewDisposition['block']; children?: Array<{ id: string; started: boolean; units?: number }> } = {}): VoidPreview {
  const { moved = true, children = [], ...rest } = over;
  const all = [{ id, started: true, units: 1 }, ...children];
  const each = (d: 'moved' | 'wastage' | 'staff_meal' | 'other') => Object.fromEntries(all.map((c) => [c.id, c.started ? d : null]));
  return {
    order_item_id: id,
    group: 'void',
    refund_minor: 228_000,
    comp_voided_minor: 0,
    touched: all.map((c) => ({ order_item_id: c.id, name: c.id, units: c.units ?? 1, stage: c.started ? ('cooking' as const) : ('not_started' as const), refund_minor: 0, comp_voided_minor: 0 })),
    stage: 'cooking',
    dispositions: [
      disp('moved', moved === true, each('moved'), moved === true || moved === false ? 'stock_not_tracked' : moved),
      disp('wastage', true, each('wastage')),
      disp('staff_meal', true, each('staff_meal')),
      disp('other', true, each('other')),
    ],
    needs_approval: true,
    pending: null,
    comp_pending: null,
    ...rest,
  };
}

export function pendingVoid(order_item_id: string, over: Partial<PendingVoid> = {}): PendingVoid {
  return {
    alert_id: `AL-${order_item_id}`,
    order_item_id,
    units: 1,
    touched_ids: [order_item_id],
    refund_minor: 228_000,
    comp_voided_minor: 0,
    requester_staff_id: 'ST-ALI',
    raised_at: NOW - 60_000,
    blocked: null,
    ...over,
  };
}

const ok = <T,>(data: T) => ({ ok: true as const, data });

export const APPROVAL: Record<string, Resolution> = {
  'mark-served': { grant: 'allowed', scope: 'branch' },
  'take-order': { grant: 'allowed', scope: 'branch' },
  'void-item': { grant: 'requires_approval', approver_role_ids: ['R_MANAGER'], scope: 'branch' },
  'apply-comp': { grant: 'requires_approval', approver_role_ids: ['R_MANAGER'], scope: 'branch' },
};
export const ALLOWED: Record<string, Resolution> = { ...APPROVAL, 'void-item': { grant: 'allowed', scope: 'branch' } };

export type QueryFn = (path: string) => Promise<unknown>;
export type CommandFn = (type: string, payload: unknown, opts?: unknown) => Promise<unknown>;

export function voidShell(o: { perms?: Record<string, Resolution>; query?: QueryFn; command?: CommandFn; online?: boolean; phone?: boolean; portrait?: boolean; kiosk?: boolean; me?: string } = {}) {
  const live = createLiveBus();
  const query = vi.fn(o.query ?? (async () => ok({ previews: [] })));
  const command = vi.fn(o.command ?? (async () => ok({ pending: [] })));
  const roster = vi.fn(async () => ok({ staff: [{ staff_id: 'ST-ALI', display_name: 'Ali' }, { staff_id: 'ST-BILAL', display_name: 'Bilal' }], active_session: null }));
  const orders = { removeItems: vi.fn(async () => ok({ removed: [] })) };
  const shell = {
    device: { token: 'D', id: 'DEV', type: o.kiosk === true ? 'cashier_kiosk' : 'tablet' },
    live,
    orders,
    api: { command, query, roster },
    tables: { tableMap: vi.fn(async () => ok({ as_of_seq: 1, floors: [] })) },
    permissions: createPermissions(o.perms ?? APPROVAL),
    toasts: createToastBus(),
    enqueue: Object.assign(vi.fn(), { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} }),
    clock: { nowMs: () => NOW, utcOffsetMs: OFFSET },
    config: { snapshot: () => ({ items: [] }), config: () => null },
    me: { staff_id: o.me ?? 'ST-ALI', name: o.me === 'ST-BILAL' ? 'Bilal' : 'Ali' },
    online: o.online ?? true,
    phone: o.phone ?? false,
    portrait: o.portrait ?? false,
  } as unknown as Shell;
  return { shell, query, command, roster, orders };
}

export { ok };
export const apiError = (code: string, details: Record<string, unknown> = {}, status = 409) => ({ ok: false as const, error: { kind: 'api' as const, status, code, details } });
