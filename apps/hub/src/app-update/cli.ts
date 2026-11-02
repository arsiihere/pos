/// <reference types="node" />
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadHubConfig } from '../config/load.js';
import { DEFAULT_CONFIG_PATH } from '../config/schema.js';
import { openDb } from '../db/connection.js';
import { apkDir, apkPath } from './routes.js';

const USAGE =
  'usage: app-release add <apk> --version-code N --version-name X --stage <device_id> | app-release mark-good <version_code>';

// §6.38: the newest 2 good versions are kept, plus the staged one.
const KEEP_GOOD = 2;

/** 00 v1.6 §6.38 (H-5): stages and marks tablet app releases in `app_releases`; no event, logged here. */
export async function runAppRelease(o: {
  configPath: string;
  args: string[];
  wallNow: () => number;
  out: NodeJS.WritableStream;
}): Promise<void> {
  const config = loadHubConfig(o.configPath);
  const { positionals, values } = parseArgs({
    args: o.args,
    allowPositionals: true,
    options: {
      'version-code': { type: 'string' },
      'version-name': { type: 'string' },
      stage: { type: 'string' },
    },
  });
  const [command, target, ...rest] = positionals;
  if (rest.length > 0 || target === undefined) throw new Error(USAGE);
  const db = openDb(join(config.data_dir, 'hub.sqlite'));
  try {
    if (command === 'add') {
      const versionCode = versionCodeOf(values['version-code']);
      const versionName = values['version-name'];
      const stage = values.stage;
      if (versionName === undefined || versionName.length === 0)
        throw new Error(`--version-name is required; ${USAGE}`);
      if (stage === undefined || stage.length === 0) throw new Error(`--stage is required; ${USAGE}`);
      add(db, config.data_dir, {
        apk: target,
        versionCode,
        versionName,
        stage,
        now: o.wallNow(),
        out: o.out,
      });
      return;
    }
    if (command === 'mark-good') {
      const versionCode = versionCodeOf(target);
      const changed = db
        .prepare('UPDATE app_releases SET staged_device_id = NULL WHERE version_code = ?')
        .run(versionCode);
      if (changed.changes === 0) throw new Error(`unknown version_code ${versionCode}`);
      o.out.write(`app-release mark-good ${versionCode}: released to every tablet\n`);
      return;
    }
    throw new Error(USAGE);
  } finally {
    db.close();
  }
}

function add(
  db: ReturnType<typeof openDb>,
  dataDir: string,
  o: {
    apk: string;
    versionCode: number;
    versionName: string;
    stage: string;
    now: number;
    out: NodeJS.WritableStream;
  },
): void {
  const sha256 = createHash('sha256').update(readFileSync(o.apk)).digest('hex');
  mkdirSync(apkDir(dataDir), { recursive: true });
  const final = apkPath(dataDir, o.versionCode);
  const temp = `${final}.tmp`;
  copyFileSync(o.apk, temp);
  let renamed = false;
  let removed: number[];
  try {
    removed = db
      .transaction(() => {
        const exists = db.prepare('SELECT 1 FROM app_releases WHERE version_code = ?').get(o.versionCode);
        if (exists !== undefined) throw new Error(`version_code ${o.versionCode} already exists`);
        // The file is in place before the row is visible to `latest`.
        renameSync(temp, final);
        renamed = true;
        db.prepare(
          'INSERT INTO app_releases (version_code, version_name, sha256, staged_device_id, added_at) VALUES (?, ?, ?, ?, ?)',
        ).run(o.versionCode, o.versionName, sha256, o.stage, o.now);
        const rows = db
          .prepare('SELECT version_code, staged_device_id FROM app_releases ORDER BY version_code DESC')
          .all() as Array<{
          version_code: number;
          staged_device_id: string | null;
        }>;
        const keep = new Set<number>([o.versionCode]);
        for (const row of rows.filter((r) => r.staged_device_id === null).slice(0, KEEP_GOOD))
          keep.add(row.version_code);
        const drop = rows.map((r) => r.version_code).filter((code) => !keep.has(code));
        const remove = db.prepare('DELETE FROM app_releases WHERE version_code = ?');
        for (const code of drop) remove.run(code);
        return drop;
      })
      .immediate();
  } catch (error) {
    rmSync(renamed ? final : temp, { force: true });
    throw error;
  }
  for (const code of removed) rmSync(apkPath(dataDir, code), { force: true });
  o.out.write(
    `app-release add ${o.versionCode} (${o.versionName}) staged to ${o.stage}; sha256 ${sha256}` +
      (removed.length > 0 ? `; removed ${removed.join(', ')}` : '') +
      '\n',
  );
}

function versionCodeOf(raw: string | undefined): number {
  const code = raw === undefined || !/^[1-9]\d{0,14}$/.test(raw) ? Number.NaN : Number(raw);
  if (!Number.isSafeInteger(code)) throw new Error(`--version-code must be a positive integer; ${USAGE}`);
  return code;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  runAppRelease({
    configPath: process.env.POS_HUB_CONFIG ?? DEFAULT_CONFIG_PATH,
    args: process.argv.slice(2),
    wallNow: Date.now,
    out: process.stdout,
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'app-release failed';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
