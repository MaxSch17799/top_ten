import { unoCardLabel, type UnoCard as Card } from "../../../shared/uno";
import { UNO_PALETTE } from "../lib/unoTheme";
const symbols: Record<string, string> = {
  skip: "⊘",
  reverse: "⇄",
  draw2: "+2",
  wild: "✦",
  draw4: "+4",
};
/** One original vector design for the complete deck; no raster art or brand marks. */
export default function UnoCard({
  card,
  back = false,
}: {
  card?: Card | null;
  back?: boolean;
}) {
  const color = card?.color ? UNO_PALETTE[card.color] : "#c8b8ff",
    value = card ? (symbols[card.value] ?? card.value) : "✦";
  return (
    <svg
      className="uno-card-art"
      viewBox="0 0 100 146"
      role="img"
      aria-label={back ? "Face-down card" : card ? unoCardLabel(card) : "Card"}
    >
      <rect
        x="1.5"
        y="1.5"
        width="97"
        height="143"
        rx="12"
        fill="#121421"
        stroke={back ? "#7f76af" : color}
        strokeWidth="3"
      />
      <rect
        x="7"
        y="7"
        width="86"
        height="132"
        rx="7"
        fill={back ? "#23213a" : color}
      />
      {back ? (
        <>
          <path
            d="M8 35L66 8M8 61L92 22M8 87L92 48M8 113L92 74M24 138L92 100M76 138L92 126"
            stroke="#b5a0ff"
            strokeOpacity=".2"
            strokeWidth="2"
          />
          <path d="M50 39L78 73L50 107L22 73Z" fill="#b5a0ff" />
          <path d="M50 53L66 73L50 93L34 73Z" fill="#23213a" />
          <text
            x="50"
            y="126"
            textAnchor="middle"
            fill="#dbd2ff"
            fontSize="7"
            fontFamily="system-ui"
            letterSpacing="2"
          >
            GAME NIGHT
          </text>
        </>
      ) : (
        <>
          <path
            d="M7 108L93 36V91L37 139H7Z"
            fill="#101522"
            fillOpacity=".12"
          />
          <path
            d="M16 48L72 16H84V98L28 130H16Z"
            fill="#f9f7ef"
            fillOpacity=".92"
          />
          {card?.color === null && (
            <g transform="translate(50 73) rotate(45)">
              <path d="M-22 -22H0V0H-22Z" fill={UNO_PALETTE.red} />
              <path d="M0 -22H22V0H0Z" fill={UNO_PALETTE.blue} />
              <path d="M-22 0H0V22H-22Z" fill={UNO_PALETTE.yellow} />
              <path d="M0 0H22V22H0Z" fill={UNO_PALETTE.green} />
            </g>
          )}
          <text
            x="50"
            y="91"
            textAnchor="middle"
            fontSize={value.length > 1 ? "39" : "52"}
            fontWeight="900"
            fontFamily="system-ui, sans-serif"
            fill="#15172a"
            stroke={card?.color === null ? "#fff" : "none"}
            strokeWidth={card?.color === null ? "1.5" : "0"}
            paintOrder="stroke"
          >
            {value}
          </text>
          <g
            fill="#15172a"
            fontFamily="system-ui, sans-serif"
            fontSize="16"
            fontWeight="850"
          >
            <text x="13" y="26">
              {value}
            </text>
            <text transform="rotate(180 50 73)" x="13" y="26">
              {value}
            </text>
          </g>
          <text
            x="50"
            y="118"
            textAnchor="middle"
            fontFamily="system-ui"
            fontWeight="700"
            fontSize="6"
            letterSpacing="1"
            fill="#15172a"
          >
            {card?.color?.toUpperCase() ?? "WILD"}
          </text>
          {(card?.value === "6" || card?.value === "9") && (
            <path d="M39 99H61" stroke="#15172a" strokeWidth="2" />
          )}
        </>
      )}
    </svg>
  );
}
