/**
 * Beni covers its eyes while you type a password, and peeks when you reveal it. One document-wide
 * listener, installed by the first mascot that mounts; nothing runs on the server.
 */

export type Secrecy = 'none' | 'hidden' | 'shown';

export const beniWatch = $state<{ secrecy: Secrecy }>({ secrecy: 'none' });

/** A field holding a secret: a password input, or one marked so (autocomplete *-password, data-secret). */
export function secrecyOf(el: Element | null): Secrecy {
  if (!(el instanceof HTMLInputElement)) return 'none';
  if (el.type === 'password') return 'hidden';
  const marked = /password/.test(el.autocomplete) || el.dataset.secret !== undefined;
  return marked && el.type === 'text' ? 'shown' : 'none';
}

let installed = false;

export function watchSecrets(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const check = () => {
    beniWatch.secrecy = secrecyOf(document.activeElement);
  };
  document.addEventListener('focusin', check);
  document.addEventListener('focusout', () => setTimeout(check, 0));
  // A "show password" button flips the input's type while it keeps focus (or right after).
  new MutationObserver(check).observe(document.documentElement, { subtree: true, attributeFilter: ['type'] });
  check();
}
