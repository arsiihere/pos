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
