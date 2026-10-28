import { ErrorCatalogue } from '@pos/domain';
import { describe, expect, it } from 'vitest';
import { t } from '../../i18n';
import { errorText } from './form';

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
});
