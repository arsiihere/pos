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
