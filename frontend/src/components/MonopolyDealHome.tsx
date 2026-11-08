import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { adminReauthorize, ApiError, createGame } from "../api";
import { loadOverrideToken, saveOverrideToken } from "../lib/adminSession";
import { saveSession } from "../lib/session";
import { DEFAULT_DEAL_SETTINGS } from "../../../shared/monopolyDeal";
import DealCard from "./DealCard";
import PasswordPromptDialog from "./PasswordPromptDialog";
import { DealRulesSummary } from "./DealSettings";

export default function MonopolyDealHome() {
  const navigate = useNavigate(),
    [nickname, setNickname] = useState(""),
    [code, setCode] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [override, setOverride] = useState(false),
    [password, setPassword] = useState("");
  const create = async (token?: string | null) => {
    const r = await createGame({
      gameType: "monopoly-deal",
      hostNickname: nickname.trim(),
      settings: DEFAULT_DEAL_SETTINGS,
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
    <main className="page sheet deal">
      <section className="hero deal-home">
        <Link className="deal-back-link" to="/">
          ← All games
        </Link>
        <div className="deal-home-cards" aria-hidden="true">
          <DealCard
            card={{
              id: "home-r",
              kind: "property",
              title: "Emerald Gardens",
              value: 4,
              colors: ["green"],
            }}
          />
          <DealCard
            card={{
              id: "home-w",
              kind: "action",
              title: "Deal Breaker",
              value: 5,
              colors: [],
              effect: "dealBreaker",
            }}
          />
          <DealCard
            card={{
              id: "home-b",
              kind: "property",
              title: "Sapphire Terrace",
              value: 4,
              colors: ["darkBlue"],
            }}
          />
        </div>
        <p className="eyebrow">2–5 players · together or online</p>
        <h1>Monopoly Deal</h1>
        <p className="tagline">Build an empire. Make a little trouble.</p>
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
            {busy ? "Creating…" : "Create Monopoly Deal lobby"}
          </button>
        </form>
        <p className="deal-help">
          Three colors. A handful of plans. One very good deal. Choose your
          rules in the lobby.
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
        <DealRulesSummary settings={DEFAULT_DEAL_SETTINGS} />
        {override && (
          <PasswordPromptDialog
            title="Usage override"
            message="The configured usage limit requires an admin override."
            password={password}
            loading={busy}
            error={error}
            confirmLabel="Create Monopoly Deal lobby"
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
