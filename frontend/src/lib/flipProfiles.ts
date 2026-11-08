import { checkedFlipSettings, type FlipProfile } from '../../../shared/flip7';
const KEY = 'game-night-flip7-profiles-v1';
export function loadFlipProfiles(): FlipProfile[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 30).flatMap((p: FlipProfile) => {
      try { return p.id.startsWith('custom-') && p.name.trim() ? [{ id: p.id.slice(0, 80), name: p.name.slice(0, 40), rules: checkedFlipSettings({ rules: p.rules }).rules }] : []; }
      catch { return []; }
    });
  } catch { return []; }
}
export function saveFlipProfiles(profiles: FlipProfile[]) { localStorage.setItem(KEY, JSON.stringify(profiles.slice(0, 30))); }
