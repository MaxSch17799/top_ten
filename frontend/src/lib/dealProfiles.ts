import {
  checkedDealSettings,
  type DealProfile,
} from "../../../shared/monopolyDeal";
const KEY = "game-night-deal-profiles-v1";
export function loadDealProfiles(): DealProfile[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 30).flatMap((p: DealProfile) => {
      try {
        if (!p.id.startsWith("custom-") || !p.name.trim()) return [];
        return [
          {
            id: p.id.slice(0, 80),
            name: p.name.slice(0, 40),
            description: "Saved on this browser",
            rules: checkedDealSettings({ rules: p.rules }).rules,
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
export function saveDealProfiles(profiles: DealProfile[]) {
  localStorage.setItem(KEY, JSON.stringify(profiles.slice(0, 30)));
}
