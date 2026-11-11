import { z } from 'zod';
import { defineAlertKind, type AlertKindDef } from '../alerts/kinds.js';

// 02b v1.0.2 §6.13, verbatim: kinds `zone_stock_low` and `zone_stock_out` (§3.10 Alerts). Defined at the top level of
// this module; orders/index.ts imports it statically (server.ts -> orders/index.ts), so both kinds exist before boot
// replays the `alerts` projection (01d §3.5 / P-8). Raised with { stream_type: 'table', stream_id: 'zone:' + zone_id }
// (§6.19) by zone-alerts.ts.

export const ZoneStockAlertValues = z.object({
  zone_id: z.string().min(1),
  item_id: z.string().min(1),
  on_hand: z.number().int().min(0),
  threshold: z.number().int().min(0),
});
export type ZoneStockAlertValues = z.infer<typeof ZoneStockAlertValues>;

// §6.13: 'zone_stock_out' has the same shape as 'zone_stock_low'; only the kind and its labels differ.
function zoneStockKind(kind: 'zone_stock_low' | 'zone_stock_out'): AlertKindDef<ZoneStockAlertValues> {
  return {
    kind,
    family: 'info',
    subject: 'table',
    steps: [
      {
        at: { ms: 0 },
        to: [
          { target: 'raised_target', set: 'recipient' }, // { kind: 'permission', permission: 'manage-zone-stock' }
          { target: { kind: 'managers' }, set: 'recipient' }, // Z7 + owner Q5 (b)
        ],
      },
    ],
    closes_on: 'owner', // 02b closes 'done' when the count goes back above threshold
    values_schema: ZoneStockAlertValues,
    details_schema: null,
    lead_fallback: false,
    expires_at_day_close: true,
    silent: false,
    labels: { card: `alert.${kind}.card`, lock: `alert.${kind}.lock` },
    request: null,
  };
}

export const ZONE_STOCK_LOW = defineAlertKind(zoneStockKind('zone_stock_low'));
export const ZONE_STOCK_OUT = defineAlertKind(zoneStockKind('zone_stock_out'));
