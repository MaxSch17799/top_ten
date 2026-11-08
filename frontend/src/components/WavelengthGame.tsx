import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  waveScore,
  type WaveAction,
  type WaveView,
} from "../../../shared/wavelength";
import { BACKEND_BASE, joinGame, request } from "../api";
import { useGameConnection } from "../hooks/useGameConnection";
import { loadSessionForGame, saveSession } from "../lib/session";
import type { SessionData } from "../lib/types";
import {
  coopBand,
  useWaveLanguage,
  waveRules,
  type WaveTranslate,
} from "../lib/waveI18n";
import AddPlayerPanel from "./AddPlayerPanel";
import WavelengthDial from "./WavelengthDial";
import WavelengthSettings, { type WaveAct } from "./WavelengthSettings";

function Countdown({
  s,
  receivedAt,
  t,
}: {
  s: WaveView;
  receivedAt: number;
  t: WaveTranslate;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  if (s.paused)
    return (
      <p className="wave-timer" role="status">
        Ⅱ {t("Paused")}
        {s.pausedRemaining !== null
          ? ` · ${Math.ceil(s.pausedRemaining / 1000)} s`
          : ""}
      </p>
    );
  if (!s.deadline)
    return s.timerExpired ? (
      <p className="wave-timer" role="status">
        {t("Time is up")}
      </p>
    ) : null;
  return (
    <p className="wave-timer" role="timer">
      {s.phase === "REVEAL" ? `${t("Next round")} · ` : ""}
      {Math.max(
        0,
        Math.ceil(
          (s.deadline - s.serverNow - Math.max(0, now - receivedAt)) / 1000,
        ),
      )}{" "}
      s
    </p>
  );
}
function Clue({
  s,
  act,
  busy,
  t,
}: {
  s: WaveView;
  act: WaveAct;
  busy: boolean;
  t: WaveTranslate;
}) {
  const key = `wave-clue-${s.gameId}-${s.roundId}-${s.yourPlayerId}`;
  const [text, setText] = useState(() => sessionStorage.getItem(key) ?? "");
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await act("clue", { text })) sessionStorage.removeItem(key);
      }}
    >
      <label className="field">
        <span>{t("Your clue")}</span>
        <input
          className="input"
          maxLength={160}
          required
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            sessionStorage.setItem(key, e.target.value);
          }}
          autoComplete="off"
        />
      </label>
      <button className="primary" disabled={busy || !text.trim()}>
        {t("Give clue")}
      </button>
    </form>
  );
}
function Chat({
  s,
  act,
  busy,
  t,
}: {
  s: WaveView;
  act: WaveAct;
  busy: boolean;
  t: WaveTranslate;
}) {
  const [text, setText] = useState(""),
    log = useRef<HTMLDivElement>(null);
  const silent =
    s.yourPlayerId === s.psychicId &&
    !["REVIEW", "REVEAL", "COMPLETED"].includes(s.phase) &&
    (s.clue !== null || s.roundSettings?.mode === "party");
  const spectator =
    s.players.find((p) => p.playerId === s.yourPlayerId)?.team === null;
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [s.chat.length]);
  return (
    <details className="wave-chat" open>
      <summary>{t("Discussion")}</summary>
      <div ref={log} className="wave-messages" role="log" aria-live="polite">
        {s.chat.map((m) => (
          <p key={m.id}>
            <strong>
              {s.players.find((p) => p.playerId === m.playerId)?.nickname}
            </strong>{" "}
            {m.text}
          </p>
        ))}
      </div>
      {silent ? (
        <p className="footnote">{t("Psychic stays silent until reveal")}</p>
      ) : (
        !spectator && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act("chat", { text })) setText("");
            }}
          >
            <input
              className="input"
              aria-label={t("Message")}
              maxLength={300}
              required
              value={text}
              disabled={busy || s.paused}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              className="secondary"
              disabled={busy || s.paused || !text.trim()}
            >
              {t("Send")}
            </button>
          </form>
        )
      )}
    </details>
  );
}
function ScoreForm({
  s,
  act,
  busy,
  t,
  correction = false,
}: {
  s: WaveView;
  act: WaveAct;
  busy: boolean;
  t: WaveTranslate;
  correction?: boolean;
}) {
  const coop = s.settings.gameMode === "cooperative";
  const proposed = waveScore(s.target ?? 90, s.dial, coop);
  const [points, setPoints] = useState(s.result?.points ?? proposed.points),
    [opponentPoints, setOpponent] = useState(
      s.result?.opponentPoints ??
        (!coop &&
        !proposed.centerHit &&
        s.prediction === ((s.target ?? 90) < s.dial ? "left" : "right")
          ? 1
          : 0),
    );
  const [reason, setReason] = useState("");
  return (
    <form
      className="stack wave-score-form"
      onSubmit={(e) => {
        e.preventDefault();
        void act(correction ? "correct" : "confirm", {
          points,
          opponentPoints,
          reason,
        });
      }}
    >
      <div className="wave-settings-grid">
        <label className="field">
          <span>{t("Points")}</span>
          <select
            className="input"
            aria-label={t("Points")}
            value={points}
            onChange={(e) => setPoints(Number(e.target.value))}
          >
            {(coop ? [0, 2, 3] : [0, 2, 3, 4]).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {!coop && (
          <label className="field">
            <span>{t("Opponent points")}</span>
            <select
              className="input"
              aria-label={t("Opponent points")}
              value={points === 4 ? 0 : opponentPoints}
              disabled={points === 4 || !s.roundSettings?.prediction}
              onChange={(e) => setOpponent(Number(e.target.value))}
            >
              <option value="0">0</option>
              <option value="1">1</option>
            </select>
          </label>
        )}
      </div>
      {correction && (
        <label className="field">
          <span>{t("Reason")}</span>
          <input
            className="input"
            required
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}
      <button className="primary" disabled={busy || s.paused}>
        {t(correction ? "Apply correction" : "Confirm score")}
      </button>
    </form>
  );
}
function Roster({
  s,
  act,
  busy,
  t,
  host,
}: {
  s: WaveView;
  act: WaveAct;
  busy: boolean;
  t: WaveTranslate;
  host: boolean;
}) {
  return (
    <div className="wave-roster">
      <h3>{t("Team setup")}</h3>
      <p className="footnote">
        {t(
          "Competitive needs at least two people per team. Cooperative needs two in total.",
        )}
      </p>
      {s.order.map((id, i) => {
        const p = s.players.find((p) => p.playerId === id)!;
        return (
          <div className="wave-player" key={id}>
            <span>
              <strong>{p.nickname}</strong>
              <small>
                {p.role === "HOST" ? `${t("Host")} · ` : ""}
                {t(p.connected ? "Online" : "Offline")}
              </small>
            </span>
            {host ? (
              <>
                <select
                  className="input"
                  aria-label={`${t("Team setup")} ${p.nickname}`}
                  disabled={busy}
                  value={p.team ?? "spectator"}
                  onChange={(e) =>
                    void act("team", {
                      playerId: id,
                      team:
                        e.target.value === "spectator"
                          ? null
                          : Number(e.target.value),
                    })
                  }
                >
                  <option value="0">
                    {s.settings.gameMode === "cooperative"
                      ? t("Together")
                      : t(s.teams[0])}
                  </option>
                  {s.settings.gameMode !== "cooperative" && (
                    <option value="1">{t(s.teams[1])}</option>
                  )}
                  <option value="spectator">{t("Spectator")}</option>
                </select>
                <button
                  className="ghost"
                  aria-label={`${t("Move up")} ${p.nickname}`}
                  disabled={busy || i === 0}
                  onClick={() => {
                    const order = [...s.order];
                    [order[i - 1], order[i]] = [order[i], order[i - 1]];
                    void act("order", { order });
                  }}
                >
                  ↑
                </button>
              </>
            ) : (
              <small>
                {p.team === null
                  ? t("Spectator")
                  : s.settings.gameMode === "cooperative"
                    ? t("Together")
                    : t(s.teams[p.team])}
              </small>
            )}
          </div>
        );
      })}
      {host && s.phase === "LOBBY" && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void act("randomize")}
        >
          {t("Randomize teams")}
        </button>
      )}
    </div>
  );
}
function Administration({
  s,
  act,
  busy,
  t,
}: {
  s: WaveView;
  act: WaveAct;
  busy: boolean;
  t: WaveTranslate;
}) {
  const [reason, setReason] = useState(""),
    [names, setNames] = useState([...s.teams]);
  return (
    <details className="wave-admin">
      <summary>{t("Host controls")}</summary>
      <div className="stack">
        {s.phase !== "LOBBY" && (
          <WavelengthSettings
            key={JSON.stringify(s.settings)}
            s={s}
            act={act}
            busy={busy}
            t={t}
          />
        )}
        {!["LOBBY", "COMPLETED"].includes(s.phase) && (
          <>
            <div className="wave-buttons">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void act(s.paused ? "resume" : "pause")}
              >
                {t(s.paused ? "Resume" : "Pause")}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void act("reset-timer")}
              >
                {t("Reset timer")}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void act("add-time")}
              >
                {t("+30 seconds")}
              </button>
            </div>
            {["SELECTION", "CLUE", "DIAL"].includes(s.phase) && !s.clue && (
              <button
                className="secondary"
                disabled={busy || s.paused}
                onClick={() => void act("replace")}
              >
                {t("Replace spectrum before clue")}
              </button>
            )}
            {!["REVIEW", "REVEAL"].includes(s.phase) && (
              <label className="field">
                <span>{t("Replace Psychic with fresh target")}</span>
                <select
                  className="input"
                  value=""
                  disabled={busy || s.paused}
                  onChange={(e) => {
                    if (e.target.value)
                      void act("replace-psychic", { playerId: e.target.value });
                  }}
                >
                  <option value="">—</option>
                  {s.players
                    .filter(
                      (p) =>
                        p.team !== null &&
                        (s.settings.gameMode === "cooperative" ||
                          p.team === s.activeTeam) &&
                        p.playerId !== s.psychicId,
                    )
                    .map((p) => (
                      <option key={p.playerId} value={p.playerId}>
                        {p.nickname}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {s.phase === "PREDICTION" && (
              <button
                className="secondary"
                disabled={busy || s.paused}
                onClick={() => void act("reopen")}
              >
                {t("Reopen dial")}
              </button>
            )}
            {s.phase === "DIAL" && (
              <label className="field">
                <span>{t("Assign dial controller")}</span>
                <select
                  className="input"
                  aria-label={t("Assign dial controller")}
                  value={s.controllerId ?? ""}
                  disabled={busy || s.paused}
                  onChange={(e) => {
                    if (e.target.value)
                      void act("controller", { playerId: e.target.value });
                  }}
                >
                  <option value="">—</option>
                  {s.players
                    .filter(
                      (p) =>
                        p.team !== null &&
                        (s.settings.gameMode === "cooperative" ||
                          p.team === s.activeTeam) &&
                        p.playerId !== s.psychicId,
                    )
                    .map((p) => (
                      <option key={p.playerId} value={p.playerId}>
                        {p.nickname}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {s.phase === "PREDICTION" && (
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act("skip-prediction", { reason });
                }}
              >
                <label className="field">
                  <span>{t("Reason")}</span>
                  <input
                    className="input"
                    required
                    maxLength={200}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button className="secondary" disabled={busy || s.paused}>
                  {t("Skip prediction · no bonus")}
                </button>
              </form>
            )}
          </>
        )}
        {s.round > 0 && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void act("void", { reason });
            }}
          >
            <label className="field">
              <span>{t("Reason")}</span>
              <input
                className="input"
                required
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button className="secondary" disabled={busy}>
              {t("Void round / fresh target")}
            </button>
          </form>
        )}
        {s.result && ["REVEAL", "COMPLETED"].includes(s.phase) && (
          <details>
            <summary>{t("Correct latest score")}</summary>
            <ScoreForm
              key={`${s.roundId}-${s.result.points}-${s.result.opponentPoints}`}
              s={s}
              act={act}
              busy={busy}
              t={t}
              correction
            />
          </details>
        )}
        {s.phase === "REVEAL" && (
          <Roster s={s} act={act} busy={busy} t={t} host />
        )}
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void act("teams", { names });
          }}
        >
          <label className="field">
            <span>{t("Team Sun")}</span>
            <input
              className="input"
              value={names[0]}
              required
              maxLength={30}
              onChange={(e) => setNames([e.target.value, names[1]])}
            />
          </label>
          <label className="field">
            <span>{t("Team Moon")}</span>
            <input
              className="input"
              value={names[1]}
              required
              maxLength={30}
              onChange={(e) => setNames([names[0], e.target.value])}
            />
          </label>
          <button className="secondary" disabled={busy}>
            {t("Apply settings")}
          </button>
        </form>
        <label className="field">
          <span>{t("Transfer host")}</span>
          <select
            className="input"
            value=""
            disabled={busy}
            onChange={(e) => {
              if (e.target.value)
                void act("transfer-host", { playerId: e.target.value });
            }}
          >
            <option value="">—</option>
            {s.players
              .filter((p) => p.playerId !== s.yourPlayerId)
              .map((p) => (
                <option key={p.playerId} value={p.playerId}>
                  {p.nickname}
                </option>
              ))}
          </select>
        </label>
        <div className="wave-buttons">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t("Reset scores and return to lobby?")))
                void act("restart");
            }}
          >
            {t("Return to lobby / reset scores")}
          </button>
          {s.phase !== "COMPLETED" && (
            <button
              className="ghost danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t("End this game?"))) void act("end");
              }}
            >
              {t("End game")}
            </button>
          )}
        </div>
        <details>
          <summary>{t("Audit history")}</summary>
          <ol className="wave-audit">
            {s.audit.map((a, i) => (
              <li key={i}>{a.message}</li>
            ))}
          </ol>
        </details>
      </div>
    </details>
  );
}
export default function WavelengthGame({
  gameId: propId,
  display = false,
}: {
  gameId?: string;
  display?: boolean;
}) {
  const params = useParams(),
    gameId = propId ?? params.gameId ?? "",
    { language, setLanguage, t } = useWaveLanguage();
  const [session, setSession] = useState<SessionData | null>(() =>
    display ? null : loadSessionForGame(gameId),
  );
  const [displayToken] = useState(() =>
    display ? window.location.hash.slice(1) : "",
  );
  const {
    state: s,
    wsStatus,
    lastError,
    requestState,
    receivedAt,
  } = useGameConnection<WaveView>({
    gameId,
    playerToken: display ? displayToken : session?.playerToken,
  });
  const [nickname, setNickname] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [invite, setInvite] = useState(false),
    [displayInvite, setDisplayInvite] = useState(false);
  const [peek, setPeek] = useState<string | null>(null),
    [localDial, setLocalDial] = useState<{
      roundId: string;
      epoch: number;
      value: number;
    } | null>(null);
  const stateRef = useRef(s),
    pendingMove = useRef<number | null>(null),
    moving = useRef(false),
    sequence = useRef(0),
    busyRef = useRef(false);
  useEffect(() => {
    if (!stateRef.current || !s || s.version >= stateRef.current.version)
      stateRef.current = s;
    if (s) sequence.current = Math.max(sequence.current, s.dialSequence);
  }, [s]);
  const join = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await joinGame(gameId, nickname);
      const next = {
        gameId,
        playerId: result.playerId,
        playerToken: result.playerToken,
        role: result.role,
      };
      saveSession(next);
      setSession(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry connection");
    } finally {
      setBusy(false);
    }
  };
  const send = async (type: string, payload: Record<string, unknown> = {}) => {
    const current = stateRef.current;
    if (!current || !session) return false;
    const action: WaveAction = {
      id: crypto.randomUUID(),
      type,
      generation: current.generation,
      roundId: current.roundId,
      phase: current.phase,
      revision: current.revision,
      payload,
    };
    try {
      await request(`${BACKEND_BASE}/api/game/${gameId}/action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.playerToken}`,
        },
        body: JSON.stringify(action),
      });
      if (type === "move") return true;
      // Read back authority before another phase-changing action; WebSockets may arrive in either order.
      const fresh = await request<WaveView>(
        `${BACKEND_BASE}/api/game/${gameId}/state`,
        { headers: { Authorization: `Bearer ${session.playerToken}` } },
      );
      if (!stateRef.current || fresh.version >= stateRef.current.version)
        stateRef.current = fresh;
      await requestState();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry connection");
      await requestState();
      return false;
    }
  };
  const act: WaveAct = async (type, payload = {}) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    // A lock carries the final pointer value; delayed movement cannot change a locked phase.
    if (type === "lock") pendingMove.current = null;
    try {
      return await send(type, payload);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const move = (value: number) => {
    const current = stateRef.current;
    if (!current) return;
    setLocalDial({
      roundId: current.roundId,
      epoch: current.controlEpoch,
      value,
    });
    pendingMove.current = value;
    if (moving.current) return;
    moving.current = true;
    const roundId = current.roundId,
      epoch = current.controlEpoch;
    void (async () => {
      try {
        while (pendingMove.current !== null) {
          const v = pendingMove.current;
          pendingMove.current = null;
          const live = stateRef.current;
          if (
            !live ||
            live.roundId !== roundId ||
            live.controlEpoch !== epoch ||
            live.phase !== "DIAL" ||
            busyRef.current
          )
            break;
          await send("move", { value: v, epoch, sequence: ++sequence.current });
          await new Promise((resolve) => window.setTimeout(resolve, 130));
        }
      } finally {
        moving.current = false;
      }
    })();
  };
  const nav = (
    <nav className="wave-top">
      <Link to="/">← {t("All games")}</Link>
      {display ? (
        <span>{t("Public view · no secrets")}</span>
      ) : (
        <select
          aria-label={t("Interface language")}
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          <option value="en">English</option>
          <option value="de">Deutsch</option>
        </select>
      )}
    </nav>
  );
  if (!session && !display)
    return (
      <main className="page sheet wavelength">
        <section className="host-form">
          {nav}
          <p className="eyebrow">Wavelength · {gameId}</p>
          <h1>{t("Join Wavelength")}</h1>
          <form className="stack" onSubmit={join}>
            <label className="field">
              <span>{t("Your nickname")}</span>
              <input
                className="input"
                maxLength={20}
                required
                value={nickname}
                autoComplete="nickname"
                onChange={(e) => setNickname(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              {t("Join lobby")}
            </button>
            {error && (
              <p className="error" role="alert">
                {t(error)}
              </p>
            )}
          </form>
        </section>
      </main>
    );
  if (!s)
    return (
      <main className="page sheet wavelength">
        <section className="host-form">
          {nav}
          <p role="status">
            {t(
              display && !displayToken
                ? "Shared display link is missing."
                : (lastError ?? "Connecting…"),
            )}
          </p>
          <button className="secondary" onClick={() => void requestState()}>
            {t("Retry connection")}
          </button>
        </section>
      </main>
    );
  const host = s.yourRole === "HOST",
    psychic = s.yourPlayerId === s.psychicId,
    coop = s.settings.gameMode === "cooperative";
  const current = s.players.find((p) => p.playerId === s.yourPlayerId),
    teammate =
      current?.team !== null &&
      !!current &&
      (coop || current.team === s.activeTeam);
  const canDial = s.phase === "DIAL" && teammate && !psychic && !display,
    driving = canDial && s.controllerId === s.yourPlayerId;
  const canPredict =
    s.phase === "PREDICTION" &&
    !!current &&
    current.team === 1 - s.activeTeam &&
    !psychic &&
    !display;
  const revealed = ["REVIEW", "REVEAL", "COMPLETED"].includes(s.phase),
    settings = s.roundSettings ?? s.settings,
    compact = s.settings.compact;
  const dial =
    driving &&
    localDial?.roundId === s.roundId &&
    localDial.epoch === s.controlEpoch
      ? localDial.value
      : s.dial;
  const name = (id: string | null) =>
    s.players.find((p) => p.playerId === id)?.nickname ?? "—";
  const target =
    revealed || (psychic && peek === s.roundId) ? s.target : undefined;
  const joinUrl = `${(import.meta.env.VITE_FRONTEND_URL || window.location.origin).replace(/\/$/, "")}/g/${gameId}`;
  const displayUrl = `${joinUrl}/display#${s.displayToken ?? ""}`;
  const titles = {
    LOBBY: "Gather your minds",
    SELECTION: "Choose your spectrum",
    CLUE: "One thought. One clue.",
    DIAL: "Find your wavelength",
    PREDICTION: "Which side is the center?",
    REVIEW: "Check the score",
    REVEAL: "The moment of truth",
    COMPLETED: "On the same wavelength",
  };
  const sufficient = coop
    ? s.players.filter((p) => p.team !== null).length >= 2
    : [0, 1].every(
        (team) => s.players.filter((p) => p.team === team).length >= 2,
      );
  return (
    <main
      className={`page sheet wavelength ${display ? "wave-display" : ""} ${compact ? "wave-compact" : ""}`}
    >
      <section className="game-view wave-game">
        {nav}
        <header className="wave-header">
          <div>
            <p className="eyebrow">Wavelength · {gameId}</p>
            <h1>{t(titles[s.phase])}</h1>
          </div>
          {!display && (
            <button className="ghost" onClick={() => setInvite(true)}>
              {t("Invite players")}
            </button>
          )}
          {display && (
            <button
              className="ghost"
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen();
                else void document.documentElement.requestFullscreen();
              }}
            >
              {t("Fullscreen")}
            </button>
          )}
        </header>
        <div className="wave-scoreboard" aria-label={t("Points")}>
          <div className={s.activeTeam === 0 ? "wave-active-team" : ""}>
            <span>{coop ? t("Together") : t(s.teams[0])}</span>
            <strong data-testid="wave-score-0">{s.scores[0]}</strong>
          </div>
          {!coop && (
            <div className={s.activeTeam === 1 ? "wave-active-team" : ""}>
              <span>{t(s.teams[1])}</span>
              <strong data-testid="wave-score-1">{s.scores[1]}</strong>
            </div>
          )}
          <div>
            <span>{t(coop ? "Remaining rounds" : "Round")}</span>
            <strong>{coop ? s.remaining : s.round}</strong>
          </div>
        </div>
        {wsStatus !== "open" && (
          <p className="footnote" role="status">
            {t("Reconnecting… updates resume automatically.")}
          </p>
        )}
        {(error || lastError) && (
          <p className="error" role="alert">
            {t(error || lastError || "")}
          </p>
        )}
        {s.notice && (
          <p className="wave-notice" role="status">
            {t(s.notice)}
          </p>
        )}
        <Countdown s={s} receivedAt={receivedAt} t={t} />
        {s.phase === "LOBBY" ? (
          <div className="card wave-lobby">
            <Roster s={s} act={act} busy={busy} t={t} host={host} />
            {s.packs.find((p) => p.packId === s.settings.packId)
              ?.development && (
              <p className="footnote wave-starter">
                {t(
                  "Starter content · 12 spectrums per language. Full 200-pair packs have not been supplied.",
                )}
              </p>
            )}
            {host && (
              <details open className="wave-lobby-settings">
                <summary>{t("Game settings")}</summary>
                <WavelengthSettings
                  key={JSON.stringify(s.settings)}
                  s={s}
                  act={act}
                  busy={busy}
                  t={t}
                />
              </details>
            )}
            {host ? (
              <button
                className="primary"
                disabled={busy || !sufficient}
                onClick={() => void act("start")}
              >
                {t("Start game")}
              </button>
            ) : (
              <p className="footnote">{t("Waiting for the host")}</p>
            )}
          </div>
        ) : (
          <>
            <div className="wave-roles">
              <span>
                {t("Psychic")} <strong>{name(s.psychicId)}</strong>
              </span>
              {s.controllerId && (
                <span>
                  {t("Dial controller")} <strong>{name(s.controllerId)}</strong>
                </span>
              )}
            </div>
            {current?.team === null && (
              <p className="footnote">
                {t("You are watching. The host can add you between rounds.")}
              </p>
            )}
            {s.phase === "SELECTION" && (
              <div className="wave-choices">
                {psychic && s.candidates ? (
                  s.candidates.map((pair, index) => (
                    <button
                      className="secondary"
                      key={pair.id}
                      disabled={busy || s.paused}
                      onClick={() => void act("choose", { index })}
                    >
                      {pair.left} ↔ {pair.right}
                    </button>
                  ))
                ) : (
                  <p>{t("The Psychic is preparing a clue.")}</p>
                )}
              </div>
            )}
            {s.spectrum && (
              <div className="wave-instrument" data-testid="wave-instrument">
                <div className="wave-endpoints">
                  <h2>{s.spectrum.left}</h2>
                  <span aria-hidden="true">↔</span>
                  <h2>{s.spectrum.right}</h2>
                </div>
                {psychic && !revealed && !display && (
                  <aside className="wave-private" data-testid="wave-private">
                    <p className="eyebrow">
                      {t("Private · only you can see this target")}
                    </p>
                    <button
                      className="secondary"
                      onClick={() =>
                        setPeek(peek === s.roundId ? null : s.roundId)
                      }
                    >
                      {t(peek === s.roundId ? "Hide target" : "Peek at target")}
                    </button>
                  </aside>
                )}
                <WavelengthDial
                  value={dial}
                  target={target}
                  enabled={driving && !busy && !s.paused}
                  onMove={move}
                  cooperative={coop}
                  reveal={revealed}
                  t={t}
                />
                {s.clue && (
                  <blockquote className="wave-clue" data-testid="wave-clue">
                    “{s.clue}”
                  </blockquote>
                )}
                {!revealed &&
                  s.phase !== "CLUE" &&
                  settings.mode === "party" && (
                    <p className="wave-prompt">
                      {t(
                        psychic
                          ? "Give one clue aloud. Your team can move the dial immediately. Then stay silent until reveal."
                          : "Say your clue aloud. Discuss, move the dial, then lock it.",
                      )}
                    </p>
                  )}
                {s.phase === "CLUE" &&
                  (psychic ? (
                    <Clue
                      key={s.roundId}
                      s={s}
                      act={act}
                      busy={busy || s.paused}
                      t={t}
                    />
                  ) : (
                    <p>{t("The Psychic is preparing a clue.")}</p>
                  ))}
                {canDial &&
                  (driving ? (
                    <button
                      className="primary wave-lock"
                      disabled={busy || s.paused}
                      onClick={() =>
                        void act("lock", { value: dial, epoch: s.controlEpoch })
                      }
                    >
                      {t("Lock dial")}
                    </button>
                  ) : (
                    <button
                      className="secondary wave-lock"
                      disabled={busy || s.paused}
                      onClick={() => void act("claim")}
                    >
                      {t("Take the dial")}
                    </button>
                  ))}
                {s.phase === "PREDICTION" && (
                  <div className="wave-prediction">
                    <p>
                      {t(
                        canPredict || display
                          ? "Opposing team: is the target center left or right of the needle?"
                          : "The opposing team is choosing left or right.",
                      )}
                    </p>
                    <p className="eyebrow">{t("Dial locked")}</p>
                    {canPredict && (
                      <div className="wave-buttons">
                        {(["left", "right"] as const).map((side) => (
                          <button
                            className="primary"
                            key={side}
                            disabled={busy || s.paused}
                            onClick={() => void act("predict", { side })}
                          >
                            {side === "left" ? "← " : ""}
                            {t(side.toUpperCase())}
                            {side === "right" ? " →" : ""}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {psychic && !revealed && !compact && (
              <p className="footnote">
                {t(
                  "One existing thing, on topic. No endpoint synonyms or numeric codes. Aim for five words or fewer, without qualifiers.",
                )}
              </p>
            )}
            {s.phase === "REVIEW" &&
              (host ? (
                <ScoreForm key={s.roundId} s={s} act={act} busy={busy} t={t} />
              ) : (
                <p className="role-banner">{t("Waiting for the host")}</p>
              ))}
            {s.result && (
              <div
                className="wave-result"
                role="status"
                data-testid="wave-result"
              >
                <div className="wave-points">
                  +{s.result.points}
                  <span>{t("Points")}</span>
                </div>
                {!coop && (
                  <p>
                    {t("Opponent points")}:{" "}
                    <strong>+{s.result.opponentPoints}</strong>
                    {s.result.prediction &&
                      ` · ${t(s.result.prediction.toUpperCase())}`}
                  </p>
                )}
                {coop && s.result.centerHit && s.settings.coopBonus && (
                  <p>{t("Center hit · extra round!")}</p>
                )}
                {s.catchUpTurn && (
                  <p className="role-banner">
                    {t("Catch-up! Same team, new Psychic.")}
                  </p>
                )}
                {s.tiebreak && s.winner === null && (
                  <p className="role-banner">
                    {t(
                      "Sudden death · both teams get a turn before comparison.",
                    )}{" "}
                    ({s.tiebreak.pair} · {s.tiebreak.remaining}/2)
                  </p>
                )}
                {s.winner !== null && (
                  <h2>
                    {coop
                      ? t(coopBand(s.scores[0]))
                      : `${t("Winner")}: ${t(s.teams[s.winner])}`}
                  </h2>
                )}
                {s.phase === "REVEAL" && !display && (host || teammate) && (
                  <button
                    className="primary"
                    disabled={busy || s.paused}
                    onClick={() => void act("next")}
                  >
                    {t(s.winner !== null ? "Show final result" : "Next round")}
                  </button>
                )}
              </div>
            )}
            {s.phase === "COMPLETED" && !s.result && (
              <h2>
                {t("Final score")}: {s.scores.join(" · ")}
              </h2>
            )}
            {settings.mode === "written" && !display && (
              <Chat s={s} act={act} busy={busy} t={t} />
            )}
            {!compact && !display && s.history.length > 0 && (
              <details className="wave-history">
                <summary>{t("Recent rounds")}</summary>
                <ol>
                  {[...s.history].reverse().map((r, i) => (
                    <li key={`${r.roundId}-${i}`}>
                      <strong>
                        {r.round} · {t(s.teams[r.team])} ·{" "}
                        {r.void
                          ? t("Void")
                          : `+${r.points} / +${r.opponentPoints}`}
                      </strong>
                      <span>
                        {r.spectrum.left} ↔ {r.spectrum.right}
                      </span>
                      {r.reason && <small>{r.reason}</small>}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </>
        )}
        {!display && host && s.displayToken && (
          <div className="wave-display-link">
            <a href={displayUrl} target="_blank" rel="noreferrer">
              ▣ {t("Shared display")} ↗
            </a>
            <button
              className="ghost"
              aria-label={`${t("Shared display")} QR`}
              onClick={() => setDisplayInvite(true)}
            >
              QR
            </button>
          </div>
        )}
        {host && (
          <Administration
            key={s.generation}
            s={s}
            act={act}
            busy={busy}
            t={t}
          />
        )}
        {!display &&
          !host &&
          current?.team !== null &&
          s.players.some((p) => p.role === "HOST" && !p.connected) && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void act("claim-host")}
            >
              {t("Recover host after 60 seconds offline")}
            </button>
          )}
        {!display && (
          <details className="wave-rules">
            <summary>{t("How to play")}</summary>
            <p>{waveRules[language === "de" ? "de" : "en"]}</p>
            <p>
              {t(
                "One existing thing, on topic. No endpoint synonyms or numeric codes. Aim for five words or fewer, without qualifiers.",
              )}
            </p>
            <a
              href="https://gamers-hq.de/media/pdf/87/83/b1/Wavelength_rules.pdf"
              target="_blank"
              rel="noreferrer"
            >
              {t("Physical game rulebook")} ↗
            </a>
          </details>
        )}
        {invite && (
          <AddPlayerPanel
            joinUrl={joinUrl}
            gameCode={gameId}
            onClose={() => setInvite(false)}
            translate={t}
          />
        )}
        {displayInvite && (
          <AddPlayerPanel
            joinUrl={displayUrl}
            gameCode={gameId}
            onClose={() => setDisplayInvite(false)}
            translate={t}
          />
        )}
      </section>
    </main>
  );
}
