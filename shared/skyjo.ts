export interface SkyCard { id: string; value: number }
export interface SkyRules {
  target: number; fixedRounds: number; startingCards: number; columns: boolean;
  penalty: boolean; turnSeconds: number; timeout: 'pause' | 'automatic';
}
export const CLASSIC_SKY_RULES: SkyRules = {
  target: 100, fixedRounds: 0, startingCards: 2, columns: true, penalty: true,
  turnSeconds: 0, timeout: 'pause',
};
export interface SkyProfile { id: string; name: string; rules: SkyRules }
export const SKY_PROFILES: SkyProfile[] = [
  { id: 'classic', name: 'Classic Skyjo', rules: { ...CLASSIC_SKY_RULES } },
  { id: 'quick', name: 'Quick Game', rules: { ...CLASSIC_SKY_RULES, target: 50 } },
  { id: 'long', name: 'Long Game', rules: { ...CLASSIC_SKY_RULES, target: 150 } },
];
export interface SkySettings { profileId: string; rules: SkyRules; displayMode: 'normal' | 'tv'; autoNext: boolean }
export const DEFAULT_SKY_SETTINGS: SkySettings = {
  profileId: 'classic', rules: { ...CLASSIC_SKY_RULES }, displayMode: 'normal', autoNext: true,
};
export function checkedSkySettings(raw: unknown): SkySettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid settings');
  const p = raw as Partial<SkySettings>;
  if (p.rules !== undefined && (!p.rules || typeof p.rules !== 'object' || Array.isArray(p.rules))) throw new Error('Invalid rules');
  const r = { ...CLASSIC_SKY_RULES, ...p.rules };
  const limits = { target: [1, 10000], fixedRounds: [0, 100], startingCards: [1, 11], turnSeconds: [0, 300] };
  for (const [key, [min, max]] of Object.entries(limits)) {
    const v = r[key as keyof typeof limits];
    if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${key} must be a whole number from ${min} to ${max}`);
  }
  for (const k of ['columns', 'penalty'] as const) if (typeof r[k] !== 'boolean') throw new Error(`Invalid ${k} rule`);
  if (!['pause', 'automatic'].includes(r.timeout)) throw new Error('Invalid timeout behavior');
  if (p.displayMode !== undefined && !['normal', 'tv'].includes(p.displayMode)) throw new Error('Invalid display mode');
  if (p.autoNext !== undefined && typeof p.autoNext !== 'boolean') throw new Error('Invalid automatic rounds setting');
  return { profileId: String(p.profileId ?? 'classic').slice(0, 80), rules: r, displayMode: p.displayMode ?? 'normal', autoNext: p.autoNext ?? true };
}
export type SkyPhase = 'LOBBY' | 'SETUP' | 'PLAY' | 'RESULTS' | 'COMPLETED';
export type SkyStep = 'choose' | 'drawn' | 'replace' | 'reveal';
export interface SkySlot { id: string; value: number | null }
export interface SkyPlayer {
  playerId: string; nickname: string; role: 'HOST' | 'PLAYER'; connected: boolean;
  grid: (SkySlot | null)[]; total: number; visible: number; hidden: number; startingRevealed: number;
}
export interface SkyEvent {
  id: number; at: number; type: 'deal' | 'flip' | 'draw' | 'take' | 'discard' | 'swap' | 'column' | 'final' | 'score' | 'win' | 'shuffle' | 'system';
  actor: string | null; message: string; index?: number; column?: number; card?: SkyCard;
}
export interface SkyResult {
  round: number; raw: Record<string, number>; scores: Record<string, number>;
  totals: Record<string, number>; finisher: string; doubled: boolean;
}
export interface SkyAction { id: string; type: string; generation: number; revision: number; round: number; payload?: Record<string, unknown> }
export interface SkyView {
  gameType: 'skyjo'; gameId: string; version: number; revision: number; generation: number;
  phase: SkyPhase; step: SkyStep; paused: boolean; settings: SkySettings; players: SkyPlayer[];
  round: number; turn: string | null; finisher: string | null; finalTurns: string[];
  pending: { owner: string; source: 'deck' | 'discard'; card: SkyCard | null } | null;
  yourCard: SkyCard | null; deckCount: number; discardCount: number; discardTop: SkyCard | null;
  events: SkyEvent[]; result: SkyResult | null; history: SkyResult[]; winners: string[];
  deadline: number | null; nextRoundAt: number | null; serverNow: number; endedReason: string | null;
  yourPlayerId: string | null; yourRole: 'HOST' | 'PLAYER' | 'DISPLAY'; displayUrl?: string;
}
