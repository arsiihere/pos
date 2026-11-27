import type { HubConfigStatus } from '@pos/events';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHubClock } from '../../../app/hub-clock';
import { setLanguage } from '../../../i18n';
import { ConfigStatus } from './ConfigStatus';

// ⚠️ 02b-TK L-CLIENT-2 item 1 (01a v2.11 §6.21 (run 3 R3-B-1), §6.9a; D7): a Pass archive the hub refuses at apply keeps
// last_problem.reason 'apply_failed' and adds code VALIDATION_FAILED with details.issues
// [{ path: 'archived', message: 'Activate another Pass point first' }] (hub a6e905d). The hub admin config status shows
// "Activate another Pass point first" for it instead of the generic apply_failed text; any other problem is unchanged.

const HOUR = 3_600_000;
const OFFSET = 5 * HOUR;
const hubAt = (h: number, m = 0) => Date.UTC(2026, 9, 25, h, m) - OFFSET;
const STATUS: HubConfigStatus = {
  tenant_id: 'T1',
  branch_id: 'B1',
  config_version: 42,
  snapshot_schema_version: 4,
  applied_at: hubAt(8),
  directory_version: 2,
  last_poll: { outcome: 'rejected', at: hubAt(11) },
  last_problem: null,
  stuck_alerts: 0,
};
const ARCHIVE = { issues: [{ path: 'archived', message: 'Activate another Pass point first' }] };

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setLanguage('en');
});

const dangerText = () => container.querySelector('.pos-banner--danger p')?.firstChild?.textContent;
const render = (status: HubConfigStatus) => act(() => root.render(<ConfigStatus status={status} clock={createHubClock({ now_ms: hubAt(11, 2), utc_offset_ms: OFFSET })} />));

describe('[01a v2.11 §6.21 (R3-B-1), D7] config status: the refused Pass archive', () => {
  it('apply_failed with VALIDATION_FAILED and an `archived` issue → "activate another Pass point first", with the version still in use', () => {
    render({ ...STATUS, last_problem: { outcome: 'rejected', reason: 'apply_failed', at: hubAt(11), code: 'VALIDATION_FAILED', details: ARCHIVE } });
    expect(dangerText()).toBe('Menu update refused: activate another Pass point first. The hub is still using version 42.');
  });

  it('another code, other issues, no details or an older hub without code keep the generic apply_failed text', () => {
    const generic = 'Menu update could not be applied. The hub is still using version 42.';
    for (const extra of [{}, { code: 'CONFLICT', details: ARCHIVE }, { code: 'VALIDATION_FAILED' }, { code: 'VALIDATION_FAILED', details: { issues: [{ path: 'stations', message: 'x' }] } }, { code: 'VALIDATION_FAILED', details: 'archived' }]) {
      render({ ...STATUS, last_problem: { outcome: 'rejected', reason: 'apply_failed', at: hubAt(11), ...extra } });
      expect(dangerText(), JSON.stringify(extra)).toBe(generic);
    }
  });

  it('Urdu: the refusal in Urdu', () => {
    setLanguage('ur');
    render({ ...STATUS, last_problem: { outcome: 'rejected', reason: 'apply_failed', at: hubAt(11), code: 'VALIDATION_FAILED', details: ARCHIVE } });
    expect(dangerText()).toContain('پہلے کوئی اور پاس پوائنٹ فعال کریں');
  });
});
