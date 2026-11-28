// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';

// 02b v1.0.28 QK-10 (QA round 2 UX): a double-click on a staff panel button does not select its text; a text field
// stays selectable. Reads the real kit layer (staff-02-additions.css, the staff page's last layer).

const root = resolvePath(__dirname, '../../..') + '/';
const css = readFileSync(root + 'packages/ui-kit/components/staff-02-additions.css', 'utf8');

describe('[02b v1.0.28 QK-10] no text selection on staff buttons', () => {
  it('buttons, chips and rail rows are user-select: none; inputs are not', () => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    document.body.innerHTML = '<div class="pu staff"><button>Print check bill</button><span class="pill">Sides</span><div class="tk-qr">#8</div><input value="Usman"></div>';
    for (const sel of ['button', '.pill', '.tk-qr']) expect(getComputedStyle(document.querySelector(sel)!).userSelect).toBe('none');
    expect(getComputedStyle(document.querySelector('input')!).userSelect).not.toBe('none');
    style.remove();
  });
});
