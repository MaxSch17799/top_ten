import { defaultQuestionBankId, questionBanks as staticQuestionBanks } from './generated/questionBanks.js';
import type { DbEnv } from './questionBanksDb.js';
import type { QuestionBankDefinition } from './questionBankTypes.js';
import { trackUsageEvent, type UsageMonitorEnv } from './usageMonitor.js';
import {
  generateShortId,
  generateToken,
  normalizeNickname,
  pickUniqueIndexes,
  seededRng,
  shuffleWithRng,
} from './utils.js';

type JsonPayload = Record<string, unknown>;

const MAX_PLAYERS = 10;
const HOST_TIMEOUT_MS = 10 * 60 * 1000;
const LOBBY_TIMEOUT_MS = 30 * 60 * 1000;
const ROUND_TIMEOUT_MS = 30 * 60 * 1000;
const WARNING_LEAD_MS = 5 * 60 * 1000;
const HEARTBEAT_PERSIST_MS = 30 * 1000;

export type Phase = 'LOBBY' | 'ACTIVE' | 'ENDED';
export type PlayerStatus = 'ACTIVE' | 'PENDING';
export type PlayerRole = 'HOST' | 'PLAYER';
export type GameEndReason = 'HOST_REQUESTED' | 'HOST_TIMEOUT' | 'ROUND_TIMEOUT' | 'LOBBY_TIMEOUT';
export type InactivityKind = 'LOBBY' | 'ROUND' | null;

interface PlayerState {
  playerId: string;
  nickname: string;
  role: PlayerRole;
  status: PlayerStatus;
  joinedAt: number;
  lastSeenAt: number;
  connected: boolean;
  playerToken: string;
}

interface RoundPromptState {
  hostPlayerId: string | null;
  promptIds: string[];
  chosenPromptId?: string;
}

interface GameState {
  gameId: string;
  seed: string;
  questionBankId: string;
  questionBankSource: 'static' | 'db';
  questionBankRevision: number;
  questionBankSnapshot: QuestionBankDefinition;
  hostToken: string;
  phase: Phase;
  endReason: GameEndReason | null;
  createdAt: number;
  updatedAt: number;
  round: number;
  players: Record<string, PlayerState>;
  order: string[];
  pendingJoinQueue: string[];
  roundHostPlayerId: string | null;
  roundAssignments: Record<string, number>;
  roundPromptsByRound: Record<number, RoundPromptState>;
  version: number;
  hostLastSeenAt: number;
  lobbyActivityAt: number;
  roundStartedAt: number | null;
  inactivityKind: InactivityKind;
  inactivityWarningAt: number | null;
  inactivityEndsAt: number | null;
}

interface SerializedPlayer {
  playerId: string;
  nickname: string;
  role: PlayerRole;
  status: PlayerStatus;
  connected: boolean;
  seatLabel: number | null;
  joinedAt: number;
}

interface SerializedStateBase {
  gameId: string;
  version: number;
  phase: Phase;
  round: number;
  players: SerializedPlayer[];
  order: string[];
  pendingCount: number;
  activeCount: number;
  roundHostPlayerId: string | null;
  questionBankId: string;
  seed: string;
  maxPlayers: number;
  chosenPromptId?: string;
  endedReason: GameEndReason | null;
  inactivityKind: InactivityKind;
  inactivityWarningAt: number | null;
  inactivityEndsAt: number | null;
}

interface SerializedStateForPlayer extends SerializedStateBase {
  yourPlayerId: string | null;
  yourRole: PlayerRole | null;
  yourSecretNumber: number | null;
  promptOptions?: QuestionBankDefinition['questions'];
}

type ClientMessage =
  | { type: 'PING' }
  | { type: 'HOST_CHOOSE_PROMPT'; promptId: string };

export interface Env extends DbEnv, UsageMonitorEnv {
  GAME_DO: DurableObjectNamespace;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
}

async function parseJson(request: Request): Promise<JsonPayload> {
  try {
    return (await request.json()) as JsonPayload;
  } catch {
    return {};
  }
}

function fallbackStaticBank(): QuestionBankDefinition {
  return staticQuestionBanks[defaultQuestionBankId] as QuestionBankDefinition;
}

function isQuestionBankDefinition(value: unknown): value is QuestionBankDefinition {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as QuestionBankDefinition;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.version === 'number' &&
    Array.isArray(candidate.questions) &&
    candidate.questions.every((question) => typeof question.id === 'string' && typeof question.prompt === 'string')
  );
}

export class GameDurableObject {
  private state: GameState | null = null;
  private clients = new Map<string, Set<WebSocket>>();
  private loadingStatePromise: Promise<void> | null = null;

  constructor(private readonly stateController: DurableObjectState, private readonly env: Env) {}

  private get storage(): DurableObjectStorage {
    return this.stateController.storage;
  }

  private async loadState(): Promise<void> {
    if (this.state) {
      return;
    }
    if (!this.loadingStatePromise) {
      this.loadingStatePromise = this.storage.get<GameState>('state').then((stored) => {
        this.state = stored ?? null;
      });
    }
    await this.loadingStatePromise;
  }

  private async persistState(): Promise<void> {
    if (this.state) {
      await this.storage.put('state', this.state);
    }
  }

  private bumpVersion(now = Date.now()): void {
    if (!this.state) {
      return;
    }
    this.state.version += 1;
    this.state.updatedAt = now;
  }

  private connectedPlayerCount(): number {
    if (!this.state) {
      return 0;
    }
    return Object.values(this.state.players).filter((player) => player.connected).length;
  }

  private trackUsage(payload: Parameters<typeof trackUsageEvent>[1]): void {
    this.stateController.waitUntil(trackUsageEvent(this.env, payload).catch(() => undefined));
  }

  private notifyUsageStateChanged(): void {
    if (!this.state || this.state.phase === 'ENDED') {
      return;
    }
    this.trackUsage({
      type: 'GAME_STATE_CHANGED',
      gameId: this.state.gameId,
      phase: this.state.phase,
      connectedPlayers: this.connectedPlayerCount(),
    });
  }

  private updateInactivityWindow(now = Date.now()): void {
    if (!this.state) {
      return;
    }
    if (this.state.phase === 'LOBBY') {
      this.state.inactivityKind = 'LOBBY';
      this.state.inactivityEndsAt = this.state.lobbyActivityAt + LOBBY_TIMEOUT_MS;
      this.state.inactivityWarningAt = this.state.inactivityEndsAt - WARNING_LEAD_MS;
      return;
    }
    if (this.state.phase === 'ACTIVE') {
      const base = this.state.roundStartedAt ?? now;
      this.state.inactivityKind = 'ROUND';
      this.state.inactivityEndsAt = base + ROUND_TIMEOUT_MS;
      this.state.inactivityWarningAt = this.state.inactivityEndsAt - WARNING_LEAD_MS;
      return;
    }
    this.state.inactivityKind = null;
    this.state.inactivityEndsAt = null;
    this.state.inactivityWarningAt = null;
  }

  private async scheduleNextAlarm(): Promise<void> {
    if (!this.state || this.state.phase === 'ENDED') {
      await this.storage.deleteAlarm();
      return;
    }
    const candidates: number[] = [];
    if (this.state.inactivityEndsAt) {
      candidates.push(this.state.inactivityEndsAt);
    }
    if (this.state.phase === 'ACTIVE') {
      candidates.push(this.state.hostLastSeenAt + HOST_TIMEOUT_MS);
    }
    if (!candidates.length) {
      await this.storage.deleteAlarm();
      return;
    }
    await this.storage.setAlarm(Math.min(...candidates));
  }

  private createCorsHeaders(request: Request): Record<string, string> {
    const origin = request.headers.get('Origin') ?? '*';
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Player-Token,X-Host-Token',
      'Access-Control-Expose-Headers': 'X-Version',
    };
  }

  public async fetch(request: Request): Promise<Response> {
    const corsHeaders = this.createCorsHeaders(request);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (url.pathname === '/api/internal/create') {
      return this.handleInternalCreate(request, corsHeaders);
    }

    await this.loadState();
    if (!this.state) {
      return new Response('Game not initialized', { status: 404, headers: corsHeaders });
    }

    const match = url.pathname.match(/^\/api\/game\/([^/]+)(\/.*)?$/);
    if (!match) {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }
    const [, gameId, route] = match;
    if (gameId !== this.state.gameId) {
      return new Response('Game mismatch', { status: 400, headers: corsHeaders });
    }

    await this.checkAutoEndConditions();
    const normalizedRoute = (route ?? '').replace(/\/$/, '');
    switch (true) {
      case normalizedRoute === '/ws':
        return this.handleWebSocket(request, corsHeaders);
      case normalizedRoute === '/state' && request.method === 'GET':
        return this.handleState(request, corsHeaders, url);
      case normalizedRoute === '/join' && request.method === 'POST':
        return this.handleJoin(request, corsHeaders);
      case normalizedRoute === '/reorder' && request.method === 'POST':
        return this.handleReorder(request, corsHeaders);
      case normalizedRoute === '/startRound1' && request.method === 'POST':
        return this.handleStartRound1(request, corsHeaders);
      case normalizedRoute === '/nextRound' && request.method === 'POST':
        return this.handleNextRound(request, corsHeaders);
      case normalizedRoute === '/end' && request.method === 'POST':
        return this.handleEnd(request, corsHeaders);
      default:
        return new Response('Endpoint not supported', { status: 404, headers: corsHeaders });
    }
  }

  public async alarm(): Promise<void> {
    await this.loadState();
    await this.checkAutoEndConditions();
  }

  private async handleInternalCreate(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const payload = await parseJson(request);
    const gameId = typeof payload.gameId === 'string' ? payload.gameId : '';
    if (!gameId) {
      return new Response('Missing gameId', { status: 400, headers: corsHeaders });
    }
    await this.loadState();
    if (this.state) {
      return new Response('Game already exists', { status: 409, headers: corsHeaders });
    }

    const now = Date.now();
    const hostPlayerId = generateShortId(8);
    const hostToken = generateToken(56);
    const playerToken = generateToken(48);
    const nickname = normalizeNickname(String(payload.hostNickname ?? 'Host'));
    const seed = typeof payload.seed === 'string' && payload.seed.trim() ? payload.seed.trim() : crypto.randomUUID();
    const fallbackBank = fallbackStaticBank();
    const providedSnapshot = isQuestionBankDefinition(payload.questionBankSnapshot) ? payload.questionBankSnapshot : null;
    const snapshot = providedSnapshot ?? fallbackBank;
    const questionBankId =
      typeof payload.questionBankId === 'string' && payload.questionBankId.trim() ? payload.questionBankId.trim() : snapshot.id;
    const questionBankSource = payload.questionBankSource === 'db' ? 'db' : 'static';
    const questionBankRevision =
      typeof payload.questionBankRevision === 'number' && Number.isFinite(payload.questionBankRevision)
        ? payload.questionBankRevision
        : snapshot.version;

    this.state = {
      gameId,
      seed,
      questionBankId,
      questionBankSource,
      questionBankRevision,
      questionBankSnapshot: snapshot,
      hostToken,
      phase: 'LOBBY',
      endReason: null,
      createdAt: now,
      updatedAt: now,
      round: 0,
      players: {
        [hostPlayerId]: {
          playerId: hostPlayerId,
          nickname,
          role: 'HOST',
          status: 'ACTIVE',
          joinedAt: now,
          lastSeenAt: now,
          connected: false,
          playerToken,
        },
      },
      order: [hostPlayerId],
      pendingJoinQueue: [],
      roundHostPlayerId: null,
      roundAssignments: {},
      roundPromptsByRound: {},
      version: 1,
      hostLastSeenAt: now,
      lobbyActivityAt: now,
      roundStartedAt: null,
      inactivityKind: 'LOBBY',
      inactivityWarningAt: null,
      inactivityEndsAt: null,
    };
    this.updateInactivityWindow(now);
    await this.persistState();
    await this.scheduleNextAlarm();
    this.trackUsage({ type: 'GAME_CREATED', gameId, connectedPlayers: 0 });

    return new Response(
      JSON.stringify({
        gameId,
        seed,
        questionBankId,
        hostToken,
        playerId: hostPlayerId,
        playerToken,
        role: 'HOST',
        joinPath: `/g/${gameId}`,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  private requireHostAuth(request: Request, body: JsonPayload | null): boolean {
    if (!this.state) {
      return false;
    }
    const headerToken = request.headers.get('x-host-token') ?? request.headers.get('authorization')?.split(' ')[1];
    const bodyToken = typeof body?.hostToken === 'string' ? body.hostToken : undefined;
    const token = bodyToken ?? headerToken;
    return !!token && token === this.state.hostToken;
  }

  private async handleJoin(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    if (!this.state) {
      return new Response('Game not initialized', { status: 404, headers: corsHeaders });
    }
    if (this.state.phase === 'ENDED') {
      return new Response(JSON.stringify({ error: 'ENDED' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const payload = await parseJson(request);
    const nickname = normalizeNickname(String(payload.nickname ?? 'Player'));
    if (Object.keys(this.state.players).length >= MAX_PLAYERS) {
      return new Response(JSON.stringify({ error: 'FULL' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const playerId = generateShortId(8);
    const playerToken = generateToken(48);
    const now = Date.now();
    const status: PlayerStatus = this.state.phase === 'LOBBY' ? 'ACTIVE' : 'PENDING';
    this.state.players[playerId] = {
      playerId,
      nickname,
      role: 'PLAYER',
      status,
      joinedAt: now,
      lastSeenAt: now,
      connected: false,
      playerToken,
    };
    this.state.order.push(playerId);
    if (status === 'PENDING') {
      this.state.pendingJoinQueue.push(playerId);
    } else {
      this.state.lobbyActivityAt = now;
      this.updateInactivityWindow(now);
    }
    this.bumpVersion(now);
    await this.persistState();
    await this.scheduleNextAlarm();
    this.notifyUsageStateChanged();
    this.broadcastState();

    return new Response(
      JSON.stringify({
        playerId,
        playerToken,
        role: 'PLAYER',
        status,
        seed: this.state.seed,
        questionBankId: this.state.questionBankId,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  private async handleReorder(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    if (!this.state) {
      return new Response('Game not initialized', { status: 404, headers: corsHeaders });
    }
    if (this.state.phase !== 'LOBBY') {
      return new Response(JSON.stringify({ error: 'NOT_ALLOWED' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    const payload = await parseJson(request);
    if (!this.requireHostAuth(request, payload)) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }

    const requestedOrder = Array.isArray(payload.order) ? payload.order.map((item) => String(item)) : [];
    const currentIds = Object.keys(this.state.players);
    if (
      requestedOrder.length !== currentIds.length ||
      currentIds.some((playerId) => !requestedOrder.includes(playerId))
    ) {
      return new Response(JSON.stringify({ error: 'INVALID_ORDER' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const now = Date.now();
    this.state.order = requestedOrder;
    this.state.lobbyActivityAt = now;
    this.updateInactivityWindow(now);
    this.bumpVersion(now);
    await this.persistState();
    await this.scheduleNextAlarm();
    this.notifyUsageStateChanged();
    this.broadcastState();
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  private async handleStartRound1(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    if (!this.state) {
      return new Response('Game not initialized', { status: 404, headers: corsHeaders });
    }
    const payload = await parseJson(request);
    if (!this.requireHostAuth(request, payload)) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }
    if (this.state.phase !== 'LOBBY') {
      return new Response(JSON.stringify({ error: 'ALREADY_STARTED' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const now = Date.now();
    this.state.phase = 'ACTIVE';
    this.state.endReason = null;
    this.state.round = 1;
    this.state.roundStartedAt = now;
    this.promotePendingPlayers();
    this.dealRound();
    this.updateInactivityWindow(now);
    this.bumpVersion(now);
    await this.persistState();
    await this.scheduleNextAlarm();
    this.notifyUsageStateChanged();
    this.broadcastState();
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  private async handleNextRound(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    if (!this.state) {
      return new Response('Game not initialized', { status: 404, headers: corsHeaders });
    }
    const payload = await parseJson(request);
    if (!this.requireHostAuth(request, payload)) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }
    if (this.state.phase !== 'ACTIVE') {
      return new Response(JSON.stringify({ error: 'NOT_ACTIVE' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const now = Date.now();
    this.state.round += 1;
    this.state.roundStartedAt = now;
    this.promotePendingPlayers();
    this.dealRound();
    this.updateInactivityWindow(now);
    this.bumpVersion(now);
    await this.persistState();
    await this.scheduleNextAlarm();
    this.notifyUsageStateChanged();
    this.broadcastState();
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  private async handleEnd(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    if (!this.state) {
      return new Response('Game not initialized', { status: 404, headers: corsHeaders });
    }
    const payload = await parseJson(request);
    if (!this.requireHostAuth(request, payload)) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }
    if (this.state.phase !== 'ENDED') {
      await this.endGame('HOST_REQUESTED');
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  private async handleState(request: Request, corsHeaders: Record<string, string>, url: URL): Promise<Response> {
    if (!this.state) {
      return new Response('Game not initialized', { status: 404, headers: corsHeaders });
    }
    const token = this.extractPlayerToken(request, url);
    const playerInfo = this.getPlayerByToken(token);
    if (!playerInfo) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }

    await this.touchPlayerLastSeen(playerInfo.playerId);
    const sinceVersion = Number(url.searchParams.get('sinceVersion')) || 0;
    if (sinceVersion >= this.state.version) {
      return new Response(null, { status: 204, headers: { 'X-Version': `${this.state.version}`, ...corsHeaders } });
    }
    return new Response(JSON.stringify(this.serializeStateForPlayer(playerInfo.playerId)), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Version': `${this.state.version}`, ...corsHeaders },
    });
  }

  private async handleWebSocket(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    if (!this.state) {
      return new Response('Game not initialized', { status: 404, headers: corsHeaders });
    }
    const url = new URL(request.url);
    const token = this.extractPlayerToken(request, url);
    const playerInfo = this.getPlayerByToken(token);
    if (!playerInfo) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.addClient(playerInfo.playerId, server);
    server.addEventListener('message', (event) => this.handleSocketMessage(playerInfo.playerId, event));
    server.addEventListener('close', () => void this.handleSocketClose(playerInfo.playerId, server));
    await this.touchPlayerLastSeen(playerInfo.playerId);
    this.bumpVersion();
    await this.persistState();
    this.notifyUsageStateChanged();
    this.broadcastState();
    server.send(JSON.stringify({ type: 'STATE', payload: this.serializeStateForPlayer(playerInfo.playerId) }));
    return new Response(null, { status: 101, webSocket: client });
  }

  private addClient(playerId: string, socket: WebSocket): void {
    const sockets = this.clients.get(playerId) ?? new Set<WebSocket>();
    sockets.add(socket);
    this.clients.set(playerId, sockets);
    if (this.state?.players[playerId]) {
      this.state.players[playerId].connected = true;
    }
  }

  private async handleSocketClose(playerId: string, socket: WebSocket): Promise<void> {
    const sockets = this.clients.get(playerId);
    if (!sockets) {
      return;
    }
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.clients.delete(playerId);
      if (this.state?.players[playerId]) {
        this.state.players[playerId].connected = false;
        this.bumpVersion();
        await this.persistState();
        this.notifyUsageStateChanged();
        this.broadcastState();
      }
    }
  }

  private handleSocketMessage(playerId: string, event: MessageEvent): void {
    try {
      const data = typeof event.data === 'string' ? (JSON.parse(event.data) as ClientMessage) : null;
      if (!data || typeof data.type !== 'string') {
        return;
      }
      if (data.type === 'PING') {
        void this.touchPlayerLastSeen(playerId);
        return;
      }
      if (data.type === 'HOST_CHOOSE_PROMPT') {
        this.handleHostChoosePrompt(playerId, data.promptId);
      }
    } catch {
      /* ignore malformed messages */
    }
  }

  private handleHostChoosePrompt(playerId: string, promptId: string): void {
    if (!this.state) {
      return;
    }
    const roundMeta = this.state.roundPromptsByRound[this.state.round];
    if (!roundMeta || roundMeta.hostPlayerId !== playerId || !roundMeta.promptIds.includes(promptId)) {
      return;
    }
    roundMeta.chosenPromptId = promptId;
    this.bumpVersion();
    this.stateController.waitUntil(this.persistState().catch(() => undefined));
    this.broadcastState();
  }

  private async touchPlayerLastSeen(playerId: string): Promise<void> {
    if (!this.state?.players[playerId]) {
      return;
    }
    const now = Date.now();
    const player = this.state.players[playerId];
    if (now - player.lastSeenAt < HEARTBEAT_PERSIST_MS) {
      return;
    }
    player.lastSeenAt = now;
    if (player.role === 'HOST') {
      this.state.hostLastSeenAt = now;
      await this.scheduleNextAlarm();
    }
    await this.persistState();
  }

  private getPlayerByToken(token: string | null): { playerId: string; player: PlayerState } | null {
    if (!this.state || !token) {
      return null;
    }
    for (const [playerId, player] of Object.entries(this.state.players)) {
      if (player.playerToken === token) {
        return { playerId, player };
      }
    }
    return null;
  }

  private extractPlayerToken(request: Request, url: URL): string | null {
    const headerToken = request.headers.get('x-player-token') ?? request.headers.get('authorization')?.split(' ')[1];
    return headerToken ?? url.searchParams.get('token');
  }

  private async checkAutoEndConditions(): Promise<void> {
    if (!this.state || this.state.phase === 'ENDED') {
      return;
    }
    const now = Date.now();
    let reason: GameEndReason | null = null;
    if (this.state.phase === 'ACTIVE' && now - this.state.hostLastSeenAt > HOST_TIMEOUT_MS) {
      reason = 'HOST_TIMEOUT';
    } else if (this.state.inactivityEndsAt && now >= this.state.inactivityEndsAt) {
      reason = this.state.phase === 'LOBBY' ? 'LOBBY_TIMEOUT' : 'ROUND_TIMEOUT';
    }
    if (reason) {
      await this.endGame(reason);
      return;
    }
    await this.scheduleNextAlarm();
  }

  private async endGame(reason: GameEndReason): Promise<void> {
    if (!this.state || this.state.phase === 'ENDED') {
      return;
    }
    this.state.phase = 'ENDED';
    this.state.endReason = reason;
    this.state.roundHostPlayerId = null;
    this.state.roundAssignments = {};
    this.updateInactivityWindow(Date.now());
    this.bumpVersion();
    await this.persistState();
    await this.scheduleNextAlarm();
    this.trackUsage({ type: 'GAME_ENDED', gameId: this.state.gameId });
    this.broadcastState();
  }

  private promotePendingPlayers(): void {
    if (!this.state) {
      return;
    }
    for (const playerId of this.state.pendingJoinQueue) {
      if (this.state.players[playerId]) {
        this.state.players[playerId].status = 'ACTIVE';
      }
    }
    this.state.pendingJoinQueue = [];
  }

  private dealRound(): void {
    if (!this.state) {
      return;
    }
    const activeIds = this.state.order.filter((playerId) => this.state?.players[playerId]?.status === 'ACTIVE');
    if (!activeIds.length) {
      this.state.roundHostPlayerId = null;
      this.state.roundAssignments = {};
      return;
    }

    const assignmentRng = seededRng(`${this.state.seed}-round-${this.state.round}-assign`);
    const assignmentMap: Record<string, number> = {};
    const secretNumbers = shuffleWithRng(
      Array.from({ length: 10 }, (_, index) => index + 1),
      assignmentRng
    );
    for (let index = 0; index < activeIds.length; index += 1) {
      assignmentMap[activeIds[index]] = secretNumbers[index % secretNumbers.length];
    }

    const hostIndex = (this.state.round - 1) % activeIds.length;
    const roundHostId = activeIds[hostIndex];
    const promptIndexes = pickUniqueIndexes(
      3,
      this.state.questionBankSnapshot.questions.length,
      seededRng(`${this.state.seed}-round-${this.state.round}-prompt`)
    );

    this.state.roundAssignments = assignmentMap;
    this.state.roundHostPlayerId = roundHostId;
    this.state.roundPromptsByRound[this.state.round] = {
      hostPlayerId: roundHostId,
      promptIds: promptIndexes.map((index) => this.state!.questionBankSnapshot.questions[index].id),
    };
  }

  private broadcastState(): void {
    if (!this.state) {
      return;
    }
    for (const [playerId, sockets] of this.clients.entries()) {
      const message = JSON.stringify({ type: 'STATE', payload: this.serializeStateForPlayer(playerId) });
      for (const socket of [...sockets]) {
        try {
          socket.send(message);
        } catch {
          sockets.delete(socket);
          try {
            socket.close();
          } catch {
            /* ignore close failures */
          }
        }
      }
      if (sockets.size === 0) {
        this.clients.delete(playerId);
        if (this.state.players[playerId]) {
          this.state.players[playerId].connected = false;
        }
      }
    }
  }

  private serializeStateForPlayer(playerId: string | null): SerializedStateForPlayer {
    if (!this.state) {
      throw new Error('State unavailable');
    }
    const serializedPlayers = this.state.order
      .map((id) => this.state!.players[id])
      .filter((player): player is PlayerState => Boolean(player))
      .map((player, index) => ({
        playerId: player.playerId,
        nickname: player.nickname,
        role: player.role,
        status: player.status,
        connected: player.connected,
        seatLabel: index + 1,
        joinedAt: player.joinedAt,
      }));

    const roundMeta = this.state.roundPromptsByRound[this.state.round];
    const base: SerializedStateBase = {
      gameId: this.state.gameId,
      version: this.state.version,
      phase: this.state.phase,
      round: this.state.round,
      players: serializedPlayers,
      order: this.state.order,
      pendingCount: this.state.order.filter((id) => this.state!.players[id]?.status === 'PENDING').length,
      activeCount: this.state.order.filter((id) => this.state!.players[id]?.status === 'ACTIVE').length,
      roundHostPlayerId: this.state.roundHostPlayerId,
      questionBankId: this.state.questionBankId,
      seed: this.state.seed,
      maxPlayers: MAX_PLAYERS,
      chosenPromptId: roundMeta?.chosenPromptId,
      endedReason: this.state.endReason,
      inactivityKind: this.state.inactivityKind,
      inactivityWarningAt: this.state.inactivityWarningAt,
      inactivityEndsAt: this.state.inactivityEndsAt,
    };

    const player = playerId ? this.state.players[playerId] : null;
    const payload: SerializedStateForPlayer = {
      ...base,
      yourPlayerId: playerId,
      yourRole: player?.role ?? null,
      yourSecretNumber: playerId ? this.state.roundAssignments[playerId] ?? null : null,
    };
    if (roundMeta?.hostPlayerId === playerId) {
      payload.promptOptions = roundMeta.promptIds
        .map((promptId) => this.state!.questionBankSnapshot.questions.find((question) => question.id === promptId) ?? null)
        .filter((question): question is QuestionBankDefinition['questions'][number] => Boolean(question));
    }
    return payload;
  }
}
