import type { Theme } from '#lib/theme.ts';

declare global {
  namespace App {
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
