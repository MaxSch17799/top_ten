import { checkedSkySettings, type SkyProfile } from '../../../shared/skyjo';
import { readLocalProfiles, writeLocalProfiles } from './profileStorage';
const KEY = 'game-night-skyjo-profiles-v1';
export function loadSkyProfiles(): SkyProfile[] {
  return readLocalProfiles(KEY, 30, value => {
    const p = value as SkyProfile;
    return p.id.startsWith('custom-') && p.name.trim()
      ? { id: p.id.slice(0, 80), name: p.name.slice(0, 40), rules: checkedSkySettings({ rules: p.rules }).rules } : null;
  });
}
export function saveSkyProfiles(profiles: SkyProfile[]) { writeLocalProfiles(KEY, 30, profiles); }
