// 05 §3.15 (B20, H9-4, H10-5): the fiscal port — the only thing the core knows about an authority.
// The types below are §3.15's text exactly. The core never branches on an adapter key.
import { z, type ZodType } from 'zod';

// ---- §3.15 text, verbatim (formatting included) ----
export interface FiscalAdapter {
  key: string;                                     // 'none' | 'PRA' | … (a jurisdiction's adapter_key)
  capabilities: {
    ordering: 'strict_per_pos_id' | 'none';        // strict: a pos_id's head row blocks its later rows
    credit: boolean;                               // can report a credit against an accepted original
  };
  settingsSchema: ZodType;                         // v0.7.2 (H9-4): validates this adapter's opaque settings blob (shared with the cloud PUT, row A-2); never a secret field (v0.7.3 H10-5)
  credentialNames: string[];                       // v0.7.3 (H10-5): the named secrets it needs per pos_id (PRA: ['token'])
  submitSale(sub: FiscalSubmission): Promise<FiscalAnswer>;
  submitCredit(sub: FiscalSubmission & { original: { invoice_ref: string; fiscal_number: string | null; issued_at: number } }): Promise<FiscalAnswer>;
  health(): Promise<'ok' | 'failing'>;
}
export type FiscalSubmission = {
  idempotency_key: string;                         // = invoice_ref (AC1-S000123 / AC1-C000007); resent unchanged after a crash
  pos_id: string; credentials: Record<string, string>;   // v0.7.3 (H10-5): the adapter's credentialNames read from fiscal_credentials at send, never logged
  jurisdiction_id: string; currency_code: string; currency_exponent: number; prices_include_tax: boolean;
  seller: { branch_id: string; tax_registrations: { code: string; number: string }[] };   // v0.7.2 (H9-4, H9-5): from the invoice's snapshot
  config: { environment: 'sandbox' | 'production'; base_url: string | null; settings: unknown };
                                                   // v0.7.2 (H9-4): branch fiscal settings at send; `settings` = the branch's blob for this adapter, opaque to the core; never logged
  invoice: {                                       // neutral, from InvoiceIssued / InvoiceCredited (§6.29); amounts _minor
    invoice_ref: string; issued_at: number; order_type: string;
    lines: { order_item_id: string; item_id: string | null; tax_profile_id: string | null; fiscal_category: string | null;   // v0.7.2 (H9-4)
             name: string; units: number; unit_price_minor: number; base_minor: number; discount_minor: number;
             taxes: { tax_code: string; payment_class: 'cash' | 'digital'; rate_bp: number; base_minor: number; tax_minor: number }[] }[];
    service_charge: { amount_minor: number; taxes: { tax_code: string; payment_class: 'cash' | 'digital'; rate_bp: number; base_minor: number; tax_minor: number }[] } | null;   // v0.7.3 (H10-8)
    subtotal_minor: number; discount_minor: number; tax_minor: number; rounding_minor: number; total_minor: number;
    taxes: { tax_profile_id: string; tax_code: string; payment_class: 'cash' | 'digital'; rate_bp: number; base_minor: number; tax_minor: number }[];
    payments: { authority_code: string; payment_class: 'cash' | 'digital'; direction: 'in' | 'out'; amount_minor: number }[];
    buyer: { name: string; tax_id: { type: string; value: string } } | null;   // from invoice_buyers; a credit reads its original's row
    buyer_id_refused: boolean;
  };
};
export type FiscalAnswer =
  | { outcome: 'ok'; fiscal_number: string; qr_payload: string | null }
  | { outcome: 'retry'; error_code: string }                       // short code only ('timeout', 'http_503', …)
  | { outcome: 'rejected'; error_code: string; http_status: number | null }
  | { outcome: 'duplicate'; fiscal_number: string | null };
// ---- end of §3.15 text ----

export type FiscalCreditSubmission = Parameters<FiscalAdapter['submitCredit']>[0];

// --- registry (§6.30: registerFiscalAdapter(noneAdapter), registerFiscalAdapter(praAdapter) at startup) ---

const adapters = new Map<string, FiscalAdapter>();

/**
 * Registers an adapter by key. Throws on a duplicate or empty key, on empty / repeated credential names,
 * and on a settingsSchema with a secret field (H10-5: marked `.meta({ secret })`, or named like one of the
 * adapter's own credentialNames).
 */
export function registerFiscalAdapter(adapter: FiscalAdapter): void {
  if (adapter.key === '') throw new Error('fiscal adapter key is empty');
  if (adapters.has(adapter.key)) throw new Error(`fiscal adapter already registered: ${adapter.key}`);
  const names = adapter.credentialNames;
  if (names.some((n) => n === '') || new Set(names).size !== names.length) {
    throw new Error(`fiscal adapter ${adapter.key}: credentialNames must be distinct and non-empty`);
  }
  const secret = secretSettingsPath(adapter.settingsSchema, names);
  if (secret !== null) throw new Error(`fiscal adapter ${adapter.key}: settingsSchema field is marked secret: ${secret}`);
  adapters.set(adapter.key, adapter);
}

/** The adapter registered under `key`, or null. */
export function fiscalAdapterFor(key: string): FiscalAdapter | null {
  return adapters.get(key) ?? null;
}

/** Tests only: forget every registration. */
export function resetFiscalAdapters(): void {
  adapters.clear();
}

/**
 * H10-5: "a settingsSchema must not define secret fields". A field is marked secret with Zod metadata
 * `.meta({ secret: true })`; returns the JSON path of the first such field, or null.
 */
function secretSettingsPath(schema: ZodType, credentialNames: string[]): string | null {
  const credentials = new Set(credentialNames.map((n) => n.toLowerCase()));
  // Both sides: a transform drops its input's metadata from the output schema, and the reverse.
  for (const io of ['input', 'output'] as const) {
    const hit = findSecret(z.toJSONSchema(schema, { io, unrepresentable: 'any' }), '$', credentials);
    if (hit !== null) return hit;
  }
  return null;
}

/** JSON Schema keywords that hold values, not schemas: a `secret` key inside them is data, not a mark. */
const VALUE_KEYWORDS = new Set(['default', 'const', 'enum', 'examples', 'prefault']);

function findSecret(node: unknown, path: string, credentials: Set<string>): string | null {
  if (node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) {
      const hit = findSecret(node[i], `${path}[${i}]`, credentials);
      if (hit !== null) return hit;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  if (obj['secret'] !== undefined && obj['secret'] !== false) return path;
  for (const [k, v] of Object.entries(obj)) {
    if (VALUE_KEYWORDS.has(k)) continue;
    if ((k === 'properties' || k === 'patternProperties') && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      // A map of field name → schema: the names are fields, never keywords.
      for (const [name, sub] of Object.entries(v as Record<string, unknown>)) {
        if (credentials.has(name.toLowerCase())) return `${path}.${name}`;
        const hit = findSecret(sub, `${path}.${name}`, credentials);
        if (hit !== null) return hit;
      }
      continue;
    }
    const hit = findSecret(v, `${path}.${k}`, credentials);
    if (hit !== null) return hit;
  }
  return null;
}
