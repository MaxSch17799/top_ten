import type {
  AdminQuestionBankDetail,
  QuestionBankCatalogItem,
  QuestionBankCatalogResponse,
  QuestionBankLoadResponse,
  SerializedStateForPlayer,
  SessionData,
  UsageStatus,
} from './lib/types';

type HostActionResponse = { success: boolean };
type JsonPayload = Record<string, unknown>;

export class ApiError extends Error {
  code: string;
  payload: JsonPayload;

  constructor(message: string, code = 'REQUEST_FAILED', payload: JsonPayload = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.payload = payload;
  }
}

export const BACKEND_BASE = (import.meta.env.VITE_BACKEND_URL ?? 'https://top-ten.maxschimmel17799.workers.dev').replace(/\/$/, '');

const defaultHeaders = {
  'Content-Type': 'application/json',
};

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    if (response.ok) {
      return {} as T;
    }
    throw new ApiError('Empty response');
  }

  const payload = JSON.parse(text) as JsonPayload;
  if (!response.ok) {
    throw new ApiError((payload.message as string) ?? (payload.error as string) ?? 'Request failed', String(payload.error ?? 'REQUEST_FAILED'), payload);
  }
  return payload as T;
}

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  return parseJson<T>(response);
}

function authHeaders(token?: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface CreateGamePayload {
  hostNickname: string;
  seed?: string;
  questionBankId: string;
  overrideToken?: string;
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

export interface AdminLoginResult {
  token: string;
  expiresInMs: number;
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
    throw new ApiError('Host token missing', 'HOST_TOKEN_MISSING');
  }
  return request<HostActionResponse>(`${BACKEND_BASE}/api/game/${gameId}/${action}`, {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify({ ...payload, hostToken: session.hostToken }),
  });
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

export async function fetchQuestionBankCatalog(): Promise<QuestionBankCatalogResponse> {
  return request<QuestionBankCatalogResponse>(`${BACKEND_BASE}/api/question-banks/catalog`);
}

export async function fetchQuestionBankById(bankId: string): Promise<QuestionBankLoadResponse> {
  return request<QuestionBankLoadResponse>(`${BACKEND_BASE}/api/question-banks/${encodeURIComponent(bankId)}`);
}

export async function fetchPublicUsageStatus(): Promise<UsageStatus> {
  return request<UsageStatus>(`${BACKEND_BASE}/api/usage-status`);
}

export async function adminLogin(password: string): Promise<AdminLoginResult> {
  return request<AdminLoginResult>(`${BACKEND_BASE}/api/admin/login`, {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify({ password }),
  });
}

export async function adminReauthorize(password: string): Promise<AdminLoginResult> {
  return request<AdminLoginResult>(`${BACKEND_BASE}/api/admin/reauthorize`, {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify({ password }),
  });
}

export async function fetchAdminUsageStatus(adminToken: string): Promise<UsageStatus> {
  return request<UsageStatus>(`${BACKEND_BASE}/api/admin/usage-status`, {
    headers: authHeaders(adminToken),
  });
}

export async function fetchAdminQuestionBanks(adminToken: string): Promise<{ banks: QuestionBankCatalogItem[] }> {
  return request(`${BACKEND_BASE}/api/admin/question-banks`, {
    headers: authHeaders(adminToken),
  });
}

export async function fetchAdminQuestionBankDetail(adminToken: string, bankId: string): Promise<{ detail: AdminQuestionBankDetail }> {
  return request(`${BACKEND_BASE}/api/admin/question-banks/${encodeURIComponent(bankId)}`, {
    headers: authHeaders(adminToken),
  });
}

export async function createAdminQuestionBank(
  adminToken: string,
  payload: JsonPayload
): Promise<{ detail: AdminQuestionBankDetail }> {
  return request(`${BACKEND_BASE}/api/admin/question-banks`, {
    method: 'POST',
    headers: { ...defaultHeaders, ...authHeaders(adminToken) },
    body: JSON.stringify(payload),
  });
}

export async function updateAdminQuestionBank(
  adminToken: string,
  bankId: string,
  payload: JsonPayload
): Promise<{ detail: AdminQuestionBankDetail }> {
  return request(`${BACKEND_BASE}/api/admin/question-banks/${encodeURIComponent(bankId)}`, {
    method: 'PUT',
    headers: { ...defaultHeaders, ...authHeaders(adminToken) },
    body: JSON.stringify(payload),
  });
}

export async function importAdminQuestionBank(
  adminToken: string,
  bankId: string,
  payload: JsonPayload
): Promise<{ detail: AdminQuestionBankDetail }> {
  return request(`${BACKEND_BASE}/api/admin/question-banks/${encodeURIComponent(bankId)}/import`, {
    method: 'POST',
    headers: { ...defaultHeaders, ...authHeaders(adminToken) },
    body: JSON.stringify(payload),
  });
}

export async function copyAdminQuestionBank(
  adminToken: string,
  bankId: string,
  payload: JsonPayload = {}
): Promise<{ detail: AdminQuestionBankDetail }> {
  return request(`${BACKEND_BASE}/api/admin/question-banks/${encodeURIComponent(bankId)}/copy`, {
    method: 'POST',
    headers: { ...defaultHeaders, ...authHeaders(adminToken) },
    body: JSON.stringify(payload),
  });
}

export async function fetchAdminQuestionBankRevision(
  adminToken: string,
  bankId: string,
  revision: number
): Promise<{ detail: AdminQuestionBankDetail }> {
  return request(`${BACKEND_BASE}/api/admin/question-banks/${encodeURIComponent(bankId)}/revisions/${revision}`, {
    headers: authHeaders(adminToken),
  });
}

export async function restoreAdminQuestionBankRevision(
  adminToken: string,
  bankId: string,
  revision: number,
  payload: JsonPayload = {}
): Promise<{ detail: AdminQuestionBankDetail }> {
  return request(`${BACKEND_BASE}/api/admin/question-banks/${encodeURIComponent(bankId)}/revisions/${revision}/restore`, {
    method: 'POST',
    headers: { ...defaultHeaders, ...authHeaders(adminToken) },
    body: JSON.stringify(payload),
  });
}
