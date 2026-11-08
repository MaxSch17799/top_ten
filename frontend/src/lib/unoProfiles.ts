import {
  checkedUnoSettings,
  DEFAULT_UNO_SETTINGS,
  UNO_PROFILES,
  type UnoProfile,
  type UnoRules,
} from "../../../shared/uno";
const KEY = "game-night-uno-profiles-v1";
export function readUnoProfiles(): UnoProfile[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.slice(0, 50).flatMap((p) => {
      try {
        if (
          !p ||
          typeof p.id !== "string" ||
          !p.id.startsWith("custom-") ||
          seen.has(p.id) ||
          typeof p.name !== "string" ||
          !p.name.trim()
        )
          return [];
        const rules = checkedUnoSettings({
          ...DEFAULT_UNO_SETTINGS,
          rules: p.rules,
        }).rules;
        seen.add(p.id);
        return [
          {
            id: p.id.slice(0, 80),
            name: p.name.trim().slice(0, 40),
            description: "Your saved house rules.",
            rules,
          },
        ];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}
export function writeUnoProfiles(profiles: UnoProfile[]) {
  localStorage.setItem(KEY, JSON.stringify(profiles.slice(0, 50)));
}
export function profileForRules(rules: UnoRules, custom: UnoProfile[]) {
  return [...UNO_PROFILES, ...custom].find((p) =>
    Object.keys(rules).every(
      (k) => p.rules[k as keyof UnoRules] === rules[k as keyof UnoRules],
    ),
  );
}
