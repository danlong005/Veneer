// Veneer's own sign-on page (automatic sign-on, VENEER_SIGNON=auto): what it
// checks before sending, the same as the server does again.

import type { PasswordRules } from '@veneer/server';

export interface SignOnForm {
  user: string;
  password: string;
  program: string;
  menu: string;
  library: string;
}

export const EMPTY_SIGN_ON: SignOnForm = { user: '', password: '', program: '', menu: '', library: '' };

/** IBM i user profiles and object names: up to 10 of A-Z, 0-9, #, $, @, _, not starting with a digit or _. */
const NAME = /^[A-Z#$@][A-Z0-9#$@_]{0,9}$/;

/**
 * Whether this page may send a password: it is on HTTPS, or on this machine.
 * Elsewhere, plain HTTP would send it across the network as it is.
 */
export function passwordAllowedHere(loc: { protocol: string; hostname: string }): boolean {
  if (loc.protocol === 'https:') return true;
  return loc.protocol === 'http:' && (loc.hostname === 'localhost' || loc.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(loc.hostname));
}

/** What to fix before signing on, if anything. */
export function signOnProblem(form: SignOnForm, rules: PasswordRules): string | undefined {
  const user = form.user.trim().toUpperCase();
  if (!user) return 'Type your user name.';
  if (!NAME.test(user)) return 'A user name is up to 10 letters and digits (and # $ @ _), starting with a letter.';
  if (!form.password) return 'Type your password.';
  if (form.password.length > rules.maxLength) return `A password is at most ${rules.maxLength} characters${rules.maxLength === 10 ? ' on this IBM i' : ''}.`;
  for (const [key, label] of [['program', 'program'], ['menu', 'menu'], ['library', 'current library']] as const) {
    const value = form[key].trim().toUpperCase();
    if (value && !NAME.test(value)) return `The ${label} must be an IBM i name: up to 10 letters and digits, starting with a letter.`;
  }
  return undefined;
}

/** The message to send: names uppercased, blanks left out. */
export function signOnMessage(form: SignOnForm) {
  const extra = (value: string) => value.trim().toUpperCase() || undefined;
  return {
    type: 'signon' as const,
    user: form.user.trim().toUpperCase(),
    password: form.password,
    ...(extra(form.program) ? { program: extra(form.program)! } : {}),
    ...(extra(form.menu) ? { menu: extra(form.menu)! } : {}),
    ...(extra(form.library) ? { library: extra(form.library)! } : {}),
  };
}
