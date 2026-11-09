import { DEAL_PALETTE } from '../../lib/dealTheme';
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { DEAL_EFFECTS, DEAL_GROUPS, dealAssets, dealBankTotal, type DealView } from "../../../../shared/monopolyDeal";
import DealCard from "../../components/DealCard";
import DealColorMark from "../../components/DealColorMark";
import { type Act, playerName } from "./types";
import { Placement } from "./presentation";

export function ResponsePanel({
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
  const bankOnly = !!(
    s.settings.rules.bankFirstPayments &&
    own &&
    own.table.bank.length
  );
  const payable = bankOnly ? own!.table.bank : assets;
  const selectedPayable = payable.filter((c) => selected.includes(c.id));
  const total = assets
      .filter((c) => selectedPayable.some((p) => p.id === c.id))
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
  const takenGroup = targeted?.find((set) =>
    set.cards.some((c) => c.id === p.targetCardId),
  );
  const offeredGroup = s.players
    .find((player) => player.playerId === p.actor)
    ?.table.sets.find((set) => set.cards.some((c) => c.id === p.giveCardId));
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
      {taken && takenGroup && (
        <div className="deal-proposed-property">
          <strong>Taking: {taken.title}</strong>
          <DealColorMark card={taken} color={takenGroup.color} />
        </div>
      )}
      {p.kind === "forcedDeal" && offeredGroup && (
        <div className="deal-proposed-property">
          <strong>
            Giving:{" "}
            {offeredGroup.cards.find((c) => c.id === p.giveCardId)!.title}
          </strong>
          <DealColorMark
            card={offeredGroup.cards.find((c) => c.id === p.giveCardId)}
            color={offeredGroup.color}
          />
        </div>
      )}
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
            {bankOnly && (
              <p className="deal-payment-rule">
                <strong>Bank-first house rule</strong> · Pay from your bank
                first. Properties and buildings unlock after the bank is empty.
                If the bank is short, pay all its cards now and choose assets
                for the remainder next.
              </p>
            )}
            <div className="deal-payment-assets">
              {assets.map((c) => {
                const bank = own!.table.bank.some((b) => b.id === c.id);
                const property =
                  !bank && (c.kind === "property" || c.kind === "wild");
                const set = property
                  ? own!.table.sets.find((set) =>
                      set.cards.some((v) => v.id === c.id),
                    )
                  : undefined;
                const locked = bankOnly && !bank;
                return (
                  <button
                    key={c.id}
                    className={`deal-asset ${bank ? "is-bank" : property ? "is-property" : "is-building"} ${selected.includes(c.id) && !locked ? "selected" : ""}`}
                    data-asset-kind={
                      bank ? "bank" : property ? "property" : "building"
                    }
                    style={
                      set
                        ? ({
                            "--property-color": DEAL_PALETTE[set.color],
                          } as CSSProperties)
                        : undefined
                    }
                    disabled={busy || locked}
                    title={
                      locked ? "Use your bank first (house rule)" : undefined
                    }
                    aria-pressed={selected.includes(c.id)}
                    onClick={() =>
                      setSelected(
                        selected.includes(c.id)
                          ? selected.filter((id) => id !== c.id)
                          : [...selected, c.id],
                      )
                    }
                  >
                    <span className="deal-asset-kind">
                      {bank
                        ? "BANK"
                        : c.kind === "property" || c.kind === "wild"
                          ? "◆ PROPERTY TRANSFER"
                          : "BUILDING"}
                    </span>
                    <strong>{c.title}</strong>
                    <b>{c.value}M</b>
                    {set && <DealColorMark card={c} color={set.color} />}
                    <small>
                      {bank
                        ? "Pays as cash"
                        : property
                          ? "Transfers to their property collection"
                          : "Transfers to their bank as money"}
                      {locked ? " · Locked: use bank first" : ""}
                    </small>
                  </button>
                );
              })}
            </div>
            <div className="deal-buttons">
              {(available < p.amount ||
                (bankOnly && dealBankTotal(own!.table) < p.amount)) && (
                <button
                  className="secondary"
                  onClick={() => setSelected(payable.map((c) => c.id))}
                >
                  {bankOnly
                    ? "Select all bank cards"
                    : "Select all · insufficient assets"}
                </button>
              )}
              <strong>
                Selected: {total}M / {p.amount}M
              </strong>
              <button
                className="primary"
                disabled={
                  busy ||
                  !(
                    total >= p.amount ||
                    selectedPayable.length === payable.length
                  )
                }
                onClick={() =>
                  void act("pay", { cardIds: selectedPayable.map((c) => c.id) })
                }
              >
                Confirm payment · {total}M
                {bankOnly &&
                total < p.amount &&
                selectedPayable.length === payable.length
                  ? ` · ${p.amount - total}M remains`
                  : ""}
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
