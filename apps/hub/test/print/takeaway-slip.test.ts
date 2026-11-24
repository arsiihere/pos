import { renderText } from '@pos/domain';
import { describe, expect, it } from 'vitest';
import { encodeDoc } from '../../src/print/escpos';
import { clock12, dayText } from '../../src/print/render/jobs';
import { takeawaySlipReadyAt } from '../../src/print/render/ready-at';
import { buildTakeawaySlipDoc } from '../../src/print/render/takeaway-slip';

const PKT = 5 * 3_600_000;
const placedAt = Date.UTC(2026, 10, 24, 8, 20);
const input = {
  reprint: false,
  branch_name: 'LAKE CITY BRANCH',
  token: 57,
  ready_at_text: '1:42 PM',
  status_url: null,
  placed_at_text: '1:20 PM',
  date_text: '24 Nov 2026',
};

describe('[03c §3.11 #57] takeaway slip without a status link', () => {
  it.each([32, 48] as const)('prints golden ESC/POS bytes at %s columns', (width) => {
    const doc = buildTakeawaySlipDoc({
      ...input, placed_at_text: clock12(placedAt, PKT), date_text: dayText(placedAt, PKT),
    }, width);
    const expected = Buffer.from([
      '\x1b@\x1ba\x01\x1bE\x01LAKE CITY BRANCH\n',
      '\x1bE\x00TAKEAWAY\n',
      '='.repeat(width) + '\n',
      '\x1bE\x01TOKEN\n',
      '\x1d!\x1157\n',
      '\x1bE\x00\x1d!\x00Aap ka token: 57\n',
      '\x1bE\x01Ready around 1:42 PM\n',
      '-'.repeat(width) + '\n',
      'PAY AT THE COUNTER\n',
      '\x1bE\x00Paise counter par dein\n',
      '-'.repeat(width) + '\n',
      '#57  1:20 PM  24 Nov 2026\n\n',
      '\x1dVB\x00',
    ].join(''), 'ascii');
    expect(encodeDoc(doc, width)).toEqual(expected);
    expect(doc.width_cols).toBe(width);
  });

  it('labels a reprint and omits an unknown ready time', () => {
    const doc = buildTakeawaySlipDoc({ ...input, reprint: true, ready_at_text: null }, 32);
    expect(doc.blocks[0]).toEqual({ text: 'REPRINT', align: 'center', bold: true });
    expect(renderText(doc, 32)).not.toContain('Ready around');
  });

  it.each(['', '   ', 'لاہور', 'ABCلاہور'])('omits an unprintable branch name %j', (branch_name) => {
    const doc = buildTakeawaySlipDoc({ ...input, branch_name }, 32);
    expect(doc.blocks[0]).toEqual({ text: 'TAKEAWAY', align: 'center' });
  });

  it('prints PC437 letters and replaces an isolated unsupported letter', () => {
    const doc = buildTakeawaySlipDoc({ ...input, branch_name: 'Café ن' }, 32);
    expect(renderText(doc, 32)).toContain('Café ?');
    expect(encodeDoc(doc, 32)).toContain(0x82);
    expect(renderText(buildTakeawaySlipDoc({ ...input, branch_name: 'ABاب' }, 32), 32)).toContain('AB??');
  });

  it('prints the branch-local date across UTC midnight', () => {
    expect(dayText(Date.UTC(2026, 11, 31, 20), PKT)).toBe('1 Jan 2027');
  });
});

describe('[03c §3.11 #58] ready line for a token', () => {
  const root = {
    order_id: 'root', station_id: 's', stage: 'cooking' as const, serve_mode: 'sync',
    carry_ms: 0, cook_ms: 0, load_id: null, booked: null, done_at: null,
    started_at: 100, fired_at: null, fire_ms: null,
  };
  const addition = { ...root, order_id: 'addition', started_at: 150, serve_mode: 'immediate' };
  const state = {
    orders: { root: { promise_ms: 130, target_land_ms: 100 }, addition: { promise_ms: 180, target_land_ms: 150 } },
    stations: {},
    lines: { root, addition, cancelled: { ...root, order_id: 'cancelled', started_at: null } },
  };
  const orderIds = ['root', 'addition'];

  it('uses the latest customer time across live lines of both orders', () => {
    expect(takeawaySlipReadyAt(state, orderIds, null)).toBe(180);
  });

  it('uses pickup exactly when every live line lands on time, else the latest customer time', () => {
    expect(takeawaySlipReadyAt(state, orderIds, 150)).toBe(150);
    expect(takeawaySlipReadyAt(state, orderIds, 149)).toBe(180);
  });

  it('omits the ready line if any live line is unplanned', () => {
    const lines = { ...state.lines, addition: { ...addition, started_at: null } };
    expect(takeawaySlipReadyAt({ ...state, lines }, orderIds, 150)).toBeNull();
  });

  it('ignores served lines and omits the time if no lines are live', () => {
    const served = { ...addition, stage: 'served' as const };
    expect(takeawaySlipReadyAt({ ...state, lines: { root, served } }, orderIds, null)).toBe(130);
    expect(takeawaySlipReadyAt({ ...state, lines: { served } }, orderIds, null)).toBeNull();
  });
});
