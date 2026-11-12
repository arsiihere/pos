// 03c §3.6: the document a print job renders (ticket, slip, coming-up; 05's bills / receipts / Z through
// printDocument, §3.9). Browser-safe. Wrapped to 32 / 48 columns; long words break.

export type DocBlock =
  | { text: string; size?: 1 | 2; bold?: boolean; align?: 'left' | 'center' | 'right' }
  | { rule: true }
  | { feed: number }
  | { cut: true }
  | { drawer: true }; // §3.9: drawer kick

export interface Doc {
  width_cols?: 32 | 48;
  blocks: DocBlock[];
}
