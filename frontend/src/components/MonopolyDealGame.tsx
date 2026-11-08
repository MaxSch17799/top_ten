import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import {
  DEAL_EFFECTS,
  DEAL_GROUPS,
  buildableDealColor,
  completeDealSet,
  dealAssets,
  dealBankTotal,
  dealRent,
  type DealAction,
  type DealCard as Card,
  type DealColor,
  type DealPlayer,
  type DealSet,
  type DealView,
} from "../../../shared/monopolyDeal";
import { ApiError, BACKEND_BASE, joinGame, request } from "../api";
import { useGameConnection } from "../hooks/useGameConnection";
import { loadSessionForGame, saveSession } from "../lib/session";
import type { SessionData } from "../lib/types";
import AddPlayerPanel from "./AddPlayerPanel";
import DealCard from "./DealCard";
import DealSettings, { DealRulesSummary } from "./DealSettings";

type Act = (
  type: string,
  payload?: Record<string, unknown>,
) => Promise<boolean>;
const playerName = (s: DealView, id: string | null | undefined) =>
  s.players.find((p) => p.playerId === id)?.nickname ?? "Player";
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => {
      if (d?.open) d.close();
    };
  }, []);
  return (
    <dialog
      className="deal-modal"
      aria-label={title}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="deal-modal-title">
        <h2>{title}</h2>
        <button
          className="secondary"
          aria-label="Close card details"
          onClick={close}
        >
          ✕
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Placement({
  card,
  player,
  submit,
  busy,
  exclude,
  label = "Place property",
}: {
  card: Card;
  player: DealPlayer;
  submit: (p: Record<string, unknown>) => void;
  busy: boolean;
  exclude?: string;
  label?: string;
}) {
  const [color, setColor] = useState<DealColor>(card.colors[0]),
    [setId, setSetId] = useState("");
  const eligible = player.table.sets.filter(
    (s) =>
      s.color === color &&
      s.cards.length < DEAL_GROUPS[color].size &&
      s.id !== exclude,
  );
  const from = player.table.sets.find((s) => s.id === exclude);
  return (
    <div className="deal-placement">
      <label className="field">
        <span>Property color</span>
        <select
          className="input"
          value={color}
          onChange={(e) => {
            setColor(e.target.value as DealColor);
            setSetId("");
          }}
        >
          {card.colors.map((c) => (
            <option key={c} value={c}>
              {DEAL_GROUPS[c].name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Destination group</span>
        <select
          className="input"
          value={setId}
          onChange={(e) => setSetId(e.target.value)}
        >
          <option value="">Start a new {DEAL_GROUPS[color].name} group</option>
          {eligible.map((s, i) => (
            <option key={s.id} value={s.id}>
              {DEAL_GROUPS[color].name} group {i + 1} · {s.cards.length}/
              {DEAL_GROUPS[color].size}
            </option>
          ))}
        </select>
      </label>
      {from && (from.house || from.hotel) && (
        <p className="deal-gold">
          Moving this card breaks a built set. Its buildings will be discarded.
        </p>
      )}
      <button
        className="primary"
        disabled={busy}
        onClick={() => submit({ color, setId, cardId: card.id })}
      >
        {label}
      </button>
    </div>
  );
}
function CardComposer({
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
  const [setId, setSetId] = useState(""),
    [target, setTarget] = useState(""),
    [targetCard, setTargetCard] = useState(""),
    [giveCard, setGiveCard] = useState(""),
    [targetSet, setTargetSet] = useState(""),
    [doubles, setDoubles] = useState<string[]>([]);
  const effect = card.effect,
    other = s.players.find((p) => p.playerId === target);
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
          <div className="deal-tabs">
            {(card.kind === "property" || card.kind === "wild"
              ? ["property"]
              : card.kind === "money"
                ? ["bank"]
                : ["action", "bank"]
            ).map((m) => (
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
                        {DEAL_GROUPS[set.color].name} · group {i + 1} ·{" "}
                        {rent ? `${dealRent(set)}M rent` : "complete"}
                      </option>
                    ))}
                  </select>
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
                    {s.players
                      .filter((p) => p.playerId !== s.yourPlayerId)
                      .map((p) => (
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
                      onClick={() => setTargetCard(c.id)}
                    >
                      {c.title} · {c.value}M
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
                          {c.title} · {DEAL_GROUPS[set.color].name}
                          {completeDealSet(set)
                            ? " (breaks complete group)"
                            : ""}
                        </option>
                      )),
                    )}
                  </select>
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
                    {other?.table.sets.filter(completeDealSet).map((set, i) => (
                      <option key={set.id} value={set.id}>
                        {DEAL_GROUPS[set.color].name} · group {i + 1}
                        {set.house ? " + House" : ""}
                        {set.hotel ? " + Hotel" : ""}
                      </option>
                    ))}
                  </select>
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
function ResponsePanel({
  s,
  act,
  busy,
}: {
  s: DealView;
  act: Act;
  busy: boolean;
}) {
  const p = s.pending!,
    mine = p.responder === s.yourPlayerId;
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (mine)
      panel.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "center",
      });
  }, [mine]);
  const [selected, setSelected] = useState<string[]>([]);
  const own = s.players.find((v) => v.playerId === s.yourPlayerId),
    assets = own ? dealAssets(own.table) : [];
  const total = assets
      .filter((c) => selected.includes(c.id))
      .reduce((n, c) => n + c.value, 0),
    available = assets.reduce((n, c) => n + c.value, 0);
  const no = s.hand.find((c) => c.effect === "justSayNo"),
    canNo =
      no &&
      (!s.settings.rules.ownTurnNoCostsPlay ||
        s.turn !== s.yourPlayerId ||
        s.playsLeft > 0);
  const targeted = s.players.find((v) => v.playerId === p.target)?.table.sets;
  const taken = targeted
      ?.flatMap((set) => set.cards)
      .find((c) => c.id === p.targetCardId),
    takenSet = targeted?.find((set) => set.id === p.targetSetId);
  return (
    <section
      ref={panel}
      className={`deal-response ${mine ? "needs-you" : ""}`}
      aria-live="polite"
    >
      <div className="deal-section-heading">
        <span className="deal-kicker">
          {mine ? "Your decision" : "Action in progress"}
        </span>
        <strong>{DEAL_EFFECTS[p.kind].title}</strong>
        {p.targets.length > 1 && (
          <small>
            Opponent {p.index + 1}/{p.targets.length}
          </small>
        )}
      </div>
      <p>
        {playerName(s, p.actor)} → {playerName(s, p.target)}
        {p.amount > 0
          ? ` · ${p.amount}M`
          : taken
            ? ` · ${taken.title}`
            : takenSet
              ? ` · complete ${DEAL_GROUPS[takenSet.color].name} group${takenSet.house ? " with buildings" : ""}`
              : ""}
      </p>
      {p.stage === "response" && (
        <>
          <p>
            {p.depth > 0
              ? `${p.depth} No ${p.depth === 1 ? "card" : "cards"} played. ${p.cancelled ? "The action is currently blocked." : "The action is currently active."}`
              : "The affected player can accept or play Just Say No."}
          </p>
          {mine ? (
            <div className="deal-buttons">
              <button
                className="primary"
                disabled={busy}
                onClick={() => void act("respond", { no: false })}
              >
                {p.cancelled ? "Let the No stand" : "Accept action"}
              </button>
              {canNo && (
                <button
                  className="deal-no-button"
                  disabled={busy}
                  onClick={() =>
                    void act("respond", { no: true, cardId: no.id })
                  }
                >
                  Just Say No{p.depth ? " · counter" : ""}
                  {s.turn === s.yourPlayerId &&
                  s.settings.rules.ownTurnNoCostsPlay
                    ? " · 1 play"
                    : ""}
                </button>
              )}
              {!canNo && (
                <small>
                  {no
                    ? "The 2024 own-turn No rule needs an unused play."
                    : "You have no Just Say No in hand."}
                </small>
              )}
            </div>
          ) : (
            <p className="deal-gold">
              Waiting for {playerName(s, p.responder)}…
            </p>
          )}
        </>
      )}
      {p.stage === "payment" &&
        (mine ? (
          <>
            <h3>
              Pay {p.amount}M to {playerName(s, p.actor)}
            </h3>
            <p className="deal-help">
              Select tabled assets. Your hand cannot pay. Properties go to their
              property collection; banked actions stay money. Zero-value wilds
              cannot pay.
            </p>
            <div className="deal-payment-assets">
              {assets.map((c) => {
                const bank = own!.table.bank.some((b) => b.id === c.id);
                return (
                  <button
                    key={c.id}
                    className={`deal-asset ${selected.includes(c.id) ? "selected" : ""}`}
                    aria-pressed={selected.includes(c.id)}
                    onClick={() =>
                      setSelected(
                        selected.includes(c.id)
                          ? selected.filter((id) => id !== c.id)
                          : [...selected, c.id],
                      )
                    }
                  >
                    <span>
                      {bank
                        ? "BANK"
                        : c.kind === "property" || c.kind === "wild"
                          ? "PROPERTY"
                          : "BUILDING"}
                    </span>
                    <strong>{c.title}</strong>
                    <b>{c.value}M</b>
                  </button>
                );
              })}
            </div>
            <div className="deal-buttons">
              {available < p.amount && (
                <button
                  className="secondary"
                  onClick={() => setSelected(assets.map((c) => c.id))}
                >
                  Select all · insufficient assets
                </button>
              )}
              <strong>
                Selected: {total}M / {p.amount}M
              </strong>
              <button
                className="primary"
                disabled={
                  busy ||
                  !(total >= p.amount || selected.length === assets.length)
                }
                onClick={() => void act("pay", { cardIds: selected })}
              >
                Confirm payment · {total}M
              </button>
            </div>
            {total > p.amount && (
              <p className="deal-gold">
                Overpayment of {total - p.amount}M. No change is returned.
              </p>
            )}
            {available < p.amount && (
              <p className="deal-help">
                Give all payable assets ({available}M). The rest of the debt is
                cleared.
              </p>
            )}
            <p className="deal-help">
              If a built set becomes incomplete, its unpaid buildings are
              discarded.
            </p>
          </>
        ) : (
          <p className="deal-gold">
            {playerName(s, p.target)} is choosing a payment…
          </p>
        ))}
      {p.stage === "placement" &&
        (mine && own ? (
          <div className="deal-received">
            <div className="deal-preview">
              <DealCard card={p.placements[0].card} />
            </div>
            <div>
              <h3>Place your received property</h3>
              <p>
                You choose its color and group.{" "}
                {p.placements.length > 1
                  ? `${p.placements.length} properties still to place.`
                  : ""}
              </p>
              <Placement
                key={p.placements[0].card.id}
                card={p.placements[0].card}
                player={own}
                busy={busy}
                submit={(v) => void act("place-received", v)}
              />
            </div>
          </div>
        ) : (
          <p className="deal-gold">
            {playerName(s, p.responder)} is placing received properties…
          </p>
        ))}
    </section>
  );
}
function Group({ group, open }: { group: DealSet; open: () => void }) {
  const complete = completeDealSet(group),
    meta = DEAL_GROUPS[group.color];
  return (
    <button
      className={`deal-group ${complete ? "complete" : ""}`}
      style={{ "--group-color": meta.color } as CSSProperties}
      onClick={open}
      aria-label={`${meta.name} group, ${group.cards.length} of ${meta.size} properties${complete ? ", complete" : ""}`}
    >
      <span className="deal-group-top">
        <strong>{meta.name}</strong>
        <b>{complete ? "✓" : `${group.cards.length}/${meta.size}`}</b>
      </span>
      <span className="deal-property-slots">
        {Array.from({ length: meta.size }, (_, i) => (
          <i key={i} className={group.cards[i] ? "filled" : ""}>
            {group.cards[i]?.kind === "wild" ? "✦" : group.cards[i] ? "◆" : "·"}
          </i>
        ))}
      </span>
      <span className="deal-group-rent">
        {dealRent(group)}M rent{" "}
        <span>
          {group.house ? "⌂" : ""}
          {group.hotel ? " ▥" : ""}
        </span>
      </span>
    </button>
  );
}
function PlayerTable({
  s,
  p,
  inspect,
  inspectGroup,
}: {
  s: DealView;
  p: DealPlayer;
  inspect: (c: Card) => void;
  inspectGroup: (owner: string, setId: string) => void;
}) {
  const mine = p.playerId === s.yourPlayerId;
  return (
    <section
      className={`deal-player-table ${mine ? "is-mine" : ""} ${s.turn === p.playerId ? "is-turn" : ""}`}
      data-player={p.playerId}
    >
      <header>
        <span className="deal-avatar">
          {p.nickname.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <h2>
            {p.nickname}
            {mine ? " · you" : ""}
          </h2>
          <small>
            {s.turn === p.playerId
              ? "● CURRENT TURN"
              : p.connected
                ? `${p.cardCount} cards in hand`
                : "○ Reconnecting"}
            {s.turn === p.playerId ? ` · ${p.cardCount} cards` : ""}
          </small>
        </div>
        <span className="deal-set-score">
          <strong>{p.completeSets}</strong>/{s.settings.rules.setsToWin}
          <small>colors</small>
        </span>
      </header>
      <div className="deal-groups">
        {p.table.sets.map((group) => (
          <Group
            key={group.id}
            group={group}
            open={() => inspectGroup(p.playerId, group.id)}
          />
        ))}
        {p.table.sets.length === 0 && (
          <p className="deal-empty">
            Your next empire starts here.
            {mine ? " Play property cards from your hand." : ""}
          </p>
        )}
      </div>
      <div className="deal-bank">
        <span>
          <b>{dealBankTotal(p.table)}M</b> BANK
        </span>
        <div>
          {p.table.bank.map((c) => (
            <button
              key={c.id}
              className="deal-bank-chip"
              title={c.title}
              onClick={() => inspect(c)}
            >
              {c.value}M<small>{c.kind === "action" ? c.title : "Cash"}</small>
            </button>
          ))}
          {p.table.bank.length === 0 && <small>No banked cards</small>}
        </div>
      </div>
    </section>
  );
}
function GroupDetails({
  s,
  owner,
  setId,
  act,
  busy,
  close,
}: {
  s: DealView;
  owner: string;
  setId: string;
  act: Act;
  busy: boolean;
  close: () => void;
}) {
  const [chosen, setChosen] = useState(""),
    [destination, setDestination] = useState("");
  const player = s.players.find((p) => p.playerId === owner)!,
    group = player.table.sets.find((set) => set.id === setId);
  if (!group)
    return (
      <Modal title="Property moved" close={close}>
        <p>
          This group has moved or changed. Open its new location on the table.
        </p>
      </Modal>
    );
  const canMove =
    s.turn === owner &&
    s.yourPlayerId === owner &&
    s.phase === "PLAY" &&
    !s.pending &&
    s.settings.rules.rearrange;
  const cards = [
      ...group.cards,
      ...(group.house ? [group.house] : []),
      ...(group.hotel ? [group.hotel] : []),
    ],
    card = cards.find((c) => c.id === chosen);
  return (
    <Modal
      title={`${DEAL_GROUPS[group.color].name} · ${group.cards.length}/${DEAL_GROUPS[group.color].size}`}
      close={close}
    >
      <p>
        {completeDealSet(group) ? "Complete set" : "Incomplete set"} ·{" "}
        {dealRent(group)}M rent{group.house ? " · House +3M" : ""}
        {group.hotel ? " · Hotel +4M" : ""}
      </p>
      <div className="deal-inspect-cards">
        {cards.map((c) => (
          <button
            key={c.id}
            className={c.id === chosen ? "selected" : ""}
            onClick={() => setChosen(c.id)}
          >
            <DealCard card={c} />
          </button>
        ))}
      </div>
      {card && (
        <>
          <h3>
            {card.title} · {card.value}M
          </h3>
          {canMove ? (
            card.kind === "property" || card.kind === "wild" ? (
              <Placement
                key={card.id}
                card={card}
                player={player}
                exclude={group.id}
                label="Move property · free"
                busy={busy}
                submit={async (v) => {
                  if (await act("move", v)) close();
                }}
              />
            ) : (
              <>
                <label className="field">
                  <span>Move building to another complete group</span>
                  <select
                    className="input"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                  >
                    <option value="">Choose an eligible group</option>
                    {player.table.sets
                      .filter(
                        (set) =>
                          set.id !== group.id &&
                          completeDealSet(set) &&
                          buildableDealColor(set.color) &&
                          (card.effect === "house"
                            ? !set.house && !group.hotel
                            : set.house && !set.hotel),
                      )
                      .map((set) => (
                        <option key={set.id} value={set.id}>
                          {DEAL_GROUPS[set.color].name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  className="primary"
                  disabled={busy || !destination}
                  onClick={async () => {
                    if (
                      await act("move-building", {
                        cardId: card.id,
                        setId: destination,
                      })
                    )
                      close();
                  }}
                >
                  Move building · free
                </button>
              </>
            )
          ) : (
            <p className="deal-help">
              Properties may only be rearranged on their owner’s turn, outside
              pending actions.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
function Hand({
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
function Motion({ s }: { s: DealView }) {
  const previous = useRef<number | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = s.events.at(-1)?.id ?? 0;
    if (
      before === null ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const effects: { node: HTMLDivElement; animation: Animation }[] = [];
    for (const e of s.events
      .filter(
        (e) =>
          e.id > before &&
          [
            "draw",
            "bank",
            "property",
            "action",
            "payment",
            "steal",
            "no",
            "set",
          ].includes(e.type),
      )
      .slice(-5)) {
      const seat = document.querySelector(
          `[data-player="${CSS.escape(e.actor ?? "")}"]`,
        ),
        other = document.querySelector(
          `[data-player="${CSS.escape(e.target ?? "")}"]`,
        ),
        center = document.querySelector(".deal-piles");
      const hand =
        e.actor === s.yourPlayerId
          ? document.querySelector(".deal-hand")
          : seat;
      const source =
        e.type === "draw"
          ? center
          : e.type === "steal"
            ? other
            : ["bank", "property", "action"].includes(e.type)
              ? hand
              : seat;
      const dest =
        e.type === "draw"
          ? hand
          : e.type === "payment"
            ? other
            : e.type === "steal"
              ? seat
              : e.type === "bank"
                ? seat?.querySelector(".deal-bank")
                : e.type === "property"
                  ? seat?.querySelector(".deal-groups")
                  : center;
      if (!source || !dest) continue;
      const a = source.getBoundingClientRect(),
        b = dest.getBoundingClientRect();
      const node = document.createElement("div");
      node.className = `deal-flight ${e.type === "no" ? "is-no" : ""}`;
      node.setAttribute("aria-hidden", "true");
      const graphic = e.card
        ? Array.from(document.querySelectorAll(".deal-card-svg")).find((el) =>
            el.getAttribute("aria-label")?.startsWith(`${e.card!.title}, `),
          )
        : null;
      if (e.type === "no" || e.type === "set" || e.type === "payment")
        node.textContent =
          e.type === "no" ? "NO" : e.type === "set" ? "✦" : "M";
      else {
        const svg = graphic ?? center?.querySelector(".deal-card-svg");
        if (svg) node.append(svg.cloneNode(true));
      }
      node.style.left = `${a.x + a.width / 2}px`;
      node.style.top = `${a.y + Math.min(a.height / 2, 70)}px`;
      document.body.append(node);
      const animation = node.animate(
        [
          { transform: "translate(-50%,-50%) scale(.7)", opacity: 0.3 },
          {
            transform: `translate(${b.x + b.width / 2 - a.x - a.width / 2}px, ${b.y + Math.min(b.height / 2, 70) - a.y - Math.min(a.height / 2, 70)}px) rotate(12deg)`,
            opacity: 1,
          },
          { opacity: 0 },
        ],
        { duration: 450, easing: "cubic-bezier(.2,.7,.3,1)" },
      );
      animation.onfinish = () => node.remove();
      effects.push({ node, animation });
    }
    return () => {
      for (const e of effects) {
        e.animation.cancel();
        e.node.remove();
      }
    };
  }, [s.events, s.yourPlayerId]);
  return null;
}
function Deadline({ s, receivedAt }: { s: DealView; receivedAt: number }) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const deadline = s.pending?.deadline ?? s.turnDeadline;
  if (!deadline) return null;
  return (
    <span className="deal-countdown">
      {Math.max(
        0,
        Math.ceil((deadline - s.serverNow - (tick - receivedAt)) / 1000),
      )}
      s · {s.pending ? "response" : "turn"}
    </span>
  );
}
export default function MonopolyDealGame({
  gameId,
  display = false,
}: {
  gameId: string;
  display?: boolean;
}) {
  const [session, setSession] = useState<SessionData | null>(() =>
    display ? null : loadSessionForGame(gameId),
  );
  const token = display
    ? (new URLSearchParams(location.search).get("token") ?? undefined)
    : session?.playerToken;
  const {
    state: s,
    wsStatus,
    lastError,
    requestState,
    receivedAt,
  } = useGameConnection<DealView>({ gameId, playerToken: token });
  const [nickname, setNickname] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [invite, setInvite] = useState(false),
    [retry, setRetry] = useState<DealAction | null>(null);
  const [cardId, setCardId] = useState<string | null>(null),
    [inspect, setInspect] = useState<Card | null>(null),
    [group, setGroup] = useState<{ owner: string; id: string } | null>(null),
    [confirm, setConfirm] = useState<"end" | "restart" | null>(null);
  const lock = useRef(false);
  const send = async (action: DealAction) => {
    if (!session || lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    setRetry(null);
    try {
      await request(`${BACKEND_BASE}/api/game/${gameId}/action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.playerToken}`,
        },
        body: JSON.stringify(action),
        signal: AbortSignal.timeout(12_000),
      });
      await requestState();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
      if (!(e instanceof ApiError)) setRetry(action);
      await requestState();
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const act: Act = async (type, payload = {}) =>
    s
      ? send({
          id: crypto.randomUUID(),
          type,
          payload,
          generation: s.generation,
          revision: s.revision,
          round: s.round,
        })
      : false;
  const join = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await joinGame(gameId, nickname.trim());
      const value: SessionData = {
        gameId,
        playerId: r.playerId,
        playerToken: r.playerToken,
        role: "PLAYER",
      };
      saveSession(value);
      setSession(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join");
    } finally {
      setBusy(false);
    }
  };
  if (!session && !display)
    return (
      <main className="page sheet deal">
        <section className="host-form">
          <Link to="/">← All games</Link>
          <p className="eyebrow">Room {gameId}</p>
          <h1>Monopoly Deal</h1>
          <p>Build an empire. Make a little trouble.</p>
          <form className="stack" onSubmit={join}>
            <label className="field">
              <span>Your nickname</span>
              <input
                className="input"
                required
                maxLength={20}
                autoComplete="nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              Join lobby
            </button>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      </main>
    );
  if (!s)
    return (
      <main className="page sheet deal">
        <section className="host-form">
          <p role="status">
            {lastError ??
              (display && !token
                ? "Use the shared display link from the host."
                : "Reconnecting to your table…")}
          </p>
          <button className="secondary" onClick={() => void requestState()}>
            Retry connection
          </button>
          <Link to="/">All games</Link>
        </section>
      </main>
    );
  const host = s.yourRole === "HOST",
    myTurn = s.turn === s.yourPlayerId,
    own = s.players.find((p) => p.playerId === s.yourPlayerId),
    others = s.players.filter((p) => p.playerId !== s.yourPlayerId),
    selected = s.hand.find((c) => c.id === cardId);
  const latest = s.events.at(-1),
    celebration = [...s.events]
      .reverse()
      .find((e) => e.type === "set" || e.type === "win");
  return (
    <main className={`deal deal-game ${display ? "deal-display" : ""}`}>
      <Motion s={s} />
      <header className="deal-header">
        <Link to="/" aria-label="All games">
          ←
        </Link>
        <div>
          <h1>
            MONOPOLY <span>DEAL</span>
          </h1>
          <small>
            GAME NIGHT / ROOM {gameId} {s.round > 0 ? `/ GAME ${s.round}` : ""}
          </small>
        </div>
        <span
          className={`deal-connection ${wsStatus === "open" ? "live" : ""}`}
          role="status"
        >
          {wsStatus === "open" ? "● Live" : "↻ Reconnecting"}
        </span>
        {!display && (
          <button className="secondary" onClick={() => setInvite(true)}>
            Invite
          </button>
        )}
      </header>
      {s.turn && (
        <div className="deal-status-strip">
          {s.pending
            ? s.pending.responder === s.yourPlayerId
              ? "Your decision"
              : `${playerName(s, s.pending.responder)} responds`
            : `${myTurn ? "Your turn" : `${playerName(s, s.turn)}’s turn`} · ${s.playsLeft} plays left`}
          {!display && <a href="#deal-your-hand">Your hand ↓</a>}
        </div>
      )}
      {(error || lastError) && (
        <div className="deal-error" role="alert">
          {error || lastError}
          {retry && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void send(retry)}
            >
              Retry last move
            </button>
          )}
        </div>
      )}
      {s.phase === "LOBBY" ? (
        <div className="deal-lobby">
          <section className="deal-panel">
            <p className="deal-kicker">Your people. Your property empire.</p>
            <h2>Waiting for the first deal</h2>
            <p className="deal-help">
              2–5 players · one private hand per device
            </p>
            <ol className="deal-seats">
              {s.order.map((id, i) => {
                const p = s.players.find((p) => p.playerId === id)!;
                return (
                  <li key={id}>
                    <span className="deal-avatar">
                      {p.nickname.slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <strong>{p.nickname}</strong>
                      <small>
                        {p.role === "HOST" ? "Host · " : ""}
                        {p.connected ? "Ready" : "Joining…"}
                      </small>
                    </div>
                    {host && (
                      <div className="deal-buttons">
                        <button
                          className="secondary"
                          disabled={busy || i === 0}
                          aria-label={`Move ${p.nickname} earlier`}
                          onClick={() => {
                            const order = [...s.order];
                            [order[i - 1], order[i]] = [order[i], order[i - 1]];
                            void act("reorder", { order });
                          }}
                        >
                          ↑
                        </button>
                        {id !== s.yourPlayerId && (
                          <button
                            className="secondary"
                            disabled={busy}
                            aria-label={`Remove ${p.nickname}`}
                            onClick={() => void act("kick", { playerId: id })}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            <DealRulesSummary settings={s.settings} />
            {host ? (
              <button
                className="primary deal-start"
                disabled={busy || s.players.length < 2}
                onClick={() => void act("start")}
              >
                Shuffle & deal
              </button>
            ) : (
              <p className="deal-gold">
                The host will start when everyone is ready.
              </p>
            )}
          </section>
          {host ? (
            <div className="deal-panel">
              <DealSettings
                key={JSON.stringify(s.settings)}
                value={s.settings}
                onApply={(settings) => act("settings", { settings })}
                busy={busy}
              />
            </div>
          ) : (
            <section className="deal-panel">
              <Rules />
            </section>
          )}
        </div>
      ) : (
        <>
          <section className="deal-center">
            <div className="deal-turn-status">
              <p className="deal-kicker">
                {s.phase === "COMPLETED"
                  ? "Match complete"
                  : s.phase === "ROUND_OVER"
                    ? "Game complete"
                    : myTurn
                      ? "You’re up"
                      : "At the table"}
              </p>
              <h2>
                {s.turn
                  ? `${myTurn ? "Your" : `${playerName(s, s.turn)}’s`} turn`
                  : s.result
                    ? `${playerName(s, s.result.winner)} wins!`
                    : "Thanks for playing"}
              </h2>
              {s.turn && (
                <span
                  className="deal-play-dots"
                  aria-label={`${s.playsLeft} plays remaining`}
                >
                  {Array.from(
                    { length: s.settings.rules.playsPerTurn },
                    (_, i) => (
                      <i
                        key={i}
                        className={i < s.playsLeft ? "available" : ""}
                      />
                    ),
                  )}
                  <small>{s.playsLeft} plays left</small>
                </span>
              )}
              <Deadline s={s} receivedAt={receivedAt} />
              {myTurn && s.phase === "PLAY" && !s.pending && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void act("end-turn")}
                >
                  End turn
                  {s.hand.length > s.settings.rules.handLimit
                    ? " · discard next"
                    : ""}
                </button>
              )}
              {s.phase === "DISCARD" && (
                <p className="deal-gold">
                  {myTurn
                    ? "Select excess cards in your hand below."
                    : `${playerName(s, s.turn)} is discarding to ${s.settings.rules.handLimit}.`}
                </p>
              )}
            </div>
            <div className="deal-piles">
              <div>
                <div className="deal-pile-card">
                  <DealCard back />
                </div>
                <small>{s.deckCount} DRAW</small>
              </div>
              <div>
                <button
                  className="deal-pile-card"
                  disabled={!s.top}
                  onClick={() => s.top && setInspect(s.top)}
                >
                  <DealCard card={s.top} />
                </button>
                <small>{s.discardCount} DISCARD</small>
              </div>
            </div>
          </section>
          <p
            className="deal-announcement"
            role="status"
            key={`announcement-${latest?.id}`}
          >
            {latest?.message ?? "The table is ready."}
          </p>
          {celebration && (
            <div
              key={`celebration-${celebration.id}`}
              className={`deal-set-burst ${celebration.type === "win" ? "victory" : ""}`}
              aria-hidden="true"
            >
              ✦{" "}
              {celebration.type === "win"
                ? "DEAL OF THE NIGHT"
                : `${playerName(s, celebration.actor)} · SET COMPLETE`}{" "}
              ✦
            </div>
          )}
          {s.pending && (
            <ResponsePanel
              key={`${s.pending.index}-${s.pending.stage}-${s.pending.depth}-${s.pending.responder}`}
              s={s}
              busy={busy}
              act={act}
            />
          )}
          {["ROUND_OVER", "COMPLETED"].includes(s.phase) && (
            <section className="deal-results deal-panel">
              <p className="deal-kicker">
                {s.settings.mode === "single"
                  ? "The final deal"
                  : "Match scoreboard"}
              </p>
              <h2>
                {s.winners.length
                  ? `${s.winners.map((id) => playerName(s, id)).join(" & ")} ${s.winners.length > 1 ? "share the win" : "takes the match"}`
                  : s.result
                    ? `${playerName(s, s.result.winner)} takes game ${s.round}`
                    : "Match ended"}
              </h2>
              <ol>
                {[...s.players]
                  .sort((a, b) => b.wins - a.wins)
                  .map((p) => (
                    <li key={p.playerId}>
                      <strong>{p.nickname}</strong>
                      <span>
                        {p.wins} {p.wins === 1 ? "win" : "wins"}
                      </span>
                    </li>
                  ))}
              </ol>
              <p className="deal-help">
                One point for each game won. Starting seat rotates each game.
              </p>
              {host && s.phase === "ROUND_OVER" && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void act("next")}
                >
                  Deal game {s.round + 1}
                </button>
              )}
              {host && s.phase === "COMPLETED" && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => setConfirm("restart")}
                >
                  Play again · return to lobby
                </button>
              )}
            </section>
          )}
          <div className="deal-opponents">
            {others.map((p) => (
              <PlayerTable
                key={p.playerId}
                s={s}
                p={p}
                inspect={setInspect}
                inspectGroup={(owner, id) => setGroup({ owner, id })}
              />
            ))}
          </div>
          {own && (
            <PlayerTable
              s={s}
              p={own}
              inspect={setInspect}
              inspectGroup={(owner, id) => setGroup({ owner, id })}
            />
          )}
          {!display && own && (
            <Hand
              key={`${s.generation}-${s.round}-${s.turn}-${s.phase}`}
              s={s}
              act={act}
              busy={busy}
              select={(c) => setCardId(c.id)}
            />
          )}
        </>
      )}
      <footer className="deal-footer">
        <details>
          <summary>How to play</summary>
          <Rules />
        </details>
        {s.events.length > 0 && (
          <details>
            <summary>Table activity · {latest?.message}</summary>
            <ol className="deal-activity">
              {s.events.map((e) => (
                <li key={e.id}>{e.message}</li>
              ))}
            </ol>
          </details>
        )}
        {s.phase !== "LOBBY" && (
          <details>
            <summary>Locked rules · {s.settings.profileName}</summary>
            <DealRulesSummary settings={s.settings} />
          </details>
        )}
        {host && (
          <details>
            <summary>Host controls</summary>
            <div className="deal-buttons">
              {s.displayToken && (
                <a
                  className="secondary"
                  target="_blank"
                  rel="noreferrer"
                  href={`/g/${gameId}/display?token=${encodeURIComponent(s.displayToken)}`}
                >
                  Open safe shared display
                </a>
              )}
              {s.phase !== "LOBBY" && (
                <>
                  <button
                    className="secondary"
                    onClick={() => setConfirm("restart")}
                  >
                    Return to lobby
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setConfirm("end")}
                  >
                    End match
                  </button>
                </>
              )}
            </div>
            <label className="field">
              <span>Transfer host</span>
              <select
                className="input"
                value=""
                disabled={busy}
                onChange={(e) => {
                  if (e.target.value)
                    void act("transfer-host", { playerId: e.target.value });
                }}
              >
                <option value="">Choose another player</option>
                {s.players
                  .filter((p) => p.playerId !== s.yourPlayerId)
                  .map((p) => (
                    <option key={p.playerId} value={p.playerId}>
                      {p.nickname}
                    </option>
                  ))}
              </select>
            </label>
          </details>
        )}
      </footer>
      {invite && (
        <AddPlayerPanel
          gameCode={gameId}
          joinUrl={`${window.location.origin}/g/${gameId}`}
          onClose={() => setInvite(false)}
          translate={(t) =>
            t === "Share this link or QR to add players mid-game."
              ? "Share this link or QR. Players join before the game starts."
              : t
          }
        />
      )}
      {selected && (
        <CardComposer
          key={`${selected.id}-${s.round}`}
          s={s}
          card={selected}
          act={act}
          busy={busy}
          close={() => setCardId(null)}
        />
      )}
      {inspect && (
        <Modal title={inspect.title} close={() => setInspect(null)}>
          <div className="deal-preview standalone">
            <DealCard card={inspect} />
          </div>
          <p>
            {inspect.value}M ·{" "}
            {inspect.effect
              ? DEAL_EFFECTS[inspect.effect].text
              : inspect.kind === "money"
                ? "Money in the bank"
                : "Public property"}
          </p>
          <p className="deal-help">
            Tabled cards are public. Actions already banked are money, and
            cannot be used as actions.
          </p>
        </Modal>
      )}
      {group && (
        <GroupDetails
          s={s}
          owner={group.owner}
          setId={group.id}
          act={act}
          busy={busy}
          close={() => setGroup(null)}
        />
      )}
      {confirm && (
        <Modal
          title={confirm === "restart" ? "Return to lobby?" : "End this match?"}
          close={() => setConfirm(null)}
        >
          <p>
            {confirm === "restart"
              ? "Hands, properties and match scores reset. Players and chosen rules stay in this room."
              : "The current game stops. Completed game wins remain on the scoreboard."}
          </p>
          <div className="deal-buttons">
            <button className="secondary" onClick={() => setConfirm(null)}>
              Keep playing
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (await act(confirm)) setConfirm(null);
              }}
            >
              {confirm === "restart" ? "Return to lobby" : "End match"}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
function Rules() {
  return (
    <div className="deal-rulebook">
      <h3>Your first Deal</h3>
      <ol>
        <li>
          Collect three complete property groups of different colors. The first
          to do so wins immediately.
        </li>
        <li>
          Draw two at turn start, or five if your hand is empty. Play up to
          three cards, then end your turn. Discard to seven.
        </li>
        <li>
          Play money or actions into your bank. Properties stay in your property
          collection. Banked actions cannot be used again.
        </li>
        <li>
          Charge rent, trade, or steal. Answer attacks with Just Say No; the
          attacker may counter with another No. Each opponent answers group
          attacks independently.
        </li>
        <li>
          Pay only with tabled assets you choose. No change. If short, give
          every payable asset; zero-value wilds stay. Received properties are
          placed by their new owner.
        </li>
        <li>
          Rearrange properties free during your turn. Fixed properties keep
          their color. Wilds use their printed colors. A group made only of
          rainbow wilds has no rent and cannot be complete.
        </li>
        <li>
          One House (+3M), then one Hotel (+4M), per complete colored group.
          Never on railroads or utilities. If the group becomes incomplete, its
          remaining buildings are discarded. Paid buildings go to the
          recipient’s bank.
        </li>
        <li>
          Sly Deal and Forced Deal cannot take from complete groups. Deal
          Breaker takes the whole complete group, including buildings.
        </li>
      </ol>
      <p>
        Classic follows the Hasbro FAQ (all No responses free); the 2024 printed
        edition charges a play for No during your own turn. Double Rent is
        played together with Rent, costs one play each, and may be used twice if
        you have three plays left.
      </p>
      <a
        href="https://instructions.hasbro.com/en-us/instruction/monopoly-deal-card-game-instructions"
        target="_blank"
        rel="noreferrer"
      >
        Hasbro instructions ↗
      </a>
      <p className="deal-help">
        An unofficial, private game-night adaptation. Original card designs; no
        Hasbro artwork.
      </p>
    </div>
  );
}
