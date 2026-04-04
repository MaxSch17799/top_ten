const ADMIN_TOKEN_KEY = 'top10-admin-token';
const OVERRIDE_TOKEN_KEY = 'top10-admin-override-token';

export function loadAdminToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

export function saveAdminToken(token: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
}

export function loadOverrideToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.sessionStorage.getItem(OVERRIDE_TOKEN_KEY);
}

export function saveOverrideToken(token: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.setItem(OVERRIDE_TOKEN_KEY, token);
}

export function clearOverrideToken(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.removeItem(OVERRIDE_TOKEN_KEY);
}
