import type { Doc } from '@pos/domain';
import { mapText, wrapText } from '../escpos.js';

// 03c §3.6, §3.9 (c10): the text preview of a Doc (05's preview), 0 statements. The same mapping and wrapping as the
// encoder (split on newlines before the mapping): text wraps at width / size and is aligned as the printer does (size columns per character); a rule is `-` × width; a feed is empty lines; cut and
// drawer print nothing.

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
    } else if ('rule' in block) out.push('-'.repeat(cols));
    else if ('feed' in block) for (let i = 0; i < Math.floor(block.feed); i += 1) out.push('');
  }
  return out.join('\n');
}
