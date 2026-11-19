import { mapText, toPc437, wrapText, type Doc } from '@pos/domain';

// 03c §3.6: ESC/POS encoder (no library) and the PC437 character mapping. Pure, 0 statements. Only the commands the
// spec lists (Epson ESC/POS reference, checked 2026-11-11): ESC @, ESC a n, ESC E n, GS ! n, GS V 66 0,
// ESC p 0 25 250, DLE EOT 1 / DLE EOT 4. Code page: PC437, the printer default after ESC @ (P10).
// ⚠️ 03c v1.0.11 §3.6 (05 row P-4): the mapping and wrapping (toPc437, mapText, wrapText) live in
// @pos/domain/src/print-render.ts with renderText, so the preview and the paper share them; re-exported here.

export { mapText, toPc437, wrapText };

// ⚠️ 03c v1.0.13 §3.6 (05 row P-3; owner ruling R-26, 2026-11-19): the QR block. Payload 1–400 characters,
// counted in code points; stored as UTF-8 (pL pH = its bytes + 3). Module size `size` (3–8), else 6 on 80 mm paper
// and 4 on 58 mm (the printer's paper, i.e. its `width_cols` 48 / 32, not `doc.width_cols`). A Doc outside these
// bounds throws here, at send: the worker cancels the job `render_failed` (worker.ts start), the same path as any
// corrupt Doc. printDocument does not refuse it (03c §3.9 lists only PRINTER_NOT_FOUND; 05 §3.16 R8).
export const QR_MAX_CHARS = 400;
export const QR_DEFAULT_SIZE: Record<32 | 48, number> = { 32: 4, 48: 6 };

type Align = 'left' | 'center' | 'right';

const ESC = 0x1b;
const GS = 0x1d;
const DLE = 0x10;
const EOT = 0x04;
const LF = 0x0a;

const ALIGN_N: Record<Align, number> = { left: 0, center: 1, right: 2 };

export const ESCPOS = {
  init: Uint8Array.of(ESC, 0x40),
  align: (a: Align): Uint8Array => Uint8Array.of(ESC, 0x61, ALIGN_N[a]),
  bold: (on: boolean): Uint8Array => Uint8Array.of(ESC, 0x45, on ? 1 : 0),
  /** GS ! n: 1 = normal, 2 = double width and height (0x11). */
  size: (s: 1 | 2): Uint8Array => Uint8Array.of(GS, 0x21, s === 2 ? 0x11 : 0x00),
  /** GS V 66 0: feed to the cutter and cut. */
  cut: Uint8Array.of(GS, 0x56, 66, 0),
  /** ESC p 0 25 250: drawer kick on pin 2 (§3.9). */
  drawer: Uint8Array.of(ESC, 0x70, 0, 25, 250),
  /** DLE EOT 1: printer status (c15 reads the answer). */
  statusPrinter: Uint8Array.of(DLE, EOT, 1),
  /** DLE EOT 4: paper roll sensor status. */
  statusPaper: Uint8Array.of(DLE, EOT, 4),
} as const;

const GS_K = [GS, 0x28, 0x6b] as const; // GS ( k, cn 49 (QR code)

/** §3.6 (row P-3): GS ( k fn 165 model 2, fn 167 module size, fn 169 error correction M, fn 180 store (pL pH = k + 3), fn 181 print. */
export function qrBytes(payload: string, size: number): Uint8Array {
  const chars = [...payload].length; // R-26: code points, not UTF-16 units or bytes
  if (chars === 0) throw new Error('qr: empty payload');
  if (chars > QR_MAX_CHARS) throw new Error(`qr: payload over ${QR_MAX_CHARS} characters`);
  if (!Number.isInteger(size) || size < 3 || size > 8) throw new Error('qr: size outside 3-8');
  const data = new TextEncoder().encode(payload);
  const len = data.length + 3;
  return Uint8Array.from([
    ...GS_K, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,
    ...GS_K, 0x03, 0x00, 0x31, 0x43, size,
    ...GS_K, 0x03, 0x00, 0x31, 0x45, 0x31,
    ...GS_K, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...data,
    ...GS_K, 0x03, 0x00, 0x31, 0x51, 0x30,
  ]);
}

/** §3.6: a Doc as ESC/POS bytes; `doc.width_cols` wins over the printer's `width_cols`. */
export function encodeDoc(doc: Doc, width_cols: 32 | 48): Buffer {
  const cols = doc.width_cols ?? width_cols;
  const parts: Uint8Array[] = [ESCPOS.init];
  let align: Align = 'left';
  let bold = false;
  let size: 1 | 2 = 1;
  const setSize = (s: 1 | 2): void => {
    if (s !== size) parts.push(ESCPOS.size(s));
    size = s;
  };
  for (const block of doc.blocks) {
    if ('text' in block) {
      const a = block.align ?? 'left';
      const b = block.bold ?? false;
      if (a !== align) parts.push(ESCPOS.align(a));
      if (b !== bold) parts.push(ESCPOS.bold(b));
      align = a;
      bold = b;
      setSize(block.size ?? 1);
      for (const line of block.text.split(/\r?\n/).flatMap((p) => wrapText(mapText(p), Math.floor(cols / size)))) {
        parts.push(toPc437(line).bytes, Uint8Array.of(LF));
      }
    } else if ('rule' in block) {
      setSize(1);
      parts.push(toPc437('-'.repeat(cols)).bytes, Uint8Array.of(LF));
    } else if ('feed' in block) {
      parts.push(new Uint8Array(Math.max(0, Math.floor(block.feed))).fill(LF));
    } else if ('qr' in block) {
      parts.push(qrBytes(block.qr, block.size ?? QR_DEFAULT_SIZE[width_cols]));
    } else if ('cut' in block) {
      parts.push(ESCPOS.cut);
    } else {
      parts.push(ESCPOS.drawer);
    }
  }
  return Buffer.concat(parts);
}
