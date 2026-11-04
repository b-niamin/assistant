import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { extensionsDir } from './scripts/extensions-lib.mjs';

const EXT_DIR: string = extensionsDir();

export default defineConfig({
  plugins: [sveltekit()],
  // Extension sources live outside this package: let the dev server read them, and make every
  // `svelte` import resolve to this package's copy.
  server: { fs: { allow: [EXT_DIR] } },
  resolve: { dedupe: ['svelte', '@sveltejs/kit'] },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', `${EXT_DIR}/*/web/**/*.test.ts`],
    exclude: ['**/node_modules/**']
  }
});
