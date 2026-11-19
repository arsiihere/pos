import type { PrintConfig, PrintQueue } from './api';

// Test-only data for the Printers page (frames Printers, PrintersPaperOut).

export const PRINT_CONFIG: PrintConfig = {
  printers: [
    {
      printer_id: 'P1',
      name: 'Tandoor printer',
      connection: 'lan',
      address: '192.168.1.50:9100',
      paper_width_mm: 80,
      archived_at: null,
      supports_status: 1,
      last_status: 'clean',
      last_status_at: 1_000,
      last_ack_at: 900,
      last_error: null,
    },
    {
      printer_id: 'P2',
      name: 'Cold printer',
      connection: 'usb',
      address: '/dev/pos-printer-cold',
      paper_width_mm: 58,
      archived_at: null,
      supports_status: 0,
      last_status: 'unknown',
      last_status_at: null,
      last_ack_at: 800,
      last_error: null,
    },
    {
      printer_id: 'P9',
      name: 'Old fryer printer',
      connection: 'lan',
      address: '192.168.1.60:9100',
      paper_width_mm: 80,
      archived_at: 500,
      supports_status: 1,
      last_status: 'clean',
      last_status_at: null,
      last_ack_at: null,
      last_error: null,
    },
  ],
  station_outputs: [
    { station_id: 'S-T', name: 'Tandoor', mode: 'screen', printer_id: 'P1', show_taker: true, show_order_id: true, screen_paired: true, archived: false },
    { station_id: 'S-K', name: 'Karahi', mode: 'screen', printer_id: null, show_taker: true, show_order_id: true, screen_paired: true, archived: false },
    { station_id: 'S-F', name: 'Fryer', mode: 'both', printer_id: 'P1', show_taker: false, show_order_id: true, screen_paired: true, archived: false },
    { station_id: 'S-C', name: 'Cold', mode: 'printer', printer_id: 'P2', show_taker: true, show_order_id: true, screen_paired: false, archived: false },
    { station_id: 'S-G', name: 'Grill', mode: 'screen', printer_id: null, show_taker: true, show_order_id: true, screen_paired: false, archived: true },
  ],
  bill_routes: [
    { scope: 'default', ref_id: '', printer_id: 'P1' },
    { scope: 'zone', ref_id: 'Z-GARDEN', printer_id: 'P2' },
    { scope: 'zone', ref_id: 'Z-OLD', printer_id: 'P1' },
  ],
  zones: [
    { zone_id: 'Z-GARDEN', floor_id: 'F-1', name: 'Garden', archived: false },
    { zone_id: 'Z-ROOF', floor_id: 'F-2', name: 'Patio', archived: false },
    { zone_id: 'Z-PATIO', floor_id: 'F-1', name: 'Patio', archived: false },
    { zone_id: 'Z-OLD', floor_id: 'F-1', name: 'Old patio', archived: true },
    { zone_id: 'Z-GONE', floor_id: 'F-1', name: 'Gone patio', archived: true },
  ],
  floors: [
    { floor_id: 'F-1', name: 'Ground', archived: false },
    { floor_id: 'F-2', name: 'Roof', archived: false },
  ],
  warnings: [],
};

export const PRINT_QUEUE: PrintQueue = {
  printers: [
    { printer_id: 'P1', name: 'Tandoor printer', status: 'clean', waiting: 0, suspect: 3, head_error: null, last_ack_at: 900 },
    { printer_id: 'P2', name: 'Cold printer', status: 'unknown', waiting: 0, suspect: 0, head_error: null, last_ack_at: 800 },
    { printer_id: 'P9', name: 'Old fryer printer', status: 'clean', waiting: 2, suspect: 0, head_error: null, last_ack_at: null },
  ],
  jobs: [],
  no_printer: 0,
};

/** 00 §6.14 devices (test-only): a cashier kiosk, a tablet, a KDS screen (no bills) and a revoked tablet. */
export const BILL_DEVICES = [
  { device_id: 'D-K', device_name: 'Counter kiosk', device_type: 'cashier_kiosk', revoked_at: null },
  { device_id: 'D-T', device_name: 'Waiter tablet', device_type: 'tablet', revoked_at: null },
  { device_id: 'D-S', device_name: 'Tandoor screen', device_type: 'kds', revoked_at: null },
  { device_id: 'D-X', device_name: 'Lost tablet', device_type: 'tablet', revoked_at: 5 },
];
