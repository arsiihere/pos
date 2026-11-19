import { describe, expect, it } from 'vitest';
import type { Doc } from '@pos/domain';
import { encodeDoc, ESCPOS, mapText, toPc437, wrapText } from '../../src/print/escpos';

// 03c §3.6 (#30 bytes half; the partial-write retry half is c14's worker): the encoder writes only the listed
// commands (Epson ESC/POS reference), the character mapping is `—` `–` `−` → `-`, `×` → `x`, `·` → space,
// curly quotes → straight, then PC437, else `?`.

const ESC = 0x1b;
const GS = 0x1d;
const DLE = 0x10;
const LF = 0x0a;
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const bytes = (doc: Doc, cols: 32 | 48 = 32): number[] => [...encodeDoc(doc, cols)];

describe('[03c #30] ESC/POS command bytes', () => {
  it('[03c #30] every listed command has its Epson bytes', () => {
    expect([...ESCPOS.init]).toEqual([ESC, 0x40]); // ESC @
    expect([...ESCPOS.align('left')]).toEqual([ESC, 0x61, 0]); // ESC a n
    expect([...ESCPOS.align('center')]).toEqual([ESC, 0x61, 1]);
    expect([...ESCPOS.align('right')]).toEqual([ESC, 0x61, 2]);
    expect([...ESCPOS.bold(true)]).toEqual([ESC, 0x45, 1]); // ESC E n
    expect([...ESCPOS.bold(false)]).toEqual([ESC, 0x45, 0]);
    expect([...ESCPOS.size(1)]).toEqual([GS, 0x21, 0x00]); // GS ! n
    expect([...ESCPOS.size(2)]).toEqual([GS, 0x21, 0x11]); // double width + height
    expect([...ESCPOS.cut]).toEqual([GS, 0x56, 66, 0]); // GS V 66 0
    expect([...ESCPOS.drawer]).toEqual([ESC, 0x70, 0, 25, 250]); // ESC p 0 25 250
    expect([...ESCPOS.statusPrinter]).toEqual([DLE, 0x04, 1]); // DLE EOT 1
    expect([...ESCPOS.statusPaper]).toEqual([DLE, 0x04, 4]); // DLE EOT 4
  });
});

describe('[03c #30] encodeDoc golden bytes', () => {
  it('[03c #30] init, then per block only the state that changes; rule = width dashes; feed = LFs; cut; drawer', () => {
    const doc: Doc = {
      blocks: [
        { text: 'GRILL', size: 2, bold: true, align: 'center' },
        { text: 'T4 · 12:05' },
        { rule: true },
        { text: '2 x Naan', bold: true },
        { text: 'TOTAL', align: 'right' },
        { feed: 2 },
        { cut: true },
        { drawer: true },
      ],
    };
    expect(bytes(doc, 32)).toEqual([
      ESC, 0x40,
      ESC, 0x61, 1, ESC, 0x45, 1, GS, 0x21, 0x11, ...ascii('GRILL'), LF,
      ESC, 0x61, 0, ESC, 0x45, 0, GS, 0x21, 0x00, ...ascii('T4   12:05'), LF,
      ...ascii('-'.repeat(32)), LF,
      ESC, 0x45, 1, ...ascii('2 x Naan'), LF,
      ESC, 0x61, 2, ESC, 0x45, 0, ...ascii('TOTAL'), LF,
      LF, LF,
      GS, 0x56, 66, 0,
      ESC, 0x70, 0, 25, 250,
    ]);
  });

  it('[03c #30] a rule after a size-2 block returns to size 1; width_cols on the Doc wins over the default', () => {
    const doc: Doc = { width_cols: 48, blocks: [{ text: 'A', size: 2 }, { rule: true }] };
    expect(bytes(doc, 32)).toEqual([ESC, 0x40, GS, 0x21, 0x11, ...ascii('A'), LF, GS, 0x21, 0x00, ...ascii('-'.repeat(48)), LF]);
  });

  it('[03c #30] text is wrapped to the width (half at size 2), one LF per line; empty text = one LF', () => {
    const long = 'Chicken Karahi Special Family Size';
    expect(bytes({ blocks: [{ text: long }] }, 32)).toEqual([ESC, 0x40, ...ascii('Chicken Karahi Special Family'), LF, ...ascii('Size'), LF]);
    expect(bytes({ blocks: [{ text: long, size: 2 }] }, 32)).toEqual([
      ESC, 0x40, GS, 0x21, 0x11,
      ...ascii('Chicken Karahi'), LF, ...ascii('Special Family'), LF, ...ascii('Size'), LF,
    ]);
    expect(bytes({ blocks: [{ text: '' }] })).toEqual([ESC, 0x40, LF]);
  });

  it('[03c #30] PC437 bytes and `?` reach the printer; no byte outside the listed commands', () => {
    expect(bytes({ blocks: [{ text: 'Café — 2×½ “x” نان' }] })).toEqual([
      ESC, 0x40, ...ascii('Caf'), 0x82, ...ascii(' - 2x'), 0xab, ...ascii(' "x" ???'), LF,
    ]);
  });

  it('[03c #30] a newline in a text block is a line break, not `?`', () => {
    expect(bytes({ blocks: [{ text: 'a\nb' }] })).toEqual([ESC, 0x40, ...ascii('a'), LF, ...ascii('b'), LF]);
    expect(bytes({ blocks: [{ text: 'a\r\nb' }] })).toEqual([ESC, 0x40, ...ascii('a'), LF, ...ascii('b'), LF]);
  });

  it('[03c #30] negative or fractional feed is floored at 0', () => {
    expect(bytes({ blocks: [{ feed: -1 }, { feed: 1.7 }] })).toEqual([ESC, 0x40, LF]);
  });
});

describe('[03c §3.6] character mapping table', () => {
  const table: Array<[string, string]> = [
    ['—', '-'], // — em dash
    ['–', '-'], // – en dash
    ['−', '-'], // − minus
    ['×', 'x'], // ×
    ['·', ' '], // · (PC437 has 0xFA, but the mapping comes first)
    ['‘', "'"],
    ['’', "'"],
    ['‚', "'"],
    ['‛', "'"],
    ['“', '"'],
    ['”', '"'],
    ['„', '"'],
    ['‟', '"'],
  ];
  it.each(table)('[03c §3.6] %s → %s', (from, to) => {
    expect(mapText(from)).toBe(to);
    expect(toPc437(from)).toEqual({ bytes: Uint8Array.from(ascii(to)), lossy: false });
  });

  it('[03c §3.6] PC437 high half: é ü £ ñ ½ ° ß µ NBSP → their code points', () => {
    expect([...toPc437('éü£ñ½°ßµ ').bytes]).toEqual([0x82, 0x81, 0x9c, 0xa4, 0xab, 0xf8, 0xe1, 0xe6, 0xff]);
    expect(toPc437('Ça').lossy).toBe(false);
  });

  it('[03c §3.6] decomposed accents are composed first (NFC)', () => {
    expect([...toPc437('é').bytes]).toEqual([0x82]);
  });

  it('[03c §3.6] outside PC437 → `?` per character (Urdu, emoji, control, DEL) and lossy', () => {
    expect(toPc437('نان')).toEqual({ bytes: Uint8Array.from(ascii('???')), lossy: true });
    expect(toPc437('a😀b')).toEqual({ bytes: Uint8Array.from(ascii('a?b')), lossy: true });
    expect(toPc437('a\tb\x7f')).toEqual({ bytes: Uint8Array.from(ascii('a?b?')), lossy: true });
    expect(toPc437('Naan x2').lossy).toBe(false);
  });
});

describe('[03c §3.6] wrap to 32 / 48; long words break', () => {
  it('[03c §3.6] greedy on spaces, inner spacing kept, trailing spaces trimmed', () => {
    expect(wrapText('- 1 x Naan  3 left', 32)).toEqual(['- 1 x Naan  3 left']);
    expect(wrapText('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
    expect(wrapText('aaa bbb  ', 32)).toEqual(['aaa bbb']);
    expect(wrapText('  + Raita', 32)).toEqual(['  + Raita']);
  });

  it('[03c §3.6] a word longer than the width breaks at the width', () => {
    expect(wrapText('x'.repeat(70), 32)).toEqual(['x'.repeat(32), 'x'.repeat(32), 'x'.repeat(6)]);
    expect(wrapText('ab ' + 'y'.repeat(50), 48)).toEqual(['ab ' + 'y'.repeat(45), 'y'.repeat(5)]);
    expect(wrapText('  ' + 'z'.repeat(40), 32)).toEqual(['  ' + 'z'.repeat(30), 'z'.repeat(10)]);
  });

  it('[03c §3.6] newlines are hard breaks; empty text is one empty line', () => {
    expect(wrapText('a\nb\r\nc', 32)).toEqual(['a', 'b', 'c']);
    expect(wrapText('', 48)).toEqual(['']);
    expect(wrapText(' '.repeat(40), 32), 'whitespace only → one empty line').toEqual(['']);
  });
});

// 03c v1.0.11 §3.6 (⚠️ 05 row P-3; 05 §10 #86 QR half; owner ruling R-26, 2026-11-19): `{ qr, size? }` → ESC/POS
// GS ( k, model 2, error correction M, module size `size`, else 6 on 80 mm (48 columns) and 4 on 58 mm (32 columns).
describe('[05 #86] QR block → GS ( k', () => {
  const K = [GS, 0x28, 0x6b]; // GS ( k
  const qrBytes = (payload: string, size: number): number[] => {
    const data = [...Buffer.from(payload, 'utf8')];
    const len = data.length + 3;
    return [
      ...K, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00, // fn 165: model 2
      ...K, 0x03, 0x00, 0x31, 0x43, size, // fn 167: module size
      ...K, 0x03, 0x00, 0x31, 0x45, 0x31, // fn 169: error correction M (49)
      ...K, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...data, // fn 180: store data, pL pH = k + 3
      ...K, 0x03, 0x00, 0x31, 0x51, 0x30, // fn 181: print
    ];
  };
  const URL = 'https://reg.pra.punjab.gov.pk/IMSFiscalReport/SearchPOSInvoice_Report.aspx?PRAInvNo=123';

  it('[05 #86] 80 mm (48 columns): default module size 6; exact bytes', () => {
    expect(bytes({ blocks: [{ qr: URL }] }, 48)).toEqual([ESC, 0x40, ...qrBytes(URL, 6)]);
  });

  it('[05 #86] 58 mm (32 columns): default module size 4; exact bytes', () => {
    expect(bytes({ blocks: [{ qr: URL }] }, 32)).toEqual([ESC, 0x40, ...qrBytes(URL, 4)]);
  });

  it('[05 #86] an explicit size (3–8) wins over the paper default, on either paper', () => {
    expect(bytes({ blocks: [{ qr: 'AB', size: 3 }] }, 48)).toEqual([ESC, 0x40, ...qrBytes('AB', 3)]);
    expect(bytes({ blocks: [{ qr: 'AB', size: 8 }] }, 32)).toEqual([ESC, 0x40, ...qrBytes('AB', 8)]);
  });

  it('[05 #86] the default follows the printer paper, not doc.width_cols', () => {
    expect(bytes({ width_cols: 48, blocks: [{ qr: 'AB' }] }, 32)).toEqual([ESC, 0x40, ...qrBytes('AB', 4)]);
  });

  it('[05 #86] a 400-character payload: pL / pH carry k + 3 = 403 (0x93, 0x01)', () => {
    const out = bytes({ blocks: [{ qr: 'x'.repeat(400) }] }, 48);
    expect(out).toEqual([ESC, 0x40, ...qrBytes('x'.repeat(400), 6)]);
    expect(out.slice(2 + 9 + 8 + 8, 2 + 9 + 8 + 8 + 5)).toEqual([...K, 0x93, 0x01]);
  });

  it('[05 #86, 03c §3.6] the fiscal number line beside the QR is ordinary text: a printer that ignores GS ( k still prints it', () => {
    const out = bytes({ blocks: [{ text: 'PRA invoice no. 123' }, { qr: 'AB' }, { text: 'Thank you' }] }, 48);
    expect(out).toEqual([ESC, 0x40, ...ascii('PRA invoice no. 123'), LF, ...qrBytes('AB', 6), ...ascii('Thank you'), LF]);
  });

  it('[05 #86, R-26] a multi-byte payload: pL pH = its UTF-8 bytes + 3, the bytes stored as UTF-8 (literal bytes)', () => {
    // 'é€' = 2 code points, 2 UTF-16 units, 5 UTF-8 bytes (C3 A9, E2 82 AC) → pL pH = 8, 0
    expect(bytes({ blocks: [{ qr: 'é€' }] }, 48)).toEqual([
      ESC, 0x40,
      ...K, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,
      ...K, 0x03, 0x00, 0x31, 0x43, 0x06,
      ...K, 0x03, 0x00, 0x31, 0x45, 0x31,
      ...K, 0x08, 0x00, 0x31, 0x50, 0x30, 0xc3, 0xa9, 0xe2, 0x82, 0xac,
      ...K, 0x03, 0x00, 0x31, 0x51, 0x30,
    ]);
  });

  it('[05 #86, R-26] the 400 limit counts code points, not UTF-16 units or bytes', () => {
    // '😀' = 1 code point, 2 UTF-16 units, 4 UTF-8 bytes: 400 of them pass (1 600 bytes → pL pH = 1 603 = 0x43, 0x06)
    const out = bytes({ blocks: [{ qr: '😀'.repeat(400) }] }, 48);
    expect(out.slice(2 + 9 + 8 + 8, 2 + 9 + 8 + 8 + 5)).toEqual([...K, 0x43, 0x06]);
    expect(() => encodeDoc({ blocks: [{ qr: '😀'.repeat(401) }] }, 48)).toThrow(/qr/);
    expect(() => encodeDoc({ blocks: [{ qr: 'é'.repeat(400) }] }, 48), '400 two-byte characters pass').not.toThrow();
  });

  it('[05 #86, 03c §3.6] refused at encode: a payload over 400 characters, an empty payload, or a size outside 3–8', () => {
    expect(() => encodeDoc({ blocks: [{ qr: 'x'.repeat(401) }] }, 48)).toThrow(/qr/);
    expect(() => encodeDoc({ blocks: [{ qr: '' }] }, 48)).toThrow(/qr/);
    for (const size of [2, 9, 4.5]) {
      expect(() => encodeDoc({ blocks: [{ qr: 'AB', size: size as 3 }] }, 48)).toThrow(/qr/);
    }
  });
});
