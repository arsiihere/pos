import { t, type MessageKey } from '../../../i18n';
import type { ConfigPrinter, OutputMode, SetStationOutputPayload, StationOutput } from './api';

// 03c §3.2, §6.3; brief §3.5.5 and the gap record's "3 modes ↔ 4 design options" table: the four options of the
// output editor (03c-D04) and the three stored modes.
//
// | option   | mode    | printer_id                       |
// | screen   | screen  | null (sent, releases a fallback) |
// | fallback | screen  | required (client rule)           |
// | both     | both    | required (hub 400 otherwise)     |
// | printer  | printer | required (hub 400 otherwise)     |

export type OutputOption = 'screen' | 'fallback' | 'both' | 'printer';

export const OUTPUT_OPTIONS: readonly OutputOption[] = ['screen', 'fallback', 'both', 'printer'];

export const OPTION_KEY: Record<OutputOption, MessageKey> = {
  screen: 'outputs.mode.screen',
  fallback: 'outputs.mode.fallback',
  both: 'outputs.mode.both',
  printer: 'outputs.mode.printer',
};

/** Read back (print-config `station_outputs[]`): `screen` with a printer is "Screen, paper if the screen is off". */
export function optionOf(o: { mode: OutputMode; printer_id: string | null }): OutputOption {
  return o.mode === 'screen' && o.printer_id !== null ? 'fallback' : o.mode;
}

export function outputPayload(
  stationId: string,
  option: OutputOption,
  printerId: string | null,
  toggles: { show_taker: boolean; show_order_id: boolean },
): { ok: true; payload: SetStationOutputPayload } | { ok: false; error: 'outputs.need_printer' } {
  if (option === 'screen') return { ok: true, payload: { station_id: stationId, mode: 'screen', printer_id: null, ...toggles } };
  if (printerId === null) return { ok: false, error: 'outputs.need_printer' };
  return { ok: true, payload: { station_id: stationId, mode: option === 'fallback' ? 'screen' : option, printer_id: printerId, ...toggles } };
}

const NONE = '—';

/** One Station outputs row (frame Printers): option, printer and "On the ticket" (the two toggles, paper only). */
export function outputRow(o: StationOutput, printers: readonly ConfigPrinter[]): { option: string; printer: string; ticket: string } {
  // Q-18: an archived station's apply released its printer; the row is read-only.
  if (o.archived && o.printer_id === null) return { option: NONE, printer: t('admin.pr.output_released'), ticket: '' };
  const printer = o.printer_id === null ? NONE : (printers.find((p) => p.printer_id === o.printer_id)?.name ?? o.printer_id);
  const parts = [o.show_taker ? t('outputs.ticket_taker') : null, o.show_order_id ? t('outputs.ticket_order_no') : null].filter((p): p is string => p !== null);
  return {
    option: t(OPTION_KEY[optionOf(o)]),
    printer,
    ticket: o.printer_id === null || parts.length === 0 ? NONE : parts.join(' · '),
  };
}
