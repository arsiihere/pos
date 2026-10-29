import {
  BranchConfigSnapshotSchemaV1,
  CONFIG_POLL_INTERVAL_MS,
  SNAPSHOT_SCHEMA_VERSION,
  SyncConfigEnvelopeSchema,
  type BranchConfigV1,
  type DirectoryInput,
  type EventDraft,
} from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { applyStaffDirectory } from '../auth/apply-directory.js';
import type { StaffDirectory } from '../auth/staff-directory.js';
import { isConfirmed, isProvisioned, type HubConfig } from '../config/schema.js';
import type { Writer } from '../engine-host/writer.js';
import type { Clock } from '../lib/clock.js';
import { canonicalJson, sha256hex } from '../lib/hash.js';
import { readBranchConfigRow } from '../projections/branch-config.js';
import { branchConfig, runBranchConfigHooks, swapBranchConfig, type ConfigEntry } from './branch-config-holder.js';
import type { ConfigClient } from './config-client.js';

export type PollOutcome = 'applied' | 'unchanged' | 'offline' | 'rejected' | 'unauthorized' | 'not_ready';
export type RejectReason = 'malformed' | 'hash_mismatch' | 'schema_unsupported' | 'schema_invalid' | 'apply_failed';

export interface PollProblem {
  outcome: 'rejected' | 'unauthorized';
  reason: RejectReason | null;
  at: number;
}

export interface PollResult {
  outcome: PollOutcome;
  at: number;
  config_version?: number;
  directory_version?: number;
  reason?: RejectReason;
}

export interface ConfigPoller {
  pollOnce(): Promise<PollResult>;
  lastPoll(): { outcome: PollOutcome; at: number } | null;
  lastProblem(): PollProblem | null;
  // §7.2: boot step 6 starts the 60 s timer; shutdown stops it. A stopped poller never polls again.
  start(): void;
  stop(): void;
}

export interface ConfigPollerDeps {
  config: HubConfig;
  db: Database.Database;
  writer: Writer;
  clock: Clock;
  client: ConfigClient;
  setDirectory: (d: StaffDirectory) => void;
  // 00's applyStaffDirectory unless a test forces the directory part to fail (S43).
  applyDirectory?: typeof applyStaffDirectory;
  log: Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn' | 'error'>;
}

// §12.4: above this many items the hash and parse should move off the main thread.
const LARGE_SNAPSHOT_ITEMS = 1_000;
const MSG = 'config poll';

interface ConfigPart {
  raw: Record<string, unknown>;
  hash: string;
  config: BranchConfigV1;
}

const pollers = new WeakMap<FastifyInstance, ConfigPoller>();

export function bindConfigPoller(app: FastifyInstance, poller: ConfigPoller): void {
  pollers.set(app, poller);
}

export function configPoller(app: FastifyInstance): ConfigPoller {
  const poller = pollers.get(app);
  if (poller === undefined) throw new Error('config poller is not bound');
  return poller;
}

export function createConfigPoller(deps: ConfigPollerDeps): ConfigPoller {
  let inFlight: Promise<PollResult> | null = null;
  let last: { outcome: PollOutcome; at: number } | null = null;
  let problem: PollProblem | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const applyDirectory = deps.applyDirectory ?? applyStaffDirectory;

  function finish(result: PollResult): PollResult {
    last = { outcome: result.outcome, at: result.at };
    const fields = {
      outcome: result.outcome,
      ...(result.reason !== undefined ? { reason: result.reason } : {}),
      ...(result.config_version !== undefined ? { config_version: result.config_version } : {}),
      ...(result.directory_version !== undefined ? { directory_version: result.directory_version } : {}),
    };
    if (result.outcome === 'unchanged') deps.log.debug(fields, MSG);
    else if (result.outcome === 'rejected' || result.outcome === 'unauthorized') deps.log.error(fields, MSG);
    else deps.log.info(fields, MSG);
    return result;
  }

  function reject(reason: RejectReason, at: number): void {
    problem = { outcome: 'rejected', reason, at };
  }

  async function poll(): Promise<PollResult> {
    const provisioned = deps.config.provisioned;
    if (provisioned === undefined || !isProvisioned(deps.config) || !isConfirmed(deps.config)) {
      return finish({ outcome: 'not_ready', at: deps.clock.branchNow() });
    }
    const branchId = provisioned.branch_id;
    const currentConfig = currentConfigVersion(deps.db, branchId);
    const currentDirectory = currentDirectoryVersion(deps.db);
    const fetched = await deps.client.fetchConfig({ config_version: currentConfig, directory_version: currentDirectory });
    // §7.2: a result that lands after stop() is dropped: nothing written, nothing swapped, nothing recorded.
    if (stopped) return { outcome: 'offline', at: deps.clock.branchNow() };
    // One reading per poll, so last_problem.at and lastPoll().at agree.
    const now = deps.clock.branchNow();
    if (fetched.kind === 'offline') return finish({ outcome: 'offline', at: now });
    if (fetched.kind === 'not_modified') {
      problem = null;
      return finish({ outcome: 'unchanged', at: now });
    }
    if (fetched.kind === 'error') {
      if (fetched.status === 401) {
        problem = { outcome: 'unauthorized', reason: null, at: now };
        return finish({ outcome: 'unauthorized', at: now });
      }
      deps.log.error({ status: fetched.status, code: fetched.code }, 'config poll refused by the cloud');
      return finish({ outcome: 'offline', at: now });
    }

    // Step 4: envelope, then (i) raw hash, (ii) schema version, (iii) Zod, (iv) forward only (S28 d).
    let json: unknown;
    try {
      json = JSON.parse(fetched.text);
    } catch {
      deps.log.error({ issues: [{ path: '', code: 'invalid_json' }] }, 'config poll envelope malformed');
      reject('malformed', now);
      return finish({ outcome: 'rejected', reason: 'malformed', at: now });
    }
    const envelope = SyncConfigEnvelopeSchema.safeParse(json);
    if (!envelope.success) {
      const issues = envelope.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code }));
      deps.log.error({ issues }, 'config poll envelope malformed');
      reject('malformed', now);
      return finish({ outcome: 'rejected', reason: 'malformed', at: now });
    }
    const { config: wire, directory } = envelope.data.data;
    let configRejected: RejectReason | null = null;
    let part: ConfigPart | null = null;
    if (wire !== null) {
      const checked = checkConfig(wire.snapshot, wire.snapshot_hash);
      if ('reason' in checked) configRejected = checked.reason;
      else if (checked.config.config_version > currentConfig) part = checked;
    }
    const directoryPart: DirectoryInput | null =
      directory !== null && directory.directory_version > currentDirectory ? directory : null;
    if (configRejected !== null) reject(configRejected, now);
    if (part === null && directoryPart === null) {
      if (configRejected !== null) return finish({ outcome: 'rejected', reason: configRejected, at: now });
      problem = null;
      return finish({ outcome: 'unchanged', at: now });
    }
    // §7.3: the rejected config part is logged at error even though the directory part goes on to apply.
    if (configRejected !== null) deps.log.error({ outcome: 'rejected', reason: configRejected }, MSG);
    if (part !== null && part.config.items.length > LARGE_SNAPSHOT_ITEMS) {
      deps.log.warn({ items: part.config.items.length }, 'config snapshot above the off-thread trigger (§12.4)');
    }

    // Step 5: one writer.run for both parts.
    try {
      deps.writer.run((tx) => {
        if (part !== null) applyConfigPart(tx, part, branchId);
        if (directoryPart !== null) applyDirectory(tx, directoryPart, deps.setDirectory);
      });
    } catch (error) {
      // S43: visible problem, then each part alone, the directory first.
      deps.log.error({ err: error }, 'config apply failed');
      reject('apply_failed', now);
      let directoryVersion = currentDirectory;
      let configVersion = currentConfig;
      if (directoryPart !== null) {
        try {
          deps.writer.run((tx) => {
            applyDirectory(tx, directoryPart, deps.setDirectory);
          });
          directoryVersion = directoryPart.directory_version;
        } catch (partError) {
          deps.log.error({ err: partError, part: 'directory' }, 'config apply failed');
        }
      }
      if (part !== null) {
        try {
          deps.writer.run((tx) => {
            applyConfigPart(tx, part, branchId);
          });
          configVersion = part.config.config_version;
        } catch (partError) {
          deps.log.error({ err: partError, part: 'config' }, 'config apply failed');
        }
      }
      return finish({
        outcome: 'rejected',
        reason: 'apply_failed',
        at: now,
        config_version: configVersion,
        directory_version: directoryVersion,
      });
    }
    // Step 6.
    if (configRejected === null) problem = null;
    return finish({
      outcome: 'applied',
      at: now,
      config_version: part?.config.config_version ?? currentConfig,
      directory_version: directoryPart?.directory_version ?? currentDirectory,
    });
  }

  function applyConfigPart(tx: Parameters<Parameters<Writer['run']>[0]>[0], part: ConfigPart, branchId: string): void {
    const previous = readBranchConfigRow(tx.db, branchId);
    tx.db
      .prepare(
        `INSERT OR IGNORE INTO config_snapshots (snapshot_hash, config_version, body, received_at) VALUES (?, ?, ?, ?)`,
      )
      .run(part.hash, part.config.config_version, canonicalJson(part.raw), tx.clock.branchNow());
    const draft: EventDraft = {
      stream_type: 'hub',
      stream_id: branchId,
      event_type: 'BranchConfigApplied',
      schema_version: 1,
      payload: {
        config_version: part.config.config_version,
        snapshot_schema_version: part.config.snapshot_schema_version,
        snapshot_hash: part.hash,
        previous_config_version: previous?.config_version ?? null,
      },
      occurred_at: tx.clock.branchNow(),
      actor_id: null,
      device_id: 'hub',
    };
    const [event] = tx.append([draft]);
    runBranchConfigHooks(branchConfig(), part.config, tx);
    const entry: ConfigEntry = {
      config: part.config,
      snapshotHash: part.hash,
      configVersion: part.config.config_version,
      snapshotSchemaVersion: part.config.snapshot_schema_version,
      appliedAt: event!.recorded_at,
    };
    tx.onCommit(() => {
      swapBranchConfig(entry);
    });
  }

  function pollOnce(): Promise<PollResult> {
    if (inFlight !== null) return inFlight;
    if (stopped) return Promise.resolve(last ?? { outcome: 'not_ready', at: deps.clock.branchNow() });
    const running = poll().finally(() => {
      inFlight = null;
    });
    inFlight = running;
    return running;
  }

  return {
    pollOnce,
    lastPoll: () => last,
    lastProblem: () => problem,
    start() {
      if (stopped || timer !== null) return;
      timer = setInterval(() => {
        void pollOnce();
      }, CONFIG_POLL_INTERVAL_MS);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      stopped = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}

function checkConfig(raw: Record<string, unknown>, snapshotHash: string): ConfigPart | { reason: RejectReason } {
  const hash = sha256hex(canonicalJson(raw));
  if (hash !== snapshotHash) return { reason: 'hash_mismatch' };
  if (raw.snapshot_schema_version !== SNAPSHOT_SCHEMA_VERSION) return { reason: 'schema_unsupported' };
  const parsed = BranchConfigSnapshotSchemaV1.safeParse(raw);
  if (!parsed.success) return { reason: 'schema_invalid' };
  return { raw, hash, config: parsed.data };
}

// §3.4 step 2: 0 when there is no row, no stored body, or the row's schema is not ours (S5, S28 b).
function currentConfigVersion(db: Database.Database, branchId: string): number {
  const row = readBranchConfigRow(db, branchId);
  if (row === undefined || row.snapshot_schema_version !== SNAPSHOT_SCHEMA_VERSION) return 0;
  const body = db.prepare('SELECT 1 FROM config_snapshots WHERE snapshot_hash = ?').get(row.snapshot_hash);
  return body === undefined ? 0 : row.config_version;
}

function currentDirectoryVersion(db: Database.Database): number {
  const row = db.prepare('SELECT directory_version FROM staff_directory_meta').get() as
    | { directory_version: number }
    | undefined;
  return row?.directory_version ?? 0;
}
