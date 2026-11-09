import { type WaveView } from "../../../../shared/wavelength";
import { type WaveTranslate } from "../../lib/waveI18n";
import { type WaveAct } from "../../components/WavelengthSettings";

export function Roster({
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
