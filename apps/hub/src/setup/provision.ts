/// <reference types="node" />
import { BlockList } from 'node:net';
import { DomainError, ErrorCatalogue, type ErrorCode } from '@pos/domain';
import { DirectorySchema } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { issueAdminBootstrap } from '../auth/bootstrap-tokens.js';
import { applyStaffDirectory } from '../auth/apply-directory.js';
import { swapDirectory } from '../auth/guards.js';
import type { HubConfig } from '../config/schema.js';
import { isProvisioned } from '../config/schema.js';
import { writeHubConfigAtomic } from '../config/write.js';
import { createWriter } from '../engine-host/writer.js';
import { HUB_VERSION } from '../lib/health.js';
import type { HubDeps } from '../server.js';
import type { CloudClient } from './cloud-client.js';
import { CloudError, CloudUnreachableError } from './cloud-client.js';
import { setupPage } from './page.js';
import { qrSvg } from '../lib/qr.js';

const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;

const ProvisionBody = z.object({
  registration_code: z.string(),
  guest_network_cidrs: z.array(z.string()).min(1),
  advertised_host: z.string(),
});

const RegisterResponse = z.object({
  data: z.object({
    tenant_id: z.string().min(1),
    branch_id: z.string().min(1),
    branch_name: z.string(),
    currency_code: z.string(),
    kind: z.enum(['new_branch', 'replace_hub']),
    branch_api_key: z.string().min(1),
    directory: DirectorySchema,
  }),
});

export interface SetupDeps extends HubDeps {
  cloud: CloudClient;
  configPath: string;
  exit: (code: number) => void;
  writeConfig?: (path: string, cfg: HubConfig) => void;
}

let setupInProgress = false;

export function registerSetupRoutes(app: FastifyInstance, deps: SetupDeps): void {
  app.get('/setup', { config: { group: 'setup' } }, async (_request, reply) => {
    if (isProvisioned(deps.config)) throw new DomainError('ROUTE_NOT_FOUND');
    return reply.type('text/html; charset=utf-8').send(setupPage());
  });

  app.post('/setup/provision', { config: { group: 'setup' } }, async (request, reply) => {
    if (isProvisioned(deps.config)) throw new DomainError('ROUTE_NOT_FOUND');
    if (setupInProgress) throw new DomainError('SETUP_IN_PROGRESS');
    setupInProgress = true;
    try {
      const input = parseProvision(request.body, deps.ownIPv4);
      const code = normaliseCode(input.registration_code);
      if (!CODE_RE.test(code)) invalid('registration_code', 'malformed code');
      if (deps.config.setup_attempt_id === undefined) {
        const setupAttemptId = deps.ids.next();
        saveConfig(deps, { ...deps.config, setup_attempt_id: setupAttemptId });
        deps.config.setup_attempt_id = setupAttemptId;
      }
      const raw = await deps.cloud
        .registerHub(
          { registration_code: code, hub_version: HUB_VERSION, accepted_kinds: ['new_branch'] },
          deps.config.setup_attempt_id,
        )
        .catch(cloudFailure);
      const parsed = RegisterResponse.safeParse(raw);
      if (!parsed.success) throw new DomainError('INTERNAL_ERROR');
      const data = parsed.data.data;
      const writer = createWriter({
        db: deps.db,
        clock: deps.clock,
        ids: deps.ids,
        tenantId: data.tenant_id,
        branchId: data.branch_id,
        projections: deps.projections,
        state: deps.state,
        authGeneration: deps.authGeneration,
        publish: () => undefined,
      });
      const issued = writer.run((tx) => {
        applyStaffDirectory(tx, data.directory, (directory) => {
          swapDirectory(app, directory);
        });
        const existing = tx.db
          .prepare(`SELECT 1 AS ok FROM events WHERE branch_id = ? AND event_type = 'HubProvisioned' LIMIT 1`)
          .get(tx.branchId) as { ok: number } | undefined;
        if (existing === undefined) {
          tx.append([
            {
              stream_type: 'hub',
              stream_id: data.branch_id,
              event_type: 'HubProvisioned',
              schema_version: 1,
              payload: { tenant_id: data.tenant_id, branch_id: data.branch_id, hub_version: HUB_VERSION },
              occurred_at: tx.clock.branchNow(),
              actor_id: null,
              device_id: 'hub',
            },
          ]);
        }
        return issueAdminBootstrap(tx, 'setup', { clock: deps.clock, ids: deps.ids, secrets: deps.secrets });
      }).result;
      const next: HubConfig = {
        ...deps.config,
        advertised_host: input.advertised_host,
        guest_network_cidrs: input.guest_network_cidrs,
        backup_encryption_key: deps.config.backup_encryption_key ?? deps.secrets.bytes(32).toString('base64'),
        provisioned: {
          tenant_id: data.tenant_id,
          branch_id: data.branch_id,
          branch_name: data.branch_name,
          branch_api_key: data.branch_api_key,
        },
      };
      saveConfig(deps, next);
      Object.assign(deps.config, next);
      const firstAdminUrl = `http://${input.advertised_host}:${deps.config.http_port}/admin/bootstrap#t=${issued.token}`;
      try {
        await reply.send({
          data: {
            tenant_id: data.tenant_id,
            branch_id: data.branch_id,
            branch_name: data.branch_name,
            restarting: true,
            first_admin_url: firstAdminUrl,
            first_admin_qr_svg: qrSvg(firstAdminUrl),
            first_admin_expires_at: issued.expires_at,
          },
        });
      } catch {
        // Config is already provisioned; exit even if the flush failed (M13 / §6.4).
      }
      deps.exit(0);
    } finally {
      setupInProgress = false;
    }
  });
}

function saveConfig(deps: SetupDeps, cfg: HubConfig): void {
  (deps.writeConfig ?? writeHubConfigAtomic)(deps.configPath, cfg);
}

function parseProvision(body: unknown, ownIPv4: string[]): z.infer<typeof ProvisionBody> {
  const parsed = ProvisionBody.safeParse(body);
  if (!parsed.success) invalid('body', 'invalid setup body');
  if (parsed.data.guest_network_cidrs.some((cidr) => !validCidr(cidr))) invalid('guest_network_cidrs', 'invalid CIDR');
  if (!ownIPv4.includes(parsed.data.advertised_host)) invalid('advertised_host', 'not an address of this host');
  return parsed.data;
}

function cloudFailure(error: unknown): never {
  if (error instanceof CloudUnreachableError) throw new DomainError('SERVICE_UNAVAILABLE', { retry_after_ms: 5000 });
  if (error instanceof CloudError && isErrorCode(error.code)) throw new DomainError(error.code, error.details);
  throw new DomainError('INTERNAL_ERROR');
}

function isErrorCode(code: string): code is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ErrorCatalogue, code);
}

function invalid(path: string, message: string): never {
  throw new DomainError('VALIDATION_FAILED', { issues: [{ path, message }] });
}

function validCidr(cidr: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr);
  if (match === null) return false;
  const prefix = Number(match[5]);
  if (prefix > 32) return false;
  if (!match.slice(1, 5).every((octet) => Number(octet) <= 255)) return false;
  try {
    new BlockList().addSubnet(cidr.slice(0, cidr.indexOf('/')), prefix, 'ipv4');
    return true;
  } catch {
    return false;
  }
}

function normaliseCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}
