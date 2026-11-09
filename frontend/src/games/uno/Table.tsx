import { useEffect, useRef, type CSSProperties } from "react";
import { type UnoView } from "../../../../shared/uno";
import UnoCard from "../../components/UnoCard";
import { UNO_PALETTE } from "../../lib/unoTheme";
import { type Act } from "./types";

export function Player({
  s,
  id,
  style,
}: {
  s: UnoView;
  id: string;
  style?: CSSProperties;
}) {
  const p = s.players.find((p) => p.playerId === id)!;
  const effect = s.events
    .slice(-4)
    .reverse()
    .find((e) => e.type === "skip" && e.target === id);
  return (
    <div
      className={`uno-player ${s.turn === id ? "is-turn" : ""} ${p.connected ? "" : "is-offline"}`}
      data-player={id}
      style={style}
    >
      <span className="uno-avatar" aria-hidden="true">
        {p.nickname.slice(0, 2).toUpperCase()}
      </span>
      <strong>
        {p.nickname}
        {id === s.yourPlayerId ? " (you)" : ""}
      </strong>
      <span className="uno-player-count">
        {p.cardCount} {p.cardCount === 1 ? "card" : "cards"}
        {p.saidUno && <b> UNO!</b>}
      </span>
      <small>
        {s.turn === id
          ? "● Playing"
          : !p.connected
            ? "Reconnecting…"
            : `${p.score} pts`}
      </small>
      {effect && (
        <span key={effect.id} className="uno-skipped" aria-hidden="true">
          SKIP
        </span>
      )}
    </div>
  );
}
export function Table({ s, act, busy }: { s: UnoView; act: Act; busy: boolean }) {
  const table = useRef<HTMLDivElement>(null),
    last = useRef<number | null>(null);
  const seat = s.order.indexOf(s.yourPlayerId);
  const opponents =
    seat >= 0
      ? [...s.order.slice(seat + 1), ...s.order.slice(0, seat)]
      : s.order;
  const current = s.players.find((p) => p.playerId === s.turn);
  useEffect(() => {
    const previous = last.current;
    last.current = s.events.at(-1)?.id ?? 0;
    if (
      previous === null ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const animations: { node: HTMLElement; animation: Animation }[] = [];
    for (const e of s.events.filter(
      (e) => e.id > previous && (e.type === "play" || e.type === "draw"),
    )) {
      const root = table.current;
      const center = root?.querySelector(
        e.type === "play" ? ".uno-discard" : ".uno-draw",
      );
      const position =
        e.actor === s.yourPlayerId
          ? document.querySelector(".uno-hand")
          : root?.querySelector(`[data-player="${CSS.escape(e.actor ?? "")}"]`);
      const graphic = root?.querySelector(
        e.type === "play" ? ".uno-discard svg" : ".uno-draw svg",
      );
      if (!center || !position || !graphic) continue;
      const from = (
          e.type === "play" ? position : center
        ).getBoundingClientRect(),
        to = (e.type === "play" ? center : position).getBoundingClientRect();
      const node = document.createElement("div");
      node.className = "uno-flying";
      node.setAttribute("aria-hidden", "true");
      node.append(graphic.cloneNode(true));
      document.body.append(node);
      node.style.left = `${from.x + from.width / 2 - 28}px`;
      node.style.top = `${from.y + from.height / 2 - 41}px`;
      const animation = node.animate(
        [
          { transform: "translate(0,0) scale(.65)", opacity: 0.5 },
          {
            transform: `translate(${to.x + to.width / 2 - from.x - from.width / 2}px,${to.y + to.height / 2 - from.y - from.height / 2}px) scale(1)`,
            opacity: 1,
          },
        ],
        { duration: 360, easing: "cubic-bezier(.2,.7,.3,1)" },
      );
      animation.onfinish = () => node.remove();
      animations.push({ node, animation });
    }
    return () => {
      for (const { node, animation } of animations) {
        animation.cancel();
        node.remove();
      }
    };
  }, [s.events, s.yourPlayerId]);
  const latest = s.events.at(-1),
    latestUno = s.events
      .slice(-3)
      .reverse()
      .find((e) => e.type === "uno");
  return (
    <div
      className="uno-table"
      ref={table}
      style={
        {
          "--active-color": s.color ? UNO_PALETTE[s.color] : "#b5a0ff",
        } as CSSProperties
      }
    >
      <div className={`uno-opponents count-${opponents.length}`}>
        {opponents.map((id, index) => {
          const angle =
            opponents.length === 1
              ? -Math.PI / 2
              : -Math.PI + ((index + 0.5) * Math.PI) / opponents.length;
          return (
            <Player
              key={id}
              s={s}
              id={id}
              style={
                {
                  "--seat-x": `${50 + 43 * Math.cos(angle)}%`,
                  "--seat-y": `${50 + 38 * Math.sin(angle)}%`,
                } as CSSProperties
              }
            />
          );
        })}
      </div>
      <div className="uno-table-center">
        <div className="uno-turn-banner" role="status">
          {s.phase === "COLOR"
            ? `${current?.nickname} chooses the opening color`
            : s.phase === "PLAY"
              ? s.turn === s.yourPlayerId
                ? "Your turn"
                : `${current?.nickname}’s turn`
              : "Round complete"}
        </div>
        <div className="uno-piles">
          <button
            className="uno-draw"
            aria-label={
              s.pending
                ? `Draw ${s.pending.amount} penalty cards`
                : "Draw a card"
            }
            disabled={!s.canDraw || busy}
            onClick={() => void act("draw")}
          >
            <UnoCard back />
            <span>
              {s.pending ? `DRAW ${s.pending.amount}` : "DRAW"}
              <small>{s.deckCount} in pile</small>
            </span>
          </button>
          <div
            className="uno-direction"
            key={s.direction}
            aria-label={s.direction === 1 ? "Clockwise" : "Counterclockwise"}
          >
            <span>{s.direction === 1 ? "↻" : "↺"}</span>
            <small>
              {s.direction === 1 ? "Clockwise" : "Counterclockwise"}
            </small>
          </div>
          <div className="uno-discard" data-testid="uno-discard">
            <UnoCard card={s.top} />
            <span>DISCARD</span>
          </div>
        </div>
        <span className="uno-active-color">
          <i />
          {s.color ? `${s.color.toUpperCase()} in play` : "Choose a color"}
        </span>
        {latestUno && (
          <div
            key={latestUno.id}
            className="uno-celebration"
            aria-hidden="true"
          >
            ✦ UNO! ✦
          </div>
        )}
      </div>
      <p className="uno-announcement" aria-live="polite" key={latest?.id}>
        {latest?.message}
      </p>
    </div>
  );
}
