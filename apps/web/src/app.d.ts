import type { Theme } from '#lib/theme.ts';

declare global {
  namespace App {
    interface Locals {
      authenticated: boolean;
      profileId: string;
      theme: Theme;
    }
  }
}
export {};
