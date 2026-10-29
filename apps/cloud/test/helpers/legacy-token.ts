import { createHmac } from 'node:crypto';
import type { TestCloud } from './test-cloud';

// An access token signed without a cv claim, as before 01b B5 (`cloud.app.jwt.sign` requires cv for new
// tokens; the guard still reads a missing cv as 0, 01b #91). Same bytes signJwt produced for those claims:
// header, then sub, tenant_id, allowed_branch_ids, iat, exp; HS256 over JWT_SECRET; 1 h TTL; the app's clock.
export interface LegacyClaims {
  sub: string;
  tenant_id: string;
  allowed_branch_ids: string[];
}

const TOKEN_TTL_S = 60 * 60;

export function legacyToken(cloud: Pick<TestCloud, 'env' | 'clock'>, claims: LegacyClaims): string {
  const nowS = Math.floor(cloud.clock.branchNow() / 1000);
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64(
    JSON.stringify({
      sub: claims.sub,
      tenant_id: claims.tenant_id,
      allowed_branch_ids: claims.allowed_branch_ids,
      iat: nowS,
      exp: nowS + TOKEN_TTL_S,
    }),
  );
  const data = `${header}.${payload}`;
  return `${data}.${createHmac('sha256', cloud.env.JWT_SECRET).update(data).digest('base64url')}`;
}

function b64(value: string): string {
  return Buffer.from(value).toString('base64url');
}
