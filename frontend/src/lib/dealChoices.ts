import { DEAL_PALETTE } from './dealTheme';
import {
  DEAL_GROUPS,
  type DealCard,
  type DealColor,
  type DealTable,
} from "../../../shared/monopolyDeal";

const MARKS: Record<DealColor, string> = {
  brown: "🟫",
  lightBlue: "🔹",
  pink: "🌸",
  orange: "🟧",
  red: "🟥",
  yellow: "🟨",
  green: "🟩",
  darkBlue: "🟦",
  railroad: "🚆",
  utility: "💧",
};
/** Native mobile menus cannot reliably show HTML swatches, so options also name their color. */
export const dealColorLabel = (color: DealColor) =>
  `${MARKS[color]} ${DEAL_GROUPS[color].name}`;
export const dealCardColorText = (card: DealCard, color: DealColor) =>
  `${dealColorLabel(color)}${card.kind === "wild" ? (card.colors.length > 2 ? " · rainbow wild" : ` · wild (${card.colors.map((c) => DEAL_GROUPS[c].name).join(" / ")})`) : ""}`;
export function onlyDealChoice(choice: string, ids: string[]): string {
  return ids.includes(choice) ? choice : ids.length === 1 ? ids[0] : "";
}
export function preferredDealColor(
  table: DealTable,
  card: DealCard,
  exclude?: string,
): DealColor {
  const groups = table.sets.filter(
    (s) =>
      s.id !== exclude &&
      card.colors.includes(s.color) &&
      s.cards.length < DEAL_GROUPS[s.color].size,
  );
  const current = table.sets.find((s) => s.id === exclude);
  return (
    groups.find((s) => s.color === current?.color)?.color ??
    groups[0]?.color ??
    current?.color ??
    card.colors[0]
  );
}
export function dealWildStripe(
  card: DealCard,
  assigned: DealColor,
): string | undefined {
  if (card.kind !== "wild") return undefined;
  if (card.colors.length > 2)
    return "linear-gradient(90deg, #f87171 0% 17%, #fb923c 17% 34%, #fde047 34% 50%, #6ee7a0 50% 67%, #7dd3fc 67% 84%, #b9a0f7 84% 100%)";
  return DEAL_PALETTE[card.colors.find((c) => c !== assigned) ?? assigned];
}
