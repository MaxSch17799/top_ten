/** Stable public IDs. Keep these compatible with invite URLs and persisted rooms. */
export const GAME_TYPES = [
  'top10',
  'just-one',
  'sounds-fishy',
  'wavelength',
  'uno',
  'monopoly-deal',
  'flip7',
  'skyjo',
] as const;

export type GameType = (typeof GAME_TYPES)[number];
export type StandaloneGameType = Exclude<GameType, 'top10'>;

export function isGameType(value: unknown): value is GameType {
  return typeof value === 'string' && GAME_TYPES.includes(value as GameType);
}

/** Top 10 alone uses the platform's question-bank selection during creation. */
export function isStandaloneGameType(value: unknown): value is StandaloneGameType {
  return isGameType(value) && value !== 'top10';
}
