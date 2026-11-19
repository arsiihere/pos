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
  | { qr: string; size?: 3 | 4 | 5 | 6 | 7 | 8 };

export interface Doc {
  width_cols?: 32 | 48;
  blocks: DocBlock[];
}
