import { useState } from "react";
import { DEAL_EFFECTS, buildableDealColor, completeDealSet, dealRent, type DealCard as Card, type DealView } from "../../../../shared/monopolyDeal";
import DealCard from "../../components/DealCard";
import DealColorMark from "../../components/DealColorMark";
import { dealColorLabel, onlyDealChoice } from "../../lib/dealChoices";
import { type Act } from "./types";
import { Modal, Placement } from "./presentation";

export function CardComposer({
  s,
  card,
  act,
  busy,
  close,
}: {
  s: DealView;
  card: Card;
  act: Act;
  busy: boolean;
  close: () => void;
}) {
  const own = s.players.find((p) => p.playerId === s.yourPlayerId)!;
  const [mode, setMode] = useState(
    card.kind === "money" ||
      card.effect === "justSayNo" ||
      card.effect === "doubleRent"
      ? "bank"
      : card.kind === "property" || card.kind === "wild"
        ? "property"
        : "action",
  );
  const [setChoice, setSetId] = useState(""),
    [targetChoice, setTarget] = useState(""),
    [targetCardChoice, setTargetCard] = useState(""),
    [giveCardChoice, setGiveCard] = useState(""),
    [targetSetChoice, setTargetSet] = useState(""),
    [doubles, setDoubles] = useState<string[]>([]);
  const effect = card.effect;
  const opponents = s.players.filter(
    (p) =>
      p.playerId !== s.yourPlayerId &&
      (effect === "dealBreaker"
        ? p.table.sets.some(completeDealSet)
        : ["slyDeal", "forcedDeal"].includes(effect ?? "")
          ? p.table.sets.some(
              (set) => !completeDealSet(set) && set.cards.length > 0,
            )
          : true),
  );
  const target = onlyDealChoice(
    targetChoice,
    opponents.map((p) => p.playerId),
  );
  const other = opponents.find((p) => p.playerId === target);
  const rent = effect === "rent" || effect === "wildRent",
    building = effect === "house" || effect === "hotel";
  const sets = own.table.sets.filter((set) =>
    rent
      ? dealRent(set) > 0 &&
        (effect === "wildRent" || card.colors.includes(set.color))
      : building
        ? completeDealSet(set) &&
          buildableDealColor(set.color) &&
          (effect === "house" ? !set.house : set.house && !set.hotel)
        : false,
  );
  const targetNeeded = [
    "wildRent",
    "debtCollector",
    "slyDeal",
    "forcedDeal",
    "dealBreaker",
  ].includes(effect ?? "");
  const targetProps =
    other?.table.sets
      .filter((set) => !completeDealSet(set))
      .flatMap((set) => set.cards) ?? [];
  const setId = onlyDealChoice(
    setChoice,
    sets.map((set) => set.id),
  );
  const targetCard = onlyDealChoice(
    targetCardChoice,
    targetProps.map((c) => c.id),
  );
  const ownProps = own.table.sets.flatMap((set) => set.cards);
  const giveCard = onlyDealChoice(
    giveCardChoice,
    ownProps.map((c) => c.id),
  );
  const stealSets = other?.table.sets.filter(completeDealSet) ?? [];
  const targetSet = onlyDealChoice(
    targetSetChoice,
    stealSets.map((set) => set.id),
  );
  const offered = own.table.sets.find((set) =>
    set.cards.some((c) => c.id === giveCard),
  );
  const canAct =
    s.turn === s.yourPlayerId &&
    s.phase === "PLAY" &&
    !s.pending &&
    s.playsLeft > 0;
  const legalAction =
    !["justSayNo", "doubleRent"].includes(effect ?? "") &&
    (!(rent || building) || sets.some((set) => set.id === setId)) &&
    (!targetNeeded || !!other) &&
    (!["slyDeal", "forcedDeal"].includes(effect ?? "") ||
      targetProps.some((c) => c.id === targetCard)) &&
    (effect !== "forcedDeal" ||
      own.table.sets.some((set) => set.cards.some((c) => c.id === giveCard))) &&
    (effect !== "dealBreaker" ||
      (s.settings.rules.dealBreaker &&
        other?.table.sets.some(
          (set) => set.id === targetSet && completeDealSet(set),
        ))) &&
    1 + doubles.length <= s.playsLeft;
  const submit = async (payload: Record<string, unknown>) => {
    if (await act("play", { cardId: card.id, mode, ...payload })) close();
  };
  return (
    <Modal title={card.title} close={close}>
      <div className="deal-card-detail">
        <div className="deal-preview">
          <DealCard card={card} />
        </div>
        <div className="deal-card-controls">
          <p>
            {effect
              ? DEAL_EFFECTS[effect].text
              : card.kind === "money"
                ? `Add ${card.value}M to your bank. Banked cards stay on the table.`
                : "Build property groups. A complete set needs at least one valued property; rainbow wilds have no monetary value."}
          </p>
          {card.kind === "action" && (
            <div className="deal-tabs">
              {["action", "bank"].map((m) => (
                <button
                  key={m}
                  className={mode === m ? "primary" : "secondary"}
                  onClick={() => setMode(m)}
                >
                  {m === "property"
                    ? "As property"
                    : m === "bank"
                      ? `Bank ${card.value}M`
                      : "Use action"}
                </button>
              ))}
            </div>
          )}
          {(card.kind === "property" || card.kind === "wild") && (
            <p className="deal-help">
              Property · place in your collection. Never banked as cash.
            </p>
          )}
          {!canAct && (
            <p className="deal-gold">
              {s.pending
                ? "Resolve the pending action first."
                : "You can play cards during your turn."}
            </p>
          )}
          {mode === "property" ? (
            <Placement
              card={card}
              player={own}
              busy={busy || !canAct}
              submit={(p) => void submit(p)}
            />
          ) : mode === "bank" ? (
            <>
              <p className="deal-help">
                A banked action is money for the rest of this game.
              </p>
              <button
                className="primary"
                disabled={busy || !canAct}
                onClick={() => void submit({})}
              >
                Add to bank · one play
              </button>
            </>
          ) : (
            <>
              {["justSayNo", "doubleRent"].includes(effect ?? "") && (
                <p className="deal-gold">
                  {effect === "justSayNo"
                    ? "Play this from the response panel when an action affects you."
                    : "Select a Rent card first, then add this as a multiplier."}
                </p>
              )}
              {(rent || building) && (
                <label className="field">
                  <span>{rent ? "Charge rent for" : "Build on"}</span>
                  <select
                    className="input"
                    value={setId}
                    onChange={(e) => setSetId(e.target.value)}
                  >
                    <option value="">Choose an eligible group</option>
                    {sets.map((set, i) => (
                      <option key={set.id} value={set.id}>
                        {dealColorLabel(set.color)} · group {i + 1} ·{" "}
                        {rent ? `${dealRent(set)}M rent` : "complete"}
                      </option>
                    ))}
                  </select>
                  {sets.find((set) => set.id === setId) && (
                    <DealColorMark
                      color={sets.find((set) => set.id === setId)!.color}
                    />
                  )}
                  {!sets.length && (
                    <small>
                      No eligible property group yet. You can bank this card
                      instead.
                    </small>
                  )}
                </label>
              )}
              {targetNeeded && (
                <label className="field">
                  <span>Target opponent</span>
                  <select
                    className="input"
                    value={target}
                    onChange={(e) => {
                      setTarget(e.target.value);
                      setTargetCard("");
                      setTargetSet("");
                    }}
                  >
                    <option value="">Choose an opponent</option>
                    {opponents.map((p) => (
                      <option key={p.playerId} value={p.playerId}>
                        {p.nickname}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {["slyDeal", "forcedDeal"].includes(effect ?? "") && (
                <div className="deal-targets">
                  <p>Take a property outside a complete set</p>
                  {targetProps.length === 0 && (
                    <small>Choose an opponent with an incomplete group.</small>
                  )}
                  {targetProps.map((c) => (
                    <button
                      className={`deal-chip ${targetCard === c.id ? "selected" : ""}`}
                      key={c.id}
                      aria-pressed={targetCard === c.id}
                      onClick={() => setTargetCard(c.id)}
                    >
                      <strong>
                        {c.title} · {c.value}M
                      </strong>
                      <DealColorMark
                        card={c}
                        color={
                          other!.table.sets.find((set) =>
                            set.cards.some((v) => v.id === c.id),
                          )!.color
                        }
                      />
                    </button>
                  ))}
                </div>
              )}
              {effect === "forcedDeal" && (
                <label className="field">
                  <span>Give one of your properties</span>
                  <select
                    className="input"
                    value={giveCard}
                    onChange={(e) => setGiveCard(e.target.value)}
                  >
                    <option value="">Choose a property to give</option>
                    {own.table.sets.flatMap((set) =>
                      set.cards.map((c) => (
                        <option key={c.id} value={c.id}>
                          {dealColorLabel(set.color)} · {c.title}
                          {c.kind === "wild"
                            ? c.colors.length > 2
                              ? " · rainbow wild"
                              : " · two-color wild"
                            : ""}
                          {completeDealSet(set)
                            ? " (breaks complete group)"
                            : ""}
                        </option>
                      )),
                    )}
                  </select>
                  {offered && (
                    <DealColorMark
                      card={offered.cards.find((c) => c.id === giveCard)}
                      color={offered.color}
                    />
                  )}
                </label>
              )}
              {effect === "dealBreaker" && (
                <label className="field">
                  <span>Steal a complete group</span>
                  <select
                    className="input"
                    value={targetSet}
                    onChange={(e) => setTargetSet(e.target.value)}
                  >
                    <option value="">Choose a complete group</option>
                    {stealSets.map((set, i) => (
                      <option key={set.id} value={set.id}>
                        {dealColorLabel(set.color)} · group {i + 1}
                        {set.house ? " + House" : ""}
                        {set.hotel ? " + Hotel" : ""}
                      </option>
                    ))}
                  </select>
                  {stealSets.find((set) => set.id === targetSet) && (
                    <DealColorMark
                      color={
                        stealSets.find((set) => set.id === targetSet)!.color
                      }
                    />
                  )}
                  {!s.settings.rules.dealBreaker && (
                    <small>
                      Deal Breaker is disabled; this card can be banked.
                    </small>
                  )}
                </label>
              )}
              {rent && (
                <>
                  <fieldset className="deal-multipliers">
                    <legend>Double the Rent · optional</legend>
                    {s.hand
                      .filter((c) => c.effect === "doubleRent")
                      .map((c) => (
                        <label key={c.id}>
                          <input
                            type="checkbox"
                            checked={doubles.includes(c.id)}
                            disabled={
                              !doubles.includes(c.id) &&
                              doubles.length + 2 > s.playsLeft
                            }
                            onChange={(e) =>
                              setDoubles(
                                e.target.checked
                                  ? [...doubles, c.id]
                                  : doubles.filter((id) => id !== c.id),
                              )
                            }
                          />{" "}
                          ×2 · costs one play
                        </label>
                      ))}
                    {!s.hand.some((c) => c.effect === "doubleRent") && (
                      <small>No Double Rent in your hand.</small>
                    )}
                  </fieldset>
                  <p className="deal-rent-quote">
                    {sets.some((set) => set.id === setId)
                      ? `${dealRent(sets.find((set) => set.id === setId)!) * 2 ** doubles.length}M`
                      : "Choose a group"}{" "}
                    {effect === "rent"
                      ? "from each opponent"
                      : "from one opponent"}
                  </p>
                </>
              )}
              <button
                className="primary"
                disabled={busy || !canAct || !legalAction}
                onClick={() =>
                  void submit({
                    setId,
                    target,
                    targetCardId: targetCard,
                    targetSetId: targetSet,
                    giveCardId: giveCard,
                    doubleIds: doubles,
                  })
                }
              >
                Play {card.title} · {1 + doubles.length}{" "}
                {doubles.length ? "plays" : "play"}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
