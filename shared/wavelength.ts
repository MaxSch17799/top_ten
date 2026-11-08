export type WavePhase =
  | "LOBBY"
  | "SELECTION"
  | "CLUE"
  | "DIAL"
  | "PREDICTION"
  | "REVIEW"
  | "REVEAL"
  | "COMPLETED";
export interface Spectrum {
  id: string;
  left: string;
  right: string;
  category: string;
  tone: string;
  difficulty: string;
}
export interface SpectrumPack {
  schemaVersion: 1;
  game: "wavelength";
  packId: string;
  language: "en" | "de";
  title: string;
  development?: boolean;
  spectrums: Spectrum[];
}
export interface WavePackSummary {
  packId: string;
  language: string;
  title: string;
  count: number;
  development: boolean;
}
export interface WaveSettings {
  packId: string;
  mode: "party" | "written";
  gameMode: "competitive" | "cooperative";
  compact: boolean;
  automaticScoring: boolean;
  selection: "auto" | "two";
  targetScore: number;
  fixedRounds: number;
  startingBonus: boolean;
  catchUp: boolean;
  prediction: boolean;
  coopRounds: number;
  coopBonus: boolean;
  clueSeconds: number;
  dialSeconds: number;
  predictionSeconds: number;
  autoNextSeconds: number;
  autoExpiry: boolean;
}
export const defaultWaveSettings: WaveSettings = {
  packId: "wavelength-en-classic-v1",
  mode: "party",
  gameMode: "competitive",
  compact: false,
  automaticScoring: true,
  selection: "auto",
  targetScore: 10,
  fixedRounds: 0,
  startingBonus: true,
  catchUp: true,
  prediction: true,
  coopRounds: 7,
  coopBonus: true,
  clueSeconds: 0,
  dialSeconds: 0,
  predictionSeconds: 0,
  autoNextSeconds: 0,
  autoExpiry: false,
};
// Angular approximation of the printed wheel, not verified manufacturing measurements.
// Coordinates run from the left endpoint (0°) to the right endpoint (180°).
export const WAVE_GEOMETRY = {
  centerHalf: 4,
  adjacentOuter: 12,
  outer: 20,
  visible: 180,
} as const;
export function waveScore(
  center: number,
  dial: number,
  cooperative = false,
): { points: number; centerHit: boolean } {
  const distance = Math.abs(center - dial),
    epsilon = 1e-8;
  const centerHit = distance <= WAVE_GEOMETRY.centerHalf + epsilon;
  return {
    points: centerHit
      ? cooperative
        ? 3
        : 4
      : distance <= WAVE_GEOMETRY.adjacentOuter + epsilon
        ? 3
        : distance <= WAVE_GEOMETRY.outer + epsilon
          ? 2
          : 0,
    centerHit,
  };
}
export interface WavePlayer {
  playerId: string;
  nickname: string;
  role: "HOST" | "PLAYER";
  connected: boolean;
  team: number | null;
}
export interface WaveChat {
  id: string;
  at: number;
  playerId: string;
  text: string;
}
export interface WaveAudit {
  at: number;
  actor: string;
  message: string;
}
export interface WaveResult {
  roundId: string;
  round: number;
  team: number;
  psychicId: string;
  spectrum: Spectrum;
  center: number;
  dial: number;
  prediction: "left" | "right" | null;
  points: number;
  opponentPoints: number;
  centerHit: boolean;
  void: boolean;
  reason: string | null;
}
export interface WaveTiebreak {
  remaining: number;
  base: [number, number];
  firstTeam: number;
  pair: number;
}
export interface WaveView {
  gameType: "wavelength";
  gameId: string;
  version: number;
  revision: number;
  generation: number;
  roundId: string;
  phase: WavePhase;
  serverNow: number;
  yourPlayerId: string;
  yourRole: "HOST" | "PLAYER" | "DISPLAY";
  players: WavePlayer[];
  order: string[];
  teams: [string, string];
  settings: WaveSettings;
  roundSettings: WaveSettings | null;
  packs: WavePackSummary[];
  round: number;
  activeTeam: number;
  psychicId: string | null;
  controllerId: string | null;
  controlEpoch: number;
  dialSequence: number;
  dial: number;
  clue: string | null;
  spectrum: Spectrum | null;
  candidates?: Spectrum[];
  target?: number;
  scores: [number, number];
  remaining: number;
  prediction: "left" | "right" | null;
  result: WaveResult | null;
  history: WaveResult[];
  chat: WaveChat[];
  deadline: number | null;
  paused: boolean;
  pausedRemaining: number | null;
  timerExpired: boolean;
  nextTeam: number;
  catchUpTurn: boolean;
  tiebreak: WaveTiebreak | null;
  winner: number | null;
  notice: string | null;
  audit: WaveAudit[];
  displayToken?: string;
  poolRemaining: number;
  poolCycle: number;
}
export interface WaveAction {
  id: string;
  type: string;
  generation: number;
  roundId: string;
  phase: WavePhase;
  revision: number;
  payload?: Record<string, unknown>;
}
