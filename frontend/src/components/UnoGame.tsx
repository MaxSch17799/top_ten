import { useRoomCommand } from "../hooks/useRoomCommand";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { UNO_COLORS, type UnoAction, type UnoView } from "../../../shared/uno";
import { joinGame } from "../api";
import { useGameConnection } from "../hooks/useGameConnection";
import { loadSessionForGame, saveSession } from "../lib/session";
import type { SessionData } from "../lib/types";
import AddPlayerPanel from "./AddPlayerPanel";
import UnoCard from "./UnoCard";
import { UNO_PALETTE } from "../lib/unoTheme";
import UnoSettings, { UnoRulesSummary } from "./UnoSettings";
import { type Act } from "../games/uno/types";
import { Table } from "../games/uno/Table";
import { Hand } from "../games/uno/Hand";
import { Results } from "../games/uno/Results";

export default function UnoGame({
  gameId,
  display = false,
}: {
  gameId: string;
  display?: boolean;
}) {
  const [session, setSession] = useState<SessionData | null>(() =>
    display ? null : loadSessionForGame(gameId),
  );
  const displayToken = display
    ? (new URLSearchParams(location.search).get("token") ?? undefined)
    : undefined;
  const {
    state: s,
    wsStatus,
    lastError,
    requestState,
    receivedAt,
  } = useGameConnection<UnoView>({
    gameId,
    playerToken: display ? displayToken : session?.playerToken,
  });
  const [nickname, setNickname] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [invite, setInvite] = useState(false);
  const { send, retry } = useRoomCommand<UnoAction>({
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
          round: s.round,
          revision: s.revision,
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
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  };
  const host = s?.yourRole === "HOST";
  if (!session && !display)
    return (
      <main className="page sheet uno">
        <section className="host-form">
          <Link to="/">← All games</Link>
          <h1>UNO</h1>
          <p>Lobby {gameId} · each player uses their own device</p>
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
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </section>
      </main>
    );
  if (!s)
    return (
      <main className="page sheet uno">
        <section className="host-form">
          <p role="status">
            {lastError ??
              (display && !displayToken
                ? "Open the shared display using the host’s display link."
                : "Reconnecting to your table…")}
          </p>
          <button className="secondary" onClick={() => void requestState()}>
            Retry connection
          </button>
          <Link to="/">All games</Link>
        </section>
      </main>
    );
  return (
    <main className={`uno uno-game ${display ? "uno-display" : ""}`}>
      <header className="uno-header">
        <Link to="/" aria-label="All games">
          ←
        </Link>
        <div>
          <h1>
            UNO <span>GAME NIGHT</span>
          </h1>
          <small>
            ROOM {gameId} ·{" "}
            {s.phase === "LOBBY"
              ? `${s.players.length}/10 players`
              : `Round ${s.round}${s.settings.mode === "rounds" ? `/${s.settings.rounds}` : ""}`}
          </small>
        </div>
        <span
          className={`uno-connection ${wsStatus === "open" ? "connected" : ""}`}
          role="status"
        >
          {wsStatus === "open" ? "● Live" : "↻ Reconnecting"}
        </span>
        {!display && (
          <button className="secondary" onClick={() => setInvite(true)}>
            Invite players
          </button>
        )}
      </header>
      {(error || lastError) && (
        <div className="uno-error" role="alert">
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
        <div className="uno-lobby">
          <section className="uno-panel">
            <p className="eyebrow">Shuffle up & settle in</p>
            <h2>Your table is waiting.</h2>
            <p>
              One phone each. The same game whether you’re across the table or
              across the world.
            </p>
            <ol className="uno-roster">
              {s.players.map((p, i) => (
                <li key={p.playerId}>
                  <span className="uno-avatar">
                    {p.nickname.slice(0, 2).toUpperCase()}
                  </span>
                  <strong>
                    {p.nickname} {p.role === "HOST" ? "♛" : ""}
                  </strong>
                  <small>{p.connected ? "Ready" : "Offline"}</small>
                  {host && (
                    <>
                      <button
                        className="ghost"
                        aria-label={`Move ${p.nickname} earlier`}
                        disabled={busy || i === 0}
                        onClick={() => {
                          const order = [...s.order];
                          [order[i - 1], order[i]] = [order[i], order[i - 1]];
                          void act("reorder", { order });
                        }}
                      >
                        ↑
                      </button>
                      {p.playerId !== s.yourPlayerId && (
                        <button
                          className="ghost"
                          disabled={busy}
                          aria-label={`Remove ${p.nickname}`}
                          onClick={() =>
                            void act("kick", { playerId: p.playerId })
                          }
                        >
                          ×
                        </button>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ol>
            {host ? (
              <button
                className="primary"
                disabled={busy || s.players.length < 2}
                onClick={() => void act("start")}
              >
                Start game
              </button>
            ) : (
              <p className="uno-help">
                The host will start when everyone is ready.
              </p>
            )}
          </section>
          <section className="uno-panel">
            <h2>Make it your game.</h2>
            {host ? (
              <UnoSettings
                settings={s.settings}
                disabled={busy}
                onChange={(settings) => void act("settings", { ...settings })}
              />
            ) : (
              <UnoRulesSummary settings={s.settings} />
            )}
          </section>
        </div>
      ) : (
        <>
          {["ROUND_OVER", "COMPLETED"].includes(s.phase) ? (
            <Results s={s} act={act} busy={busy} receivedAt={receivedAt} />
          ) : (
            <>
              <Table s={s} act={act} busy={busy} />
              {s.phase === "COLOR" && s.turn === s.yourPlayerId && (
                <fieldset className="uno-color-choice">
                  <legend>Opening Wild: choose the starting color</legend>
                  {UNO_COLORS.map((color) => (
                    <button
                      key={color}
                      disabled={busy}
                      style={{ background: UNO_PALETTE[color] }}
                      onClick={() => void act("color", { color })}
                    >
                      {color}
                    </button>
                  ))}
                </fieldset>
              )}
              {s.pending && (
                <div className="uno-penalty" role="status">
                  <strong>+{s.pending.amount} penalty</strong>
                  <span>
                    {s.turn === s.yourPlayerId
                      ? "Draw and miss your turn, or use an allowed stack."
                      : `${s.players.find((p) => p.playerId === s.turn)?.nickname} must respond.`}
                  </span>
                  {s.pending.canChallenge && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void act("challenge")}
                    >
                      Challenge +4
                    </button>
                  )}
                </div>
              )}
              {!display && (
                <Hand
                  key={`${s.generation}-${s.round}`}
                  s={s}
                  act={act}
                  busy={busy}
                />
              )}
              {s.challengeProof && (
                <details className="uno-proof" open>
                  <summary>
                    Your private challenge evidence ·{" "}
                    {s.challengeProof.guilty
                      ? "matching color found"
                      : "no matching color"}
                  </summary>
                  <p>
                    The challenged hand when +4 was played. Active color was{" "}
                    {s.challengeProof.color}. Only you can see this evidence.
                  </p>
                  <div>
                    {s.challengeProof.cards.map((c) => (
                      <UnoCard key={c.id} card={c} />
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </>
      )}
      <footer className="uno-footer">
        <UnoRulesSummary settings={s.settings} />
        {host && (
          <details className="uno-host-controls">
            <summary>Host controls</summary>
            <p>
              Rules stay locked during play. Return to the lobby to change them.
            </p>
            <div className="uno-buttons">
              {s.phase !== "LOBBY" && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (
                      s.phase === "COMPLETED" ||
                      confirm(
                        "Return everyone to the lobby and reset this game’s scores?",
                      )
                    )
                      void act("restart");
                  }}
                >
                  Return to lobby / restart
                </button>
              )}
              {s.phase !== "COMPLETED" && (
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (confirm("End the game for everyone?")) void act("end");
                  }}
                >
                  End game
                </button>
              )}
              {s.displayToken && (
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={`/g/${gameId}/display?token=${encodeURIComponent(s.displayToken)}`}
                >
                  Open shared display ↗
                </a>
              )}
            </div>
            <label className="field">
              <span>Transfer host role</span>
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
        {s.events.length > 0 && (
          <details>
            <summary>Table activity</summary>
            <ol className="uno-activity">
              {s.events.map((e) => (
                <li key={e.id}>{e.message}</li>
              ))}
            </ol>
          </details>
        )}
      </footer>
      {invite && (
        <AddPlayerPanel
          gameCode={gameId}
          joinUrl={`${window.location.origin}/g/${gameId}`}
          onClose={() => setInvite(false)}
          translate={(text) =>
            text === "Share this link or QR to add players mid-game."
              ? "Share this link or QR. New players join before the game starts."
              : text
          }
        />
      )}
    </main>
  );
}
