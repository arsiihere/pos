import type Database from 'better-sqlite3';

// 03c v1.0.13 §3.2, §4.2 (05 row P-1, R-22): `billPrinterFor` — where a bill, receipt or report prints. 1 statement.
// A bill / receipt: the first ACTIVE printer of device → zone → floor → default (a route whose printer is archived is
// skipped); an id that is not asked for is not consulted. A report (X / Z): the `report` route if set and active, else
// `default`; zone / floor / device are not consulted. A bill never uses `report`. null = no printer.

export interface BillPrinterAsk {
  zone_id?: string | undefined;
  floor_id?: string | undefined;
  device_id?: string | undefined;
  report?: boolean | undefined;
}

const SQL = `SELECT r.printer_id FROM json_each(?) j
  JOIN bill_routes r ON r.scope = json_extract(j.value, '$[0]') AND r.ref_id = json_extract(j.value, '$[1]')
  JOIN printers p ON p.printer_id = r.printer_id AND p.archived_at IS NULL
 ORDER BY j.key LIMIT 1`;

export function billPrinterFor(db: Database.Database, ask: BillPrinterAsk): string | null {
  const chain: Array<[string, string]> = [];
  if (ask.report === true) chain.push(['report', '']);
  else {
    // '' is the ref_id of report / default only, never an entity id
    if (ask.device_id !== undefined && ask.device_id !== '') chain.push(['device', ask.device_id]);
    if (ask.zone_id !== undefined && ask.zone_id !== '') chain.push(['zone', ask.zone_id]);
    if (ask.floor_id !== undefined && ask.floor_id !== '') chain.push(['floor', ask.floor_id]);
  }
  chain.push(['default', '']);
  return (db.prepare(SQL).pluck().get(JSON.stringify(chain)) as string | undefined) ?? null;
}

// ⚠️ 03c v1.0.16 §3.11 Printer (02b-TK R6; hostile run 1): the 03c-internal `slipPrinterRow` — with a `printer_id`,
// that printer if active; else the device → default route chain joined with `printers` (as billPrinterFor, whose
// exported shape stays `string | null`). `{ printer_id, paper_width_mm }` or null. 1 statement.
const SLIP_GIVEN_SQL = 'SELECT printer_id, paper_width_mm FROM printers WHERE printer_id = ? AND archived_at IS NULL';
const SLIP_ROUTE_SQL = `SELECT p.printer_id, p.paper_width_mm FROM json_each(?) j
  JOIN bill_routes r ON r.scope = json_extract(j.value, '$[0]') AND r.ref_id = json_extract(j.value, '$[1]')
  JOIN printers p ON p.printer_id = r.printer_id AND p.archived_at IS NULL
 ORDER BY j.key LIMIT 1`;

export interface SlipPrinter {
  printer_id: string;
  paper_width_mm: number;
}

export function slipPrinterRow(db: Database.Database, ask: { printer_id?: string; device_id: string }): SlipPrinter | null {
  if (ask.printer_id !== undefined) return (db.prepare(SLIP_GIVEN_SQL).get(ask.printer_id) as SlipPrinter | undefined) ?? null;
  const chain: Array<[string, string]> = ask.device_id === '' ? [['default', '']] : [['device', ask.device_id], ['default', '']];
  return (db.prepare(SLIP_ROUTE_SQL).get(JSON.stringify(chain)) as SlipPrinter | undefined) ?? null;
}
