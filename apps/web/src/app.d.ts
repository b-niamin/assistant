import type { Theme } from '#lib/theme.ts';

declare global {
  namespace App {
    interface Error {
      message: string;
      /** A short code for an unexpected error, also in /logs/web.log (hooks.server.ts handleError). */
      id?: string;
    }
    interface Locals {
      authenticated: boolean;
      profileId: string;
      theme: Theme;
      /** Language of the page (spec 007): en, pl, ... */
      lang: string;
    }
  }
}
export {};
