export type PlayerStatus = 'ACTIVE' | 'PENDING';
export type PlayerRole = 'HOST' | 'PLAYER';
export type GamePhase = 'LOBBY' | 'ACTIVE' | 'ENDED';

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
}

export interface SerializedStateForPlayer extends SerializedState {
  yourPlayerId: string | null;
  yourRole: PlayerRole | null;
  yourSecretNumber: number | null;
  promptOptions?: string[];
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

export interface SessionData {
  gameId: string;
  playerId: string;
  playerToken: string;
  hostToken?: string;
  role?: PlayerRole;
}
