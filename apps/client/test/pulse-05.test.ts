// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Handoff 05 README "CSS": design/css/pulse-05.css holds every new 05 style (prefix b5-, no new tokens). The ui-kit
// copy is byte-identical; what the frames set inline lives in pulse-05-additions.css, scoped with :where(...).

const root = fileURLToPath(new URL('../../../', import.meta.url));
const kitDir = root + 'packages/ui-kit/components/';
const handoff = root + 'docs/design/handoff/05/design/css/pulse-05.css';
const k = (name: string) => '../../../../packages/ui-kit/components/' + name;

function importsOf(path: string): string[] {
  return [...readFileSync(path, 'utf8').matchAll(/^import\s+['"]([^'"]+)['"];/gm)].map((m) => m[1] as string);
}

describe('[05 §8; handoff 05 README] Pulse 05 layer', () => {
  it('pulse-05.css equals the handoff file byte for byte; nothing from the network, no font faces', () => {
    expect(existsSync(kitDir + 'pulse-05.css')).toBe(true);
    const text = readFileSync(kitDir + 'pulse-05.css', 'utf8');
    expect(text).toBe(readFileSync(handoff, 'utf8'));
    const rules = text.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/https?:\/\/|@import|url\(|@font-face/);
  });

  it('pulse-05-additions.css: every rule scoped with :where(...), no network, fonts or new colours', () => {
    const rules = readFileSync(kitDir + 'pulse-05-additions.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/https?:\/\/|@import|url\(|@font-face|#[0-9a-f]{3,8}\b|rgb\(/i);
    const selectors = [...rules.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim()).filter((s) => !s.startsWith('@'));
    expect(selectors.length).toBeGreaterThan(0);
    for (const sel of selectors) expect(sel, sel).toMatch(/^:where\(/);
  });

  it('the billing screens load pulse-05.css, then its additions (features/billing/styles.ts); no kit entry loads it', () => {
    const styles = importsOf(root + 'apps/client/src/features/billing/styles.ts');
    const at = (name: string) => styles.indexOf('../../../../../packages/ui-kit/components/' + name);
    expect(at('pulse-05.css')).toBe(0);
    expect(at('pulse-05-additions.css')).toBe(1);
    expect(readFileSync(root + 'apps/client/src/features/billing/OpenBills.tsx', 'utf8')).toMatch(/^import '\.\/styles';$/m);
    const app = root + 'apps/client/src/app/';
    for (const f of ['ui-kit.ts', 'ui-kit-staff.ts', 'ui-kit-kds.ts', 'ui-kit-admin.ts']) if (existsSync(app + f)) expect(importsOf(app + f), f).not.toContain(k('pulse-05.css'));
  });
});

// E2E E-6 (docs/reviews/05-e2e.md): at the 1920×1080 kiosk the money column did not scroll and its children shrank
// (`.b5-tot` has overflow: hidden, so its flex min-height is 0), so the Close bar sat over "Add payment" and the
// totals were clipped. The money pane scrolls and none of its children shrinks. (jsdom does no layout; the measured
// check at 1920×1080 is in the PR.)
describe('[05 §8 Bill screen; E2E E-6] the money column scrolls, its parts never shrink', () => {
  const rules = readFileSync(kitDir + 'pulse-05-additions.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleOf = (selector: string) => [...rules.matchAll(/([^{}]+)\{([^}]*)\}/g)].find((m) => m[1]!.trim() === selector)?.[2] ?? '';
  it('the pane: overflow-y auto', () => {
    expect(ruleOf(':where(.b5-money) > .b5-pane')).toMatch(/overflow:\s*hidden auto/);
  });
  it('its children: flex-shrink 0', () => {
    expect(ruleOf(':where(.b5-money) > .b5-pane > *')).toMatch(/flex-shrink:\s*0/);
  });
  it('Close stays in view at the foot (sticky), no sideways scroll', () => {
    expect(ruleOf(':where(.b5-money) > .b5-pane > .b5-close')).toMatch(/position:\s*sticky/);
    expect(ruleOf(':where(.b5-money) > .b5-pane')).toMatch(/overflow:\s*hidden auto/);
  });
});

// E2E R-4 (re-run, E-6 leftover): focus scrolling stopped with Add payment under the sticky Close bar (no bottom
// scroll padding). The pane pads its scrollport by the bar's height; opening the pad scrolls in BillScreen (tested there).
describe('[05 §8 Bill screen; E2E R-4] focus scrolling clears the Close bar', () => {
  const rules = readFileSync(kitDir + 'pulse-05-additions.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('the money pane has a bottom scroll padding at least the kiosk bar height (142 px)', () => {
    const m = [...rules.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((r) => (r[1]!.trim() === ':where(.b5-money) > .b5-pane' ? /scroll-padding-bottom:\s*(\d+)px/.exec(r[2]!)?.[1] : undefined)).find((x) => x !== undefined);
    expect(Number(m ?? 0)).toBeGreaterThanOrEqual(142);
  });
});
