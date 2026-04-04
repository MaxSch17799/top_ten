type MonitorEventType =
  | 'GAME_CREATED'
  | 'GAME_STATE_CHANGED'
  | 'GAME_ENDED'
  | 'ADMIN_LOGIN'
  | 'ADMIN_WRITE'
  | 'D1_USAGE';

interface ActiveGameUsage {
  gameId: string;
  phase: 'LOBBY' | 'ACTIVE';
  phaseStartedAt: number;
  lastActivityAt: number;
  connectedPlayers: number;
}

interface UsageMonitorState {
  dayUtc: string;
  gameCreateCount: number;
  adminLoginCount: number;
  adminWriteCount: number;
  d1RowsRead: number;
  d1RowsWritten: number;
  activeGames: Record<string, ActiveGameUsage>;
}

interface TrackPayload {
  type: MonitorEventType;
  gameId?: string;
  phase?: 'LOBBY' | 'ACTIVE' | 'ENDED';
  connectedPlayers?: number;
  rowsRead?: number;
  rowsWritten?: number;
}

export interface UsageStatusSnapshot {
  dayUtc: string;
  nearLimit: boolean;
  hardBlock: boolean;
  warningMessage: string | null;
  thresholds: {
    warnPercent: number;
    blockPercent: number;
  };
  counters: {
    gameCreatesToday: number;
    adminLoginsToday: number;
    adminWritesToday: number;
    d1RowsReadToday: number;
    d1RowsWrittenToday: number;
    activeLobbies: number;
    activeGames: number;
    connectedPlayersNow: number;
    estimatedDoDurationGbSecondsToday: number;
  };
}

export interface UsageMonitorEnv {
  USAGE_WARN_PERCENT?: string;
  USAGE_BLOCK_PERCENT?: string;
  USAGE_MONITOR_DO: DurableObjectNamespace;
}

function getDayUtc(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function createState(now = Date.now()): UsageMonitorState {
  return {
    dayUtc: getDayUtc(now),
    gameCreateCount: 0,
    adminLoginCount: 0,
    adminWriteCount: 0,
    d1RowsRead: 0,
    d1RowsWritten: 0,
    activeGames: {},
  };
}

function getDayStartMs(dayUtc: string): number {
  return Date.parse(`${dayUtc}T00:00:00.000Z`);
}

function normalizeThreshold(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildStatus(state: UsageMonitorState, env: UsageMonitorEnv, now = Date.now()): UsageStatusSnapshot {
  const activeValues = Object.values(state.activeGames);
  const activeLobbies = activeValues.filter((entry) => entry.phase === 'LOBBY').length;
  const activeGames = activeValues.filter((entry) => entry.phase === 'ACTIVE').length;
  const connectedPlayersNow = activeValues.reduce((sum, entry) => sum + entry.connectedPlayers, 0);
  const dayStart = getDayStartMs(state.dayUtc);
  const estimatedDoDurationGbSecondsToday = Math.round(
    activeValues.reduce((sum, entry) => {
      const elapsedSeconds = Math.max(0, Math.floor((now - Math.max(dayStart, entry.phaseStartedAt)) / 1000));
      return sum + elapsedSeconds * 0.125;
    }, 0)
  );

  const warnPercent = normalizeThreshold(env.USAGE_WARN_PERCENT, 80);
  const blockPercent = normalizeThreshold(env.USAGE_BLOCK_PERCENT, 95);
  const ratio = Math.max(
    estimatedDoDurationGbSecondsToday / 13000,
    state.d1RowsRead / 5_000_000,
    state.d1RowsWritten / 100_000
  );
  const nearLimit = ratio >= warnPercent / 100;
  const hardBlock = ratio >= blockPercent / 100;

  return {
    dayUtc: state.dayUtc,
    nearLimit,
    hardBlock,
    warningMessage: hardBlock
      ? 'Free-tier usage is very close to the configured limit. New lobbies and admin writes require an override.'
      : nearLimit
        ? 'Free-tier usage is nearing the configured limit. New lobbies and admin writes require an override.'
        : null,
    thresholds: { warnPercent, blockPercent },
    counters: {
      gameCreatesToday: state.gameCreateCount,
      adminLoginsToday: state.adminLoginCount,
      adminWritesToday: state.adminWriteCount,
      d1RowsReadToday: state.d1RowsRead,
      d1RowsWrittenToday: state.d1RowsWritten,
      activeLobbies,
      activeGames,
      connectedPlayersNow,
      estimatedDoDurationGbSecondsToday,
    },
  };
}

export class UsageMonitorDurableObject {
  private stateData: UsageMonitorState | null = null;
  private loadingStatePromise: Promise<void> | null = null;

  constructor(private readonly controller: DurableObjectState, private readonly env: UsageMonitorEnv) {}

  private async loadState(): Promise<void> {
    if (this.stateData) {
      return;
    }
    if (!this.loadingStatePromise) {
      this.loadingStatePromise = this.controller.storage.get<UsageMonitorState>('state').then((stored) => {
        this.stateData = stored ?? createState();
      });
    }
    await this.loadingStatePromise;
  }

  private ensureToday(now = Date.now()): void {
    if (!this.stateData) {
      this.stateData = createState(now);
      return;
    }
    const today = getDayUtc(now);
    if (this.stateData.dayUtc === today) {
      return;
    }
    this.stateData.dayUtc = today;
    this.stateData.gameCreateCount = 0;
    this.stateData.adminLoginCount = 0;
    this.stateData.adminWriteCount = 0;
    this.stateData.d1RowsRead = 0;
    this.stateData.d1RowsWritten = 0;
  }

  private async persist(): Promise<void> {
    if (this.stateData) {
      await this.controller.storage.put('state', this.stateData);
    }
  }

  public async fetch(request: Request): Promise<Response> {
    await this.loadState();
    this.ensureToday();
    const url = new URL(request.url);
    if (url.pathname === '/internal/status' && request.method === 'GET') {
      return Response.json(buildStatus(this.stateData!, this.env));
    }
    if (url.pathname !== '/internal/track' || request.method !== 'POST') {
      return new Response('Not found', { status: 404 });
    }

    const payload = (await request.json().catch(() => ({}))) as TrackPayload;
    const now = Date.now();
    this.ensureToday(now);
    const state = this.stateData!;
    switch (payload.type) {
      case 'GAME_CREATED':
        state.gameCreateCount += 1;
        if (payload.gameId) {
          state.activeGames[payload.gameId] = {
            gameId: payload.gameId,
            phase: 'LOBBY',
            phaseStartedAt: now,
            lastActivityAt: now,
            connectedPlayers: payload.connectedPlayers ?? 1,
          };
        }
        break;
      case 'GAME_STATE_CHANGED':
        if (payload.gameId) {
          const existing = state.activeGames[payload.gameId] ?? {
            gameId: payload.gameId,
            phase: payload.phase === 'ACTIVE' ? 'ACTIVE' : 'LOBBY',
            phaseStartedAt: now,
            lastActivityAt: now,
            connectedPlayers: payload.connectedPlayers ?? 0,
          };
          if (payload.phase && payload.phase !== existing.phase) {
            existing.phase = payload.phase === 'ACTIVE' ? 'ACTIVE' : 'LOBBY';
            existing.phaseStartedAt = now;
          }
          existing.lastActivityAt = now;
          if (typeof payload.connectedPlayers === 'number') {
            existing.connectedPlayers = payload.connectedPlayers;
          }
          state.activeGames[payload.gameId] = existing;
        }
        break;
      case 'GAME_ENDED':
        if (payload.gameId) {
          delete state.activeGames[payload.gameId];
        }
        break;
      case 'ADMIN_LOGIN':
        state.adminLoginCount += 1;
        break;
      case 'ADMIN_WRITE':
        state.adminWriteCount += 1;
        break;
      case 'D1_USAGE':
        state.d1RowsRead += Number(payload.rowsRead ?? 0);
        state.d1RowsWritten += Number(payload.rowsWritten ?? 0);
        break;
    }

    await this.persist();
    return new Response(null, { status: 204 });
  }
}

async function getUsageStub(env: UsageMonitorEnv) {
  return env.USAGE_MONITOR_DO.get(env.USAGE_MONITOR_DO.idFromName('global'));
}

export async function trackUsageEvent(env: UsageMonitorEnv, payload: TrackPayload): Promise<void> {
  const stub = await getUsageStub(env);
  await stub.fetch('https://usage.internal/internal/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function fetchUsageStatus(env: UsageMonitorEnv): Promise<UsageStatusSnapshot> {
  const stub = await getUsageStub(env);
  const response = await stub.fetch('https://usage.internal/internal/status');
  return (await response.json()) as UsageStatusSnapshot;
}
