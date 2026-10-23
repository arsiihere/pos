import type pg from 'pg';

type Queryable = pg.Pool | pg.PoolClient;

export interface OwnerUser {
  tenant_id: string;
  user_id: string;
  email: string;
  display_name: string;
  password_hash: string;
  allowed_branch_ids: string[];
  failed_login_count: number;
  login_window_started_at: string | null;
  login_locked_until: string | null;
  created_at: string;
}

export interface RefreshToken {
  tenant_id: string;
  token_id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  rotated_at: string | null;
  revoked_at: string | null;
}

export interface BranchApiKey {
  tenant_id: string;
  branch_id: string;
  key_id: string;
  key_hash: string;
  created_at: string;
  revoked_at: string | null;
}

export interface RegistrationCode {
  code_hash: string;
  tenant_id: string;
  branch_id: string;
  kind: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  consumed_attempt_id: string | null;
}

export async function ownerByEmail(db: Queryable, email: string): Promise<OwnerUser | null> {
  const result = await db.query<OwnerUser>(
    `SELECT tenant_id, user_id, email, display_name, password_hash, allowed_branch_ids,
            failed_login_count, login_window_started_at, login_locked_until, created_at
       FROM owner_users
      WHERE lower(email) = lower($1)`,
    [email],
  );
  return result.rows[0] ?? null;
}

export async function refreshTokenByHash(
  client: pg.PoolClient,
  hash: string,
  forUpdate: boolean,
): Promise<RefreshToken | null> {
  const result = await client.query<RefreshToken>(
    `SELECT tenant_id, token_id, user_id, token_hash, created_at, expires_at, rotated_at, revoked_at
       FROM owner_refresh_tokens
      WHERE token_hash = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [hash],
  );
  return result.rows[0] ?? null;
}

export async function branchByApiKeyHash(db: Queryable, hash: string): Promise<BranchApiKey | null> {
  const result = await db.query<BranchApiKey>(
    `SELECT tenant_id, branch_id, key_id, key_hash, created_at, revoked_at
       FROM branch_api_keys
      WHERE key_hash = $1`,
    [hash],
  );
  return result.rows[0] ?? null;
}

export async function registrationCodeByHash(
  client: pg.PoolClient,
  hash: string,
  forUpdate: boolean,
): Promise<RegistrationCode | null> {
  const result = await client.query<RegistrationCode>(
    `SELECT code_hash, tenant_id, branch_id, kind, created_at, expires_at, consumed_at, consumed_attempt_id
       FROM registration_codes
      WHERE code_hash = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [hash],
  );
  return result.rows[0] ?? null;
}
