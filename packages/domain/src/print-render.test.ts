import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapText, renderText, toPc437, wrapText, type Doc } from './index';

// 03c v1.0.11 §3.6, §4.2 (⚠️ 05 row P-4; 05 §10 #86 P-4 half): renderText lives in @pos/domain/src/print-render.ts,
// browser-safe (no node:*), the same text as before the move (the hub's render tests run against this import too).

const centre2 = (text: string, cols: number): string => ' '.repeat(Math.floor((cols - 2 * text.length) / 2)) + text;

describe('[03c §3.6, 05 row P-4] renderText from @pos/domain', () => {
  it('[05 row P-4] align, size, rule, feed; cut / drawer print nothing; doc.width_cols wins; a newline breaks the line', () => {
    const doc: Doc = {
      blocks: [{ text: 'BILL', size: 2, align: 'center' }, { text: 'Total 1,200', align: 'right' }, { rule: true }, { feed: 1 }, { text: 'x' }, { cut: true }, { drawer: true }],
    };
    expect(renderText(doc, 32).split('\n')).toEqual([centre2('BILL', 32), ' '.repeat(21) + 'Total 1,200', '-'.repeat(32), '', 'x']);
    expect(renderText({ ...doc, width_cols: 48 }, 32).split('\n')[2]).toBe('-'.repeat(48));
    expect(renderText({ blocks: [{ text: 'a\nb' }] }, 32)).toBe('a\nb');
  });

  it('[05 row P-4] the printer mapping and wrapping: dashes, ×, curly quotes, PC437, else ?; long words break', () => {
    expect(renderText({ blocks: [{ text: '2 × Naan — “hot” ‘now’ · Ç 漢' }] }, 48)).toBe('2 x Naan - "hot" \'now\'   Ç ?');
    expect(renderText({ blocks: [{ text: 'x'.repeat(40) }] }, 32).split('\n')).toEqual(['x'.repeat(32), 'x'.repeat(8)]);
    expect(renderText({ blocks: [{ text: 'aaa bbb ccc', size: 2 }] }, 32).split('\n')).toEqual(['aaa bbb ccc']);
    expect(mapText('–−')).toBe('--');
    expect(wrapText('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
    expect(toPc437('é').bytes).toEqual(Uint8Array.of(0x82));
    expect(toPc437('漢').lossy).toBe(true);
  });

  it('[05 #86, row P-3] a QR block previews as "[QR] <payload>" (mapped and wrapped like text); no other output', () => {
    const url = 'https://pra.test/?PRAInvNo=123';
    const doc: Doc = { blocks: [{ text: 'PRA invoice no. 123' }, { qr: url }, { qr: 'AB', size: 8 }] };
    expect(renderText(doc, 48).split('\n')).toEqual(['PRA invoice no. 123', `[QR] ${url}`, '[QR] AB']);
    expect(renderText({ blocks: [{ qr: 'x'.repeat(40) }] }, 32).split('\n')).toEqual(['[QR] ' + 'x'.repeat(27), 'x'.repeat(13)]);
  });

  it('[05 §10 #86, row P-4] browser-safe: print-render.ts imports no node:* module and no Buffer', () => {
    const src = readFileSync(new URL('./print-render.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from\s+['"]node:/);
    expect(src).not.toMatch(/\bBuffer\b/);
    expect(readFileSync(new URL('./index.ts', import.meta.url), 'utf8')).toContain("export * from './print-render.js';");
  });
});
