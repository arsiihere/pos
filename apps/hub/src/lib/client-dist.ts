/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DomainError } from '@pos/domain';
import type { FastifyContextConfig, FastifyInstance, FastifyReply } from 'fastify';

// §7.1, S39 b: the built admin-stock entry, found relative to this file (as M81 finds the UI kit).
export const CLIENT_DIST_DIR = fileURLToPath(new URL('../../../client/dist/admin-stock/', import.meta.url));
// S21: the same header on every file served from a build, on the hub and on the cloud.
export const CSP = "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const IMMUTABLE = 'public, max-age=31536000, immutable';

interface ClientFile {
  type: string;
  cache: string;
  body: Buffer;
}

export interface ClientDistOptions {
  prefix: string; // '/admin/stock/'
  dir: string;
  routeConfig: FastifyContextConfig;
}

// Reads the file list and bodies once, at registration: a release that replaces the files on disk takes
// effect at the next restart. Only listed files with a mapped extension are servable, so `.vite/manifest.json`
// and `../` paths never are. A missing build is logged and its routes answer 404; the server still starts.
// The cloud has the same helper (§7.1: moved to a shared place only if the two copies drift, §12.4).
export function registerClientDist(app: FastifyInstance, o: ClientDistOptions): void {
  const files = load(app, o.dir);
  const send = (reply: FastifyReply, name: string): FastifyReply => {
    const file = files.get(name);
    if (file === undefined) throw new DomainError('ROUTE_NOT_FOUND');
    return reply.header('content-security-policy', CSP).header('cache-control', file.cache).type(file.type).send(file.body);
  };
  app.get(o.prefix, { config: o.routeConfig }, async (_request, reply) => send(reply, 'index.html'));
  app.get(`${o.prefix}*`, { config: o.routeConfig }, async (request, reply) =>
    send(reply, (request.params as { '*': string })['*']),
  );
}

function load(app: FastifyInstance, dir: string): Map<string, ClientFile> {
  const files = new Map<string, ClientFile>();
  let entries;
  try {
    entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  } catch (error) {
    app.log.error({ dir, err: error }, 'client build output missing; its pages answer 404');
    return files;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const dot = entry.name.lastIndexOf('.');
    const type = dot === -1 ? undefined : TYPES[entry.name.slice(dot)];
    if (type === undefined) continue;
    const name = relative(dir, path).split(sep).join('/');
    files.set(name, { type, cache: name.startsWith('assets/') ? IMMUTABLE : 'no-cache', body: readFileSync(path) });
  }
  return files;
}
