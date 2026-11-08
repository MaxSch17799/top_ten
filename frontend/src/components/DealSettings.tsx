import { useState } from "react";
import {
  CLASSIC_DEAL_RULES,
  DEAL_PROFILES,
  DEAL_RULE_INFO,
  checkedDealSettings,
  type DealProfile,
  type DealSettings as Settings,
} from "../../../shared/monopolyDeal";
import { loadDealProfiles, saveDealProfiles } from "../lib/dealProfiles";

export function DealRulesSummary({ settings }: { settings: Settings }) {
  const changes = DEAL_RULE_INFO.filter(
    (i) => settings.rules[i.key] !== CLASSIC_DEAL_RULES[i.key],
  );
  return (
    <div className="deal-rules-summary">
      <strong>{settings.profileName}</strong>
      <p>
        {settings.rules.setsToWin} different colors to win ·{" "}
        {settings.rules.playsPerTurn} plays · draw {settings.rules.drawPerTurn}{" "}
        · hand limit {settings.rules.handLimit}
      </p>
      {changes.length > 0 && (
        <p className="deal-gold">
          {changes
            .map(
              (i) =>
                `${i.label}: ${String(settings.rules[i.key]) === "true" ? "on" : String(settings.rules[i.key]) === "false" ? "off" : settings.rules[i.key]}`,
            )
            .join(" · ")}
        </p>
      )}
      <small>
        {settings.mode === "single"
          ? "Single game"
          : settings.mode === "bestOf"
            ? `Up to ${settings.games} games; ${Math.ceil(settings.games / 2)} wins ends early, otherwise most wins (ties shared)`
            : `${settings.games} games; most wins takes the match (ties shared)`}
        . Classic uses Hasbro’s FAQ: all No responses are free. The 2024 edition
        charges a play on your own turn.
      </small>
    </div>
  );
}
export default function DealSettings({
  value,
  onApply,
  busy,
}: {
  value: Settings;
  onApply: (s: Settings) => Promise<boolean>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(value),
    [profiles, setProfiles] = useState(loadDealProfiles),
    [profileName, setProfileName] = useState(""),
    [error, setError] = useState("");
  const all = [...DEAL_PROFILES, ...profiles],
    chosen = profiles.find((p) => p.id === draft.profileId);
  const editRules = (key: keyof Settings["rules"], v: boolean | number) =>
    setDraft({
      ...draft,
      profileId: chosen?.id ?? "custom",
      profileName: chosen?.name ?? "Custom Deal",
      rules: { ...draft.rules, [key]: v },
    });
  const persist = (next: DealProfile[]) => {
    try {
      saveDealProfiles(next);
      setProfiles(next);
      setError("");
    } catch {
      setError(
        "Browser storage is unavailable. Rules can still be applied to this lobby.",
      );
    }
  };
  const store = (duplicate = false) => {
    const name =
      profileName.trim() ||
      (duplicate ? `${draft.profileName} copy` : draft.profileName);
    const id =
      !duplicate && chosen ? chosen.id : `custom-${crypto.randomUUID()}`;
    if (profiles.length >= 30 && !profiles.some((p) => p.id === id)) {
      setError("You have 30 saved profiles. Delete one before saving another.");
      return;
    }
    try {
      const valid = checkedDealSettings({
        ...draft,
        profileId: id,
        profileName: name,
      });
      const p: DealProfile = {
        id,
        name,
        description: "Saved on this browser",
        rules: valid.rules,
      };
      persist([...profiles.filter((v) => v.id !== id), p]);
      setDraft(valid);
      setProfileName("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="deal-settings">
      <h2>Make it your table</h2>
      <label className="field">
        <span>Rules profile</span>
        <select
          className="input"
          value={
            all.some((p) => p.id === draft.profileId)
              ? draft.profileId
              : "custom"
          }
          onChange={(e) => {
            const p = all.find((v) => v.id === e.target.value);
            if (p)
              setDraft({
                ...draft,
                profileId: p.id,
                profileName: p.name,
                rules: { ...p.rules },
              });
          }}
        >
          {all.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="custom" disabled>
            Unsaved custom rules
          </option>
        </select>
      </label>
      <p className="deal-help">
        {all.find((p) => p.id === draft.profileId)?.description ??
          "Your own configuration."}
      </p>
      <details>
        <summary>Advanced rules & saved profiles</summary>
        <p className="deal-help">
          Changes from Classic are shown to everyone. Rules lock when the game
          starts.
        </p>
        <div className="deal-settings-grid">
          {DEAL_RULE_INFO.map((info) => (
            <label key={info.key} className="deal-rule">
              <span>
                <strong>{info.label}</strong>
                <small id={`deal-rule-${info.key}`}>{info.text}</small>
              </span>
              {typeof draft.rules[info.key] === "boolean" ? (
                <input
                  aria-label={info.label}
                  aria-describedby={`deal-rule-${info.key}`}
                  type="checkbox"
                  checked={draft.rules[info.key] as boolean}
                  onChange={(e) => editRules(info.key, e.target.checked)}
                />
              ) : (
                <input
                  aria-label={info.label}
                  aria-describedby={`deal-rule-${info.key}`}
                  className="input"
                  type="number"
                  min={info.min}
                  max={info.max}
                  value={draft.rules[info.key] as number}
                  onChange={(e) => editRules(info.key, Number(e.target.value))}
                />
              )}
            </label>
          ))}
        </div>
        <label className="field">
          <span>Saved profile name</span>
          <input
            className="input"
            maxLength={40}
            value={profileName}
            placeholder={draft.profileName}
            onChange={(e) => setProfileName(e.target.value)}
          />
        </label>
        <div className="deal-buttons">
          <button className="secondary" onClick={() => store()}>
            Save profile
          </button>
          <button className="secondary" onClick={() => store(true)}>
            Duplicate
          </button>
          {chosen && (
            <>
              <button
                className="secondary"
                onClick={() => {
                  const name = profileName.trim();
                  if (!name) {
                    setError("Enter the new name first.");
                    return;
                  }
                  persist(
                    profiles.map((p) =>
                      p.id === chosen.id ? { ...p, name } : p,
                    ),
                  );
                  setDraft({ ...draft, profileName: name });
                  setProfileName("");
                }}
              >
                Rename
              </button>
              <button
                className="secondary"
                onClick={() => {
                  persist(profiles.filter((p) => p.id !== chosen.id));
                  setDraft({
                    ...draft,
                    profileId: "custom",
                    profileName: "Custom Deal",
                  });
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
        <small>
          Profiles stay on this browser. Select a saved profile, edit its rules,
          then save under the same name to update it.
        </small>
      </details>
      <div className="deal-settings-grid">
        <label className="field">
          <span>Match length</span>
          <select
            className="input"
            value={draft.mode}
            onChange={(e) =>
              setDraft({
                ...draft,
                mode: e.target.value as Settings["mode"],
                games: 3,
              })
            }
          >
            <option value="single">Single game</option>
            <option value="bestOf">Best of 3 / 5</option>
            <option value="games">Fixed number of games</option>
          </select>
        </label>
        {draft.mode !== "single" && (
          <label className="field">
            <span>Number of games</span>
            {draft.mode === "bestOf" ? (
              <select
                className="input"
                value={draft.games}
                onChange={(e) =>
                  setDraft({ ...draft, games: Number(e.target.value) })
                }
              >
                <option value={3}>3</option>
                <option value={5}>5</option>
              </select>
            ) : (
              <input
                className="input"
                type="number"
                min={1}
                max={15}
                value={draft.games}
                onChange={(e) =>
                  setDraft({ ...draft, games: Number(e.target.value) })
                }
              />
            )}
          </label>
        )}
      </div>
      <p className="deal-help">
        One point per game won. Starting player rotates every game. Best-of
        matches end early at a majority; after the game limit, most wins takes
        the match and ties are shared.
      </p>
      <button
        className="primary"
        disabled={busy}
        onClick={async () => {
          try {
            const valid = checkedDealSettings(draft);
            if (await onApply(valid)) setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Apply settings
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
