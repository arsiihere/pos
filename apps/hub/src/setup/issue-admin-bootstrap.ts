/// <reference types="node" />
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyEvent, initialEngineState, type EngineState } from '@pos/engine';
import QRCode from 'qrcode';
import { issueAdminBootstrap } from '../auth/bootstrap-tokens.js';
import { loadHubConfig } from '../config/load.js';
import { DEFAULT_CONFIG_PATH, isProvisioned } from '../config/schema.js';
import { openDb } from '../db/connection.js';
import { createAuthGeneration } from '../engine-host/auth-generation.js';
import { createStateHolder } from '../engine-host/state-holder.js';
import { createWriter } from '../engine-host/writer.js';
import { createBranchClock } from '../lib/clock.js';
import { ulidGen } from '../lib/ids.js';
import { cryptoSecrets } from '../lib/secrets.js';
import { registerAccessReconcile } from '../projections/access-reconcile.js';
import { createProjectionRegistry } from '../projections/registry.js';

export async function runIssueAdminBootstrap(o: {
  configPath: string;
  wallNow: () => number;
  monoNow: () => number;
  uid: number;
  out: NodeJS.WritableStream;
}): Promise<{ url: string; expires_at: number }> {
  const config = loadHubConfig(o.configPath);
  if (!isProvisioned(config) || config.provisioned === undefined || config.advertised_host === undefined) {
    throw new Error('run setup instead');
  }
  if (o.uid !== statSync(config.data_dir).uid) throw new Error(`refusing to run as uid ${o.uid}`);
  const db = openDb(join(config.data_dir, 'hub.sqlite'));
  try {
    const row = db
      .prepare('SELECT recorded_at FROM events WHERE branch_id = ? ORDER BY seq DESC LIMIT 1')
      .get(config.provisioned.branch_id) as { recorded_at: number } | undefined;
    const { clock } = createBranchClock({
      wallNow: o.wallNow,
      monoNow: o.monoNow,
      lastRecordedAt: row?.recorded_at ?? o.wallNow(),
    });
    const ids = ulidGen(clock);
    const projections = createProjectionRegistry();
    const state = createStateHolder<EngineState>(initialEngineState());
    state.setReducer((s, e) => applyEvent(s, e, { strict: false }));
    const writer = createWriter({
      db,
      clock,
      ids,
      tenantId: config.provisioned.tenant_id,
      branchId: config.provisioned.branch_id,
      projections,
      state,
      authGeneration: createAuthGeneration(),
      publish: () => undefined,
    });
    registerAccessReconcile({ projections, writer, clock });
    const issued = writer.run((tx) => issueAdminBootstrap(tx, 'cli', { clock, ids, secrets: cryptoSecrets })).result;
    const url = `http://${config.advertised_host}:${config.http_port}/admin/bootstrap#t=${issued.token}`;
    const qr = await QRCode.toString(url, { type: 'terminal', small: true });
    o.out.write(`${url}\n${new Date(issued.expires_at).toISOString()}\n${qr}`);
    return { url, expires_at: issued.expires_at };
  } finally {
    db.close();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  runIssueAdminBootstrap({
    configPath: process.env.POS_HUB_CONFIG ?? DEFAULT_CONFIG_PATH,
    wallNow: Date.now,
    monoNow: () => performance.now(),
    uid: process.getuid!(),
    out: process.stdout,
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'issue-admin-bootstrap failed';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
