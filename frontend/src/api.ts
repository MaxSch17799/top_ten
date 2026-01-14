import type { SerializedStateForPlayer, SessionData } from './lib/types';

type HostActionResponse = { success: boolean };

type JsonPayload = Record<string, unknown>;

const BACKEND_BASE = (import.meta.env.VITE_BACKEND_URL ?? 'https://top-ten.maxschimmel17799.workers.dev').replace(/\/$/, '');

const defaultHeaders = {
  'Content-Type': 'application/json',
};

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    if (response.ok) {
      return {} as T;
    }
    throw new Error('Empty response');
  }
  const payload = JSON.parse(text) as JsonPayload;
  if (!response.ok) {
    throw new Error((payload?.error as string) ?? 'Request failed');
  }
  return payload as T;
}

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  return parseJson<T>(response);
}

export interface CreateGamePayload {
  hostNickname: string;
  seed?: string;
  questionBankId: string;
}

export interface CreateGameResult {
  gameId: string;
  hostToken: string;
  playerId: string;
  playerToken: string;
  role: 'HOST';
  seed: string;
  questionBankId: string;
  joinPath: string;
}

export interface JoinGameResult {
  playerId: string;
  playerToken: string;
  role: 'PLAYER';
  status: 'ACTIVE' | 'PENDING';
  seed: string;
  questionBankId: string;
}

export async function createGame(payload: CreateGamePayload): Promise<CreateGameResult> {
  return request<CreateGameResult>(`${BACKEND_BASE}/api/game/create`, {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify(payload),
  });
}

export async function joinGame(gameId: string, nickname: string): Promise<JoinGameResult> {
  return request<JoinGameResult>(`${BACKEND_BASE}/api/game/${gameId}/join`, {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify({ nickname }),
  });
}

export async function fetchGameState(options: {
  gameId: string;
  token: string;
  sinceVersion?: number;
}): Promise<SerializedStateForPlayer | null> {
  const searchParams = new URLSearchParams();
  searchParams.set('token', options.token);
  if (options.sinceVersion) {
    searchParams.set('sinceVersion', String(options.sinceVersion));
  }
  const response = await fetch(`${BACKEND_BASE}/api/game/${options.gameId}/state?${searchParams.toString()}`);
  if (response.status === 204) {
    return null;
  }
  return parseJson<SerializedStateForPlayer>(response);
}

async function hostAction(gameId: string, action: string, session: SessionData, payload: JsonPayload = {}): Promise<HostActionResponse> {
  if (!session.hostToken) {
    throw new Error('Host token missing');
  }
  return request<HostActionResponse>(
    `${BACKEND_BASE}/api/game/${gameId}/${action}`,
    {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ ...payload, hostToken: session.hostToken }),
    }
  );
}

export function reorderPlayers(gameId: string, session: SessionData, order: string[]) {
  return hostAction(gameId, 'reorder', session, { order });
}

export function startRound(gameId: string, session: SessionData) {
  return hostAction(gameId, 'startRound1', session);
}

export function advanceRound(gameId: string, session: SessionData) {
  return hostAction(gameId, 'nextRound', session);
}

export function endGame(gameId: string, session: SessionData) {
  return hostAction(gameId, 'end', session);
}

export function buildWsUrl(gameId: string, token: string): string {
  const protocol = BACKEND_BASE.startsWith('https') ? 'wss' : 'ws';
  const trimmed = BACKEND_BASE.replace(/^https?:/, '');
  return `${protocol}:${trimmed}/api/game/${gameId}/ws?token=${encodeURIComponent(token)}`;
}
