import { checkedFlipSettings, type FlipProfile } from '../../../shared/flip7';
import { readLocalProfiles, writeLocalProfiles } from './profileStorage';
const KEY = 'game-night-flip7-profiles-v1';
export function loadFlipProfiles(): FlipProfile[] {
  return readLocalProfiles(KEY, 30, value => {
    const p = value as FlipProfile;
    return p.id.startsWith('custom-') && p.name.trim()
      ? { id: p.id.slice(0, 80), name: p.name.slice(0, 40), rules: checkedFlipSettings({ rules: p.rules }).rules } : null;
  });
}
export function saveFlipProfiles(profiles: FlipProfile[]) { writeLocalProfiles(KEY, 30, profiles); }
