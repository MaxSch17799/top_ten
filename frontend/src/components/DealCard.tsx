import { DEAL_PALETTE } from '../lib/dealTheme';
import {
  DEAL_EFFECTS,
  DEAL_GROUPS,
  type DealCard as Card,
} from "../../../shared/monopolyDeal";

const lines = (text: string, max = 24) => {
  const result: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if ((line + " " + word).trim().length > max && line) {
      result.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) result.push(line);
  return result;
};
/** Original, data-driven SVG deck. All colors and templates can be themed here. */
export default function DealCard({
  card,
  back = false,
}: {
  card?: Card | null;
  back?: boolean;
}) {
  const c = card,
    property = c?.kind === "property",
    wild = c?.kind === "wild",
    money = c?.kind === "money";
  const accent =
    c?.colors.length === 1
      ? DEAL_PALETTE[c.colors[0]]
      : wild
        ? "#b9a0f7"
        : money
          ? "#6ee7a0"
          : c?.effect === "justSayNo"
            ? "#fb7185"
            : "#f4c875";
  const heading =
    back || !c ? ["GAME", "NIGHT"] : lines(c.title.toUpperCase(), 17);
  const text = c?.effect
    ? DEAL_EFFECTS[c.effect].text
    : wild
      ? "Choose a printed color. Rearrange free on your turn. Never bank a property."
      : "";
  return (
    <svg
      viewBox="0 0 180 254"
      className="deal-card-svg"
      role="img"
      aria-label={
        back || !c
          ? "Card back"
          : `${c.title}, ${c.value}M${c.effect ? ". " + DEAL_EFFECTS[c.effect].text : ""}`
      }
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="2"
        y="2"
        width="176"
        height="250"
        rx="16"
        fill="#151d28"
        stroke={back || !c ? "#628b7c" : accent}
        strokeWidth="3"
      />
      <rect
        x="9"
        y="9"
        width="162"
        height="236"
        rx="11"
        fill={back || !c ? "#1b3936" : "#f5f0e3"}
      />
      {back || !c ? (
        <>
          {[0, 1, 2, 3, 4].map((i) => (
            <path
              key={i}
              d={`M${14 + i * 32} 12L${i * 32 - 100} 244M${14 + i * 32} 244L${i * 32 + 130} 12`}
              stroke="#4b7162"
              strokeWidth="1"
              opacity=".5"
            />
          ))}
          <path
            d="M90 47L142 107L90 170L38 107Z"
            fill="#142825"
            stroke="#d9c78f"
            strokeWidth="2"
          />
          <text
            x="90"
            y="104"
            textAnchor="middle"
            fill="#f4d889"
            fontSize="29"
            fontWeight="800"
          >
            DEAL
          </text>
          <text
            x="90"
            y="125"
            textAnchor="middle"
            fill="#e8efdf"
            fontSize="10"
            letterSpacing="4"
          >
            IT IN
          </text>
          <text
            x="90"
            y="214"
            textAnchor="middle"
            fill="#a9c7b4"
            fontSize="10"
            letterSpacing="2"
          >
            GAME NIGHT
          </text>
        </>
      ) : (
        <>
          <rect x="9" y="9" width="162" height="38" rx="10" fill={accent} />
          <rect x="9" y="35" width="162" height="12" fill={accent} />
          <text x="20" y="33" fill="#14202c" fontSize="13" fontWeight="800">
            {property
              ? "PROPERTY"
              : wild
                ? "WILD PROPERTY"
                : money
                  ? "BANK NOTE"
                  : c.effect === "rent" || c.effect === "wildRent"
                    ? "RENT"
                    : "ACTION"}
          </text>
          <text
            x="159"
            y="33"
            textAnchor="end"
            fill="#14202c"
            fontSize="13"
            fontWeight="800"
          >
            {c.value}M
          </text>
          {heading.map((line, i) => (
            <text
              key={i}
              x="90"
              y={66 + i * 17}
              textAnchor="middle"
              fill="#202d39"
              fontSize="13"
              fontWeight="850"
              letterSpacing=".4"
            >
              {line}
            </text>
          ))}
          {property ? (
            <>
              <path
                d="M33 140V113L50 101L66 113V140M71 140V102L91 87L111 102V140M117 140V115L133 105L149 115V140"
                fill="none"
                stroke={accent}
                strokeWidth="4"
                strokeLinejoin="round"
              />
              <path d="M24 143H156" stroke="#263c49" strokeWidth="2" />
              <text x="25" y="167" fill="#4d5e64" fontSize="9" fontWeight="700">
                CARDS IN GROUP
              </text>
              <text
                x="155"
                y="167"
                textAnchor="end"
                fill="#4d5e64"
                fontSize="9"
                fontWeight="700"
              >
                RENT
              </text>
              {DEAL_GROUPS[c.colors[0]].rent.map((rent, i) => (
                <g key={i}>
                  <text x="28" y={183 + i * 13} fill="#233b45" fontSize="11">
                    {"◆".repeat(i + 1)}
                  </text>
                  <text
                    x="153"
                    y={183 + i * 13}
                    textAnchor="end"
                    fill="#233b45"
                    fontSize="11"
                    fontWeight="700"
                  >
                    {rent}M
                  </text>
                </g>
              ))}
            </>
          ) : money ? (
            <>
              <circle
                cx="90"
                cy="143"
                r="43"
                fill="none"
                stroke="#b9cebb"
                strokeWidth="2"
              />
              <circle cx="90" cy="143" r="36" fill="none" stroke="#b9cebb" />
              <text
                x="90"
                y="156"
                textAnchor="middle"
                fill="#245640"
                fontSize="47"
                fontWeight="850"
              >
                {c.value}
              </text>
              <text
                x="90"
                y="205"
                textAnchor="middle"
                fill="#245640"
                fontSize="12"
                letterSpacing="3"
              >
                MILLION
              </text>
            </>
          ) : (
            <>
              <text
                x="90"
                y={wild ? 112 : 127}
                textAnchor="middle"
                fill={wild ? "#7962a1" : "#294653"}
                fontSize={c.effect === "justSayNo" ? 37 : 34}
                fontWeight="900"
              >
                {wild ? "◆" : c.effect ? DEAL_EFFECTS[c.effect].symbol : "✦"}
              </text>
              {c.colors.length > 0 && (
                <g>
                  {c.colors.map((color, i) => (
                    <rect
                      key={color}
                      x={22 + (i % 5) * (c.colors.length > 2 ? 28 : 70)}
                      y={wild ? 128 + Math.floor(i / 5) * 10 : 139}
                      width={c.colors.length > 2 ? 24 : 66}
                      height={c.colors.length > 2 ? 7 : 10}
                      rx="3"
                      fill={DEAL_PALETTE[color]}
                      stroke="#203542"
                      strokeWidth=".5"
                    />
                  ))}
                </g>
              )}
              {lines(text, 26).map((line, i) => (
                <text
                  key={i}
                  x="90"
                  y={166 + i * 12}
                  textAnchor="middle"
                  fill="#344a53"
                  fontSize="9.5"
                  fontWeight="550"
                >
                  {line}
                </text>
              ))}
            </>
          )}
          <path d="M21 230H159" stroke="#d9d5ca" />
          <text
            x="90"
            y="240"
            textAnchor="middle"
            fill="#687875"
            fontSize="7.5"
            letterSpacing="1.5"
          >
            GAME NIGHT · DEAL IT IN
          </text>
        </>
      )}
    </svg>
  );
}
