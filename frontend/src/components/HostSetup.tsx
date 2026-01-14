import { useEffect, useState } from 'react';
import type { FormEvent, ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createGame } from '../api';
import { loadQuestionBank } from '../lib/questionBank';
import { saveSession } from '../lib/session';
import type { QuestionBank, SessionData } from '../lib/types';

const DEFAULT_BANK = 'classic_v1';

export default function HostSetup() {
  const navigate = useNavigate();
  const [nickname, setNickname] = useState('');
  const [seed, setSeed] = useState('');
  const [questionBankId, setQuestionBankId] = useState(DEFAULT_BANK);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [bank, setBank] = useState<QuestionBank | null>(null);

  useEffect(() => {
    void loadQuestionBank(DEFAULT_BANK)
      .then((data) => {
        setBank(data);
      })
      .catch(() => {
        setBank(null);
      });
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (nicknameError) {
      setError(nicknameError);
      return;
    }
    const clean = nickname.trim();
    if (!clean) {
      setError('Enter a nickname (max 20 characters)');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await createGame({
        hostNickname: clean,
        seed: seed.trim() || undefined,
        questionBankId,
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
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Game creation failed';
      setError(message);
    } finally {
      setLoading(false);
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
              <option value={DEFAULT_BANK}>{bank?.name ?? 'Classic'}</option>
            </select>
            {!bank && <p className="footnote">Loading question bank...</p>}
          </label>
          <button type="submit" className="primary" disabled={loading}>
            {loading ? 'Creating game...' : 'Create lobby'}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </section>
    </main>
  );
}

