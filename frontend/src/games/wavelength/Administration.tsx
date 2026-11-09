import { useState } from "react";
import { type WaveView } from "../../../../shared/wavelength";
import { type WaveTranslate } from "../../lib/waveI18n";
import WavelengthSettings, { type WaveAct } from "../../components/WavelengthSettings";
import { ScoreForm } from "./Forms";
import { Roster } from "./Roster";

export function Administration({
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
