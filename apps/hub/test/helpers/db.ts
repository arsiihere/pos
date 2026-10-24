import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/connection';

export function freshDb(): { db: ReturnType<typeof openDb>; path: string; dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-hub-'));
  const path = join(dir, 'hub.sqlite');
  const db = openDb(path);
  return {
    db,
    path,
    dir,
    cleanup(): void {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
