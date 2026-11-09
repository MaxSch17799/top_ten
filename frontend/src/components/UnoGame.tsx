import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { Link } from "react-router-dom";
import {
  UNO_COLORS,
  isUnoNumber,
  sameUnoCard,
  unoCardLabel,
  type UnoAction,
  type UnoView,
} from "../../../shared/uno";
import { ApiError, BACKEND_BASE, joinGame, request } from "../api";
import { useGameConnection } from "../hooks/useGameConnection";
import { loadSessionForGame, saveSession } from "../lib/session";
import type { SessionData } from "../lib/types";
import AddPlayerPanel from "./AddPlayerPanel";
import UnoCard from "./UnoCard";
import { UNO_PALETTE } from "../lib/unoTheme";
import UnoSettings, { UnoRulesSummary } from "./UnoSettings";

type Act = (
  type: string,
  payload?: Record<string, unknown>,
) => Promise<boolean>;
function Player({
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
function Table({ s, act, busy }: { s: UnoView; act: Act; busy: boolean }) {
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
function Hand({ s, act, busy }: { s: UnoView; act: Act; busy: boolean }) {
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
function Results({
  s,
  act,
  busy,
  receivedAt,
}: {
  s: UnoView;
  act: Act;
  busy: boolean;
  receivedAt: number;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const result = s.result,
    done = s.phase === "COMPLETED";
  return (
    <section className="uno-results" aria-live="polite">
      <p className="eyebrow">
        {done ? "Final standings" : `Round ${s.round} complete`}
      </p>
      <h2>
        {done
          ? s.winners.length
            ? `${s.winners.map((id) => s.players.find((p) => p.playerId === id)?.nickname).join(" & ")} ${s.winners.length > 1 ? "win" : "wins"}!`
            : "Game ended"
          : result?.winner
            ? `${s.players.find((p) => p.playerId === result.winner)?.nickname} wins the round!`
            : "Round drawn"}
      </h2>
      {result?.winner && <p>+{result.points} points this round</p>}
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Points</th>
            <th>Rounds won</th>
            <th>Hand points</th>
          </tr>
        </thead>
        <tbody>
          {[...s.players]
            .sort((a, b) => b.score - a.score)
            .map((p) => (
              <tr key={p.playerId}>
                <th>{p.nickname}</th>
                <td>{p.score}</td>
                <td>{p.wins}</td>
                <td>{result?.remaining[p.playerId] ?? "—"}</td>
              </tr>
            ))}
        </tbody>
      </table>
      {!done && (
        <>
          <p>
            Next round in{" "}
            {Math.max(
              0,
              Math.ceil(
                ((s.nextRoundAt ?? 0) -
                  s.serverNow -
                  Math.max(0, now - receivedAt)) /
                  1000,
              ),
            )}
            s
          </p>
          {s.yourRole !== "DISPLAY" && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void act("next")}
            >
              Next round now
            </button>
          )}
        </>
      )}
      {s.history.length > 1 && (
        <details>
          <summary>Round history</summary>
          {s.history.map((r) => (
            <p key={r.round}>
              Round {r.round}:{" "}
              {s.players.find((p) => p.playerId === r.winner)?.nickname ??
                "Draw"}{" "}
              · {r.points} points
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
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
    [invite, setInvite] = useState(false),
    [retry, setRetry] = useState<UnoAction | null>(null);
  const lock = useRef(false);
  const send = async (action: UnoAction) => {
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
      if (!(e instanceof ApiError) || e.retryable) setRetry(action);
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
