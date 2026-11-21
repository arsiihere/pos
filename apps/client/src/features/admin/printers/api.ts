import type { HubAdminOptions } from '../../../api/hub-admin';
import { createAdminPageApi } from '../kitchen-screens/api';

// 03c §3.2, §6.2–§6.7, §8 (task A2): the hub client of /admin/printers/ (admin session, `manage-devices`). Sign-in
// and the command envelope are the 03 admin pages' shared part (kitchen-screens/api.ts). Q-54: nothing here repeats a
// read on its own.

export type PrinterStatus = 'clean' | 'paper_out' | 'offline' | 'unknown';
export type OutputMode = 'screen' | 'both' | 'printer';

/** 03c §6.6 `printers[]` (print-config: the printers table + printer_runtime). */
export interface ConfigPrinter {
  printer_id: string;
  name: string;
  connection: 'lan' | 'usb';
  address: string;
  paper_width_mm: 58 | 80;
  archived_at: number | null;
  supports_status: number | null;
  last_status: PrinterStatus | null;
  last_status_at: number | null;
  last_ack_at: number | null;
  last_error: string | null;
}

export interface StationOutput {
  station_id: string;
  name: string | null;
  mode: OutputMode;
  printer_id: string | null;
  show_taker: boolean;
  show_order_id: boolean;
  screen_paired: boolean;
  archived: boolean;
}

/** 03c §6.6; `name` on `lossy_name` is Q-48 (hub task HK6): absent before it lands. */
export interface PrintConfigWarning {
  station_id?: string | null;
  item_id?: string;
  name?: string;
  kind: 'lossy_name' | 'fold_skipped' | 'suspect_waiting' | 'screen_unused' | 'no_screen';
}

/** 03c v1.0.13 §3.2, §6.6, §6.13 (05 row P-1, R-22): `ref_id` is '' for `report` and `default`. */
export type BillScope = 'zone' | 'floor' | 'device' | 'report' | 'default';
export interface BillRoute {
  scope: BillScope;
  ref_id: string;
  printer_id: string;
}

export interface SetBillRoutePayload {
  scope: BillScope;
  ref_id: string;
  printer_id: string | null;
}

/** 00 §6.14 `GET /admin/queries/devices` (only the fields this page reads). */
export interface BillDevice {
  device_id: string;
  device_name: string;
  device_type: string;
  revoked_at: number | null;
}

/** 03c v1.0.14 §6.6 (R-38): the zones and floors a bill route can name (from the branch config; names, not just ids). */
export interface ConfigZone {
  zone_id: string;
  /** a zone name is unique only within its floor (01a), so the page shows the floor too */
  floor_id: string;
  name: string;
  archived: boolean;
}
export interface ConfigFloor {
  floor_id: string;
  name: string;
  archived: boolean;
}

export interface PrintConfig {
  printers: ConfigPrinter[];
  station_outputs: StationOutput[];
  bill_routes: BillRoute[];
  zones: ConfigZone[];
  floors: ConfigFloor[];
  warnings: PrintConfigWarning[];
}

/** 03c §6.7 print-queue. */
export interface QueuePrinter {
  printer_id: string;
  name: string;
  status: PrinterStatus;
  waiting: number;
  suspect: number;
  head_error: string | null;
  last_ack_at: number | null;
}

export interface QueueJob {
  job_id: string;
  kind: 'kitchen' | 'reprint' | 'cancel' | 'first' | 'coming_up' | 'document';
  printer_id: string | null;
  station_id: string | null;
  ticket_id: string | null;
  order_id: string | null;
  created_at: number;
  sent_at: number | null;
  attempts: number;
  last_error: string | null;
  is_reprint: boolean;
  suspect_at: number | null;
  no_printer: boolean;
}

export interface PrintQueue {
  printers: QueuePrinter[];
  jobs: QueueJob[];
  no_printer: number;
}

export interface SavePrinterPayload {
  printer_id?: string;
  name: string;
  connection: 'lan' | 'usb';
  address: string;
  paper_width_mm: 58 | 80;
  archived: boolean;
}

export interface SavedPrinter {
  printer: Required<Omit<SavePrinterPayload, 'printer_id'>> & { printer_id: string };
}

/** 03c §6.4 `POST /admin/print/test`. */
export interface TestPrintResult {
  printed: boolean;
  status: PrinterStatus;
  error: string | null;
}

export interface SetStationOutputPayload {
  station_id: string;
  mode: OutputMode;
  printer_id: string | null;
  show_taker?: boolean;
  show_order_id?: boolean;
}

export function createPrintersApi(options: HubAdminOptions) {
  const page = createAdminPageApi(options);
  return {
    ...page,
    // §6.6, §6.7
    printConfig: () => page.query<PrintConfig>('print-config'),
    printQueue: () => page.query<PrintQueue>('print-queue'),
    // §6.2
    savePrinter: (payload: SavePrinterPayload, commandId: string) => page.command<SavedPrinter>('SavePrinter', { ...payload }, commandId),
    // §6.3
    setStationOutput: (payload: SetStationOutputPayload, commandId: string) => page.command<unknown>('SetStationOutput', { ...payload }, commandId),
    // §6.13: one route per (scope, ref_id); printer_id null removes it
    setBillRoute: (payload: SetBillRoutePayload, commandId: string) => page.command<unknown>('SetBillRoute', { ...payload }, commandId),
    // 00 §6.14: the devices a bill route can name
    devices: () => page.query<{ devices: BillDevice[] }>('devices'),
    // §6.4 (outside the FIFO, ≤ 8 s)
    testPrint: (printerId: string) => page.post<TestPrintResult>('/admin/print/test', { printer_id: printerId }),
    // §6.5
    cancelJob: (jobId: string) => page.post<{ job_id: string; cancelled_at: number }>(`/admin/print/jobs/${encodeURIComponent(jobId)}/cancel`, {}),
  };
}

export type PrintersApi = ReturnType<typeof createPrintersApi>;
