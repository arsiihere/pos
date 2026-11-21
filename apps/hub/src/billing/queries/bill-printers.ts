// 05 §6.23a `GET /queries/bill-printers` (task 27; G-28 / R-27, 05 v1.0.5): the staff Print to picker's list (§8 Print
// status, B18). `take-order` with any grant (a read cannot be approved: `allowed` and `requires_approval` both read, as
// 04 §6.3 `void-preview`); printers are branch-wide, so every scope reads the whole list and there is no out-of-scope
// refusal. Staff session only (00's auth refuses a station or admin session). The branch's active printers
// `{ printer_id, name }` by name, no address, connection or status. 1 statement whatever their number.
import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineQuery, queryRegistry } from '../../queries/registry.js';

const ACTIVE_PRINTERS = 'SELECT printer_id, name FROM printers WHERE archived_at IS NULL ORDER BY name';

export interface BillPrinters {
  printers: Array<{ printer_id: string; name: string }>;
}

export function registerBillPrintersQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'bill-printers',
      sessionKind: 'device',
      session: 'required',
      querySchema: z.object({}).strict(),
      handle(ctx) {
        const staffId = ctx.session?.staff_id ?? null;
        const grant = staffId === null ? 'not_granted' : ctx.directory.resolve(staffId, 'take-order').grant;
        if (grant !== 'allowed' && grant !== 'requires_approval') throw new DomainError('PERMISSION_DENIED', { permission: 'take-order', grant });
        const data: BillPrinters = { printers: ctx.db.prepare(ACTIVE_PRINTERS).all() as BillPrinters['printers'] };
        return { data };
      },
    }),
  );
}
