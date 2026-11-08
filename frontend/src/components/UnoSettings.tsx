import { useState } from "react";
import {
  UNO_PROFILES,
  UNO_RULE_INFO,
  type UnoProfile,
  type UnoSettings as Settings,
} from "../../../shared/uno";
import { readUnoProfiles, writeUnoProfiles } from "../lib/unoProfiles";

export default function UnoSettings({
  settings: authoritative,
  onChange: commit,
  disabled = false,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  disabled?: boolean;
}) {
  const [optimistic, setOptimistic] = useState<{
    base: string;
    value: Settings;
  } | null>(null);
  const signature = JSON.stringify(authoritative);
  // Reflect the click immediately while the server validates it. A failed
  // request releases disabled and restores authoritative settings automatically.
  const settings =
    disabled && optimistic?.base === signature
      ? optimistic.value
      : authoritative;
  const onChange = (next: Settings) => {
    setOptimistic({ base: signature, value: next });
    commit(next);
  };
  const [custom, setCustom] = useState(readUnoProfiles),
    [selected, setSelected] = useState(settings.profileId);
  const [name, setName] = useState(
      settings.profileId.startsWith("custom-") ? settings.profileName : "",
    ),
    [message, setMessage] = useState("");
  const profiles = [...UNO_PROFILES, ...custom],
    current = profiles.find((p) => p.id === selected);
  const updateProfiles = (next: UnoProfile[]) => {
    try {
      writeUnoProfiles(next);
      setCustom(next);
      setMessage("Profile saved on this browser.");
      return true;
    } catch {
      setMessage(
        "Browser storage is unavailable. Rules still work for this lobby.",
      );
      return false;
    }
  };
  const save = (replace: boolean) => {
    if (!name.trim()) {
      setMessage("Give your profile a name.");
      return;
    }
    const profile: UnoProfile = {
      id:
        replace && current?.id.startsWith("custom-")
          ? current.id
          : `custom-${crypto.randomUUID()}`,
      name: name.trim().slice(0, 40),
      description: "Your saved house rules.",
      rules: { ...settings.rules },
    };
    const next = custom.filter((p) => p.id !== profile.id);
    if (next.length >= 50) {
      setMessage("You can save up to 50 profiles. Delete a profile first.");
      return;
    }
    if (updateProfiles([...next, profile])) {
      setSelected(profile.id);
      onChange({
        ...settings,
        profileId: profile.id,
        profileName: profile.name,
      });
    }
  };
  const active = profiles.find(
    (p) =>
      p.id === settings.profileId &&
      Object.keys(settings.rules).every(
        (k) =>
          p.rules[k as keyof typeof settings.rules] ===
          settings.rules[k as keyof typeof settings.rules],
      ),
  );
  return (
    <fieldset className="uno-settings" disabled={disabled}>
      <label className="field">
        <span>Rules profile</span>
        <select
          className="input"
          value={active?.id ?? "modified"}
          onChange={(e) => {
            const profile = profiles.find((p) => p.id === e.target.value)!;
            setSelected(profile.id);
            setName(profile.name);
            onChange({
              ...settings,
              profileId: profile.id,
              profileName: profile.name,
              rules: { ...profile.rules },
            });
            setMessage("");
          }}
        >
          {!active && (
            <option value="modified">{settings.profileName} · modified</option>
          )}
          {profiles.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <p className="uno-help">
        {active?.description ??
          "Custom rules for this lobby. Save them below to reuse later."}
      </p>
      <div className="uno-settings-grid">
        <label className="field">
          <span>Game length</span>
          <select
            className="input"
            value={settings.mode}
            onChange={(e) =>
              onChange({
                ...settings,
                mode: e.target.value as Settings["mode"],
              })
            }
          >
            <option value="single">Single round</option>
            <option value="rounds">Fixed rounds</option>
            <option value="points">Points target</option>
          </select>
        </label>
        {settings.mode === "rounds" && (
          <label className="field">
            <span>Number of rounds</span>
            <input
              key={`rounds-${settings.rounds}`}
              className="input"
              type="number"
              min="1"
              max="100"
              defaultValue={settings.rounds}
              onBlur={(e) => {
                if (
                  e.currentTarget.checkValidity() &&
                  Number(e.target.value) !== settings.rounds
                )
                  onChange({ ...settings, rounds: Number(e.target.value) });
              }}
            />
          </label>
        )}
        {settings.mode === "points" && (
          <label className="field">
            <span>Target score</span>
            <input
              key={`points-${settings.targetScore}`}
              className="input"
              type="number"
              min="50"
              max="10000"
              step="50"
              defaultValue={settings.targetScore}
              onBlur={(e) => {
                if (
                  e.currentTarget.checkValidity() &&
                  Number(e.target.value) !== settings.targetScore
                )
                  onChange({
                    ...settings,
                    targetScore: Number(e.target.value),
                  });
              }}
            />
          </label>
        )}
      </div>
      <details className="uno-advanced">
        <summary>Advanced rules & saved profiles</summary>
        <div className="uno-rule-list">
          {UNO_RULE_INFO.map((rule) => (
            <label key={rule.key} className="uno-rule-option">
              <input
                type="checkbox"
                checked={settings.rules[rule.key]}
                onChange={(e) => {
                  const rules = {
                    ...settings.rules,
                    [rule.key]: e.target.checked,
                  };
                  if (!rules.stack2 || !rules.stack4) rules.mixedStack = false;
                  if (rule.key === "mixedStack" && e.target.checked) {
                    rules.stack2 = true;
                    rules.stack4 = true;
                  }
                  onChange({
                    ...settings,
                    profileId: "custom",
                    profileName: current?.id.startsWith("custom-")
                      ? current.name
                      : "Custom rules",
                    rules,
                  });
                }}
              />
              <span>
                <strong>{rule.label}</strong>
                <small>{rule.explanation}</small>
              </span>
            </label>
          ))}
        </div>
        <p className="uno-help">
          A final draw card settles its whole penalty before scoring. No more
          stacks after a player goes out; the final +4 can still be challenged.
          Rules lock at the start.
        </p>
        <div className="uno-profile-editor">
          <label className="field">
            <span>Profile name</span>
            <input
              className="input"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Friday night rules"
            />
          </label>
          <div className="uno-buttons">
            <button
              type="button"
              className="secondary"
              onClick={() => save(false)}
            >
              Save as Profile
            </button>
            {current?.id.startsWith("custom-") && (
              <>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => save(true)}
                >
                  Update / rename
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    if (
                      updateProfiles(custom.filter((p) => p.id !== current.id))
                    ) {
                      setSelected("classic");
                      onChange({
                        ...settings,
                        profileId: "custom",
                        profileName: "Unsaved rules",
                      });
                      setMessage("Profile deleted. Current lobby rules kept.");
                    }
                  }}
                >
                  Delete profile
                </button>
              </>
            )}
          </div>
          <small>
            Save as Profile also duplicates a selected profile. Profiles stay on
            this browser for future lobbies.
          </small>
          {message && <p role="status">{message}</p>}
        </div>
      </details>
    </fieldset>
  );
}

export function UnoRulesSummary({ settings }: { settings: Settings }) {
  const enabled = UNO_RULE_INFO.filter((r) => settings.rules[r.key]);
  return (
    <details className="uno-rules-summary">
      <summary>{settings.profileName} · rules</summary>
      <p>
        Match color, number or symbol. Wild chooses a color. +2 draws two and
        skips; +4 draws four and skips. Reverse acts as Skip with two players.
        You may draw instead of playing; only the drawn card can then be played.
      </p>
      <p>
        A +4 requires no cards of the active color. A matching number or action
        in another color is allowed. A deliberate bluff can be challenged:
        guilty draws four; an unsuccessful challenger draws the total plus two.
        Only the challenger sees the hand evidence.
      </p>
      <p>
        Call UNO with your play, or immediately after it. Another player can
        catch you for two cards until the next player plays, draws, challenges
        or chooses a color. Skip and automatic penalties do not close that
        window.
      </p>
      <p>
        Round winner receives opponents’ card points: numbers at face value,
        actions 20, Wilds 50. Single round ends immediately; fixed rounds rank
        by total points; points mode ends at {settings.targetScore}. Ties share
        the win. A blocked deck after everyone passes draws the round.
      </p>
      {enabled.length ? (
        enabled.map((r) => (
          <p key={r.key}>
            <strong>{r.label}:</strong> {r.explanation}
          </p>
        ))
      ) : (
        <p>No house rules enabled.</p>
      )}
      <p>
        A final draw card settles the total before scoring; no further stacking.
        +4 challenges still apply. With 7–0, transfers happen before checking
        who has no cards. Subsequent rounds start automatically after 12
        seconds; any player can continue sooner. Each person uses their own
        phone, in the same room or remotely.
      </p>
    </details>
  );
}
