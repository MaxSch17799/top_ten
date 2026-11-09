import { useRoomCommand } from "../hooks/useRoomCommand";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { type WaveAction, type WaveView } from "../../../shared/wavelength";
import { BACKEND_BASE, joinGame, request } from "../api";
import { useGameConnection } from "../hooks/useGameConnection";
import { loadSessionForGame, saveSession } from "../lib/session";
import type { SessionData } from "../lib/types";
import { coopBand, useWaveLanguage, waveRules } from "../lib/waveI18n";
import AddPlayerPanel from "./AddPlayerPanel";
import WavelengthDial from "./WavelengthDial";
import WavelengthSettings, { type WaveAct } from "./WavelengthSettings";
import { Countdown, Clue, Chat, ScoreForm } from "../games/wavelength/Forms";
import { Roster } from "../games/wavelength/Roster";
import { Administration } from "../games/wavelength/Administration";

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
  const makeAction = (type: string, payload: Record<string, unknown> = {}): WaveAction | null => {
    const current = stateRef.current;
    return current ? { id: crypto.randomUUID(), type, generation: current.generation, roundId: current.roundId,
      phase: current.phase, revision: current.revision, payload } : null;
  };
  const { send: submit, retry } = useRoomCommand<WaveAction>({
    gameId, token: display ? undefined : session?.playerToken, refresh: requestState, setBusy, setError,
    afterCommit: async () => {
      // Explicit authoritative readback: requestState itself swallows read errors.
      const fresh = await request<WaveView>(`${BACKEND_BASE}/api/game/${gameId}/state`, {
        headers: { Authorization: `Bearer ${session!.playerToken}` },
      });
      if (!stateRef.current || fresh.version >= stateRef.current.version) stateRef.current = fresh;
    },
  });
  // Dial movement is coalesced below and carries its own epoch/sequence ordering.
  const send = async (type: string, payload: Record<string, unknown>) => {
    const action = makeAction(type, payload);
    if (!action || !session || display) return false;
    try {
      await request(`${BACKEND_BASE}/api/game/${gameId}/action`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.playerToken}` },
        body: JSON.stringify(action), signal: AbortSignal.timeout(12_000),
      });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retry connection');
      await requestState(); return false;
    }
  };
  const sendDecision = async (action: WaveAction) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    if (action.type === 'lock') pendingMove.current = null;
    try { return await submit(action); }
    finally { busyRef.current = false; }
  };
  const act: WaveAct = async (type, payload = {}) => {
    const action = makeAction(type, payload);
    return action ? sendDecision(action) : false;
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
            {t(error || lastError || "")}{retry && <button className="secondary" disabled={busy} onClick={() => void sendDecision(retry)}>{t('Retry same action safely')}</button>}
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
