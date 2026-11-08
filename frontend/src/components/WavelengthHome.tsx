import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  adminReauthorize,
  ApiError,
  BACKEND_BASE,
  createGame,
  request,
} from "../api";
import { loadOverrideToken, saveOverrideToken } from "../lib/adminSession";
import { saveSession } from "../lib/session";
import {
  defaultWaveSettings,
  type WavePackSummary,
} from "../../../shared/wavelength";
import { useWaveLanguage, waveRules } from "../lib/waveI18n";
import PasswordPromptDialog from "./PasswordPromptDialog";
import WavelengthDial from "./WavelengthDial";

export default function WavelengthHome() {
  const navigate = useNavigate(),
    { language, setLanguage, t } = useWaveLanguage();
  const [nickname, setNickname] = useState(""),
    [code, setCode] = useState(""),
    [packs, setPacks] = useState<WavePackSummary[]>([]);
  const [packId, setPackId] = useState(
    localStorage.getItem("wave-pack") ?? `wavelength-${language}-classic-v1`,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [override, setOverride] = useState(false),
    [password, setPassword] = useState("");
  useEffect(() => {
    let live = true;
    request<{ packs: WavePackSummary[] }>(
      `${BACKEND_BASE}/api/wavelength/packs`,
    )
      .then((data) => {
        if (live) {
          setPacks(data.packs);
          setPackId((id) =>
            data.packs.some((p) => p.packId === id)
              ? id
              : (data.packs[0]?.packId ?? ""),
          );
        }
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : "Retry connection");
      });
    return () => {
      live = false;
    };
  }, []);
  const create = async (token?: string | null) => {
    const result = await createGame({
      gameType: "wavelength",
      hostNickname: nickname.trim(),
      overrideToken: token ?? undefined,
      settings: { ...defaultWaveSettings, packId },
    });
    saveSession({
      gameId: result.gameId,
      playerId: result.playerId,
      playerToken: result.playerToken,
      hostToken: result.hostToken,
      role: "HOST",
    });
    localStorage.setItem("wave-pack", packId);
    navigate(`/g/${result.gameId}`);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await create(loadOverrideToken());
    } catch (e) {
      if (e instanceof ApiError && e.code === "LIMIT_NEAR") setOverride(true);
      else setError(e instanceof Error ? e.message : "Retry connection");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="page sheet wavelength">
      <section className="hero wave-home">
        <nav className="wave-top">
          <Link to="/">← {t("All games")}</Link>
          <select
            aria-label={t("Interface language")}
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </nav>
        <div className="wave-home-art" aria-hidden="true">
          <WavelengthDial value={67} target={74} t={t} />
        </div>
        <p className="eyebrow">{t("2–24 players · together or online")}</p>
        <h1>Wavelength</h1>
        <p className="tagline">{t("Read the room. Find the frequency.")}</p>
        <form className="stack home-create" onSubmit={submit}>
          <label className="field">
            <span>{t("Your nickname")}</span>
            <input
              className="input"
              maxLength={20}
              required
              autoComplete="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
          <label className="field">
            <span>{t("Spectrum pack")}</span>
            <select
              className="input"
              value={packId}
              onChange={(e) => setPackId(e.target.value)}
            >
              {packs.map((p) => (
                <option key={p.packId} value={p.packId}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" disabled={busy || !packs.length}>
            {t(busy ? "Creating…" : "Create Wavelength lobby")}
          </button>
        </form>
        {packs.find((p) => p.packId === packId)?.development && (
          <p className="footnote wave-starter">
            {t(
              "Starter content · 12 spectrums per language. Full 200-pair packs have not been supplied.",
            )}
          </p>
        )}
        <form
          className="join-inline"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(`/g/${code}`);
          }}
        >
          <label className="field">
            <span>{t("Have an invite code?")}</span>
            <input
              className="input"
              required
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
            />
          </label>
          <button className="secondary">{t("Join")}</button>
        </form>
        {error && (
          <p className="error" role="alert">
            {t(error)}
          </p>
        )}
        <details className="wave-rules">
          <summary>{t("How to play")}</summary>
          <p>{waveRules[language === "de" ? "de" : "en"]}</p>
        </details>
        {override && (
          <PasswordPromptDialog
            title="Usage override"
            message="The configured usage limit requires an admin override."
            password={password}
            loading={busy}
            error={error}
            confirmLabel={t("Create Wavelength lobby")}
            onPasswordChange={setPassword}
            onClose={() => setOverride(false)}
            onSubmit={async () => {
              setBusy(true);
              try {
                const auth = await adminReauthorize(password);
                saveOverrideToken(auth.token);
                await create(auth.token);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Retry connection");
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
