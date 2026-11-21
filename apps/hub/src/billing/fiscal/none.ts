// 05 §3.15: the `none` adapter. It is never called — every row of an invoice issued under it is
// `not_required` (outboxRowFor) — and exists so every branch has an adapter key. Registered at startup
// (§6.30, phase 0b).
import { z } from 'zod';
import type { FiscalAdapter } from './port.js';

export const NONE_ADAPTER_KEY = 'none';

function neverCalled(): never {
  throw new Error('the none fiscal adapter is never called');
}

export const noneAdapter: FiscalAdapter = {
  key: NONE_ADAPTER_KEY,
  capabilities: { ordering: 'none', credit: true },
  // Appendix P.2 / row A-2: `{}` only, `.strict()` (the shared schema lands in
  // @pos/events/src/admin/fiscal-adapters/none.ts with P0.9a; this one is identical).
  settingsSchema: z.object({}).strict(),
  credentialNames: [],
  submitSale: async () => neverCalled(),
  submitCredit: async () => neverCalled(),
  health: async () => 'ok',
};
