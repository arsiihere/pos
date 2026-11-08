import { ErrorCatalogue } from '@pos/domain';
import { describe, expect, it } from 'vitest';
import { en, fill } from '../../i18n/en';
import { setLanguage, t } from '../../i18n';
import { referenceText } from './c01';
import { errorText, issueMessages } from './form';

const REASONS = [
  'archived',
  'not_found',
  'wrong_branch',
  'program_required',
  'program_not_allowed',
  'program_wrong_station',
  'stock_time_exceeds_cook_time',
] as const;

describe('[01a §10 #160] error text (S50 e)', () => {
  it('every catalogue code and network map to a plain text without the code or the server message', () => {
    for (const code of Object.keys(ErrorCatalogue)) {
      const text =
        code === 'PERMISSION_DENIED'
          ? errorText({ kind: 'permission_denied', reason: null })
          : errorText({ kind: 'api', status: 400, code, details: {} });
      expect(text, code).toBeTruthy();
      expect(text, code).not.toContain(code);
      expect(text, code).not.toContain('server said');
    }
    expect(errorText({ kind: 'network' })).toBe(t('errors.network'));
    expect(errorText({ kind: 'logged_out' })).toBeNull();
  });

  it('each CONFIG_REFERENCE_INVALID reason has its own text', () => {
    const texts = REASONS.map((reason) =>
      errorText({ kind: 'api', status: 422, code: 'CONFIG_REFERENCE_INVALID', details: { field: 'station_id', reason } }),
    );
    expect(new Set(texts).size).toBe(REASONS.length);
    for (const text of texts) expect(text).not.toContain('CONFIG_REFERENCE_INVALID');
  });

  it('a code not in the catalogue shows errors.UNKNOWN; every *_NOT_FOUND says the page is refreshed', () => {
    expect(errorText({ kind: 'api', status: 500, code: 'SOMETHING_NEW', details: {} })).toBe(t('errors.UNKNOWN'));
    for (const code of ['FLOOR_NOT_FOUND', 'TABLE_NOT_FOUND', 'PROGRAM_NOT_FOUND', 'MENU_ITEM_NOT_FOUND']) {
      expect(errorText({ kind: 'api', status: 404, code, details: {} })).toBe(t('errors.NOT_FOUND_stale'));
    }
  });

  it('01c P1: every reason reads errors.reference.<reason> (01a, 01b, 01c); unit_mismatch on stock_unit has its own text', () => {
    const text = (details: Record<string, unknown>) =>
      errorText({ kind: 'api', status: 422, code: 'CONFIG_REFERENCE_INVALID', details });
    expect(text({ field: 'stock_unit', reason: 'unit_mismatch' })).toBe(t('errors.reference.unit_mismatch_stock'));
    expect(t('errors.reference.unit_mismatch_stock')).toBe('Some dishes use this stock in the old unit. Change those dishes first.');
    expect(text({ field: 'stock_draws.0.stock_item_id', reason: 'unit_mismatch' })).toBe(t('errors.reference.unit_mismatch'));
    expect(text({ field: 'variant_group_id', reason: 'category_mismatch' })).toBe(t('errors.reference.category_mismatch'));
    expect(text({ field: 'role_id', reason: 'role_archived' })).toBe(t('errors.reference.role_archived'));
    expect(text({ field: 'x', reason: 'something_new' })).toBe(t('errors.CONFIG_REFERENCE_INVALID'));
    expect(referenceText({ field: 'stock_unit', reason: 'unit_mismatch' })).toBe(t('errors.reference.unit_mismatch_stock'));
    expect(referenceText({ field: 'route', reason: 'program_required' })).toBe(t('errors.reference.program_required'));
  });
});

// A browser check showed the owner "Too big: expected number to be <=900000" under a box typed in minutes (in
// Urdu too), and internal names such as "lane_units is above capacity".
describe('[01a v2.1 §8.1; 03a A-2–A-10] a server issue reads in the box\'s own unit and language', () => {
  const under = (path: string, message: string) =>
    issueMessages({ kind: 'api', status: 400, code: 'VALIDATION_FAILED', details: { issues: [{ path, message }] } })[path];

  it('a time limit in ms is shown in minutes', () => {
    expect(under('freeze_ms', 'Too big: expected number to be <=900000')).toBe(fill(t('form.range.max_minutes'), { max: '15' }));
    expect(under('carry_times.1.carry_ms', 'Too big: expected number to be <=600000')).toBe(fill(t('form.range.max_minutes'), { max: '10' }));
    expect(under('pressure_window_ms', 'Too small: expected number to be >=60000')).toBe(fill(t('form.range.min_minutes'), { min: '1' }));
  });

  it('a basis-point limit is shown as a percent; any other number as itself', () => {
    expect(under('pressure_red_bp', 'Too big: expected number to be <=20000')).toBe(fill(t('form.range.max_percent'), { max: '200' }));
    expect(under('pressure_amber_bp', 'Too small: expected number to be >=1')).toBe(fill(t('form.range.min_percent'), { min: '0.01' }));
    expect(under('capacity', 'Too big: expected number to be <=1000')).toBe(fill(t('form.range.max'), { max: '1000' }));
    expect(under('capacity', 'Too small: expected number to be >=1')).toBe(fill(t('form.range.min'), { min: '1' }));
  });

  it('a text length and the station cross-checks have plain words', () => {
    expect(under('name', 'Too big: expected string to have <=60 characters')).toBe(fill(t('form.length_max'), { max: '60' }));
    expect(under('lane_units', 'lane_units is above capacity')).toBe(t('form.above_capacity'));
    expect(under('reserve_units', 'reserve_units is above capacity')).toBe(t('form.above_capacity'));
    expect(under('pressure_amber_bp', 'pressure_amber_bp must be below pressure_red_bp')).toBe(t('form.amber_below_red'));
  });

  it('a message it does not know is left as the server wrote it', () => {
    expect(under('goes_with', 'a source cannot link itself')).toBe('a source cannot link itself');
  });

  it('none of the texts falls back to English in Urdu', () => {
    setLanguage('ur');
    try {
      for (const key of ['form.range.max_minutes', 'form.range.min_minutes', 'form.range.max_percent', 'form.range.min_percent', 'form.range.max', 'form.range.min', 'form.length_max', 'form.above_capacity', 'form.amber_below_red'] as const) {
        expect(t(key), key).not.toBe(en[key]);
      }
    } finally {
      setLanguage('en');
    }
  });
});
