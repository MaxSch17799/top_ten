import { useEffect, useState } from "react";
import { type DealCard as Card, type DealView } from "../../../../shared/monopolyDeal";
import DealCard from "../../components/DealCard";
import { type Act } from "./types";

export function Hand({
  s,
  busy,
  act,
  select,
}: {
  s: DealView;
  busy: boolean;
  act: Act;
  select: (c: Card) => void;
}) {
  const [discard, setDiscard] = useState<string[]>([]),
    discarding = s.phase === "DISCARD" && s.turn === s.yourPlayerId;
  const excess = s.hand.length - s.settings.rules.handLimit;
  return (
    <section id="deal-your-hand" className="deal-hand-area">
      <div className="deal-section-heading">
        <h2>
          Your hand <span>{s.hand.length}</span>
        </h2>
        <small>
          {discarding
            ? `Choose ${excess} to discard`
            : s.turn === s.yourPlayerId
              ? `${s.playsLeft} plays remaining · tap a card`
              : "Tap any card to read it"}
        </small>
      </div>
      <div className="deal-hand" aria-label="Your private hand">
        {s.hand.map((c) => (
          <button
            key={c.id}
            className={`deal-hand-card ${discard.includes(c.id) ? "selected" : ""}`}
            aria-label={`${discarding ? "Discard " : "Select "}${c.title}`}
            aria-pressed={discarding ? discard.includes(c.id) : undefined}
            onClick={() =>
              discarding
                ? setDiscard(
                    discard.includes(c.id)
                      ? discard.filter((id) => id !== c.id)
                      : [...discard, c.id],
                  )
                : select(c)
            }
          >
            <DealCard card={c} />
          </button>
        ))}
        {!s.hand.length && (
          <p className="deal-empty">
            An empty hand draws five at the start of your next turn.
          </p>
        )}
      </div>
      {discarding && (
        <button
          className="primary"
          disabled={busy || discard.length !== excess}
          onClick={async () => {
            if (await act("discard", { cardIds: discard })) setDiscard([]);
          }}
        >
          Discard {discard.length}/{excess} & end turn
        </button>
      )}
    </section>
  );
}
export function EndTurnControl({
  s,
  act,
  busy,
}: {
  s: DealView;
  act: Act;
  busy: boolean;
}) {
  const [reminder, setReminder] = useState("");
  const epoch = `${s.generation}-${s.round}-${s.turn}-${s.revision}`;
  const outOfPlays = s.playsLeft === 0 && !busy;
  const remind = outOfPlays && reminder === epoch;
  useEffect(() => {
    if (!outOfPlays) return;
    let timer: number;
    const arm = (event: Event) => {
      // Keep the reminder's own button mounted between pointer-down and click.
      if (!(
        event.target instanceof Element &&
        event.target.closest(".deal-turn-nudge")
      ))
        setReminder("");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setReminder(epoch), 5000);
    };
    timer = window.setTimeout(() => setReminder(epoch), 5000);
    window.addEventListener("pointerdown", arm);
    window.addEventListener("keydown", arm);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, [outOfPlays, epoch]);
  return (
    <>
      <button
        className={`primary ${remind ? "deal-end-reminding" : ""}`}
        disabled={busy}
        onClick={() => void act("end-turn")}
      >
        End turn
        {s.hand.length > s.settings.rules.handLimit ? " · discard next" : ""}
      </button>
      {outOfPlays && (
        <small className="deal-no-plays">
          No card plays left. You can still rearrange properties, then end your
          turn.
        </small>
      )}
      {remind && (
        <aside className="deal-turn-nudge" role="status">
          <div>
            <strong>Your turn is still open</strong>
            <small>Ready? Pass play to the next person.</small>
          </div>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void act("end-turn")}
          >
            End your turn →
          </button>
        </aside>
      )}
    </>
  );
}
