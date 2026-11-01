// The stored response of a command already processed (00 §3.7 idempotency). Thrown inside a writer
// transaction to abort it; never a failure: `checkPin` rethrows it uncounted (00 v1.6 H-3).
export class IdempotentReplay extends Error {
  readonly stored: { status: number; body: unknown };

  constructor(stored: { status: number; body: unknown }) {
    super('idempotent replay');
    this.stored = stored;
  }
}
