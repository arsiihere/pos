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
