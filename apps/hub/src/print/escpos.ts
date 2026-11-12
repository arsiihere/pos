import type { Doc } from '@pos/domain';

// 03c §3.6: ESC/POS encoder (no library) and the PC437 character mapping. Pure, 0 statements. Only the commands the
// spec lists (Epson ESC/POS reference, checked 2026-11-11): ESC @, ESC a n, ESC E n, GS ! n, GS V 66 0,
// ESC p 0 25 250, DLE EOT 1 / DLE EOT 4. Code page: PC437, the printer default after ESC @ (P10).

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

// §3.6 mapping, applied before PC437.
const ASCII_MAP: ReadonlyMap<string, string> = new Map([
  ['—', '-'], ['–', '-'], ['−', '-'],
  ['×', 'x'],
  ['·', ' '],
  ['‘', "'"], ['’', "'"], ['‚', "'"], ['‛', "'"],
  ['“', '"'], ['”', '"'], ['„', '"'], ['‟', '"'],
]);

// PC437 bytes 0x80–0xFF (IBM code page 437).
const PC437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩' +
  '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

const PC437_BYTE: ReadonlyMap<string, number> = new Map([...PC437_HIGH].map((c, i) => [c, 0x80 + i]));

function byteOf(ch: string): number | undefined {
  const code = ch.codePointAt(0)!;
  if (code >= 0x20 && code <= 0x7e) return code;
  return PC437_BYTE.get(ch);
}

/** NFC, the §3.6 mapping, then PC437: bytes plus whether any character fell back to `?` (`lossy_name`, §3.2). */
export function toPc437(text: string): { bytes: Uint8Array; lossy: boolean } {
  const out: number[] = [];
  let lossy = false;
  for (const raw of text.normalize('NFC')) {
    const ch = ASCII_MAP.get(raw) ?? raw;
    const b = byteOf(ch);
    if (b === undefined) {
      lossy = true;
      out.push(0x3f);
    } else out.push(b);
  }
  return { bytes: Uint8Array.from(out), lossy };
}

/** The text as the printer shows it: one character per column (for wrapping and the text preview). Split on newlines first: a newline maps to `?`. */
export function mapText(text: string): string {
  let s = '';
  for (const b of toPc437(text).bytes) s += b < 0x80 ? String.fromCharCode(b) : PC437_HIGH[b - 0x80]!;
  return s;
}

/** §3.6: wrap one mapped text to `cols`; greedy on spaces, inner spacing kept; a word longer than `cols` breaks. */
export function wrapText(text: string, cols: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let rem = para;
    if (rem.trim() === '') {
      lines.push('');
      continue;
    }
    while (rem.length > cols) {
      const i = rem.lastIndexOf(' ', cols);
      const head = i > 0 ? rem.slice(0, i) : '';
      const nextSpace = rem.indexOf(' ', i + 1);
      const nextWordLen = (nextSpace === -1 ? rem.length : nextSpace) - (i + 1);
      if (head.trim() === '' || nextWordLen > cols) {
        lines.push(rem.slice(0, cols).trimEnd());
        rem = rem.slice(cols).trimStart();
      } else {
        lines.push(head.trimEnd());
        rem = rem.slice(i + 1).trimStart();
      }
    }
    lines.push(rem.trimEnd());
  }
  return lines;
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
    } else if ('cut' in block) {
      parts.push(ESCPOS.cut);
    } else {
      parts.push(ESCPOS.drawer);
    }
  }
  return Buffer.concat(parts);
}
