import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { extensionsDir } from './scripts/extensions-lib.mjs';

// Installed extensions live outside apps/web (repo ./extensions, mounted at /extensions in `web`).
const EXT_DIR: string = extensionsDir();

export default defineConfig({
  plugins: [
    sveltekit({
      preprocess: vitePreprocess(),
      // BUILD_OUT lets scripts/live-reload.mjs build into a staging dir and swap only on success.
      adapter: adapter({ out: process.env.BUILD_OUT ?? 'build' }),
      // The public origin (PUBLIC_ORIGIN in .env, ORIGIN in the web container) for CSRF checks: behind
      // Tailscale Serve the request itself says http. adapter-node no longer reads ORIGIN at runtime, so
      // it is baked in at build time; live-reload builds inside the web container, where it is set.
      paths: { origin: process.env.ORIGIN || process.env.PUBLIC_ORIGIN || undefined },
      alias: {
        // The SDK: the only shell code an extension may import (spec 002).
        $shell: 'src/lib/sdk',
        $extensions: EXT_DIR
      },
      typescript: {
        // Type-check extension code together with the shell (svelte-check, IDEs).
        config(cfg) {
          // Paths here are relative to the generated config, node_modules/$app/tsconfig.json.
          const gen = path.resolve('node_modules/$app');
          const rel = path.relative(gen, EXT_DIR);
          // tsconfig.json has no `include` of its own, so this list is the whole project.
          cfg.include = ['../../src', '../../vite.config.ts', `${rel}/*/web/**/*.ts`, `${rel}/*/web/**/*.svelte`];
          cfg.exclude = [...(cfg.exclude ?? []), `${rel}/*/node_modules/**`];
          // Extension files sit outside this package: resolve their bare imports to our node_modules.
          const nm = (p: string) => [path.relative(gen, path.resolve('node_modules', p))];
          cfg.compilerOptions.paths ??= {};
          Object.assign(cfg.compilerOptions.paths, {
            svelte: nm('svelte'),
            'svelte/*': nm('svelte/*'),
            '@sveltejs/kit': nm('@sveltejs/kit'),
            vitest: nm('vitest')
          });
        }
      },
      csp: {
        mode: 'auto',
        directives: {
          'default-src': ['self'],
          'script-src': ['self'],
          'style-src': ['self', 'unsafe-inline'],
          'img-src': ['self', 'data:'],
          'connect-src': ['self'],
          // onefile extensions run in a sandboxed iframe served from /api/onefile/<id>.
          'frame-src': ['self'],
          'base-uri': ['self'],
          'form-action': ['self'],
          'frame-ancestors': ['none'],
          'object-src': ['none']
        }
      }
    })
  ],
  // Extension sources live outside this package: let the dev server read them, and make every
  // `svelte` import resolve to this package's copy.
  server: { fs: { allow: [EXT_DIR] } },
  resolve: { dedupe: ['svelte', '@sveltejs/kit'] },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', `${EXT_DIR}/*/web/**/*.test.ts`],
    exclude: ['**/node_modules/**']
  }
});
