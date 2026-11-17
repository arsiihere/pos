import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Integrator ruling on #230: the 04 frame CSS defined a top-level `.ptag` (PENDING VOID: red, uppercase) that collides
// with 03's Pass "Printed" tag (pulse-03.css `.ptag`, features/pass/cards/LineRow.tsx). The ui-kit copy renames it
// `.vptag`. No rule of the 04 staff layer may match an element of a Pass line row.

// a jsdom test has no file: import.meta.url: the repo root is the nearest folder with pnpm-workspace.yaml
function repoRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'pnpm-workspace.yaml')) && dirname(dir) !== dir) dir = dirname(dir);
  return dir + '/';
}
const root = repoRoot();
const kit = (name: string) => readFileSync(root + 'packages/ui-kit/components/' + name, 'utf8');
const handoff04 = readFileSync(root + 'docs/design/handoff/04/design/css/pulse-04.css', 'utf8');

/** Every selector of a stylesheet (comments dropped; @-rule preludes skipped). */
function selectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  for (const m of text.matchAll(/([^{}]+)\{/g)) {
    const prelude = m[1]!.trim();
    if (prelude.startsWith('@')) continue;
    for (const sel of prelude.split(/,(?![^(]*\))/)) if (sel.trim() !== '') out.push(sel.trim());
  }
  return out;
}

describe('pulse-04 does not restyle other modules (ruling on #230)', () => {
  it('[04 VU1] the ui-kit copy has no .ptag rule; the PENDING VOID tag is .vptag', () => {
    const css = kit('pulse-04.css');
    expect(css).not.toMatch(/\.ptag\b/);
    expect(css).toMatch(/\.vptag \{/);
    // the handoff design file keeps the canvas name
    expect(handoff04).toMatch(/\.ptag \{/);
  });

  it('[04 VU1, 03b §3.4] no pulse-04 rule matches the Pass "Printed" tag or its line row (pulse-03 keeps its style)', () => {
    // the markup of features/pass/cards/LineRow.tsx (03c `printed` tag), inside the staff root
    document.body.innerHTML =
      '<div class="pu v-brand" lang="en"><div class="pc"><div class="pl" data-id="L1"><span class="pl__t"><span class="q">1 x</span>Karahi</span>' +
      '<span class="row"><span class="ptag"><svg class="ico"></svg>Printed</span><span class="stg c-warn"><svg class="ico"></svg>Cooking</span></span>' +
      '<span class="pl__o">less spicy</span></div></div></div>';
    const row = document.querySelector('.pl')!;
    const els = [row, ...row.querySelectorAll('*')];
    const hits: string[] = [];
    for (const sel of selectors(kit('pulse-04.css'))) {
      try {
        if (els.some((el) => el.matches(sel))) hits.push(sel);
      } catch {
        // a selector jsdom cannot parse (none today) is not a match
      }
    }
    // the 04 extensions of shared 01d / 02 parts (.stg, .ico) are fine; nothing may target the Pass tag or row
    const passHits = hits.filter((sel) => /\.ptag|\.pl\b|\.pc\b|\.row\b|\.q\b/.test(sel) || sel === '.vptag');
    expect(passHits).toEqual([]);
    const tag = row.querySelector('.ptag')!;
    expect(selectors(kit('pulse-04.css')).filter((sel) => tag.matches(sel))).toEqual([]);
    expect(kit('pulse-03.css')).toMatch(/\.ptag \{ display: inline-flex;[^}]*border-radius: 999px; background: var\(--surface-2\)/);
  });
});
