// Veneer's sign-on page, shown before the host session starts when Veneer
// signs users on itself (VENEER_SIGNON=auto), under the site's logo and name
// in the header, in the site's theme.

import type { ClientMessage, PasswordRules } from '@veneer/server';
import { useEffect, useRef, useState } from 'react';
import { EMPTY_SIGN_ON, passwordAllowedHere, signOnMessage, signOnProblem, type SignOnForm } from './signOn.ts';

interface Props {
  name: string;
  password: PasswordRules;
  /** Why the last sign-on didn't work. */
  error: string | undefined;
  /** A sign-on is under way. */
  waiting: boolean;
  send: (msg: ClientMessage) => void;
}

export function SignOnPage({ name, password, error, waiting, send }: Props) {
  const [form, setForm] = useState<SignOnForm>(EMPTY_SIGN_ON);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [more, setMore] = useState(false);
  const userInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const allowed = passwordAllowedHere(location);

  // After a failure the password is cleared, ready to type again.
  useEffect(() => {
    if (!error) return;
    setForm((f) => ({ ...f, password: '' }));
    passwordInput.current?.focus();
  }, [error]);
  useEffect(() => { if (!error) userInput.current?.focus(); }, [error]);

  const set = (key: keyof SignOnForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [key]: e.target.value });
    setProblem(undefined);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (waiting) return;
    const p = signOnProblem(form, password);
    if (p) return setProblem(p);
    send(signOnMessage(form));
  };
  const shown = problem ?? (waiting ? undefined : error);

  return (
    <div className="signon-page">
      <form className="signon-card" onSubmit={submit} autoComplete="on" aria-busy={waiting}>
        <h2>Sign on to {name}</h2>
        {!allowed ? (
          <p className="signon-error" role="alert">
            This page isn't encrypted, so it can't take your password. Use the https:// address, or ask your administrator.
          </p>
        ) : (
          <>
            {shown && <p className="signon-error" role="alert">{shown}</p>}
            <label>
              <span>User</span>
              <input ref={userInput} name="username" autoComplete="username" autoCapitalize="characters" spellCheck={false}
                maxLength={10} value={form.user} onChange={set('user')} disabled={waiting} />
            </label>
            <label>
              <span>Password</span>
              <input ref={passwordInput} type="password" name="password" autoComplete="current-password"
                maxLength={password.maxLength} value={form.password} onChange={set('password')} disabled={waiting} />
            </label>
            {!password.caseSensitive && <p className="signon-hint">Passwords on this IBM i aren't case-sensitive.</p>}
            {more ? (
              <fieldset className="signon-more">
                <legend>Start with</legend>
                <label><span>Program</span><input maxLength={10} value={form.program} onChange={set('program')} disabled={waiting} spellCheck={false} /></label>
                <label><span>Menu</span><input maxLength={10} value={form.menu} onChange={set('menu')} disabled={waiting} spellCheck={false} /></label>
                <label><span>Current library</span><input maxLength={10} value={form.library} onChange={set('library')} disabled={waiting} spellCheck={false} /></label>
              </fieldset>
            ) : (
              <button type="button" className="link-button signon-more-toggle" onClick={() => setMore(true)}>More options</button>
            )}
            <button type="submit" className="primary" disabled={waiting}>{waiting ? 'Signing on…' : 'Sign on'}</button>
          </>
        )}
      </form>
    </div>
  );
}
