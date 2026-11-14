import { DomainError } from '@pos/domain';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { ADMIN_KITCHEN_SCREENS_DIST_DIR, ADMIN_PRINTERS_DIST_DIR, CLIENT_DIST_DIR } from '../lib/client-dist.js';
import type { HubDeps } from '../server.js';
import { adminPage } from './page.js';

// M86: GET /admin, a static page guarded like /admin/approve (host, provisioned, guest network; M79).
export function registerAdminPage(app: FastifyInstance, deps: HubDeps): void {
  app.get('/admin', { config: { group: 'admin-bootstrap' } }, async (_request, reply) => {
    const provisioned = deps.config.provisioned;
    if (provisioned === undefined) throw new DomainError('HUB_NOT_PROVISIONED');
    // "Other jobs" lists only admin pages this hub actually serves: the 01a stock page, and the 03b Kitchen screens
    // and 03c Printers pages (00 v1.9.2 §8.2, Q-43).
    const links = {
      stock: existsSync(join(CLIENT_DIST_DIR, 'index.html')),
      kitchenScreens: existsSync(join(ADMIN_KITCHEN_SCREENS_DIST_DIR, 'index.html')),
      printers: existsSync(join(ADMIN_PRINTERS_DIST_DIR, 'index.html')),
    };
    return reply
      .type('text/html; charset=utf-8')
      .send(adminPage({ tenant_id: provisioned.tenant_id, branch_id: provisioned.branch_id, branch_name: provisioned.branch_name, links }));
  });
}
