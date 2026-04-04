import { useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminReauthorize, ApiError, createGame, fetchPublicUsageStatus } from '../api';
import PasswordPromptDialog from './PasswordPromptDialog';
import { loadQuestionBankCatalog } from '../lib/questionBank';
import { clearOverrideToken, loadOverrideToken, saveOverrideToken } from '../lib/adminSession';
import { saveSession } from '../lib/session';
import type { QuestionBankCatalogItem, SessionData, UsageStatus } from '../lib/types';

const DEFAULT_BANK = 'classic_v1';
const FALLBACK_BANKS: QuestionBankCatalogItem[] = [
  { id: DEFAULT_BANK, name: 'Classic', version: 1, questionCount: 120, source: 'static', readOnly: true },
];

export default function HostSetup() {
  const navigate = useNavigate();
  const [nickname, setNickname] = useState('');
  const [seed, setSeed] = useState('');
  const [questionBankId, setQuestionBankId] = useState(DEFAULT_BANK);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [banks, setBanks] = useState<QuestionBankCatalogItem[]>(FALLBACK_BANKS);
  const [bankLoadError, setBankLoadError] = useState<string | null>(null);
  const [usageStatus, setUsageStatus] = useState<UsageStatus | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overridePassword, setOverridePassword] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideLoading, setOverrideLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void loadQuestionBankCatalog()
      .then((items) => {
        if (cancelled || items.length === 0) {
          return;
        }
        setBanks(items);
        setQuestionBankId((current) => (items.some((bank) => bank.id === current) ? current : items[0].id));
        setBankLoadError(null);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setBanks(FALLBACK_BANKS);
        setQuestionBankId(FALLBACK_BANKS[0].id);
        setBankLoadError('Using fallback bank list. New database banks are unavailable right now.');
      });

    void fetchPublicUsageStatus()
      .then((usage) => {
        if (!cancelled) {
          setUsageStatus(usage);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUsageStatus(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleRandomSeed = () => {
    setSeed(Math.random().toString(36).slice(2, 10));
  };

  const handleNicknameChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    if (next.length > 20) {
      setNicknameError('Nickname max 20 characters.');
      return;
    }
    setNickname(next);
    if (nicknameError) {
      setNicknameError(null);
    }
  };

  const attemptCreateGame = async (overrideToken?: string | null) => {
    const clean = nickname.trim();
    if (nicknameError) {
      throw new Error(nicknameError);
    }
    if (!clean) {
      throw new Error('Enter a nickname (max 20 characters)');
    }

    const result = await createGame({
      hostNickname: clean,
      seed: seed.trim() || undefined,
      questionBankId,
      overrideToken: overrideToken ?? undefined,
    });

    const session: SessionData = {
      gameId: result.gameId,
      playerId: result.playerId,
      playerToken: result.playerToken,
      hostToken: result.hostToken,
      role: 'HOST',
    };
    saveSession(session);
    navigate(`/g/${result.gameId}`);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await attemptCreateGame(loadOverrideToken());
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'LIMIT_NEAR') {
        clearOverrideToken();
        setOverridePassword('');
        setOverrideError(null);
        setOverrideOpen(true);
        setUsageStatus((current) =>
          current
            ? {
                ...current,
                nearLimit: true,
                warningMessage:
                  cause.message || current.warningMessage || 'Free-tier usage is nearing the configured limit.',
              }
            : null
        );
      } else {
        setError(cause instanceof Error ? cause.message : 'Game creation failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOverrideSubmit = async () => {
    if (!overridePassword.trim()) {
      setOverrideError('Enter the admin password');
      return;
    }
    setOverrideLoading(true);
    setOverrideError(null);
    try {
      const auth = await adminReauthorize(overridePassword.trim());
      saveOverrideToken(auth.token);
      try {
        setLoading(true);
        await attemptCreateGame(auth.token);
        setOverrideOpen(false);
        setOverrideError(null);
      } catch (cause) {
        if (cause instanceof ApiError && cause.code === 'LIMIT_NEAR') {
          setOverrideError(cause.message);
          return;
        }
        setError(cause instanceof Error ? cause.message : 'Game creation failed');
        setOverrideOpen(false);
      } finally {
        setLoading(false);
      }
    } catch (cause) {
      setOverrideError(cause instanceof Error ? cause.message : 'Override failed');
    } finally {
      setOverrideLoading(false);
    }
  };

  return (
    <main className="page sheet">
      <section className="host-form">
        <h1>Host a Top 10 session</h1>
        <p className="tagline">
          Share the general join link or QR or game code.
          <br />
          Up to 10 players can join.
        </p>
        {usageStatus?.warningMessage && <p className="warning-banner">{usageStatus.warningMessage}</p>}
        <form onSubmit={handleSubmit} className="stack">
          <label className="field">
            <span>Nickname (20 chars max)</span>
            <input
              className="input"
              maxLength={20}
              value={nickname}
              onChange={handleNicknameChange}
              placeholder="Host nickname"
            />
            {nicknameError && <p className="error">{nicknameError}</p>}
          </label>
          <label className="field">
            <span>Seed (optional)</span>
            <div className="seed-row">
              <input
                className="input"
                value={seed}
                onChange={(event) => setSeed(event.target.value)}
                placeholder="blank = random seed"
              />
              <button type="button" className="secondary" onClick={handleRandomSeed}>
                Randomize
              </button>
            </div>
          </label>
          <label className="field">
            <span>Question bank</span>
            <select className="input" value={questionBankId} onChange={(event) => setQuestionBankId(event.target.value)}>
              {banks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.name} ({bank.questionCount}){bank.readOnly ? ' - Static' : ' - Editable'}
                </option>
              ))}
            </select>
            {bankLoadError && <p className="footnote">{bankLoadError}</p>}
          </label>
          <button type="submit" className="primary" disabled={loading}>
            {loading ? 'Creating game...' : 'Create lobby'}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </section>

      {overrideOpen && (
        <PasswordPromptDialog
          title="Override Needed"
          message="Free-tier usage is near the configured limit. Enter the admin password to create this lobby in the current tab."
          password={overridePassword}
          loading={overrideLoading}
          error={overrideError}
          confirmLabel="Create Lobby"
          onPasswordChange={setOverridePassword}
          onSubmit={handleOverrideSubmit}
          onClose={() => {
            setOverrideOpen(false);
            setOverrideError(null);
            setOverridePassword('');
          }}
        />
      )}
    </main>
  );
}
