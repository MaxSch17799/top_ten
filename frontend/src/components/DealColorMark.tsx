import { DEAL_PALETTE } from '../lib/dealTheme';
import type { CSSProperties } from "react";
import {
  DEAL_GROUPS,
  type DealCard,
  type DealColor,
} from "../../../shared/monopolyDeal";
import { dealCardColorText, dealWildStripe } from "../lib/dealChoices";

export default function DealColorMark({
  card,
  color,
}: {
  card?: DealCard;
  color: DealColor;
}) {
  return (
    <span
      className="deal-color-mark"
      style={
        {
          "--property-color": DEAL_PALETTE[color],
          "--wild-stripe": card ? dealWildStripe(card, color) : undefined,
        } as CSSProperties
      }
    >
      <i className={card?.kind === "wild" ? "is-wild" : ""} aria-hidden="true">
        {card?.kind === "wild"
          ? "✦"
          : color === "utility"
            ? "≈"
            : color === "railroad"
              ? "≡"
              : "◆"}
      </i>
      <span>
        {card ? dealCardColorText(card, color) : DEAL_GROUPS[color].name}
      </span>
    </span>
  );
}
