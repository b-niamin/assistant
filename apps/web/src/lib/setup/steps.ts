/**
 * The first-run wizard (spec 002, "Install"): install.sh asks nothing and prints the address and a setup
 * code; these pages do the rest. Step 1 (/setup) needs the code and makes the password, the language and
 * the first profile; the others run logged in and unlocked, and each can be skipped.
 */
export const SETUP_STEPS = [
  { href: '/setup', label: 'You' },
  { href: '/setup/apps', label: 'Apps' },
  { href: '/setup/system', label: 'Updates and Claude' },
  { href: '/setup/done', label: 'Done' }
] as const;

/** 0-based position of a path in the wizard (-1 when it is not one of its pages). */
export const stepIndex = (pathname: string): number => SETUP_STEPS.findIndex((s) => s.href === pathname.replace(/\/$/, '') || (s.href === '/setup' && pathname === '/setup/'));
