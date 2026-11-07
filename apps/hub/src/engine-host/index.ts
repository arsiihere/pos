import type { FastifyInstance } from 'fastify';
import type { HubDeps } from '../server.js';
import { afterEngineCommit } from './reducer.js';

// P-6: what the host wires into the server; called once from buildHubServer.
export function registerEngineHost(app: FastifyInstance, deps: HubDeps): void {
  deps.writer.addAfterCommit((appended) => {
    afterEngineCommit(deps.state, app.log, appended);
  });
}
