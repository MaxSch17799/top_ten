import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminReauthorize, ApiError, createGame } from '../api';
import { loadOverrideToken, saveOverrideToken } from '../lib/adminSession';
import { saveSession } from '../lib/session';
import { defaultJustOneSettings } from '../../../shared/justOne';
import SessionNavigation from './SessionNavigation';
import PasswordPromptDialog from './PasswordPromptDialog';

export default function JustOneHome() {
  const navigate = useNavigate();
  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState(() =>
    localStorage.getItem('just-one-language') === 'de' ? 'de' : 'en',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [password, setPassword] = useState('');
  const create = async (overrideToken?: string | null) => {
    const result = await createGame({
      gameType: 'just-one',
      hostNickname: nickname.trim(),
      overrideToken: overrideToken ?? undefined,
      settings: {
        ...defaultJustOneSettings,
        bankId: `just_one_${language}_classic_v1`,
      },
    });
    saveSession({
      gameId: result.gameId,
      playerId: result.playerId,
      playerToken: result.playerToken,
      hostToken: result.hostToken,
      role: 'HOST',
    });
    localStorage.setItem('just-one-language', language);
    navigate(`/g/${result.gameId}`);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await create(loadOverrideToken());
    } catch (e) {
      if (e instanceof ApiError && e.code === 'LIMIT_NEAR')
        setOverrideOpen(true);
      else setError(e instanceof Error ? e.message : 'Could not create lobby');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="page sheet just-one">
      <section className="hero">
        <SessionNavigation />
        <p className="eyebrow">A cooperative word game</p>
        <h1>Just One</h1>
        <p className="tagline">
          One mystery word. One team. Only unique clues survive.
        </p>
        <form className="stack home-create" onSubmit={submit}>
          <label className="field">
            <span>Your nickname</span>
            <input
              className="input"
              maxLength={20}
              required
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              autoComplete="nickname"
            />
          </label>
          <label className="field">
            <span>Word language</span>
            <select
              className="input"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="en">Classic English</option>
              <option value="de">Classic German</option>
            </select>
          </label>
          <button className="primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create Just One lobby'}
          </button>
        </form>
        <form
          className="join-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 4) navigate(`/g/${code}`);
          }}
        >
          <label className="field">
            <span>Have an invite code?</span>
            <input
              aria-label="4-digit code"
              className="input"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, '').slice(0, 4))
              }
              placeholder="4-digit code"
              required
            />
          </label>
          <button className="secondary" type="submit">
            Join
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <details className="jo-rules">
          <summary>How to play</summary>
          <p>
            Take turns guessing. Everyone else writes a single-word clue.
            Matching clues are removed—all copies! A reviewer checks the
            remaining clues, then the guesser gets one answer or a pass.
          </p>
          <p>
            With 3–4 players, each clue-giver writes two clues. You start with
            13 cards: a correct answer wins a point, a pass loses one card, and
            a wrong answer loses two. On the final card, a wrong answer costs
            one won point instead. Fixed-round games are also available.
          </p>
          <p>
            Clues cannot be the answer, a translation, a related word form, a
            homophone or an invented compound. Proper nouns, numbers, acronyms
            and established compounds are welcome.
          </p>
        </details>
        {overrideOpen && (
          <PasswordPromptDialog
            title="Usage override"
            message="The server’s configured usage limit requires an admin override to create a lobby."
            password={password}
            loading={busy}
            error={error}
            confirmLabel="Create lobby"
            onPasswordChange={setPassword}
            onClose={() => setOverrideOpen(false)}
            onSubmit={async () => {
              setBusy(true);
              setError(null);
              try {
                const auth = await adminReauthorize(password);
                saveOverrideToken(auth.token);
                await create(auth.token);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Override failed');
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
