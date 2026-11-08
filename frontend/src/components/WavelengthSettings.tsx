import { useState } from "react";
import type { WaveSettings, WaveView } from "../../../shared/wavelength";
import type { WaveTranslate } from "../lib/waveI18n";
export type WaveAct = (
  type: string,
  payload?: Record<string, unknown>,
) => Promise<boolean>;
export default function WavelengthSettings({
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
  const [draft, set] = useState<WaveSettings>({ ...s.settings });
  const change = <K extends keyof WaveSettings>(
    key: K,
    value: WaveSettings[K],
  ) => set((old) => ({ ...old, [key]: value }));
  const select = (
    label: string,
    key: "mode" | "gameMode" | "selection",
    options: [string, string][],
    disabled = false,
  ) => (
    <label className="field">
      <span>{t(label)}</span>
      <select
        className="input"
        aria-label={t(label)}
        value={draft[key]}
        disabled={busy || disabled}
        onChange={(e) => change(key, e.target.value as never)}
      >
        {options.map(([value, label]) => (
          <option key={value} value={value}>
            {t(label)}
          </option>
        ))}
      </select>
    </label>
  );
  const toggle = (label: string, key: keyof WaveSettings, disabled = false) => (
    <label className="wave-check">
      <input
        type="checkbox"
        checked={!!draft[key]}
        disabled={busy || disabled}
        onChange={(e) => change(key, e.target.checked as never)}
      />
      {t(label)}
    </label>
  );
  const number = (
    label: string,
    key: keyof WaveSettings,
    max: number,
    disabled = false,
  ) => (
    <label className="field">
      <span>{t(label)}</span>
      <input
        className="input"
        type="number"
        min="0"
        max={max}
        required
        value={Number(draft[key])}
        disabled={busy || disabled}
        onChange={(e) => change(key, Number(e.target.value) as never)}
      />
    </label>
  );
  const locked = s.phase !== "LOBBY";
  return (
    <form
      className="stack wave-settings"
      onSubmit={(e) => {
        e.preventDefault();
        void act("settings", { ...draft });
      }}
    >
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={async () => {
          const next = {
            ...s.settings,
            mode: "party" as const,
            compact: true,
            automaticScoring: false,
            clueSeconds: 0,
            dialSeconds: 0,
            predictionSeconds: 0,
            autoNextSeconds: 0,
            autoExpiry: false,
          };
          if (await act("settings", next)) set(next);
        }}
      >
        {t("Minimal verbal preset")}
      </button>
      <p className="footnote">
        {t("No typing, no timers, no auto-next. Host confirms the score.")}
      </p>
      <div className="wave-settings-grid">
        {select("Interaction mode", "mode", [
          ["party", "Party · verbal clues"],
          ["written", "Remote · written clues"],
        ])}
        {select(
          "Game format",
          "gameMode",
          [
            ["competitive", "Competitive · two teams"],
            ["cooperative", "Cooperative · one team"],
          ],
          locked,
        )}
        <label className="field">
          <span>{t("Spectrum pack")}</span>
          <select
            className="input"
            value={draft.packId}
            disabled={busy}
            onChange={(e) => change("packId", e.target.value)}
          >
            {s.packs.map((p) => (
              <option key={p.packId} value={p.packId}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        {select("Spectrum selection", "selection", [
          ["auto", "Automatic · fast party default"],
          ["two", "Psychic chooses one of two"],
        ])}
      </div>
      {toggle("Compact layout", "compact")}
      {toggle("Automatic scoring", "automaticScoring")}
      <details>
        <summary>{t("Timers · 0 disables")}</summary>
        <div className="wave-settings-grid">
          {number("Clue preparation (seconds)", "clueSeconds", 3600)}
          {number("Team discussion (seconds)", "dialSeconds", 3600)}
          {number("Prediction (seconds)", "predictionSeconds", 3600)}
          {number(
            "Auto-next delay (0 or 5–120 seconds)",
            "autoNextSeconds",
            120,
          )}
        </div>
        {toggle("Automatic expiry actions", "autoExpiry")}
        <p className="footnote">
          {t(
            "Timer expiry usually warns. Automatic expiry locks the current dial or skips a missing prediction without a bonus. It never invents a clue.",
          )}
        </p>
      </details>
      <details>
        <summary>
          {t("House rules · defaults follow the physical game")}
        </summary>
        <div className="stack">
          {draft.gameMode === "competitive" ? (
            <>
              {number("Target score", "targetScore", 200, locked)}
              {number(
                "Fixed total rounds (0 = target score)",
                "fixedRounds",
                200,
                locked,
              )}
              {toggle(
                "Second team starts with 1 point",
                "startingBonus",
                locked,
              )}
              {toggle("Catch-up turns", "catchUp", locked)}
              {toggle("Left/right bonus point", "prediction", locked)}
            </>
          ) : (
            <>
              {number("Cooperative starting rounds", "coopRounds", 200, locked)}
              {toggle("Center earns a bonus round", "coopBonus", locked)}
            </>
          )}
        </div>
      </details>
      <button className="secondary" disabled={busy}>
        {t("Apply settings")}
      </button>
      {locked && (
        <p className="footnote">
          {t(
            "Changes to mode and content apply next round; timers change immediately.",
          )}
        </p>
      )}
    </form>
  );
}
