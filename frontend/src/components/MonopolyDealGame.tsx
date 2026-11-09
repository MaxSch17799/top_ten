import { useRoomCommand } from "../hooks/useRoomCommand";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { DEAL_EFFECTS, type DealAction, type DealCard as Card, type DealView } from "../../../shared/monopolyDeal";
import { joinGame } from "../api";
import { useGameConnection } from "../hooks/useGameConnection";
import { loadSessionForGame, saveSession } from "../lib/session";
import type { SessionData } from "../lib/types";
import AddPlayerPanel from "./AddPlayerPanel";
import DealCard from "./DealCard";
import DealSettings, { DealRulesSummary } from "./DealSettings";
import { type Act, playerName } from "../games/monopoly-deal/types";
import { Modal } from "../games/monopoly-deal/presentation";
import { CardComposer } from "../games/monopoly-deal/CardComposer";
import { ResponsePanel } from "../games/monopoly-deal/ResponsePanel";
import { PlayerTable, GroupDetails } from "../games/monopoly-deal/Table";
import { Hand, EndTurnControl } from "../games/monopoly-deal/Hand";
import { Motion, Deadline } from "../games/monopoly-deal/Motion";
import { Rules } from "../games/monopoly-deal/Rules";

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
    [invite, setInvite] = useState(false);
  const [cardId, setCardId] = useState<string | null>(null),
    [inspect, setInspect] = useState<Card | null>(null),
    [group, setGroup] = useState<{ owner: string; id: string } | null>(null),
    [confirm, setConfirm] = useState<"end" | "restart" | null>(null);
  const { send, retry } = useRoomCommand<DealAction>({
    gameId, token: display ? undefined : session?.playerToken,
    refresh: requestState, setBusy, setError,
  });
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
                <EndTurnControl s={s} act={act} busy={busy} />
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
              key={`${s.pending.index}-${s.pending.stage}-${s.pending.depth}-${s.pending.responder}-${s.pending.amount}`}
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
