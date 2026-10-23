import { DomainError } from '@pos/domain';
import type { FastifyInstance, onRequestHookHandler } from 'fastify';
import type { HubConfig } from '../config/schema.js';
import { isProvisioned } from '../config/schema.js';
import { createHostMatcher, createNetMatcher } from '../lib/net.js';

export type RouteGroup =
  | 'health'
  | 'setup'
  | 'device'
  | 'device-session'
  | 'admin'
  | 'admin-device-public'
  | 'admin-bootstrap'
  | 'pair'
  | 'pair-request'
  | 'ws';

const GROUPS = new Set<RouteGroup>([
  'health',
  'setup',
  'device',
  'device-session',
  'admin',
  'admin-device-public',
  'admin-bootstrap',
  'pair',
  'pair-request',
  'ws',
]);

const VERSION_GROUPS = new Set<RouteGroup>(['device', 'device-session', 'pair', 'pair-request', 'ws']);

declare module 'fastify' {
  interface FastifyContextConfig {
    group?: RouteGroup;
    guards?: string[];
  }
  interface FastifyRequest {
    isGuest?: boolean;
  }
}

export function guardsFor(group: RouteGroup): string[] {
  const names = ['host'];
  if (group !== 'health' && group !== 'setup') names.push('provisioned');
  names.push(group === 'health' ? 'isGuest' : 'guest');
  if (VERSION_GROUPS.has(group)) names.push('version');
  return names;
}

export interface ListedRoute {
  method: string;
  url: string;
  guards: string[];
}

const listed = new WeakMap<FastifyInstance, ListedRoute[]>();
const unguarded = new WeakMap<FastifyInstance, string[]>();

export function listRouteGuards(app: FastifyInstance): ListedRoute[] {
  return listed.get(app) ?? [];
}

export function attachRouteGuards(app: FastifyInstance, deps: { config: HubConfig; ownIPv4: string[] }): void {
  const routes: ListedRoute[] = [];
  const missing: string[] = [];
  listed.set(app, routes);
  unguarded.set(app, missing);
  const allowHost = createHostMatcher({
    port: deps.config.http_port,
    advertisedHost: deps.config.advertised_host ?? null,
    ownIPv4: deps.ownIPv4,
  });
  const guestNet = createNetMatcher(deps.config.guest_network_cidrs ?? []);
  const handlers: Record<string, onRequestHookHandler> = {
    async host(request) {
      if (!allowHost(request.headers.host)) throw new DomainError('HOST_NOT_ALLOWED');
    },
    async provisioned() {
      if (!isProvisioned(deps.config)) throw new DomainError('HUB_NOT_PROVISIONED');
    },
    async guest(request) {
      if (guestNet(request.ip)) throw new DomainError('GUEST_NETWORK_FORBIDDEN');
    },
    async isGuest(request) {
      request.isGuest = guestNet(request.ip);
    },
    async version(request) {
      const header = request.headers['x-client-version'];
      const version = Array.isArray(header) ? header[0] : header;
      if (version !== undefined && version.length > 0 && isBelow(version, deps.config.min_client_version)) {
        throw new DomainError('CLIENT_UPGRADE_REQUIRED');
      }
    },
  };
  app.addHook('onRoute', (opts) => {
    const group = opts.config?.group;
    const label = `${String(opts.method)} ${opts.url}`;
    if (!isGroup(group)) {
      missing.push(label);
      return;
    }
    const names = guardsFor(group);
    const prior = opts.onRequest === undefined ? [] : [opts.onRequest].flat();
    opts.onRequest = [...names.map((name) => handlers[name]!), ...prior];
    routes.push({ method: String(opts.method), url: opts.url, guards: names });
  });
  app.addHook('onReady', async () => {
    if (missing.length > 0) throw new Error(`route has no group: ${missing.join(', ')}`);
  });
}

function isGroup(value: unknown): value is RouteGroup {
  return typeof value === 'string' && GROUPS.has(value as RouteGroup);
}

function isBelow(version: string, min: string): boolean {
  const left = version.split('.').map((part) => Number(part));
  const right = min.split('.').map((part) => Number(part));
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (Number.isNaN(a) || Number.isNaN(b) || a < b) return true;
    if (a > b) return false;
  }
  return false;
}
