/// <reference types="node" />
import { createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { DomainError } from '@pos/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { HubDeps } from '../server.js';

const APK_TYPE = 'application/vnd.android.package-archive';

// §6.37: `<version_code>.apk`; anything else is an unknown file.
const ApkParams = z.object({ file: z.string().regex(/^[1-9]\d{0,14}\.apk$/) });

export interface ReleaseRow {
  version_name: string;
  version_code: number;
  sha256: string;
  staged_device_id: string | null;
}

export function apkDir(dataDir: string): string {
  return join(dataDir, 'apk');
}

export function apkPath(dataDir: string, versionCode: number): string {
  return join(apkDir(dataDir), `${versionCode}.apk`);
}

/**
 * 00 v1.6 §6.36–§6.37 (H-5). Group `admin-device-public` = host, provisioned, guest, device token:
 * §3.9 puts no client-version guard on `/app/*`, so an app below `min_client_version` can still update.
 */
export function registerAppUpdateRoutes(app: FastifyInstance, deps: Pick<HubDeps, 'readDb' | 'config'>): void {
  app.get('/app/android/latest', { config: { group: 'admin-device-public' } }, async (request) => {
    requireTablet(request);
    // One statement: the newest release if it is good or staged to this device, else the newest good one.
    const row = deps.readDb
      .prepare(
        `SELECT version_name, version_code, sha256, staged_device_id FROM app_releases
         WHERE staged_device_id IS NULL
            OR (staged_device_id = ? AND version_code = (SELECT MAX(version_code) FROM app_releases))
         ORDER BY version_code DESC LIMIT 1`,
      )
      .get(request.device!.device_id) as ReleaseRow | undefined;
    if (row === undefined) throw new DomainError('ROUTE_NOT_FOUND');
    return { data: row };
  });

  app.get('/app/android/:file', { config: { group: 'admin-device-public' } }, async (request, reply) => {
    requireTablet(request);
    const parsed = ApkParams.safeParse(request.params);
    if (!parsed.success) throw new DomainError('ROUTE_NOT_FOUND');
    const versionCode = Number(parsed.data.file.slice(0, -'.apk'.length));
    const known = deps.readDb.prepare('SELECT 1 FROM app_releases WHERE version_code = ?').get(versionCode);
    if (known === undefined) throw new DomainError('ROUTE_NOT_FOUND');
    const path = apkPath(deps.config.data_dir, versionCode);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      throw new DomainError('ROUTE_NOT_FOUND');
    }
    return reply.type(APK_TYPE).header('content-length', size).send(createReadStream(path));
  });
}

function requireTablet(request: FastifyRequest): void {
  const device = request.device;
  if (device === undefined) throw new DomainError('DEVICE_TOKEN_INVALID');
  if (device.device_type !== 'tablet') {
    throw new DomainError('DEVICE_TYPE_NOT_ALLOWED', {
      device_type: device.device_type,
      allowed: ['tablet'],
    });
  }
}
