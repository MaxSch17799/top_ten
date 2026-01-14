export function normalizeNickname(nickname: string): string {
  return nickname.trim().slice(0, 20);
}

const charset = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function generateShortId(length = 6): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  let id = '';
  for (const value of array) {
    id += charset[value % charset.length];
  }
  return id;
}

export function generateToken(length = 48): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  let token = '';
  for (const value of array) {
    token += charset[value % charset.length];
  }
  return token;
}

export function xmur3(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededRng(seed: string): () => number {
  return mulberry32(xmur3(seed)());
}

export function shuffleWithRng<T>(items: T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function pickUniqueIndexes(count: number, poolSize: number, rng: () => number): number[] {
  if (count <= 0 || poolSize === 0) {
    return [];
  }
  const indexes: number[] = [];
  const seen = new Set<number>();
  let attempts = 0;
  while (indexes.length < Math.min(count, poolSize) && attempts < poolSize * 3) {
    const candidate = Math.floor(rng() * poolSize);
    if (!seen.has(candidate)) {
      seen.add(candidate);
      indexes.push(candidate);
    }
    attempts += 1;
  }
  if (indexes.length < Math.min(count, poolSize)) {
    for (let i = 0; indexes.length < Math.min(count, poolSize) && i < poolSize; i += 1) {
      if (!seen.has(i)) {
        seen.add(i);
        indexes.push(i);
      }
    }
  }
  return indexes;
}
