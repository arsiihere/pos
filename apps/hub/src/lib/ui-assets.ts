/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';

// M81: the kit is read once; only listed .css / .woff2 files are servable, so no request path can leave it.
const KIT_DIR = fileURLToPath(new URL('../../../../packages/ui-kit/', import.meta.url));
const TYPES: Record<string, string> = { '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2' };
const CACHE = 'public, max-age=31536000, immutable';

interface Asset {
  type: string;
  body: Buffer;
}

let assets: Map<string, Asset> | undefined;
let version: string | undefined;

function load(): Map<string, Asset> {
  if (assets !== undefined) return assets;
  const found = new Map<string, Asset>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      const dot = entry.name.lastIndexOf('.');
      const type = dot === -1 ? undefined : TYPES[entry.name.slice(dot)];
      if (type === undefined) continue;
      found.set(relative(KIT_DIR, path).split(sep).join('/'), { type, body: readFileSync(path) });
    }
  };
  walk(KIT_DIR);
  assets = found;
  return found;
}

// Pages add ?v=<this> to the stylesheet URLs so a hub update reaches browsers that cached for a year.
export function uiVersion(): string {
  if (version !== undefined) return version;
  const kit = load();
  const hash = createHash('sha256');
  for (const name of ['tokens.css', 'components/bundle.css']) {
    const asset = kit.get(name);
    if (asset === undefined) throw new Error(`ui kit is missing ${name}`);
    hash.update(asset.body);
  }
  version = hash.digest('hex').slice(0, 12);
  return version;
}

export function registerUiAssets(app: FastifyInstance): void {
  const kit = load();
  app.get('/ui/*', { config: { group: 'static' } }, async (request, reply) => {
    const asset = kit.get((request.params as { '*': string })['*']);
    if (asset === undefined) throw new DomainError('ROUTE_NOT_FOUND');
    return reply.header('cache-control', CACHE).type(asset.type).send(asset.body);
  });
}
