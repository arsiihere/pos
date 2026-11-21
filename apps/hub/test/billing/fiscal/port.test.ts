import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { NONE_ADAPTER_KEY, noneAdapter } from '../../../src/billing/fiscal/none';
import {
  fiscalAdapterFor,
  registerFiscalAdapter,
  resetFiscalAdapters,
  type FiscalAdapter,
  type FiscalAnswer,
  type FiscalCreditSubmission,
  type FiscalSubmission,
} from '../../../src/billing/fiscal/port';
import { aSubmission, fakeAdapter } from './fake-adapter';

afterEach(() => resetFiscalAdapters());

describe('[05 task 28a] fiscal port, registry, none adapter (§3.15, B20)', () => {
  it('[05 §3.15] registerFiscalAdapter makes an adapter findable by key; unknown keys are null', () => {
    const a = fakeAdapter({ key: 'FAKE-A' });
    const b = fakeAdapter({ key: 'FAKE-B' });
    registerFiscalAdapter(a);
    registerFiscalAdapter(b);
    expect(fiscalAdapterFor('FAKE-A')).toBe(a);
    expect(fiscalAdapterFor('FAKE-B')).toBe(b);
    expect(fiscalAdapterFor('PRA')).toBeNull();
  });

  it('[05 §3.15] a duplicate key throws and keeps the first registration', () => {
    const first = fakeAdapter({ key: 'FAKE' });
    registerFiscalAdapter(first);
    expect(() => registerFiscalAdapter(fakeAdapter({ key: 'FAKE' }))).toThrow(/already registered: FAKE/);
    expect(fiscalAdapterFor('FAKE')).toBe(first);
  });

  it('[05 §6.30] the same adapter object again is a no-op (boot and a test may both register it)', () => {
    const first = fakeAdapter({ key: 'FAKE' });
    registerFiscalAdapter(first);
    expect(() => registerFiscalAdapter(first)).not.toThrow();
    expect(fiscalAdapterFor('FAKE')).toBe(first);
  });

  it('[05 #74 H10-5] a settingsSchema with a field marked secret fails registration', () => {
    const top = z.object({ seller_code: z.string(), api_key: z.string().meta({ secret: true }) }).strict();
    expect(() => registerFiscalAdapter(fakeAdapter({ key: 'S1', settingsSchema: top }))).toThrow(
      /S1: settingsSchema field is marked secret/,
    );
    const nested = z.object({ endpoints: z.object({ sign: z.object({ key: z.string().meta({ secret: true }) }) }) });
    expect(() => registerFiscalAdapter(fakeAdapter({ key: 'S2', settingsSchema: nested }))).toThrow(/marked secret/);
    const inArray = z.object({ keys: z.array(z.string().meta({ secret: true })) });
    expect(() => registerFiscalAdapter(fakeAdapter({ key: 'S3', settingsSchema: inArray }))).toThrow(/marked secret/);
    const transformed = z.object({ a: z.string().meta({ secret: true }).transform((v) => v.trim()) });
    expect(() => registerFiscalAdapter(fakeAdapter({ key: 'S5', settingsSchema: transformed }))).toThrow(/marked secret/);
    const optionalUnion = z.object({ k: z.union([z.string().meta({ secret: true }), z.number()]).optional() });
    expect(() => registerFiscalAdapter(fakeAdapter({ key: 'S6', settingsSchema: optionalUnion }))).toThrow(/marked secret/);
    const piped = z.object({ a: z.string().meta({ secret: true }).pipe(z.string()) });
    expect(() => registerFiscalAdapter(fakeAdapter({ key: 'S9', settingsSchema: piped }))).toThrow(/marked secret/);
    const objectTransform = z.object({ inner: z.object({ k: z.string().meta({ secret: true }) }).transform((o) => o) });
    expect(() => registerFiscalAdapter(fakeAdapter({ key: 'S10', settingsSchema: objectTransform }))).toThrow(/marked secret/);
    const truthy = z.object({ k: z.string().meta({ secret: 'yes' }) });
    expect(() => registerFiscalAdapter(fakeAdapter({ key: 'S11', settingsSchema: truthy }))).toThrow(/marked secret/);
    // Unmarked, but named like one of the adapter's own credentials: refused (case-insensitive).
    const named = z.object({ endpoint: z.string(), Token: z.string() });
    expect(() => registerFiscalAdapter(fakeAdapter({ key: 'S12', settingsSchema: named, credentialNames: ['token'] }))).toThrow(
      /S12: settingsSchema field is marked secret: \$\.Token/,
    );
    const record = z.object({ keys: z.record(z.string(), z.string().meta({ secret: true })) });
    expect(() => registerFiscalAdapter(fakeAdapter({ key: 'S7', settingsSchema: record }))).toThrow(/marked secret/);
    expect(fiscalAdapterFor('S1')).toBeNull();
    // Public, non-secret settings register fine (and `secret: false` is not a mark).
    const ok = z.object({ seller_code: z.string().meta({ secret: false }), base: z.string().optional() }).strict();
    registerFiscalAdapter(fakeAdapter({ key: 'S4', settingsSchema: ok }));
    expect(fiscalAdapterFor('S4')).not.toBeNull();
    // A default value that happens to contain a `secret` key is data, not a mark.
    const dataOnly = z.object({ f: z.object({ secret: z.boolean() }).default({ secret: true }) });
    registerFiscalAdapter(fakeAdapter({ key: 'S8', settingsSchema: dataOnly }));
    expect(fiscalAdapterFor('S8')).not.toBeNull();
  });

  it('[05 §3.15] registration refuses an empty key and empty or repeated credential names', () => {
    expect(() => registerFiscalAdapter(fakeAdapter({ key: '' }))).toThrow(/key is empty/);
    expect(() => registerFiscalAdapter(fakeAdapter({ key: 'C1', credentialNames: ['token', 'token'] }))).toThrow(/distinct and non-empty/);
    expect(() => registerFiscalAdapter(fakeAdapter({ key: 'C2', credentialNames: [''] }))).toThrow(/distinct and non-empty/);
    registerFiscalAdapter(fakeAdapter({ key: 'C3', credentialNames: [] }));
    expect(fiscalAdapterFor('C3')).not.toBeNull();
  });

  it('[05 §3.15] the none adapter: key none, ordering none, no credentials, settings {} strict, never called', async () => {
    expect(noneAdapter.key).toBe('none');
    expect(NONE_ADAPTER_KEY).toBe('none');
    expect(noneAdapter.capabilities).toEqual({ ordering: 'none', credit: true });
    expect(noneAdapter.credentialNames).toEqual([]);
    expect(noneAdapter.settingsSchema.safeParse({}).success).toBe(true);
    expect(noneAdapter.settingsSchema.safeParse({ x: 1 }).success).toBe(false);
    await expect(noneAdapter.submitSale(aSubmission())).rejects.toThrow(/never called/);
    await expect(
      noneAdapter.submitCredit({ ...aSubmission(), original: { invoice_ref: 'AC1-S000001', fiscal_number: null, issued_at: 1 } }),
    ).rejects.toThrow(/never called/);
    await expect(noneAdapter.health()).resolves.toBe('ok');
    registerFiscalAdapter(noneAdapter);
    expect(fiscalAdapterFor('none')).toBe(noneAdapter);
  });

  it('[05 #74] the fake adapter receives the neutral §3.15 submission and answers as scripted', async () => {
    const fake = fakeAdapter({ key: 'FAKE', credentialNames: ['api_key', 'device_key'] });
    fake.script({ outcome: 'ok', fiscal_number: 'F-1', qr_payload: 'qr' }, { outcome: 'duplicate', fiscal_number: null });
    const sale = aSubmission({ credentials: { api_key: 'test-token', device_key: 'test-token' } });
    const credit: FiscalCreditSubmission = {
      ...aSubmission({ idempotency_key: 'AC1-C000007' }),
      original: { invoice_ref: 'AC1-S000123', fiscal_number: 'F-1', issued_at: 1_761_000_000_000 },
    };
    await expect(fake.submitSale(sale)).resolves.toEqual({ outcome: 'ok', fiscal_number: 'F-1', qr_payload: 'qr' });
    await expect(fake.submitCredit(credit)).resolves.toEqual({ outcome: 'duplicate', fiscal_number: null });
    await expect(fake.submitSale(sale)).resolves.toEqual({ outcome: 'retry', error_code: 'unscripted' });
    expect(fake.calls.map((c) => [c.kind, c.sub.idempotency_key])).toEqual([
      ['sale', 'AC1-S000123'],
      ['credit', 'AC1-C000007'],
      ['sale', 'AC1-S000123'],
    ]);
    expect(fake.calls[0]!.sub.credentials).toEqual({ api_key: 'test-token', device_key: 'test-token' });
    const c = fake.calls[1]!;
    expect(c.kind === 'credit' && c.sub.original).toEqual({ invoice_ref: 'AC1-S000123', fiscal_number: 'F-1', issued_at: 1_761_000_000_000 });
    fake.script({ throws: 'socket hang up' });
    await expect(fake.submitSale(sale)).rejects.toThrow('socket hang up');
    fake.setHealth('failing');
    await expect(fake.health()).resolves.toBe('failing');
    expect(fake.healthCalls).toBe(1);
  });

  it('[05 §3.15] port types are the §3.15 contract', () => {
    expectTypeOf<FiscalAdapter['capabilities']>().toEqualTypeOf<{ ordering: 'strict_per_pos_id' | 'none'; credit: boolean }>();
    expectTypeOf<FiscalAnswer>().toEqualTypeOf<
      | { outcome: 'ok'; fiscal_number: string; qr_payload: string | null }
      | { outcome: 'retry'; error_code: string }
      | { outcome: 'rejected'; error_code: string; http_status: number | null }
      | { outcome: 'duplicate'; fiscal_number: string | null }
    >();
    expectTypeOf<FiscalCreditSubmission['original']>().toEqualTypeOf<{
      invoice_ref: string;
      fiscal_number: string | null;
      issued_at: number;
    }>();
    expectTypeOf<keyof FiscalSubmission>().toEqualTypeOf<
      | 'idempotency_key'
      | 'pos_id'
      | 'credentials'
      | 'jurisdiction_id'
      | 'currency_code'
      | 'currency_exponent'
      | 'prices_include_tax'
      | 'seller'
      | 'config'
      | 'invoice'
    >();
  });

  it('[05 §3.15 v1.0.2 R-9 / G-4, G-7] pos_id and payments[].authority_code are string | null', () => {
    expectTypeOf<FiscalSubmission['pos_id']>().toEqualTypeOf<string | null>();
    expectTypeOf<FiscalSubmission['invoice']['payments'][number]['authority_code']>().toEqualTypeOf<string | null>();
    const sub: FiscalSubmission = aSubmission({ pos_id: null });
    sub.invoice.payments = [{ authority_code: null, payment_class: 'cash', direction: 'in', amount_minor: 1 }];
    expect(sub.pos_id).toBeNull();
  });

  it('[05 §3.15 Payment codes] the fake adapter, scripted, answers rejected / mode_unmapped on a null authority_code', async () => {
    const fake = fakeAdapter();
    fake.rejectNullAuthorityCode();
    fake.script({ outcome: 'ok', fiscal_number: 'F-1', qr_payload: null });
    const unmapped = aSubmission();
    unmapped.invoice.payments = [
      { authority_code: '1', payment_class: 'cash', direction: 'in', amount_minor: 100_000 },
      { authority_code: null, payment_class: 'digital', direction: 'in', amount_minor: 16_000 },
    ];
    await expect(fake.submitSale(unmapped)).resolves.toEqual({ outcome: 'rejected', error_code: 'mode_unmapped', http_status: null });
    // the script is untouched: a mapped submission still gets the scripted answer
    await expect(fake.submitSale(aSubmission())).resolves.toEqual({ outcome: 'ok', fiscal_number: 'F-1', qr_payload: null });
    expect(fake.calls).toHaveLength(2);
  });
});
