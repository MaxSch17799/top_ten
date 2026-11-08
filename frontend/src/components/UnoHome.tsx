import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { adminReauthorize, ApiError, createGame } from "../api";
import { loadOverrideToken, saveOverrideToken } from "../lib/adminSession";
import { saveSession } from "../lib/session";
import { DEFAULT_UNO_SETTINGS } from "../../../shared/uno";
import UnoCard from "./UnoCard";
import PasswordPromptDialog from "./PasswordPromptDialog";
import { UnoRulesSummary } from "./UnoSettings";

export default function UnoHome() {
  const navigate = useNavigate(),
    [nickname, setNickname] = useState(""),
    [code, setCode] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [override, setOverride] = useState(false),
    [password, setPassword] = useState("");
  const create = async (token?: string | null) => {
    const r = await createGame({
      gameType: "uno",
      hostNickname: nickname.trim(),
      settings: DEFAULT_UNO_SETTINGS,
      overrideToken: token ?? undefined,
    });
    saveSession({
      gameId: r.gameId,
      playerId: r.playerId,
      playerToken: r.playerToken,
      hostToken: r.hostToken,
      role: "HOST",
    });
    navigate(`/g/${r.gameId}`);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await create(loadOverrideToken());
    } catch (e) {
      if (e instanceof ApiError && e.code === "LIMIT_NEAR") setOverride(true);
      else setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="page sheet uno">
      <section className="hero uno-home">
        <Link className="uno-back-link" to="/">
          ← All games
        </Link>
        <div className="uno-home-cards" aria-hidden="true">
          <UnoCard card={{ id: "home-r", color: "red", value: "7" }} />
          <UnoCard card={{ id: "home-w", color: null, value: "wild" }} />
          <UnoCard card={{ id: "home-b", color: "blue", value: "reverse" }} />
        </div>
        <p className="eyebrow">2–10 players · together or online</p>
        <h1>UNO</h1>
        <p className="tagline">One card left. All eyes on you.</p>
        <form className="stack home-create" onSubmit={submit}>
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
            {busy ? "Creating…" : "Create UNO lobby"}
          </button>
        </form>
        <p className="uno-help">
          Classic, stacking, or your own house rules. Choose in the lobby.
        </p>
        <form
          className="join-inline"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(`/g/${code}`);
          }}
        >
          <label className="field">
            <span>Have an invite code?</span>
            <input
              className="input"
              required
              pattern="[0-9]{4}"
              inputMode="numeric"
              maxLength={4}
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
            />
          </label>
          <button className="secondary">Join</button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <UnoRulesSummary settings={DEFAULT_UNO_SETTINGS} />
        {override && (
          <PasswordPromptDialog
            title="Usage override"
            message="The configured usage limit requires an admin override."
            password={password}
            loading={busy}
            error={error}
            confirmLabel="Create UNO lobby"
            onPasswordChange={setPassword}
            onClose={() => setOverride(false)}
            onSubmit={async () => {
              setBusy(true);
              try {
                const auth = await adminReauthorize(password);
                saveOverrideToken(auth.token);
                await create(auth.token);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Connection failed");
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
      </section>
    </main>
  );
}
