#!/usr/bin/env node
/** `npm run gen`: validate installed extensions and generate their route stubs (runs before build/check). */
import { generate } from './extensions-lib.mjs';

try {
  generate({ log: (m) => console.log(m) });
} catch (e) {
  console.error(String(e.message ?? e));
  process.exit(1);
}
