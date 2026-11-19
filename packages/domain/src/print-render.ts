import type { Doc } from './print.js';

// 03c v1.0.11 §3.6, §4.2 (⚠️ Changed by 05 (row P-4)): the text preview of a Doc (05's receipt preview in the owner
// app and the hub), 0 statements, browser-safe (no node:*; bytes are a Uint8Array). Moved from the hub (print/render/text.ts) with
// the §3.6 character mapping and wrapping it shares with the hub's ESC/POS encoder (print/escpos.ts imports them from
// here), so the preview and the paper stay the same text. Text wraps at width / size and is aligned as the printer
// does (size columns per character); a rule is `-` × width; a feed is empty lines; cut and drawer print nothing.
// ⚠️ 03c v1.0.11 §3.6 (05 row P-3): a QR block prints `[QR] <payload>`, mapped and wrapped like a text line.

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

/** §3.6, §4.2: the text preview of a Doc; `doc.width_cols` wins over `width_cols`. 0 statements. */
export function renderText(doc: Doc, width_cols: 32 | 48): string {
  const cols = doc.width_cols ?? width_cols;
  const out: string[] = [];
  for (const block of doc.blocks) {
    if ('text' in block) {
      const align = block.align ?? 'left';
      const size = block.size ?? 1;
      for (const line of block.text.split(/\r?\n/).flatMap((p) => wrapText(mapText(p), Math.floor(cols / size)))) {
        const free = cols - line.length * size; // a size-2 character takes 2 printer columns
        if (align === 'right') out.push(' '.repeat(free) + line);
        else if (align === 'center') out.push(' '.repeat(Math.floor(free / 2)) + line);
        else out.push(line);
      }
    } else if ('qr' in block) out.push(...wrapText(mapText(`[QR] ${block.qr}`), cols));
    else if ('rule' in block) out.push('-'.repeat(cols));
    else if ('feed' in block) for (let i = 0; i < Math.floor(block.feed); i += 1) out.push('');
  }
  return out.join('\n');
}
