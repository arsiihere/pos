import { describe, expect, it } from 'vitest';
import { EN } from '../src/lib/strings';
import { uiVersion } from '../src/lib/ui-assets';
import { setupPage } from '../src/setup/page';
import { createTestHub } from './helpers/test-hub';

interface PageCase {
  name: string;
  html: () => Promise<string>;
  theme: 'light' | 'dark';
  ids: string[];
  classes?: string[];
}

async function served(url: string): Promise<string> {
  const hub = await createTestHub();
  try {
    return (await hub.app.inject({ method: 'GET', url })).body;
  } finally {
    await hub.close();
  }
}

const PAGES: PageCase[] = [
  { name: '/setup', html: async () => setupPage(), theme: 'light', ids: ['setup'] },
  { name: '/admin/bootstrap', html: () => served('/admin/bootstrap'), theme: 'light', ids: ['login', 'roster'] },
  { name: '/admin/approve', html: () => served('/admin/approve'), theme: 'light', ids: ['screen'] },
  { name: '/pair', html: () => served('/pair'), theme: 'dark', ids: ['screen'], classes: ['display-code'] },
];

describe('hub pages on the UI kit', () => {
  it('[00 §10 #136] every page links the kit, sets lang/dir/theme and pos-root, has one inline script and no remote asset, keeps its ids, looks up only EN keys and masks PINs', async () => {
    const v = uiVersion();
    for (const page of PAGES) {
      const html = await page.html();
      expect(html, page.name).toContain(`<link rel="stylesheet" href="/ui/tokens.css?v=${v}">`);
      expect(html, page.name).toContain(`<link rel="stylesheet" href="/ui/components/bundle.css?v=${v}">`);
      expect(html, page.name).toContain(`<html lang="en" dir="ltr" data-theme="${page.theme}">`);
      expect(html, page.name).toContain('<body class="pos-root">');
      expect(html.match(/<script/g), page.name).toHaveLength(1);
      expect(html, page.name).not.toMatch(/(?:src|href)="https?:/);
      for (const id of page.ids) expect(html, `${page.name} #${id}`).toContain(`id="${id}"`);
      for (const cls of page.classes ?? []) expect(html, `${page.name} .${cls}`).toContain(cls);
      for (const [, key] of html.matchAll(/\bt\('([a-z0-9_.]+)'/gi)) {
        expect(EN, `${page.name} t('${key}')`).toHaveProperty([key as string]);
      }
      for (const input of html.match(/<input[^>]*name="pin"[^>]*>/g) ?? []) {
        expect(input).toContain('type="password"');
        expect(input).toContain('inputmode="numeric"');
      }
      expect(html, page.name).not.toContain('window.prompt');
    }
  });
});
