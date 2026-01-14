import questionBankClassic from '../question-banks/classic_v1.json' with { type: 'json' };
import {
  generateShortId,
  generateToken,
  normalizeNickname,
  seededRng,
  shuffleWithRng,
  pickUniqueIndexes,
} from './utils.js';

type JsonPayload = Record<string, unknown>;

async function parseJson(request: Request): Promise<JsonPayload> {
  try {
    return (await request.json()) as JsonPayload;
  } catch {
    return {};
  }
}

const questionBanks: Record<string, QuestionBankDefinition> = {
  [questionBankClassic.id]: questionBankClassic as QuestionBankDefinition,
};

const MAX_PLAYERS = 10;
const HOST_TIMEOUT_MS = 10 * 60 * 1000;

export type Phase = 'LOBBY' | 'ACTIVE' | 'ENDED';
export type PlayerStatus = 'ACTIVE' | 'PENDING';
export type PlayerRole = 'HOST' | 'PLAYER';

interface QuestionDefinition {
  id: string;
  prompt: string;
}

interface QuestionBankDefinition {
  id: string;
  name: string;
  version: number;
  questions: QuestionDefinition[];
}

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
  hostToken: string;
  phase: Phase;
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
}

interface SerializedStateForPlayer extends SerializedStateBase {
  yourPlayerId: string | null;
  yourRole: PlayerRole | null;
  yourSecretNumber: number | null;
  promptOptions?: string[];
}

type ClientMessage =
  | { type: 'PING' }
  | { type: 'HOST_CHOOSE_PROMPT'; promptId: string };

export interface Env {
  GAME_DO: DurableObjectNamespace;
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
    if (this.state !== null) {
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
    if (!this.state) {
      return;
    }
    await this.storage.put('state', this.state);
  }

  private async saveStateSilently(): Promise<void> {
    if (!this.state) {
      return;
    }
    await this.storage.put('state', this.state);
  }

  private bumpVersion(): void {
    if (!this.state) {
      return;
    }
    this.state.version += 1;
    this.state.updatedAt = Date.now();
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

    const gameRoute = url.pathname.match(/^\/api\/game\/([^\/]+)(\/.*)?$/);
    if (!gameRoute) {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }

    const [, gameId, route] = gameRoute;
    if (gameId !== this.state.gameId) {
      return new Response('Game mismatch', { status: 400, headers: corsHeaders });
    }

    await this.checkAndAutoEndHostTimeout();

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

  private async handleInternalCreate(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const payload = await parseJson(request);
    const gameId = typeof payload.gameId === 'string' ? payload.gameId : undefined;
    if (!gameId) {
      return new Response('Missing gameId', { status: 400, headers: corsHeaders });
    }
    await this.loadState();
    if (this.state) {
      return new Response('Game already exists', { status: 409, headers: corsHeaders });
    }
    const now = Date.now();
    const hostPlayerId = generateShortId(8);
    const playerToken = generateToken(48);
    const hostToken = generateToken(56);
    const nickname = normalizeNickname(String(payload.hostNickname ?? 'Host'));
    const providedSeed = typeof payload.seed === 'string' ? payload.seed.trim() : '';
    const seed = providedSeed || crypto.randomUUID();
    const questionBankId =
      typeof payload.questionBankId === 'string' ? payload.questionBankId : questionBankClassic.id;

    this.state = {
      gameId,
      seed,
      questionBankId,
      hostToken,
      phase: 'LOBBY',
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
    };

    await this.persistState();
    this.broadcastState();

    const responsePayload = {
      gameId,
      seed,
      questionBankId,
      hostToken,
      playerId: hostPlayerId,
      playerToken,
      role: 'HOST',
      joinPath: `/g/${gameId}`,
    };
    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
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
    const totalPlayers = Object.keys(this.state.players).length;
    if (totalPlayers >= MAX_PLAYERS) {
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
    }
    this.bumpVersion();
    await this.persistState();
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
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
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
    const requestedOrder: string[] = Array.isArray(payload.order)
      ? payload.order.map((item) => String(item))
      : [];
    const currentIds = new Set(Object.keys(this.state.players));
    const providedIds = new Set(requestedOrder);
    if (currentIds.size !== providedIds.size || ![...currentIds].every((id) => providedIds.has(id))) {
      return new Response(JSON.stringify({ error: 'INVALID_ORDER' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    this.state.order = requestedOrder;
    this.bumpVersion();
    await this.persistState();
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
    this.state.phase = 'ACTIVE';
    this.state.round = 1;
    this.promotePendingPlayers();
    this.dealRound();
    this.bumpVersion();
    await this.persistState();
    this.broadcastState();
    this.broadcastRoundStart();
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
    this.state.round += 1;
    this.promotePendingPlayers();
    this.dealRound();
    this.bumpVersion();
    await this.persistState();
    this.broadcastState();
    this.broadcastRoundStart();
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
    if (this.state.phase === 'ENDED') {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    this.state.phase = 'ENDED';
    this.state.roundHostPlayerId = null;
    this.state.roundAssignments = {};
    this.bumpVersion();
    await this.persistState();
    this.broadcastState();
    this.broadcastGameEnded('HOST_REQUESTED');
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
      return new Response(null, {
        status: 204,
        headers: { 'X-Version': `${this.state.version}`, ...corsHeaders },
      });
    }
    const payload = this.serializeStateForPlayer(playerInfo.playerId);
    return new Response(JSON.stringify(payload), {
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
    server.addEventListener('message', (event) => this.handleSocketMessage(playerInfo.playerId, server, event));
    server.addEventListener('close', () => void this.handleSocketClose(playerInfo.playerId, server));
    await this.touchPlayerLastSeen(playerInfo.playerId);
    this.bumpVersion();
    await this.persistState();
    this.broadcastState();

    const payload = this.serializeStateForPlayer(playerInfo.playerId);
    server.send(JSON.stringify({ type: 'STATE', payload }));

    return new Response(null, { status: 101, webSocket: client });
  }

  private addClient(playerId: string, socket: WebSocket): void {
    const set = this.clients.get(playerId) ?? new Set<WebSocket>();
    set.add(socket);
    this.clients.set(playerId, set);
    const player = this.state?.players[playerId];
    if (player) {
      player.connected = true;
    }
  }

  private async handleSocketClose(playerId: string, socket: WebSocket): Promise<void> {
    const set = this.clients.get(playerId);
    if (!set) {
      return;
    }
    set.delete(socket);
    if (set.size === 0) {
      this.clients.delete(playerId);
      const player = this.state?.players[playerId];
      if (player) {
        player.connected = false;
        this.bumpVersion();
        await this.persistState();
        this.broadcastState();
      }
    }
  }

  private handleSocketMessage(playerId: string, socket: WebSocket, event: MessageEvent): void {
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : null;
      if (!data || typeof data.type !== 'string') {
        return;
      }
      switch (data.type) {
        case 'PING':
          void this.touchPlayerLastSeen(playerId);
          break;
        case 'HOST_CHOOSE_PROMPT':
          this.handleHostChoosePrompt(playerId, data.promptId);
          break;
      }
    } catch (error) {
      console.error('ws message error', error);
    }
  }

  private handleHostChoosePrompt(playerId: string, promptId: string): void {
    if (!this.state) {
      return;
    }
    const roundMeta = this.state.roundPromptsByRound[this.state.round];
    if (!roundMeta || roundMeta.hostPlayerId !== playerId) {
      return;
    }
    if (!roundMeta.promptIds.includes(promptId)) {
      return;
    }
    roundMeta.chosenPromptId = promptId;
    this.bumpVersion();
    this.persistState();
    this.broadcastState();
    this.broadcastEvent({ type: 'ROUND_META', payload: { chosenPromptId: promptId } });
  }

  private async touchPlayerLastSeen(playerId: string): Promise<void> {
    if (!this.state) {
      return;
    }
    const player = this.state.players[playerId];
    if (!player) {
      return;
    }
    const now = Date.now();
    player.lastSeenAt = now;
    if (player.role === 'HOST') {
      this.state.hostLastSeenAt = now;
    }
    await this.saveStateSilently();
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
    if (headerToken) {
      return headerToken;
    }
    return url.searchParams.get('token');
  }

  private async checkAndAutoEndHostTimeout(): Promise<void> {
    if (!this.state || this.state.phase !== 'ACTIVE') {
      return;
    }
    const now = Date.now();
    if (now - this.state.hostLastSeenAt <= HOST_TIMEOUT_MS) {
      return;
    }
    this.state.phase = 'ENDED';
    this.state.roundHostPlayerId = null;
    this.state.roundAssignments = {};
    this.bumpVersion();
    await this.persistState();
    this.broadcastState();
    this.broadcastGameEnded('HOST_TIMEOUT');
  }

  private promotePendingPlayers(): void {
    if (!this.state) {
      return;
    }
    for (const playerId of this.state.pendingJoinQueue) {
      const player = this.state.players[playerId];
      if (player) {
        player.status = 'ACTIVE';
      }
    }
    this.state.pendingJoinQueue = [];
  }

  private dealRound(): void {
    const state = this.state;
    if (!state) {
      return;
    }
    const activeIds = state.order.filter((id) => state.players[id]?.status === 'ACTIVE');
    if (activeIds.length === 0) {
      state.roundHostPlayerId = null;
      state.roundAssignments = {};
      return;
    }
    const assignmentRng = seededRng(`${state.seed}-round-${state.round}-assign`);
    const assignmentMap: Record<string, number> = {};
    const secretNumbers = shuffleWithRng(Array.from({ length: 10 }, (_, i) => i + 1), assignmentRng);
    for (let index = 0; index < activeIds.length; index += 1) {
      assignmentMap[activeIds[index]] = secretNumbers[index % secretNumbers.length];
    }
    const hostIndex = (state.round - 1) % activeIds.length;
    const roundHostId = activeIds[hostIndex];
    state.roundAssignments = assignmentMap;
    state.roundHostPlayerId = roundHostId;

    const bank = questionBanks[state.questionBankId] ?? questionBankClassic;
    const promptRng = seededRng(`${state.seed}-round-${state.round}-prompt`);
    const indexes = pickUniqueIndexes(3, bank.questions.length, promptRng);
    state.roundPromptsByRound[state.round] = {
      hostPlayerId: roundHostId,
      promptIds: indexes.map((idx) => bank.questions[idx % bank.questions.length].id),
    };
  }

  private broadcastState(): void {
    if (!this.state) {
      return;
    }
    for (const [playerId, sockets] of this.clients.entries()) {
      const payload = this.serializeStateForPlayer(playerId);
      const message = JSON.stringify({ type: 'STATE', payload });
      for (const socket of sockets) {
        socket.send(message);
      }
    }
  }

  private broadcastRoundStart(): void {
    if (!this.state) {
      return;
    }
    const roundMeta = this.state.roundPromptsByRound[this.state.round];
    for (const [playerId, sockets] of this.clients.entries()) {
      const payload = {
        round: this.state.round,
        roundHostPlayerId: this.state.roundHostPlayerId,
        yourSecretNumber: this.state.roundAssignments[playerId] ?? null,
        promptIds: roundMeta?.hostPlayerId === playerId ? roundMeta.promptIds : undefined,
        chosenPromptId: roundMeta?.chosenPromptId,
      };
      const message = JSON.stringify({ type: 'ROUND_START', payload });
      for (const socket of sockets) {
        socket.send(message);
      }
    }
  }

  private broadcastEvent(event: unknown): void {
    for (const sockets of this.clients.values()) {
      const message = JSON.stringify(event);
      for (const socket of sockets) {
        socket.send(message);
      }
    }
  }

  private broadcastGameEnded(reason: string): void {
    this.broadcastEvent({ type: 'GAME_ENDED', payload: { reason } });
  }

  private serializeStateForPlayer(playerId: string | null): SerializedStateForPlayer {
    const state = this.state;
    if (!state) {
      throw new Error('State unavailable');
    }
    const serializedPlayers = state.order
      .map((id) => state.players[id])
      .filter((player): player is PlayerState => Boolean(player))
      .map((player, index) => ({
        playerId: player.playerId,
        nickname: player.nickname,
        role: player.role,
        status: player.status,
        connected: player.connected,
        seatLabel: index >= 0 ? index + 1 : null,
        joinedAt: player.joinedAt,
      }));
    const pendingCount = state.order.filter((id) => state.players[id]?.status === 'PENDING').length;
    const activeCount = state.order.filter((id) => state.players[id]?.status === 'ACTIVE').length;
    const roundMeta = state.roundPromptsByRound[state.round];
    const base: SerializedStateBase = {
      gameId: state.gameId,
      version: state.version,
      phase: state.phase,
      round: state.round,
      players: serializedPlayers,
      order: state.order,
      pendingCount,
      activeCount,
      roundHostPlayerId: state.roundHostPlayerId,
      questionBankId: state.questionBankId,
      seed: state.seed,
      maxPlayers: MAX_PLAYERS,
      chosenPromptId: roundMeta?.chosenPromptId,
    };
    const playerInfo = playerId ? state.players[playerId] : null;
    const payload: SerializedStateForPlayer = {
      ...base,
      yourPlayerId: playerId,
      yourRole: playerInfo?.role ?? null,
      yourSecretNumber: playerId ? state.roundAssignments[playerId] ?? null : null,
    };
    if (roundMeta?.hostPlayerId === playerId) {
      payload.promptOptions = roundMeta.promptIds;
    }
    return payload;
  }
}
