// 05 #74 (J-6): test-only fiscal adapter. Configurable key, ordering, credit capability, credential
// names and settings schema; answers scripted per call; records every submission it receives.
import { z, type ZodType } from 'zod';
import type { FiscalAdapter, FiscalAnswer, FiscalCreditSubmission, FiscalSubmission } from '../../../src/billing/fiscal/port';

export type FakeCall =
  | { kind: 'sale'; sub: FiscalSubmission }
  | { kind: 'credit'; sub: FiscalCreditSubmission };

/** A scripted answer, or a thrown error (an adapter bug / transport failure the worker must survive). */
export type FakeScript = FiscalAnswer | { throws: string };

export type FakeAdapter = FiscalAdapter & {
  /** Every submission, in call order (sale and credit). */
  calls: FakeCall[];
  /** Number of health() calls. */
  healthCalls: number;
  /** Queue answers for the next calls, in order. */
  script(...answers: FakeScript[]): void;
  /** Answer used once the script is empty (default `{ outcome: 'retry', error_code: 'unscripted' }`). */
  setDefault(answer: FakeScript): void;
  setHealth(h: 'ok' | 'failing'): void;
};

export function fakeAdapter(o?: {
  key?: string;
  ordering?: 'strict_per_pos_id' | 'none';
  credit?: boolean;
  credentialNames?: string[];
  settingsSchema?: ZodType;
}): FakeAdapter {
  const queue: FakeScript[] = [];
  let fallback: FakeScript = { outcome: 'retry', error_code: 'unscripted' };
  let health: 'ok' | 'failing' = 'ok';
  const next = async (): Promise<FiscalAnswer> => {
    const s = queue.length > 0 ? queue.shift()! : fallback;
    if ('throws' in s) throw new Error(s.throws);
    return s;
  };
  const adapter: FakeAdapter = {
    key: o?.key ?? 'FAKE',
    capabilities: { ordering: o?.ordering ?? 'strict_per_pos_id', credit: o?.credit ?? true },
    settingsSchema: o?.settingsSchema ?? z.object({}).strict(),
    credentialNames: o?.credentialNames ?? ['token'],
    calls: [],
    healthCalls: 0,
    async submitSale(sub) {
      adapter.calls.push({ kind: 'sale', sub: structuredClone(sub) });
      return next();
    },
    async submitCredit(sub) {
      adapter.calls.push({ kind: 'credit', sub: structuredClone(sub) });
      return next();
    },
    async health() {
      adapter.healthCalls += 1;
      return health;
    },
    script(...answers) {
      queue.push(...answers);
    },
    setDefault(answer) {
      fallback = answer;
    },
    setHealth(h) {
      health = h;
    },
  };
  return adapter;
}

/** A neutral submission as §3.15 shapes it (built in 29b from InvoiceIssued + invoice_buyers + fiscal_credentials). */
export function aSubmission(over: Partial<FiscalSubmission> = {}): FiscalSubmission {
  return {
    idempotency_key: 'AC1-S000123',
    pos_id: 'POS-1',
    credentials: { token: 'test-token' },
    jurisdiction_id: 'TEST-J',
    currency_code: 'PKR',
    currency_exponent: 2,
    prices_include_tax: false,
    seller: { branch_id: 'branch-1', tax_registrations: [{ code: 'NTN', number: '1234567' }] },
    config: { environment: 'sandbox', base_url: null, settings: {} },
    invoice: {
      invoice_ref: 'AC1-S000123',
      issued_at: 1_761_000_000_000,
      order_type: 'dine_in',
      lines: [
        {
          order_item_id: 'oi-1',
          item_id: 'item-1',
          tax_profile_id: 'tp-1',
          fiscal_category: 'restaurant_service',
          name: 'Paye',
          units: 2,
          unit_price_minor: 50_000,
          base_minor: 100_000,
          discount_minor: 0,
          taxes: [{ tax_code: 'T1', payment_class: 'cash', rate_bp: 1600, base_minor: 100_000, tax_minor: 16_000 }],
        },
      ],
      service_charge: null,
      subtotal_minor: 100_000,
      discount_minor: 0,
      tax_minor: 16_000,
      rounding_minor: 0,
      total_minor: 116_000,
      taxes: [
        { tax_profile_id: 'tp-1', tax_code: 'T1', payment_class: 'cash', rate_bp: 1600, base_minor: 100_000, tax_minor: 16_000 },
      ],
      payments: [{ authority_code: '1', payment_class: 'cash', direction: 'in', amount_minor: 116_000 }],
      buyer: null,
      buyer_id_refused: false,
    },
    ...over,
  };
}
