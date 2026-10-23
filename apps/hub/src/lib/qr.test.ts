import { describe, expect, it } from 'vitest';
import { qrSvg } from './qr.js';

describe('qrSvg', () => {
  it('[00 §3.1 M77] qrSvg is deterministic, contains no <script>, and has the same dark modules as QRCode.create for that text', async () => {
    const text = 'http://192.168.10.2:3000/admin/bootstrap#t=01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const svg = qrSvg(text);
    expect(svg).toBe(qrSvg(text));
    expect(svg.toLowerCase()).not.toContain('<script');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);

    const loaded = await import('qrcode');
    const create = loaded.create ?? loaded.default.create;
    const created = create(text, { errorCorrectionLevel: 'M' });
    const size = created.modules.size;
    const quiet = 4;
    const dark = new Set<string>();
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (created.modules.get(row, col)) dark.add(`${col},${row}`);
      }
    }
    const painted = new Set<string>();
    for (const match of svg.matchAll(/M(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)h1v1h-1z/g)) {
      painted.add(`${Number(match[1]) - quiet},${Number(match[2]) - quiet}`);
    }
    expect(painted).toEqual(dark);
    expect(svg).toContain(`viewBox="0 0 ${size + quiet * 2} ${size + quiet * 2}"`);
  });
});
