export type PlayerStatus = 'ACTIVE' | 'PENDING';
export type PlayerRole = 'HOST' | 'PLAYER';
export type GamePhase = 'LOBBY' | 'ACTIVE' | 'ENDED';
export type GameEndReason = 'HOST_REQUESTED' | 'HOST_TIMEOUT' | 'ROUND_TIMEOUT' | 'LOBBY_TIMEOUT';
export type InactivityKind = 'LOBBY' | 'ROUND' | null;
export type QuestionBankSource = 'static' | 'db';

export interface PlayerSummary {
  playerId: string;
  nickname: string;
  role: PlayerRole;
  status: PlayerStatus;
  connected: boolean;
  seatLabel: number | null;
  joinedAt: number;
}

export interface SerializedState {
  gameId: string;
  version: number;
  phase: GamePhase;
  round: number;
  players: PlayerSummary[];
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

export interface SerializedStateForPlayer extends SerializedState {
  yourPlayerId: string | null;
  yourRole: PlayerRole | null;
  yourSecretNumber: number | null;
  promptOptions?: QuestionBankQuestion[];
}

export interface QuestionBankQuestion {
  id: string;
  prompt: string;
}

export interface QuestionBank {
  id: string;
  name: string;
  version: number;
  questions: QuestionBankQuestion[];
}

export interface QuestionBankManifestEntry {
  id: string;
  name: string;
  version: number;
  questionCount: number;
}

export interface QuestionBankManifest {
  defaultBankId: string;
  banks: QuestionBankManifestEntry[];
}

export interface QuestionBankCatalogItem {
  id: string;
  name: string;
  version: number;
  questionCount: number;
  source: QuestionBankSource;
  readOnly: boolean;
  updatedAt?: number;
  archived?: boolean;
}

export interface QuestionBankCatalogResponse {
  banks: QuestionBankCatalogItem[];
}

export interface QuestionBankLoadResponse {
  source: QuestionBankSource;
  bank: QuestionBank;
}

export interface QuestionBankRevisionSummary {
  revision: number;
  name: string;
  description: string;
  questionCount: number;
  createdAt: number;
  createdBy: string | null;
  importMode: string;
  changeSummary: string;
}

export interface AdminQuestionBankDetail {
  id: string;
  source: QuestionBankSource;
  readOnly: boolean;
  archived: boolean;
  description: string;
  currentRevision: number;
  updatedAt?: number;
  bank: QuestionBank;
  revisions: QuestionBankRevisionSummary[];
}

export interface UsageStatus {
  nearLimit: boolean;
  hardBlock: boolean;
  warningMessage: string | null;
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
  thresholds?: {
    warnPercent: number;
    blockPercent: number;
  };
  dayUtc?: string;
}

export interface SessionData {
  gameId: string;
  playerId: string;
  playerToken: string;
  hostToken?: string;
  role?: PlayerRole;
}
