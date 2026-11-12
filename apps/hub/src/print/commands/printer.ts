import { DomainError } from '@pos/domain';
import { PrinterSaved, draftOf } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';

// 03c §3.2, §6.2 (task c5): SavePrinter (admin, manage-devices, §3.10). Writes PrinterSaved on hub / branch_id.
// Statements: 1 per call (the active-name read on a save, the in-use read on an archive; §6.2 bounds it at 2).

const LAN_PORT_DEFAULT = 9100;
const USB_PATH = /^(?:\/dev\/usb\/lp[0-9]|\/dev\/pos-printer-[a-z0-9-]{1,30})$/;

/** §3.2, §7: IPv4 in 10/8, 172.16/12, 192.168/16 only (no sockets to the internet). */
function privateIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^(?:0|[1-9][0-9]{0,2})$/.test(p) && Number(p) <= 255)) return false;
  const [a, b] = parts.map(Number) as [number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** `host` or `host:port` → `host:port` (port default 9100), or null when it is not a private IPv4 with a valid port. */
export function lanAddress(address: string): string | null {
  const match = /^([0-9.]+)(?::([0-9]{1,5}))?$/.exec(address);
  if (match === null || !privateIpv4(match[1]!)) return null;
  const port = match[2] === undefined ? LAN_PORT_DEFAULT : Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || (match[2] !== undefined && match[2] !== String(port))) return null;
  return `${match[1]!}:${port}`;
}

const Payload = z
  .object({
    /** absent = a new printer (the hub picks the id); present = that printer, saved as given */
    printer_id: z.string().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(40),
    connection: z.enum(['lan', 'usb']),
    address: z.string().min(1).max(64),
    paper_width_mm: z.union([z.literal(58), z.literal(80)]),
    archived: z.boolean().default(false),
  })
  .superRefine((p, rc) => {
    const ok = p.connection === 'lan' ? lanAddress(p.address) !== null : USB_PATH.test(p.address);
    if (!ok) {
      rc.addIssue({
        code: 'custom',
        path: ['address'],
        message: p.connection === 'lan' ? 'private IPv4 host[:port] (10/8, 172.16/12, 192.168/16)' : '/dev/usb/lp[0-9] or /dev/pos-printer-<name>',
      });
    }
  });

export const savePrinterCommand = defineCommand({
  commandType: 'SavePrinter',
  payloadSchema: Payload,
  sessionKind: 'admin',
  permission: 'manage-devices',
  handle(ctx, payload) {
    const printer_id = payload.printer_id ?? ctx.ids.next();
    const db = ctx.tx.db;
    if (payload.archived) {
      // §3.2: archive refused while a station output uses it (any mode: `screen` keeps it as its fallback printer).
      // Any output row holds it, also one of a station archived in (or missing from) the branch config, with or without
      // a config in memory (integrator review, replaces R-c5-2).
      const users = db.prepare('SELECT station_id FROM station_outputs WHERE printer_id = ? ORDER BY station_id').pluck().all(printer_id) as string[];
      if (users.length > 0) {
        throw new DomainError('CONFIG_IN_USE', { entity: 'printer', id: printer_id, used_by: { entity: 'station', ids: users } });
      }
    } else {
      const taken = db
        .prepare('SELECT 1 FROM printers WHERE name = ? AND archived_at IS NULL AND printer_id <> ?')
        .pluck()
        .get(payload.name, printer_id);
      if (taken !== undefined) throw new DomainError('CONFIG_NAME_TAKEN', { entity: 'printer', name: payload.name });
    }
    const saved = {
      printer_id,
      name: payload.name,
      connection: payload.connection,
      address: payload.connection === 'lan' ? lanAddress(payload.address)! : payload.address,
      paper_width_mm: payload.paper_width_mm,
      archived: payload.archived,
    };
    const event = draftOf(PrinterSaved, {
      stream_type: 'hub',
      stream_id: ctx.branch.branchId,
      payload: saved,
      occurred_at: ctx.clock.branchNow(),
      actor_id: ctx.actor.staffId,
      device_id: ctx.actor.deviceId,
    });
    return { events: [event], result: { printer: saved } };
  },
});

export function registerSavePrinter(app: FastifyInstance): void {
  commandRegistry(app).register(savePrinterCommand);
}
