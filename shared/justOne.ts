// BCP 47 language tag. English/German receive additional local language rules.
export type Language = string;
export type JustOnePhase =
  | 'LOBBY'
  | 'SELECTION'
  | 'CLUES'
  | 'REVIEW'
  | 'GUESSING'
  | 'ANSWER_REVIEW'
  | 'RESULT'
  | 'COMPLETED';
export type Outcome = 'correct' | 'incorrect' | 'pass' | 'no-clues';
export interface WordCard {
  id: string;
  words: string[];
}
export interface WordBank {
  id: string;
  name: string;
  language: Language;
  version: number;
  development?: boolean;
  description?: string;
  theme?: string;
  difficulty?: string;
  cards: WordCard[];
}
export interface BankSummary {
  id: string;
  name: string;
  language: Language;
  version: number;
  cardCount: number;
  development: boolean;
  description?: string;
  theme?: string;
  difficulty?: string;
}
export interface JustOneSettings {
  bankId: string;
  scoring: 'original' | 'fixed' | 'infinite';
  length: number;
  selection: 'automatic' | 'five';
  guessing: 'typed' | 'verbal';
  cluesPerPlayer: 0 | 1 | 2;
  clueTimer: boolean;
  guessTimer: boolean;
  clueSeconds: number;
  guessSeconds: number;
  autoSubmitClues: boolean;
  autoSubmitGuess: boolean;
}
export const defaultJustOneSettings: JustOneSettings = {
  bankId: 'just_one_en_classic_v1',
  scoring: 'original',
  length: 13,
  selection: 'automatic',
  guessing: 'typed',
  cluesPerPlayer: 0,
  clueTimer: false,
  guessTimer: false,
  clueSeconds: 60,
  guessSeconds: 30,
  autoSubmitClues: true,
  autoSubmitGuess: true,
};
export interface JustOnePlayer {
  playerId: string;
  nickname: string;
  role: 'HOST' | 'PLAYER';
  connected: boolean;
  participating: boolean;
  pending: boolean;
}
export interface Clue {
  id: string;
  playerId: string;
  text: string;
  eliminated: boolean;
  reason: string | null;
}
export interface PotentialDuplicate {
  ids: string[];
  reason: string;
}
export interface RoundResult {
  round: number;
  word: string;
  guess: string | null;
  outcome: Outcome;
  scoreBefore: number;
  remainingBefore: number | null;
  corrected?: boolean;
}
export interface JustOneView {
  gameType: 'just-one';
  gameId: string;
  version: number;
  generation: number;
  serverNow: number;
  phase: JustOnePhase;
  yourPlayerId: string;
  yourRole: 'HOST' | 'PLAYER';
  players: JustOnePlayer[];
  order: string[];
  settings: JustOneSettings;
  roundSettings: JustOneSettings | null;
  banks: BankSummary[];
  round: number;
  score: number;
  remaining: number | null;
  maxPlayers: number;
  guesserId: string | null;
  reviewerId: string | null;
  nextGuesserId: string | null;
  clueCount: number;
  submitted: string[];
  expected: string[];
  ownClues: string[] | null;
  ownClueDraft: string[] | null;
  ownGuessDraft: string | null;
  word?: string;
  options?: string[];
  reviewClues?: Clue[];
  potentialDuplicates?: PotentialDuplicate[];
  survivingClues?: string[];
  committedGuess?: string;
  result: RoundResult | null;
  history: RoundResult[];
  deadline: number | null;
  paused: boolean;
  pausedRemaining: number | null;
  endedReason: string | null;
}
export interface JustOneAction {
  id: string;
  type: string;
  generation: number;
  round: number;
  phase: JustOnePhase;
  payload?: Record<string, unknown>;
}
