import {
  checkedDealSettings,
  type DealProfile,
} from "../../../shared/monopolyDeal";
import { readLocalProfiles, writeLocalProfiles } from './profileStorage';
const KEY = 'game-night-deal-profiles-v1';
export function loadDealProfiles(): DealProfile[] {
  return readLocalProfiles(KEY, 30, value => {
    const p = value as DealProfile;
    if (!p.id.startsWith('custom-') || !p.name.trim()) return null;
    return {
      id: p.id.slice(0, 80), name: p.name.slice(0, 40), description: 'Saved on this browser',
      rules: checkedDealSettings({ rules: p.rules }).rules,
    };
  });
}
export function saveDealProfiles(profiles: DealProfile[]) { writeLocalProfiles(KEY, 30, profiles); }
