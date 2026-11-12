import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Resolution } from '../auth/staff-directory.js';
import { screenStations } from '../kds/device-roles.js';
import { toPc437 } from '../print/escpos.js';
import { defineQuery, queryRegistry, type QueryCtx } from './registry.js';

// 03c §6.6, §3.2, §3.10 (task c20): GET /admin/queries/print-config — admin session, `manage-devices` checked inside
// handle. `{ printers, station_outputs, warnings }`. Statements 4 (printers + runtime, outputs, fold skips, waiting
// suspects) + memory: the config's stations and items, 03b's screen-station map (screenStations, b6).
// Warnings (§3.2):
// - `screen_unused`  a `printer` station that also has a screen paired;
// - `no_screen`      a `screen` station with a fallback printer but no paired screen (it never falls back to paper);
// - `lossy_name`     every name that can print at a station with a printer and loses characters in PC437: station
//   names; items whose home station, an alternate of it, or a zone-route target has a printer (station_id = home);
//   modifier option names of groups such items use, and deal names with such a part item (item_id = the option's /
//   deal's id, station_id null);
// - `fold_skipped`   every print_fold_skips row (§3.3: "the print-config page lists every skip");
// - `suspect_waiting` per station (or without one: a document) with suspect jobs not yet resolved.

export type PrintConfigWarning = { station_id?: string | null; item_id?: string; kind: 'lossy_name' | 'fold_skipped' | 'suspect_waiting' | 'screen_unused' | 'no_screen' };

const PRINTERS_SQL = `
SELECT p.printer_id, p.name, p.connection, p.address, p.paper_width_mm, p.archived_at, p.updated_at,
       r.supports_status, r.last_status, r.last_status_at, r.last_ack_at, r.last_error
  FROM printers p LEFT JOIN printer_runtime r ON r.printer_id = p.printer_id
 ORDER BY p.archived_at IS NOT NULL, p.name, p.printer_id`;
const OUTPUTS_SQL = 'SELECT station_id, mode, printer_id, show_taker, show_order_id FROM station_outputs';
const SKIPS_SQL = 'SELECT event_id, station_id FROM print_fold_skips ORDER BY at, event_id';
const SUSPECT_SQL = `SELECT DISTINCT station_id FROM print_jobs WHERE suspect_at IS NOT NULL AND suspect_resolved_at IS NULL`;

interface OutputRow {
  station_id: string;
  mode: 'screen' | 'both' | 'printer';
  printer_id: string | null;
  show_taker: number;
  show_order_id: number;
}

const lossy = (name: string): boolean => toPc437(name).lossy;

/** §3.2 lossy_name over every printable name (memory): items, modifier options, deals that can print at `printing`. */
function lossyNames(config: QueryCtx['branchConfig'], printing: ReadonlySet<string>): PrintConfigWarning[] {
  if (config === null || config === undefined || printing.size === 0) return [];
  const out: PrintConfigWarning[] = [];
  const alternates = new Map(config.stations.map((s) => [s.station_id, ((s as { alternates?: Array<{ station_id: string }> }).alternates ?? []).map((a) => a.station_id)]));
  const routed = new Map<string, string[]>();
  for (const floor of (config as { floors?: Array<{ zones?: Array<{ is_archived?: boolean; routes?: Array<{ item_id: string; station_id: string }> }> }> }).floors ?? []) {
    for (const zone of floor.zones ?? []) {
      if (zone.is_archived === true) continue;
      for (const r of zone.routes ?? []) routed.set(r.item_id, [...(routed.get(r.item_id) ?? []), r.station_id]);
    }
  }
  const prints = new Set<string>();
  for (const item of config.items) {
    const targets = [item.station_id, ...(alternates.get(item.station_id) ?? []), ...(routed.get(item.item_id) ?? [])];
    if (!targets.some((t) => printing.has(t))) continue;
    prints.add(item.item_id);
    if (lossy(item.name)) out.push({ station_id: item.station_id, item_id: item.item_id, kind: 'lossy_name' });
  }
  const groups = new Set(config.items.filter((i) => prints.has(i.item_id)).flatMap((i) => i.modifier_group_ids));
  for (const g of config.modifier_groups) {
    if (!groups.has(g.modifier_group_id)) continue;
    for (const o of g.options) if (lossy(o.name)) out.push({ station_id: null, item_id: o.option_id, kind: 'lossy_name' });
  }
  for (const d of config.deals) {
    if (d.parts.some((p) => p.choices.some((c) => prints.has(c.item_id))) && lossy(d.name)) out.push({ station_id: null, item_id: d.deal_id, kind: 'lossy_name' });
  }
  return out;
}

function requireManageDevices(ctx: QueryCtx): void {
  const staffId = ctx.session?.staff_id ?? null;
  const resolution: Resolution = staffId === null ? { grant: 'not_granted' } : ctx.directory.resolve(staffId, 'manage-devices');
  if (resolution.grant !== 'allowed') throw new DomainError('PERMISSION_DENIED', { permission: 'manage-devices', grant: resolution.grant });
}

export function registerPrintConfigQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'print-config',
      sessionKind: 'admin',
      session: 'none',
      countsAsActivity: false,
      querySchema: z.object({}),
      handle(ctx) {
        requireManageDevices(ctx);
        const printers = ctx.db.prepare(PRINTERS_SQL).all() as Array<Record<string, unknown>>;
        const outputs = new Map((ctx.db.prepare(OUTPUTS_SQL).all() as OutputRow[]).map((o) => [o.station_id, o]));
        const skips = ctx.db.prepare(SKIPS_SQL).all() as Array<{ event_id: string; station_id: string }>;
        const suspects = ctx.db.prepare(SUSPECT_SQL).pluck().all() as Array<string | null>;
        const screens = screenStations();
        const stations = (ctx.branchConfig?.stations ?? []).filter((s) => !s.is_archived);
        const station_outputs = stations.map((s) => {
          const o = outputs.get(s.station_id);
          return {
            station_id: s.station_id,
            name: s.name as string | null,
            mode: o?.mode ?? 'screen',
            printer_id: o?.printer_id ?? null,
            show_taker: o === undefined ? true : o.show_taker === 1,
            show_order_id: o === undefined ? true : o.show_order_id === 1,
            screen_paired: (screens.get(s.station_id)?.length ?? 0) > 0,
            archived: false,
          };
        });
        // an output row of an archived or unknown station still holds its printer (CONFIG_IN_USE on archive): listed too
        const active = new Set(stations.map((s) => s.station_id));
        const allStations = new Map((ctx.branchConfig?.stations ?? []).map((s) => [s.station_id, s.name]));
        for (const o of [...outputs.values()].sort((a, b) => (a.station_id < b.station_id ? -1 : a.station_id > b.station_id ? 1 : 0))) {
          if (active.has(o.station_id)) continue;
          station_outputs.push({
            station_id: o.station_id,
            name: allStations.get(o.station_id) ?? null,
            mode: o.mode,
            printer_id: o.printer_id,
            show_taker: o.show_taker === 1,
            show_order_id: o.show_order_id === 1,
            screen_paired: (screens.get(o.station_id)?.length ?? 0) > 0,
            archived: true,
          });
        }
        const warnings: PrintConfigWarning[] = [];
        const printing = new Set<string>();
        for (const s of station_outputs) {
          if (s.archived) continue;
          if (s.printer_id !== null) printing.add(s.station_id);
          if (s.mode === 'printer' && s.screen_paired) warnings.push({ station_id: s.station_id, kind: 'screen_unused' });
          if (s.mode === 'screen' && s.printer_id !== null && !s.screen_paired) warnings.push({ station_id: s.station_id, kind: 'no_screen' });
          if (s.printer_id !== null && s.name !== null && toPc437(s.name).lossy) warnings.push({ station_id: s.station_id, kind: 'lossy_name' });
        }
        warnings.push(...lossyNames(ctx.branchConfig, printing));
        for (const k of skips) warnings.push({ station_id: k.station_id, kind: 'fold_skipped' });
        for (const station_id of suspects) warnings.push(station_id === null ? { kind: 'suspect_waiting' } : { station_id, kind: 'suspect_waiting' });
        return { data: { printers, station_outputs, warnings } };
      },
    }),
  );
}
