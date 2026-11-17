import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// S35 a, S39 a: one config, one build per entry (`vite build --mode <entry>` → dist/<entry>/). No plugin.
const ENTRIES: Record<string, string> = {
  owner: '/owner/',
  'admin-stock': '/admin/stock/',
  // 01d task 41: the staff entry (inbox, requests, answer sheet, test alert)
  staff: '/staff/',
  // 03b W0.4 (00 v1.9.2 §8.2; Q-42, Q-43): the KDS (station session) and the 03b / 03c hub admin pages
  kds: '/kds/',
  'admin-kitchen-screens': '/admin/kitchen-screens/',
  'admin-printers': '/admin/printers/',
};

export default defineConfig(({ mode }) => {
  const base = ENTRIES[mode];
  if (base === undefined) throw new Error(`unknown client entry mode: ${mode}`);
  return {
    root: fileURLToPath(new URL(`./${mode}/`, import.meta.url)),
    base,
    build: {
      outDir: fileURLToPath(new URL(`./dist/${mode}/`, import.meta.url)),
      emptyOutDir: true,
      manifest: true,
      assetsInlineLimit: 0,
    },
  };
});
