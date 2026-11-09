import { useEffect, useRef, useState } from "react";
import { waveScore, type WaveView } from "../../../../shared/wavelength";
import { type WaveTranslate } from "../../lib/waveI18n";
import { type WaveAct } from "../../components/WavelengthSettings";

export function Countdown({
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
export function Clue({
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
export function Chat({
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
export function ScoreForm({
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
