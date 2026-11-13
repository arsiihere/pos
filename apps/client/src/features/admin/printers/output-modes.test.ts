import { describe, expect, it } from 'vitest';
import { outputPayload, outputRow, optionOf } from './output-modes';
import { PRINT_CONFIG } from './test-data';

const printers = PRINT_CONFIG.printers;
const toggles = { show_taker: true, show_order_id: false };

describe('station output modes (03c-D04)', () => {
  it('[03c §3.2] 4 options ↔ 3 modes: Screen only = screen + null; fallback = screen + printer (client requires the printer); both / printer require printer_id', () => {
    // Screen only always sends printer_id null explicitly (it releases a fallback printer)
    expect(outputPayload('S-T', 'screen', 'P1', toggles)).toEqual({ ok: true, payload: { station_id: 'S-T', mode: 'screen', printer_id: null, ...toggles } });
    expect(outputPayload('S-T', 'fallback', 'P1', toggles)).toEqual({ ok: true, payload: { station_id: 'S-T', mode: 'screen', printer_id: 'P1', ...toggles } });
    expect(outputPayload('S-T', 'both', 'P2', toggles)).toEqual({ ok: true, payload: { station_id: 'S-T', mode: 'both', printer_id: 'P2', ...toggles } });
    expect(outputPayload('S-T', 'printer', 'P2', toggles)).toEqual({ ok: true, payload: { station_id: 'S-T', mode: 'printer', printer_id: 'P2', ...toggles } });
    // the hub would take screen + null as "Screen only": the client asks for the printer instead
    for (const option of ['fallback', 'both', 'printer'] as const) {
      expect(outputPayload('S-T', option, null, toggles)).toEqual({ ok: false, error: 'outputs.need_printer' });
    }
  });

  it('[03c §3.2] read back: screen + printer_id → "fallback"; archived row printer null → "released when archived"', () => {
    expect(optionOf({ mode: 'screen', printer_id: 'P1' })).toBe('fallback');
    expect(optionOf({ mode: 'screen', printer_id: null })).toBe('screen');
    expect(optionOf({ mode: 'both', printer_id: 'P1' })).toBe('both');
    expect(optionOf({ mode: 'printer', printer_id: 'P2' })).toBe('printer');
    const [tandoor, karahi, fryer, cold, grill] = PRINT_CONFIG.station_outputs;
    expect(outputRow(tandoor!, printers)).toEqual({ option: 'Screen, paper if the screen is off', printer: 'Tandoor printer', ticket: 'taker · order no.' });
    expect(outputRow(karahi!, printers)).toEqual({ option: 'Screen only', printer: '—', ticket: '—' });
    expect(outputRow(fryer!, printers)).toEqual({ option: 'Screen and paper', printer: 'Tandoor printer', ticket: 'order no.' });
    expect(outputRow(cold!, printers)).toEqual({ option: 'Paper only', printer: 'Cold printer', ticket: 'taker · order no.' });
    expect(outputRow(grill!, printers)).toEqual({ option: '—', printer: 'No printer — released when archived', ticket: '' });
  });
});
