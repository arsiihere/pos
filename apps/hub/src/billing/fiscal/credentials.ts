import { DomainError } from '@pos/domain';
import type { BranchConfig } from '@pos/events';
import { draftOf, FiscalTokenSet } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { defineQuery, queryRegistry, type QueryCtx } from '../../queries/registry.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { hubBilling } from '../defaults.js';
import { fiscalAdapterFor } from './port.js';

// 05 §6.28a (B22, OQ-3, H10-5, rows H-2 / H-4): SetFiscalToken — admin session, `manage-fiscal-settings`, not
// queueable, write-only. Upserts the named credential of a `pos_id` into the hub table `fiscal_credentials` (the
// worker reads it at its next send, §3.15) and appends `FiscalTokenSet` with ids and the time only. The token is never
// hashed (`hashOmit`), returned, logged, put in an event or echoed in an error; there is no read-back.
// Statements: the upsert (1); + the pending rows' adapters (1) only when `name` is not the branch adapter's.
// Handler statements per case (§6.28a "2" read as a maximum): bad `pos_id` 0; a branch adapter's name 1 (the upsert);
// a bad name 1 (the pending read, then 422); a pending row adapter's name 2 (the pending read + the upsert).
// 05 §6.28b (R-63): GET /admin/queries/fiscal-credentials — the /admin/fiscal/ page's list (pos_id × name, set_at or
// null); `manage-fiscal-settings` checked before any read; the read never selects the token. Statements: 2.

/** §6.28a: `token` 1–512 printable (ASCII 0x20–0x7E); the message names the rule, never the value. */
const PRINTABLE = /^[\x20-\x7E]+$/;

const Payload = z
  .object({
    pos_id: z.string().min(1).max(40),
    name: z.string().min(1).max(40).default('token'),
    token: z.string().min(1).max(512).regex(PRINTABLE, 'printable'),
  })
  .strict();

const PENDING_ADAPTERS = `SELECT DISTINCT adapter_key FROM fiscal_outbox WHERE state = 'pending'`;

const UPSERT = `INSERT INTO fiscal_credentials (pos_id, name, token, set_at, set_by_staff_id) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (pos_id, name) DO UPDATE SET token = excluded.token, set_at = excluded.set_at, set_by_staff_id = excluded.set_by_staff_id`;

export const setFiscalTokenCommand = defineCommand({
  commandType: 'SetFiscalToken',
  payloadSchema: Payload,
  sessionKind: 'admin',
  permission: 'manage-fiscal-settings',
  hashOmit: ['token'], // row H-4, H1-19: a retransmit that changes only the token is the same command
  // §6.30: the `FiscalTokenSet` WS audience ("admin sessions only") is task 33's; until then it reaches no socket.
  handle(ctx, p) {
    const config = branchConfig();
    const billing = config === null ? null : hubBilling(config);
    if (billing === null || !billing.settings.fiscal.pos_ids.some((x) => x.pos_id === p.pos_id)) {
      throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'pos_id', reason: 'not_found' });
    }
    const db = ctx.tx.db;
    const branchNames = fiscalAdapterFor(billing.jurisdiction.adapter_key)?.credentialNames ?? [];
    if (!branchNames.includes(p.name)) {
      const keys = db.prepare(PENDING_ADAPTERS).pluck().all() as string[]; // 1 (only off the branch adapter's names)
      if (!keys.some((key) => fiscalAdapterFor(key)?.credentialNames.includes(p.name) === true)) {
        throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'name', reason: 'not_found' });
      }
    }
    const set_at = ctx.clock.branchNow();
    const staff_id = ctx.actor.staffId!;
    db.prepare(UPSERT).run(p.pos_id, p.name, p.token, set_at, staff_id); // 1
    return {
      events: [
        draftOf(FiscalTokenSet, {
          stream_type: 'hub',
          stream_id: ctx.branch.branchId,
          payload: { pos_id: p.pos_id, name: p.name, set_at, set_by_staff_id: staff_id },
          occurred_at: set_at,
          actor_id: staff_id,
          device_id: ctx.actor.deviceId,
        }),
      ],
      result: { pos_id: p.pos_id, name: p.name, set_at },
    };
  },
});

/** §6.28b: one list entry (never the token). */
export interface FiscalCredentialEntry {
  pos_id: string;
  label: string;
  name: string;
  set_at: number | null;
}

const SET_TIMES = `SELECT pos_id, name, set_at FROM fiscal_credentials`; // never the token column

function requireManageFiscalSettings(ctx: QueryCtx): void {
  const staffId = ctx.session?.staff_id ?? null;
  const resolution = staffId === null ? { grant: 'not_granted' as const } : ctx.directory.resolve(staffId, 'manage-fiscal-settings');
  if (resolution.grant !== 'allowed') {
    throw new DomainError('PERMISSION_DENIED', { permission: 'manage-fiscal-settings', grant: resolution.grant });
  }
}

/** §6.28b, H11-4: pos_ids × (the branch adapter's names ∪ the pending rows' adapters' names), by pos_id, name (2). */
export function fiscalCredentialList(db: QueryCtx['db'], config: BranchConfig | null): FiscalCredentialEntry[] {
  if (config === null) return [];
  const billing = hubBilling(config);
  const keys = db.prepare(PENDING_ADAPTERS).pluck().all() as string[]; // 1
  const names = new Set(fiscalAdapterFor(billing.jurisdiction.adapter_key)?.credentialNames ?? []);
  for (const key of keys) for (const name of fiscalAdapterFor(key)?.credentialNames ?? []) names.add(name);
  const set = new Map<string, number>();
  for (const row of db.prepare(SET_TIMES).all() as Array<{ pos_id: string; name: string; set_at: number }>) { // 2
    set.set(`${row.pos_id}\u0000${row.name}`, row.set_at);
  }
  const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const sortedNames = [...names].sort(byCode);
  return [...billing.settings.fiscal.pos_ids]
    .sort((a, b) => byCode(a.pos_id, b.pos_id))
    .flatMap((p) => sortedNames.map((name) => ({ pos_id: p.pos_id, label: p.label, name, set_at: set.get(`${p.pos_id}\u0000${name}`) ?? null })));
}

export function registerSetFiscalToken(app: FastifyInstance): void {
  commandRegistry(app).register(setFiscalTokenCommand);
  queryRegistry(app).register(
    defineQuery({
      resource: 'fiscal-credentials',
      sessionKind: 'admin',
      session: 'none',
      countsAsActivity: false,
      querySchema: z.object({}),
      handle(ctx) {
        requireManageFiscalSettings(ctx);
        return { data: { credentials: fiscalCredentialList(ctx.db, ctx.branchConfig) } };
      },
    }),
  );
}
