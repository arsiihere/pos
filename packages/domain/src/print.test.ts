import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Doc, DocBlock } from './index';

// 03c §3.6: the document a printer job renders; 05 builds bills / receipts / Z with it (§3.9).
describe('[03c §3.6] Doc type', () => {
  it('[03c §3.6] width 32 | 48 (optional); blocks text / rule / feed / cut / drawer', () => {
    expectTypeOf<Doc['width_cols']>().toEqualTypeOf<32 | 48 | undefined>();
    expectTypeOf<Doc['blocks']>().toEqualTypeOf<DocBlock[]>();
    expectTypeOf<Extract<DocBlock, { text: string }>>().toEqualTypeOf<{
      text: string;
      size?: 1 | 2;
      bold?: boolean;
      align?: 'left' | 'center' | 'right';
    }>();
    const doc: Doc = {
      width_cols: 48,
      blocks: [{ text: 'T4', size: 2, bold: true, align: 'center' }, { rule: true }, { feed: 1 }, { cut: true }],
    };
    const drawer: Doc = { blocks: [{ drawer: true }] }; // §3.9: drawer kick
    expect(doc.blocks).toHaveLength(4);
    expect(drawer.width_cols).toBeUndefined();
  });

  it('[03c §3.6] a block is exactly one kind', () => {
    // @ts-expect-error a width other than 32 / 48
    const wide: Doc = { width_cols: 40, blocks: [] };
    // @ts-expect-error an unknown size
    const huge: DocBlock = { text: 'x', size: 3 };
    expect([wide, huge]).toHaveLength(2);
  });

  it('[05 #86, row P-3] the QR block: { qr: string, size?: 3–8 }', () => {
    expectTypeOf<Extract<DocBlock, { qr: string }>>().toEqualTypeOf<{ qr: string; size?: 3 | 4 | 5 | 6 | 7 | 8 }>();
    const qr: Doc = { blocks: [{ qr: 'https://example.test/?n=1' }, { qr: 'A', size: 3 }, { qr: 'B', size: 8 }] };
    // @ts-expect-error a module size above 8
    const big: DocBlock = { qr: 'x', size: 9 };
    // @ts-expect-error a module size below 3
    const small: DocBlock = { qr: 'x', size: 2 };
    expect([qr, big, small]).toHaveLength(3);
  });

  it('[05 row P-5] the fill block: { fill: block_kind, ref, last4 }', () => {
    expectTypeOf<Extract<DocBlock, { fill: string }>>().toEqualTypeOf<{ fill: string; ref: string; last4: string }>();
    const doc: Doc = { blocks: [{ fill: 'buyer_id', ref: 'INV1', last4: '1234' }] };
    // @ts-expect-error last4 is required
    const noLast4: DocBlock = { fill: 'buyer_id', ref: 'INV1' };
    expect([doc, noLast4]).toHaveLength(2);
  });
});
