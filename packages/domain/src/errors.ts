export const ErrorCatalogue = {
  VALIDATION_FAILED: { status: 400 },
  DEVICE_TOKEN_INVALID: { status: 401 },
  SESSION_INVALID: { status: 401 },
  SESSION_EXPIRED: { status: 401 },
  ADMIN_SESSION_REQUIRED: { status: 401 },
  PAIRING_TOKEN_INVALID: { status: 401 },
  REGISTRATION_CODE_INVALID: { status: 401 },
  BRANCH_API_KEY_INVALID: { status: 401 },
  JWT_INVALID: { status: 401 },
  PIN_INVALID: { status: 401 },
  LOGIN_INVALID: { status: 401 },
  REFRESH_TOKEN_INVALID: { status: 401 },
  PERMISSION_DENIED: { status: 403 },
  GUEST_NETWORK_FORBIDDEN: { status: 403 },
  DEVICE_REVOKED: { status: 403 },
  BRANCH_MISMATCH: { status: 403 },
  DEVICE_TYPE_NOT_ALLOWED: { status: 403 },
  DEVICE_NOT_OWNED: { status: 403 },
  HOST_NOT_ALLOWED: { status: 403 },
  STATION_LOGOUT_NOT_ALLOWED: { status: 403 },
  ROUTE_NOT_FOUND: { status: 404 },
  STAFF_NOT_FOUND: { status: 404 },
  STATION_NOT_FOUND: { status: 404 },
  DEVICE_NOT_FOUND: { status: 404 },
  SESSION_NOT_FOUND: { status: 404 },
  PAIRING_REQUEST_NOT_FOUND: { status: 404 },
  TABLE_ALREADY_LOCKED: { status: 409 },
  TABLE_LOCK_NOT_HELD: { status: 409 },
  ITEM_WRONG_STAGE: { status: 409 },
  VOID_PENDING: { status: 409 },
  SYNC_SEQ_GAP: { status: 409 },
  DEVICE_SESSION_ACTIVE: { status: 409 },
  HUB_NOT_PROVISIONED: { status: 409 },
  SETUP_IN_PROGRESS: { status: 409 },
  REGISTRATION_CODE_KIND_UNSUPPORTED: { status: 422 },
  CLIENT_UPGRADE_REQUIRED: { status: 426 },
  PIN_LOCKED_OUT: { status: 429 },
  DEVICE_LOCKED_OUT: { status: 429 },
  IP_LOCKED_OUT: { status: 429 },
  LOGIN_LOCKED_OUT: { status: 429 },
  INTERNAL_ERROR: { status: 500 },
  SERVICE_UNAVAILABLE: { status: 503 },
} as const;

export type ErrorCode = keyof typeof ErrorCatalogue;

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function statusOf(code: ErrorCode): number {
  return ErrorCatalogue[code].status;
}
