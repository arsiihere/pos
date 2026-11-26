// 03c §3.6: the document a print job renders (ticket, slip, coming-up; 05's bills / receipts / Z through
// printDocument, §3.9). Browser-safe. Wrapped to 32 / 48 columns; long words break.

export type DocBlock =
  | { text: string; size?: 1 | 2; bold?: boolean; align?: 'left' | 'center' | 'right' }
  | { rule: true }
  | { feed: number }
  | { cut: true }
  | { drawer: true } // §3.9: drawer kick
  // ⚠️ 03c v1.0.11 §3.6 (05 row P-3): a QR code (ESC/POS GS ( k, model 2, error correction M); payload ≤ 400
  // characters; module size `size`, else the paper default (owner ruling R-26: 6 on 80 mm, 4 on 58 mm).
  | { qr: string; size?: 3 | 4 | 5 | 6 | 7 | 8 }
  // ⚠️ 03c v1.0.11 §3.6, §3.7 (05 row P-5): a fill block, replaced at send by the hub worker through the filler
  // registered for `fill` (registerDocumentFiller; 05: 'buyer_id' → the full number from invoice_buyers, ref =
  // invoice_id). The stored job keeps this block, never the filled text; renderText (pure) prints `last4`.
  | { fill: string; ref: string; last4: string };

export interface Doc {
  width_cols?: 32 | 48;
  blocks: DocBlock[];
}

/**
 * ⚠️ 03c v1.0.16 §3.11 trigger 1, §4.2 (02b-TK R6; hostile run 1): a queued Send · pay later submit prints its token
 * slip only when `now − queued_at ≤ TAKEAWAY_SLIP_REPLAY_MS`, else `skipped: 'replay_late'` (the customer has probably
 * left). A constant, not a setting.
 */
export const TAKEAWAY_SLIP_REPLAY_MS = 120_000;
