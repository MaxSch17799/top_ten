import { checkedSkySettings, type SkyProfile } from '../../../shared/skyjo';
const KEY = 'game-night-skyjo-profiles-v1';
export function loadSkyProfiles(): SkyProfile[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 30).flatMap((p: SkyProfile) => {
      try { return p.id.startsWith('custom-') && p.name.trim() ? [{ id: p.id.slice(0, 80), name: p.name.slice(0, 40), rules: checkedSkySettings({ rules: p.rules }).rules }] : []; }
      catch { return []; }
    });
  } catch { return []; }
}
export function saveSkyProfiles(profiles: SkyProfile[]) { localStorage.setItem(KEY, JSON.stringify(profiles.slice(0, 30))); }
