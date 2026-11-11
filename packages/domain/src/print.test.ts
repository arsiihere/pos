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
});
