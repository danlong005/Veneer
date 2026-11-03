// The designer token, kept for the browser tab: the design panel and the
// Macros panel both save with it.

const TOKEN_KEY = 'veneer.designerToken';

export function loadToken(): string {
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

export function storeToken(token: string): void {
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
}
