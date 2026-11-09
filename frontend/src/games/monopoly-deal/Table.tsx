import { DEAL_PALETTE } from '../../lib/dealTheme';
import { useState, type CSSProperties } from "react";
import { DEAL_GROUPS, buildableDealColor, completeDealSet, dealBankTotal, dealRent, type DealCard as Card, type DealPlayer, type DealSet, type DealView } from "../../../../shared/monopolyDeal";
import DealCard from "../../components/DealCard";
import DealColorMark from "../../components/DealColorMark";
import { dealCardColorText, dealColorLabel, dealWildStripe, onlyDealChoice } from "../../lib/dealChoices";
import { type Act, playerName } from "./types";
import { Modal, Placement } from "./presentation";

export function Group({ group, open }: { group: DealSet; open: () => void }) {
  const complete = completeDealSet(group),
    meta = DEAL_GROUPS[group.color];
  return (
    <button
      className={`deal-group ${complete ? "complete" : ""}`}
      style={{ "--group-color": DEAL_PALETTE[group.color] } as CSSProperties}
      onClick={open}
      aria-label={`${meta.name} group, ${group.cards.length} of ${meta.size} properties${complete ? ", complete" : ""}`}
    >
      <span className="deal-group-top">
        <strong>
          {group.color === "railroad"
            ? "🚆 "
            : group.color === "utility"
              ? "💧 "
              : ""}
          {meta.name}
        </strong>
        <b>{complete ? "✓" : `${group.cards.length}/${meta.size}`}</b>
      </span>
      <span className="deal-property-slots">
        {Array.from({ length: meta.size }, (_, i) => {
          const card = group.cards[i];
          const wild = card?.kind === "wild";
          const description = card
            ? `${card.title} · ${dealCardColorText(card, group.color)}`
            : "Empty property slot";
          return (
            <i
              key={i}
              className={`${card ? "filled" : ""} ${wild ? "is-wild" : ""} ${wild && card.colors.length > 2 ? "is-rainbow" : ""}`}
              style={
                card
                  ? ({
                      "--wild-stripe": dealWildStripe(card, group.color),
                    } as CSSProperties)
                  : undefined
              }
              role="img"
              title={description}
              aria-label={description}
            >
              {wild ? "✦" : card ? "◆" : "·"}
            </i>
          );
        })}
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
export function PlayerTable({
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
  const underAttack =
    s.pending?.target === p.playerId &&
    ["slyDeal", "forcedDeal", "dealBreaker"].includes(s.pending.kind);
  return (
    <section
      className={`deal-player-table ${mine ? "is-mine" : ""} ${s.turn === p.playerId ? "is-turn" : ""} ${underAttack ? "under-attack" : ""}`}
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
      {underAttack && (
        <p className="deal-attack-badge">
          {s.pending!.kind === "forcedDeal"
            ? "⇄ Swap proposed"
            : "↗ Steal attempt"}{" "}
          · {playerName(s, s.pending!.actor)}
        </p>
      )}
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
export function GroupDetails({
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
    [destinationChoice, setDestination] = useState("");
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
    card = cards.find(
      (c) =>
        c.id ===
        onlyDealChoice(
          chosen,
          cards.map((c) => c.id),
        ),
    );
  const destinations = player.table.sets.filter(
    (set) =>
      set.id !== group.id &&
      completeDealSet(set) &&
      buildableDealColor(set.color) &&
      (card?.effect === "house"
        ? !set.house && !group.hotel
        : set.house && !set.hotel),
  );
  const destination = onlyDealChoice(
    destinationChoice,
    destinations.map((set) => set.id),
  );
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
                    {destinations.map((set) => (
                      <option key={set.id} value={set.id}>
                        {dealColorLabel(set.color)}
                      </option>
                    ))}
                  </select>
                  {destinations.find((set) => set.id === destination) && (
                    <DealColorMark
                      color={
                        destinations.find((set) => set.id === destination)!
                          .color
                      }
                    />
                  )}
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
