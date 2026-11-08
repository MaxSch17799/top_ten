export type FishRole = 'red' | 'blue';
export type FishyPhase = 'LOBBY' | 'PREPARATION' | 'COLLECTION' | 'ELIMINATION' | 'RESULT' | 'COMPLETED';
export interface FishySettings {
  bankId: string;
  mode: 'party' | 'written';
  lengthMode: 'official' | 'rotations' | 'rounds';
  rotations: number;
  rounds: number;
  preparationSeconds: number;
  decisionSeconds: number;
  autoNext: boolean;
  facilitator: boolean;
}
export const defaultFishySettings: FishySettings = {
  bankId: 'sounds-fishy-classic-en', mode: 'party', lengthMode: 'official',
  rotations: 2, rounds: 8, preparationSeconds: 0, decisionSeconds: 0,
  autoNext: false, facilitator: true,
};
export interface FishySource { title: string; publisher: string; url: string; accessed: string }
export interface FishyQuestion {
  id: string; question: string; answer: string; acceptedAnswers: string[];
  category: string; answerType: string; difficulty: number; explanation: string;
  sources: FishySource[]; verificationNotes: string;
}
export interface FishyBank {
  schemaVersion: 1; bankId: string; language: string; title: string;
  development?: boolean; questions: FishyQuestion[];
}
export interface FishyBankSummary {
  bankId: string; language: string; title: string; questionCount: number; development: boolean;
}
export interface FishyPlayer {
  playerId: string; nickname: string; role: 'HOST' | 'PLAYER'; connected: boolean;
  participating: boolean; pending: boolean;
}
export interface FishyResult {
  round: number; roundId: string; outcome: 'blue' | 'banked' | 'all-reds' | 'void';
  points: Record<string, number>; reason: string | null;
}
export interface FishyAudit { at: number; actor: string; message: string }
export interface FishyView {
  gameType: 'sounds-fishy'; gameId: string; version: number; generation: number;
  roundId: string; serverNow: number; phase: FishyPhase;
  yourPlayerId: string; yourRole: 'HOST' | 'PLAYER' | 'DISPLAY';
  players: FishyPlayer[]; order: string[]; settings: FishySettings;
  roundSettings: FishySettings | null; banks: FishyBankSummary[];
  round: number; totalRounds: number; guesserId: string | null; nextGuesserId: string | null; fish: string[];
  scores: Record<string, number>; submitted: string[]; ownSubmission?: string;
  question?: string; answer?: string; explanation?: string; sources?: FishySource[];
  ownRole?: FishRole; roles: Record<string, FishRole>; answers?: Record<string, string>;
  eliminated: string[]; provisional: number; result: FishyResult | null;
  deadline: number | null; paused: boolean; pausedRemaining: number | null;
  notice: string | null; endedReason: string | null; winners: string[];
  audit: FishyAudit[]; displayToken?: string; poolRemaining: number; poolCycle: number;
}
export interface FishyAction {
  id: string; type: string; generation: number; roundId: string;
  phase: FishyPhase; payload?: Record<string, unknown>;
}
