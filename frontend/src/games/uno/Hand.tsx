import { useRef, useState } from "react";
import { UNO_COLORS, isUnoNumber, sameUnoCard, unoCardLabel, type UnoView } from "../../../../shared/uno";
import UnoCard from "../../components/UnoCard";
import { UNO_PALETTE } from "../../lib/unoTheme";
import { type Act } from "./types";

export function Hand({ s, act, busy }: { s: UnoView; act: Act; busy: boolean }) {
  const [selected, setSelected] = useState<string[]>([]),
    [sayUno, setSayUno] = useState(false),
    [bluff, setBluff] = useState(false),
    [target, setTarget] = useState("");
  const touch = useRef<{ x: number; y: number; id: string } | null>(null);
  const cards = selected.flatMap((id) => s.hand.find((c) => c.id === id) ?? []),
    first = cards[0];
  const permitted =
    !!first &&
    (s.legalCardIds.includes(first.id) ||
      (bluff && s.bluffCardIds.includes(first.id)));
  const wild = !!first && first.color === null,
    swap = !!first && first.value === "7" && s.settings.rules.sevenZero;
  const name =
    s.players.find((p) => p.playerId === s.yourPlayerId)?.nickname ?? "You";
  const play = async (color?: string) => {
    if (!permitted || (swap && !target) || busy) return;
    if (
      await act("play", {
        cardIds: cards.map((c) => c.id),
        sayUno,
        bluff,
        color,
        target,
      })
    ) {
      setSelected([]);
      setBluff(false);
      setSayUno(false);
      setTarget("");
    }
  };
  const select = (id: string) => {
    if (busy) return;
    if (selected.includes(id)) {
      if (selected.length === 1 && permitted && !wild && (!swap || target))
        void play();
      else setSelected(selected.filter((v) => v !== id));
    } else {
      const card = s.hand.find((c) => c.id === id)!;
      if (
        s.settings.rules.multiples &&
        cards.length === 1 &&
        isUnoNumber(card) &&
        sameUnoCard(card, cards[0]) &&
        s.turn === s.yourPlayerId &&
        !s.drawnCardId
      )
        setSelected([...selected, id]);
      else {
        setSelected([id]);
        setBluff(false);
      }
    }
  };
  return (
    <section className="uno-hand" aria-label="Your hand">
      <div className="uno-hand-heading">
        <h2>
          {name}’s hand <span>· {s.hand.length}</span>
        </h2>
        <small>
          {s.drawnCardId
            ? "Play the drawn card or pass"
            : "Tap to select · tap again or Play"}
        </small>
      </div>
      <div className="uno-hand-grid">
        {s.hand.map((c) => {
          const legal = s.legalCardIds.includes(c.id),
            risky = s.bluffCardIds.includes(c.id),
            active = selected.includes(c.id);
          return (
            <button
              className={`uno-hand-card ${active ? "selected" : ""} ${legal ? "legal" : "unplayable"}`}
              key={c.id}
              aria-label={`${unoCardLabel(c)}${legal ? ", playable" : risky ? ", bluff available" : ", cannot play now"}`}
              aria-pressed={active}
              data-card-id={c.id}
              onClick={() => select(c.id)}
              disabled={busy}
              onTouchStart={(e) => {
                if (active)
                  touch.current = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY,
                    id: c.id,
                  };
              }}
              onTouchEnd={(e) => {
                const start = touch.current;
                touch.current = null;
                if (
                  start?.id === c.id &&
                  start.y - e.changedTouches[0].clientY > 55 &&
                  Math.abs(start.x - e.changedTouches[0].clientX) < 70 &&
                  permitted &&
                  !wild &&
                  (!swap || target)
                ) {
                  e.preventDefault();
                  void play();
                }
              }}
            >
              <UnoCard card={c} />
              {active && <span className="uno-selected-badge">✓</span>}
            </button>
          );
        })}
      </div>
      <div className="uno-hand-controls">
        {first && (
          <p className="uno-selection-label">
            {cards.length > 1 ? "2 × " : ""}
            {unoCardLabel(first)}
            {!permitted && !s.bluffCardIds.includes(first.id)
              ? " · cannot play now"
              : ""}
          </p>
        )}
        {first && s.bluffCardIds.includes(first.id) && (
          <label className="uno-check">
            <input
              type="checkbox"
              checked={bluff}
              onChange={(e) => setBluff(e.target.checked)}
            />
            Deliberate +4 bluff · a challenge makes you draw four
          </label>
        )}
        {swap && (
          <label className="field">
            <span>Swap hands with</span>
            <select
              className="input"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Choose a player</option>
              {s.players
                .filter((p) => p.playerId !== s.yourPlayerId)
                .map((p) => (
                  <option value={p.playerId} key={p.playerId}>
                    {p.nickname} · {p.cardCount} cards
                  </option>
                ))}
            </select>
          </label>
        )}
        {wild && permitted ? (
          <fieldset className="uno-color-choice">
            <legend>Choose a color to play</legend>
            {UNO_COLORS.map((color) => (
              <button
                key={color}
                aria-label={`Play Wild and choose ${color}`}
                disabled={busy}
                style={{ background: UNO_PALETTE[color] }}
                onClick={() => void play(color)}
              >
                {color}
              </button>
            ))}
          </fieldset>
        ) : (
          <div className="uno-buttons">
            <button
              className="primary uno-play-button"
              disabled={!permitted || busy || (swap && !target)}
              onClick={() => void play()}
            >
              {s.turn !== s.yourPlayerId && s.settings.rules.jumpIn
                ? "Jump in!"
                : cards.length > 1
                  ? "Play both"
                  : "Play card"}{" "}
              ↑
            </button>
            {s.canPass && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void act("pass")}
              >
                Keep & pass
              </button>
            )}
          </div>
        )}
        <div className="uno-uno-controls">
          <button
            className={`uno-call ${sayUno ? "armed" : ""}`}
            disabled={busy || !["PLAY", "COLOR"].includes(s.phase)}
            aria-pressed={sayUno}
            onClick={() => {
              if (s.hand.length === 1) void act("uno");
              else setSayUno(!sayUno);
            }}
          >
            {sayUno ? "✓ UNO with play" : "UNO!"}
          </button>
          <small>
            {sayUno
              ? "Your next play will include the UNO call."
              : "Call with your play, or immediately after."}
          </small>
          {s.unoVulnerable && s.unoVulnerable !== s.yourPlayerId && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void act("catch")}
            >
              Catch{" "}
              {s.players.find((p) => p.playerId === s.unoVulnerable)?.nickname}!
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
