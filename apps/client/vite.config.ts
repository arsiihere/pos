import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// S35 a, S39 a: one config, one build per entry (`vite build --mode <entry>` → dist/<entry>/). No plugin.
const ENTRIES: Record<string, string> = {
  owner: '/owner/',
  'admin-stock': '/admin/stock/',
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
