import { WAVE_GEOMETRY } from "../../../shared/wavelength";
import type { WaveTranslate } from "../lib/waveI18n";

const point = (angle: number, r: number) => {
  const a = (angle * Math.PI) / 180;
  return [240 - Math.cos(a) * r, 240 - Math.sin(a) * r];
};
function wedge(start: number, end: number) {
  start = Math.max(0, start);
  end = Math.min(180, end);
  if (start >= end) return "";
  const a = point(start, 214),
    b = point(end, 214),
    c = point(end, 70),
    d = point(start, 70);
  return `M${a} A214 214 0 0 1 ${b} L${c} A70 70 0 0 0 ${d} Z`;
}
export default function WavelengthDial({
  value,
  target,
  enabled = false,
  onMove,
  reveal = false,
  cooperative = false,
  t,
}: {
  value: number;
  target?: number;
  enabled?: boolean;
  onMove?: (value: number, final?: boolean) => void;
  reveal?: boolean;
  cooperative?: boolean;
  t: WaveTranslate;
}) {
  const pointer = (e: React.PointerEvent<SVGSVGElement>, final = false) => {
    if (!enabled || (!final && e.buttons === 0 && e.pointerType !== "touch"))
      return;
    const rect = e.currentTarget.getBoundingClientRect(),
      x = ((e.clientX - rect.left) * 480) / rect.width,
      y = ((e.clientY - rect.top) * 270) / rect.height;
    let angle = (Math.atan2(240 - y, 240 - x) * 180) / Math.PI;
    if (angle < 0) angle = x < 240 ? 0 : 180;
    onMove?.(Math.max(0, Math.min(180, angle)), final);
  };
  const g = WAVE_GEOMETRY,
    zones = [
      [-g.outer, -g.adjacentOuter, 2],
      [-g.adjacentOuter, -g.centerHalf, 3],
      [-g.centerHalf, g.centerHalf, cooperative ? 3 : 4],
      [g.centerHalf, g.adjacentOuter, 3],
      [g.adjacentOuter, g.outer, 2],
    ];
  const tip = point(value, 196),
    tail = point(value + 180, 18);
  return (
    <svg
      className={`wave-dial ${enabled ? "wave-interactive" : ""} ${reveal ? "wave-revealed" : ""}`}
      viewBox="0 0 480 270"
      role={enabled ? "slider" : "img"}
      aria-label={t("Find your wavelength")}
      aria-valuemin={enabled ? 0 : undefined}
      aria-valuemax={enabled ? 180 : undefined}
      aria-valuenow={enabled ? Math.round(value) : undefined}
      aria-valuetext={
        enabled
          ? value < 60
            ? t("LEFT")
            : value > 120
              ? t("RIGHT")
              : "↔"
          : undefined
      }
      tabIndex={enabled ? 0 : undefined}
      onPointerDown={(e) => {
        if (enabled) {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointer(e);
        }
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) pointer(e);
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          pointer(e, true);
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }}
      onKeyDown={(e) => {
        const amount = e.shiftKey ? 5 : 1;
        const next =
          e.key === "ArrowLeft" || e.key === "ArrowDown"
            ? value - amount
            : e.key === "ArrowRight" || e.key === "ArrowUp"
              ? value + amount
              : e.key === "Home"
                ? 0
                : e.key === "End"
                  ? 180
                  : null;
        if (next !== null) {
          e.preventDefault();
          onMove?.(Math.max(0, Math.min(180, next)), true);
        }
      }}
    >
      <title>{t("Find your wavelength")}</title>
      <path d={wedge(0, 180)} fill="#222738" stroke="#454c64" strokeWidth="2" />
      {[0, 30, 60, 90, 120, 150, 180].map((a) => {
        const p = point(a, 202),
          q = point(a, 214);
        return (
          <line
            key={a}
            x1={p[0]}
            y1={p[1]}
            x2={q[0]}
            y2={q[1]}
            stroke="#7b839d"
            strokeWidth={a === 90 ? 3 : 1.5}
          />
        );
      })}
      {target !== undefined && (
        <g
          className={reveal ? "wave-target wave-target-reveal" : "wave-target"}
          data-testid="wave-target"
        >
          {zones.map(([a, b, score], i) => {
            const left = target + a,
              right = target + b,
              label = point(
                (Math.max(0, left) + Math.min(180, right)) / 2,
                174,
              );
            return (
              <g key={i}>
                <path
                  d={wedge(left, right)}
                  fill={
                    i === 2
                      ? "#fbcf78"
                      : i === 1 || i === 3
                        ? "#e98c88"
                        : "#87bdb7"
                  }
                  stroke="#171b28"
                  strokeWidth="1.2"
                />
                {Math.min(180, right) - Math.max(0, left) > 3 && (
                  <text
                    x={label[0]}
                    y={label[1]}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#171b28"
                    fontSize="16"
                    fontWeight="800"
                  >
                    {score}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      )}
      <line
        x1={tail[0]}
        y1={tail[1]}
        x2={tip[0]}
        y2={tip[1]}
        stroke="#0b0c12"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <line
        x1={tail[0]}
        y1={tail[1]}
        x2={tip[0]}
        y2={tip[1]}
        stroke="#f7f1e6"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle
        cx="240"
        cy="240"
        r="27"
        fill="#141824"
        stroke="#f7f1e6"
        strokeWidth="3"
      />
      <circle cx="240" cy="240" r="8" fill="#fbcf78" />
    </svg>
  );
}
