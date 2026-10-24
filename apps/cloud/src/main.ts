/// <reference types="node" />
import { fileURLToPath } from 'node:url';
import { createPool, migrate } from './db/migrate.js';
import { loadCloudEnv } from './lib/env.js';
import { systemClock } from './lib/clock.js';
import { ulidGen } from './lib/ids.js';
import { cryptoSecrets } from './lib/secrets.js';
import { buildCloudServer } from './server.js';

const env = loadCloudEnv(process.env);
const pool = createPool(env.DATABASE_URL);
const clock = systemClock();
const migrationsDir = fileURLToPath(new URL('./db/migrations', import.meta.url));

migrate(pool, migrationsDir, clock)
  .then(async () => {
    const app = buildCloudServer({ pool, env, clock, ids: ulidGen(clock), secrets: cryptoSecrets });
    await app.listen({ host: '0.0.0.0', port: env.PORT });
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'cloud boot failed';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
