import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';
import { extensionsDir } from './scripts/extensions-lib.mjs';

// Installed extensions live outside apps/web (repo ./extensions, mounted at /extensions in `web`).
const EXT_DIR = extensionsDir();

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // BUILD_OUT lets scripts/live-reload.mjs build into a staging dir and swap only on success.
    adapter: adapter({ out: process.env.BUILD_OUT ?? 'build' }),
    alias: {
      // The SDK: the only shell code an extension may import (spec 002).
      $shell: 'src/lib/sdk',
      $extensions: EXT_DIR
    },
    typescript: {
      // Type-check extension code together with the shell (svelte-check, IDEs).
      config(cfg) {
        const rel = path.relative(path.resolve('.svelte-kit'), EXT_DIR);
        cfg.include.push(`${rel}/*/web/**/*.ts`, `${rel}/*/web/**/*.svelte`);
        cfg.exclude = [...(cfg.exclude ?? []), `${rel}/*/node_modules/**`];
        // Extension files sit outside this package: resolve their bare imports to our node_modules.
        const nm = (/** @type {string} */ p) => [`../node_modules/${p}`];
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
  }
};

export default config;
