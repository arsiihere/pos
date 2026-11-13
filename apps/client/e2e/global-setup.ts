import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Permission } from '@pos/domain';
import type { DirectoryInput, EventDraft } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { swapBranchConfig } from '../../hub/src/sync/branch-config-holder';
import { aDirectory } from '../../hub/test/helpers/fixtures';
import { createTestHub, pairDevice, seedDirectory, type TestHub } from '../../hub/test/helpers/test-hub';

// W0.7 (Q-32): one hub for the whole run — a provisioned test hub (in-memory clock, SQLite under TMPDIR), the
// fixture staff directory and branch config, one paired tablet; it serves the built /staff/ (run the client
// build first: `pnpm test:e2e` does). The specs read where it listens from POS_E2E_HUB (a JSON file).

export interface E2eDevice {
  token: string;
  device_id: string;
  device_type: 'tablet';
}

export interface E2eHub {
  baseURL: string;
  /** the first paired tablet (W0.7 smoke) */
  device: E2eDevice;
  /** two more tablets, for flows that need two people signed in at once (02a flows) */
  device2: E2eDevice;
  device3: E2eDevice;
  tenant_id: string;
  branch_id: string;
}

/** 02a flows: tables the specs take one by one (a flow never reuses a table another run left seated). */
export const FLOOR_SIZE = 60;
const pad = (n: number) => String(n).padStart(3, '0');
export const TABLE_POOL: string[] = [
  ...Array.from({ length: FLOOR_SIZE }, (_, i) => `G${pad(i + 1)}`),
  ...Array.from({ length: FLOOR_SIZE }, (_, i) => `R${pad(i + 1)}`),
];
export const FLOWS = ['map', 'busy', 'handover', 'tables', 'call', 'offline'] as const;
export type Flow = (typeof FLOWS)[number];
export const PROJECTS = ['tablet-landscape', 'tablet-portrait', 'kiosk', 'phone-390', 'phone-360'] as const;
export const LANG_CODES = ['en', 'ur'] as const;

/** Two tables nobody else uses: [flow, project, language] picks the pair, so runs never meet. */
export function tablePair(flow: Flow, project: string, lang: string): [string, string] {
  const slot = (FLOWS.indexOf(flow) * PROJECTS.length + PROJECTS.indexOf(project as (typeof PROJECTS)[number])) * LANG_CODES.length + LANG_CODES.indexOf(lang as 'en' | 'ur');
  return [TABLE_POOL[slot * 2]!, TABLE_POOL[slot * 2 + 1]!];
}

function grant(permission: Permission) {
  return { permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope: 'branch' as const };
}

/** The fixture directory plus an order-taker role (take-order, clean-table, mark-served) and two people with it, PIN 1234: Ali and Sara; and Bilal, a waiter (the fixture's order-taker role, no take-order) who reports to Ali: a call from Ali's table reaches him (02a §3.13). */
async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const owner = base.staff.find((p) => p.staff_id === 'S_OWNER')!;
  const person = (staff_id: string, display_name: string) => ({ ...owner, staff_id, display_name, role_ids: ['R_TAKER'] });
  const taker = { role_id: 'R_TAKER', name: 'Waiter', session_idle_ttl_ms: 3_600_000, permissions: [grant('take-order'), grant('clean-table'), grant('mark-served')] };
  const waiter = { ...person('S_BILAL', 'Bilal'), role_ids: ['R_WAIT'], lead_staff_id: 'S_ALI' };
  return { ...base, roles: [...base.roles, taker], staff: [...base.staff, person('S_ALI', 'Ali'), person('S_SARA', 'Sara'), waiter] };
}

/** Two floors with 60 tables each (G001…, R001…), each in a zone. */
function floors() {
  const floor = (floor_id: string, name: string, prefix: string, sort_order: number) => ({
    floor_id,
    name,
    sort_order,
    zones: [{ zone_id: `Z-${floor_id}`, name, sort_order: 0, is_archived: false, routes: [], stock_items: [] }],
    tables: Array.from({ length: FLOOR_SIZE }, (_, i) => ({ table_id: `${prefix}${pad(i + 1)}`, name: `${prefix}${pad(i + 1)}`, seats: 4, sort_order: i, zone_id: `Z-${floor_id}` })),
  });
  return [floor('FL-G', 'Ground floor', 'G', 0), floor('FL-R', 'Rooftop', 'R', 1)];
}


/** The offline flow needs a table with an order (Ask for bill) and one waiting for cleaning (Clean); the 02b ordering
 * screen is a stub, so they are seeded as events, as the hub's own table tests do. */
function seedOfflineTables(hub: TestHub): void {
  const draft = (stream_type: 'table' | 'order', stream_id: string, event_type: string, payload: Record<string, unknown>): EventDraft =>
    ({ stream_type, stream_id, event_type, schema_version: 1, payload, occurred_at: hub.clock.branchNow(), actor_id: 'S_ALI', device_id: 'D_SEED' }) as EventDraft;
  const append = (d: EventDraft) => {
    hub.clock.advance(1_000);
    hub.deps.writer.run((tx) => tx.append([d]));
  };
  for (const project of PROJECTS) {
    for (const lang of LANG_CODES) {
      const [ordered, dirty] = tablePair('offline', project, lang);
      const open = (table_id: string, seating_id: string) =>
        append(draft('table', table_id, 'TableOpened', { table_id, seating_id, holder_staff_id: 'S_ALI', party_size: 2 }));
      open(ordered, `seat-${ordered}`);
      const T = hub.clock.branchNow();
      append(
        draft('order', `order-${ordered}`, 'OrderPlaced', {
          order_id: `order-${ordered}`,
          order_type: 'dine_in',
          table_id: null,
          table_key: `dine_in:seat-${ordered}`,
          follow_up: false,
          pickup_at_ms: null,
          order_item_ids: [`order-${ordered}-L1`],
          groups: [{ group_id: `order-${ordered}:0`, target_land_ms: T + 600_000, promise_ms: T + 900_000, order_item_ids: [`order-${ordered}-L1`] }],
          lines: [],
        }),
      );
      open(dirty, `seat-${dirty}`);
      append(draft('table', dirty, 'BillClosed', { seating_id: `seat-${dirty}` }));
    }
  }
}

/** A free local port: the hub checks Host = advertised_host:http_port (00 host guard), so it is fixed before boot. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const port = await freePort();
  const hub = await createTestHub({ config: { advertised_host: '127.0.0.1', http_port: port } });
  await seedDirectory(hub, await directory());
  swapBranchConfig({ config: aBranchConfig({ floors: floors() }), snapshotHash: 'e'.repeat(64), configVersion: 1, snapshotSchemaVersion: 4, appliedAt: 0 });
  seedOfflineTables(hub);
  const tablet = pairDevice(hub, { type: 'tablet', name: 'Tablet e2e' });
  const tablet2 = pairDevice(hub, { type: 'tablet', name: 'Tablet e2e 2' });
  const tablet3 = pairDevice(hub, { type: 'tablet', name: 'Tablet e2e 3' });
  const dev = (d: { token: string; deviceId: string }): E2eDevice => ({ token: d.token, device_id: d.deviceId, device_type: 'tablet' });
  await hub.app.listen({ host: '127.0.0.1', port });
  const info: E2eHub = { baseURL: `http://127.0.0.1:${port}`, device: dev(tablet), device2: dev(tablet2), device3: dev(tablet3), tenant_id: 'tenant-a', branch_id: 'branch-1' };
  const file = join(tmpdir(), `pos-e2e-hub-${process.pid}.json`);
  writeFileSync(file, JSON.stringify(info));
  process.env['POS_E2E_HUB'] = file;
  return async () => {
    await hub.close();
  };
}
