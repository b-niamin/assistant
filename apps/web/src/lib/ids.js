/**
 * The names the shell checks, in one place (audit R10): the web app, `ext check` (scripts/
 * extensions-lib.mjs) and the forms' `pattern` attributes read them from here. docker/worker/worker.py
 * keeps Python copies of the first two; test_worker.py compares them with this file.
 * Plain JS: extensions-lib.mjs runs under node without a build.
 */

/** An extension id, also its folder, schema and route: `health`, `my-notes` (no `--`, no trailing `-`). */
export const EXTENSION_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/** A service or job of an extension (manifest "services" / "jobs"). */
export const UNIT_NAME_RE = /^[a-z][a-z0-9-]{0,39}$/;
/** A profile id: lower-case letters, digits and dashes, a letter first, at most 32. */
export const PROFILE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
/** A tool, a secret or a source field of an extension: snake_case, at most 40. */
export const FIELD_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * The same rule for an <input pattern="...">: the browser anchors it and compiles it with the `v` flag,
 * where a bare `-` inside [...] is a syntax error that makes it ignore the pattern.
 * @param {RegExp} re
 */
export function inputPattern(re) {
  return re.source
    .replace(/^\^|\$$/g, '')
    .replace(/\[([^\]]*)\]/g, (_, body) => `[${body.replace(/(?<!\\)-$/, '\\-')}]`);
}
