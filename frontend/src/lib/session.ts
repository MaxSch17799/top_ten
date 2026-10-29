import type { SessionData } from './types';

const STORAGE_KEY = 'top10-top10-session';
const sessionKey = (gameId: string) => `party-session-${gameId}`;

export function loadSessionForGame(gameId: string): SessionData | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const payload = window.localStorage.getItem(sessionKey(gameId)) ?? window.localStorage.getItem(STORAGE_KEY);
  if (!payload) {
    return null;
  }
  try {
    const parsed = JSON.parse(payload) as SessionData;
    return parsed.gameId === gameId ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(session: SessionData): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  window.localStorage.setItem(sessionKey(session.gameId), JSON.stringify(session));
}

export function clearSession(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(STORAGE_KEY);
}
