declare global {
  namespace App {
    interface Locals {
      authenticated: boolean;
      profileId: string;
    }
  }
}
export {};
