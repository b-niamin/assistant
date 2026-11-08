/**
 * Environment variables the server reads (`import * as env from '$app/env/private'`). All optional:
 * unset stays `undefined`, so each caller's own default applies (docker-compose.yml sets them).
 */
import { defineEnvVars } from '@sveltejs/kit/env';

const optional = { schema: (value: string | undefined) => value };

export const variables = defineEnvVars({
  APP_PASSWORD_HASH: optional,
  SETUP_TOKEN: optional,
  DEFAULT_PROFILE: optional,
  DATABASE_URL: optional,
  SECRETS_KEY: optional,
  SIDECAR_TICKET_SECRET: optional,
  TERMINAL_ADDR: optional,
  BROWSER_VNC_ADDR: optional,
  CLAUDE_TOOLS_TOKEN: optional,
  EXTENSIONS_CATALOG_URL: optional,
  EXTENSION_DB_ROLES: optional
});
