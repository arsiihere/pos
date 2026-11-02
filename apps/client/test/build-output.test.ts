// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// R22: reads the real build of `pnpm --filter @pos/client build` (the root `pnpm test` runs it first, S39 a).
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const ENTRIES = [
  { name: 'owner', base: '/owner/', otherFeatures: 'src/features/admin/' },
  { name: 'admin-stock', base: '/admin/stock/', otherFeatures: 'src/features/owner/' },
  // 01d task 41: the staff entry (/staff/) carries neither the owner app nor the stock page
  { name: 'staff', base: '/staff/', otherFeatures: 'src/features/owner/' },
] as const;
// A data: URL (`data:image/svg+xml,…`, `data:font/woff2;base64,…`), not a minified `{data:null}` property.
const DATA_URL_RE = /data:[a-z]+\/[a-z0-9.+-]+[;,]/i;

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name));
}

interface ManifestChunk {
  file: string;
  src?: string;
  css?: string[];
  imports?: string[];
  dynamicImports?: string[];
}

describe('client build output', () => {
  it('[01a §10 #113] each entry is self-contained: own files, no inline script, no data: URL, no other entry code, kit CSS only', () => {
    for (const entry of ENTRIES) {
      const dir = join(DIST, entry.name);
      const indexPath = join(dir, 'index.html');
      expect(existsSync(indexPath), indexPath).toBe(true);
      const html = readFileSync(indexPath, 'utf8');

      const refs = [...html.matchAll(/\s(?:src|href)="([^"]*)"/g)].map((m) => m[1]!);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) {
        expect(ref.startsWith(entry.base), `${entry.name}: ${ref}`).toBe(true);
        const rel = normalize(ref.slice(entry.base.length));
        expect(rel.startsWith('..'), `${entry.name}: ${ref}`).toBe(false);
        expect(existsSync(join(dir, rel)), `${entry.name}: ${ref}`).toBe(true);
      }

      for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
        expect(tag, `${entry.name}: ${tag}`).toMatch(/\ssrc="/);
      }

      for (const file of filesUnder(dir).filter((f) => f.endsWith('.css') || f.endsWith('.js'))) {
        expect(readFileSync(file, 'utf8'), file).not.toMatch(DATA_URL_RE);
      }

      const manifest = JSON.parse(readFileSync(join(dir, '.vite', 'manifest.json'), 'utf8')) as Record<string, ManifestChunk>;
      const sources = Object.entries(manifest).flatMap(([key, chunk]) => [key, chunk.src ?? '']).filter((s) => s !== '');
      expect(sources.length).toBeGreaterThan(0);
      for (const src of sources) {
        expect(src.includes(entry.otherFeatures), `${entry.name}: ${src}`).toBe(false);
        if (src.endsWith('.css')) expect(src.includes('packages/ui-kit/'), `${entry.name}: ${src}`).toBe(true);
      }
    }
  });

  it('[01d task 41] the staff build has staff/index.html, its own code and none of the stock page', () => {
    expect(existsSync(join(DIST, 'staff', 'index.html'))).toBe(true);
    const js = filesUnder(join(DIST, 'staff'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    // the page meta the hub serves (staff entry only) and the device-route sign-in
    expect(js).toContain('pos-tenant-id');
    expect(js).toContain('/auth/pin');
    // the stock page's admin queries stay in their own entry
    expect(js).not.toContain('/admin/queries/stock');
  });

  it('[01a S35 d] each dist has an assets/*.woff2 file', () => {
    for (const entry of ENTRIES) {
      const assets = readdirSync(join(DIST, entry.name, 'assets'));
      expect(assets.some((f) => f.endsWith('.woff2')), entry.name).toBe(true);
    }
  });
});
