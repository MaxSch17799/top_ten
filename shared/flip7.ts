export type FlipKind = 'number' | 'bonus' | 'double' | 'freeze' | 'flip-three' | 'second-chance';
export interface FlipCard { id: string; kind: FlipKind; value: number }
export const FLIP_LABELS: Record<FlipKind, string> = {
  number: 'Number', bonus: 'Bonus', double: 'Double', freeze: 'Freeze',
  'flip-three': 'Flip Three', 'second-chance': 'Second Chance',
};
export const flipLabel = (c: FlipCard) => c.kind === 'number' ? String(c.value)
  : c.kind === 'bonus' ? `+${c.value}` : c.kind === 'double' ? '×2' : FLIP_LABELS[c.kind];
export interface FlipRules {
  target: number; bonus: number; unique: number; fixedRounds: number;
  turnSeconds: number; actionSeconds: number; timeout: 'stay' | 'hit';
  freeze: number; flipThree: number; secondChance: number;
}
export const CLASSIC_FLIP_RULES: FlipRules = {
  target: 200, bonus: 15, unique: 7, fixedRounds: 0,
  turnSeconds: 0, actionSeconds: 0, timeout: 'stay', freeze: 3, flipThree: 3, secondChance: 3,
};
export interface FlipProfile { id: string; name: string; rules: FlipRules }
export const FLIP_PROFILES: FlipProfile[] = [
  { id: 'classic', name: 'Classic Flip 7', rules: { ...CLASSIC_FLIP_RULES } },
  { id: 'quick', name: 'Quick Game', rules: { ...CLASSIC_FLIP_RULES, target: 100 } },
  { id: 'long', name: 'Long Game', rules: { ...CLASSIC_FLIP_RULES, target: 300 } },
];
export interface FlipSettings { profileId: string; rules: FlipRules; displayMode: 'normal' | 'tv'; autoNext: boolean }
export const DEFAULT_FLIP_SETTINGS: FlipSettings = {
  profileId: 'classic', rules: { ...CLASSIC_FLIP_RULES }, displayMode: 'normal', autoNext: true,
};
export function checkedFlipSettings(raw: unknown): FlipSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid settings');
  const p = raw as Partial<FlipSettings>;
  if (p.rules !== undefined && (!p.rules || typeof p.rules !== 'object' || Array.isArray(p.rules))) throw new Error('Invalid rules');
  const rules = { ...CLASSIC_FLIP_RULES, ...p.rules };
  const limits: Record<Exclude<keyof FlipRules, 'timeout'>, [number, number]> = {
    target: [1, 10000], bonus: [0, 100], unique: [3, 13], fixedRounds: [0, 100],
    turnSeconds: [0, 300], actionSeconds: [0, 300], freeze: [0, 9], flipThree: [0, 9], secondChance: [0, 9],
  };
  for (const [key, [min, max]] of Object.entries(limits)) {
    const value = rules[key as keyof typeof limits];
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} must be a whole number from ${min} to ${max}`);
  }
  if (!['stay', 'hit'].includes(rules.timeout)) throw new Error('Invalid timeout behavior');
  if (p.displayMode !== undefined && !['normal', 'tv'].includes(p.displayMode)) throw new Error('Invalid display mode');
  if (p.autoNext !== undefined && typeof p.autoNext !== 'boolean') throw new Error('Invalid automatic rounds setting');
  return { profileId: String(p.profileId ?? 'classic').slice(0, 80), rules,
    displayMode: p.displayMode ?? 'normal', autoNext: p.autoNext ?? true };
}
export type FlipStatus = 'active' | 'stayed' | 'frozen' | 'busted';
export interface FlipHand { cards: FlipCard[]; status: FlipStatus; flip7: boolean }
export function flipScore(h: FlipHand, rules: FlipRules): number {
  if (h.status === 'busted') return 0;
  const numbers = h.cards.filter(c => c.kind === 'number').reduce((n, c) => n + c.value, 0);
  return numbers * (h.cards.some(c => c.kind === 'double') ? 2 : 1)
    + h.cards.filter(c => c.kind === 'bonus').reduce((n, c) => n + c.value, 0)
    + (h.flip7 ? rules.bonus : 0);
}
export interface FlipPlayer { playerId: string; nickname: string; role: 'HOST' | 'PLAYER'; connected: boolean; hand: FlipHand; total: number; potential: number }
export type FlipPhase = 'LOBBY' | 'PLAY' | 'RESULTS' | 'COMPLETED';
export interface FlipPending { owner: string; card: FlipCard; eligible: string[] }
export interface FlipEvent {
  id: number; at: number; type: 'draw' | 'bust' | 'save' | 'freeze' | 'flip-three' | 'second-chance' | 'flip7' | 'round' | 'score' | 'win' | 'system' | 'shuffle';
  actor: string | null; message: string; card?: FlipCard; remaining?: number;
}
export interface FlipResult { round: number; scores: Record<string, number>; totals: Record<string, number>; flip7: string | null; tied: boolean }
export interface FlipAction { id: string; type: string; generation: number; revision: number; round: number; payload?: Record<string, unknown> }
export interface FlipView {
  gameType: 'flip7'; gameId: string; version: number; revision: number; generation: number;
  phase: FlipPhase; paused: boolean; players: FlipPlayer[]; settings: FlipSettings;
  round: number; dealer: string | null; turn: string | null; dealing: boolean;
  pending: FlipPending | null; forced: { playerId: string; remaining: number } | null;
  deckCount: number; discardCount: number; events: FlipEvent[]; result: FlipResult | null;
  history: FlipResult[]; winner: string | null; endedReason: string | null;
  deadline: number | null; nextRoundAt: number | null; serverNow: number;
  yourPlayerId: string | null; yourRole: 'HOST' | 'PLAYER' | 'DISPLAY';
  canHit: boolean; canStay: boolean; displayUrl?: string;
}
