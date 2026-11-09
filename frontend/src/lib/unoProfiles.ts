import {
  checkedUnoSettings,
  DEFAULT_UNO_SETTINGS,
  UNO_PROFILES,
  type UnoProfile,
  type UnoRules,
} from "../../../shared/uno";
import { readLocalProfiles, writeLocalProfiles } from './profileStorage';
const KEY = 'game-night-uno-profiles-v1';
export function readUnoProfiles(): UnoProfile[] {
  const seen = new Set<string>();
  return readLocalProfiles(KEY, 50, value => {
    const p = value as UnoProfile;
    if (!p || typeof p.id !== 'string' || !p.id.startsWith('custom-') || seen.has(p.id)
      || typeof p.name !== 'string' || !p.name.trim()) return null;
    const rules = checkedUnoSettings({ ...DEFAULT_UNO_SETTINGS, rules: p.rules }).rules;
    seen.add(p.id);
    return { id: p.id.slice(0, 80), name: p.name.trim().slice(0, 40), description: 'Your saved house rules.', rules };
  });
}
export function writeUnoProfiles(profiles: UnoProfile[]) { writeLocalProfiles(KEY, 50, profiles); }
export function profileForRules(rules: UnoRules, custom: UnoProfile[]) {
  return [...UNO_PROFILES, ...custom].find((p) =>
    Object.keys(rules).every(
      (k) => p.rules[k as keyof UnoRules] === rules[k as keyof UnoRules],
    ),
  );
}
