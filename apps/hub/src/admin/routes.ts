import { DomainError } from '@pos/domain';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { CLIENT_DIST_DIR } from '../lib/client-dist.js';
import type { HubDeps } from '../server.js';
import { adminPage } from './page.js';

// M86: GET /admin, a static page guarded like /admin/approve (host, provisioned, guest network; M79).
export function registerAdminPage(app: FastifyInstance, deps: HubDeps): void {
  app.get('/admin', { config: { group: 'admin-bootstrap' } }, async (_request, reply) => {
    const provisioned = deps.config.provisioned;
    if (provisioned === undefined) throw new DomainError('HUB_NOT_PROVISIONED');
    // "Other jobs" lists only admin pages this hub actually serves (today the 01a stock page).
    const links = { stock: existsSync(join(CLIENT_DIST_DIR, 'index.html')) };
    return reply
      .type('text/html; charset=utf-8')
      .send(adminPage({ tenant_id: provisioned.tenant_id, branch_id: provisioned.branch_id, branch_name: provisioned.branch_name, links }));
  });
}
