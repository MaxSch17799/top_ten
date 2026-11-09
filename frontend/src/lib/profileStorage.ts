/** Browser-local mechanics only; each game owns validation and duplicate/name policies. */
export function readLocalProfiles<T>(key: string, limit: number, parse: (value: unknown) => T | null): T[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, limit).flatMap(value => {
      try { const profile = parse(value); return profile === null ? [] : [profile]; }
      catch { return []; }
    });
  } catch { return []; }
}

/** Preserve write errors so callers can tell the user their profile was not saved. */
export function writeLocalProfiles<T>(key: string, limit: number, profiles: T[]) {
  localStorage.setItem(key, JSON.stringify(profiles.slice(0, limit)));
}
