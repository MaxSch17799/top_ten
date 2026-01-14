import type { FormEvent, ChangeEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { advanceRound, endGame, joinGame, reorderPlayers, startRound } from '../api';
import { loadQuestionBank } from '../lib/questionBank';
import { loadSessionForGame, saveSession } from '../lib/session';
import { useGameConnection } from '../hooks/useGameConnection';
import AddPlayerPanel from './AddPlayerPanel';
import LobbyView from './LobbyView';
import RoundView from './RoundView';
import type { QuestionBank, SessionData } from '../lib/types';

export default function GameShell() {
  const { gameId } = useParams<{ gameId: string }>();
  const [session, setSession] = useState<SessionData | null>(null);
  const [nickname, setNickname] = useState('');
  const [joining, setJoining] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [questionBank, setQuestionBank] = useState<QuestionBank | null>(null);
  const [joinOrigin, setJoinOrigin] = useState(import.meta.env.VITE_FRONTEND_URL ?? '');

  const connection = useGameConnection({ gameId: gameId ?? '', playerToken: session?.playerToken });
  const state = connection.state;

  useEffect(() => {
    if (!gameId) {
      return;
    }
    const stored = loadSessionForGame(gameId);
    setSession(stored);
  }, [gameId]);

  useEffect(() => {
    const bankId = connection.state?.questionBankId;
    if (!bankId) {
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const loadBank = async () => {
      try {
        const payload = await loadQuestionBank(bankId);
        if (!cancelled) {
          setQuestionBank(payload);
        }
      } catch {
        if (cancelled) {
          return;
        }
        attempts += 1;
        if (attempts <= 2) {
          setTimeout(loadBank, 800);
        } else {
          setQuestionBank(null);
        }
      }
    };
    loadBank();
    return () => {
      cancelled = true;
    };
  }, [connection.state?.questionBankId]);

  useEffect(() => {
    if (!state) {
      return;
    }
    const allowed = state.phase === 'LOBBY' || state.yourRole === 'HOST';
    if (!allowed && inviteOpen) {
      setInviteOpen(false);
    }
  }, [inviteOpen, state]);

  useEffect(() => {
    if (joinOrigin) {
      return;
    }
    if (typeof window !== 'undefined') {
      setJoinOrigin(window.location.origin);
    }
  }, [joinOrigin]);

  const joinUrl = useMemo(() => {
    if (!gameId) {
      return '';
    }
    const origin = (joinOrigin || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
    return `${origin}/g/${gameId}`;
  }, [gameId, joinOrigin]);

  const handleJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!gameId) {
      return;
    }
    if (nicknameError) {
      setJoinError(nicknameError);
      return;
    }
    const clean = nickname.trim();
    if (!clean) {
      setJoinError('Enter a nickname (max 20 chars)');
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      const result = await joinGame(gameId, clean);
      const newSession: SessionData = {
        gameId,
        playerId: result.playerId,
        playerToken: result.playerToken,
        role: result.role,
      };
      saveSession(newSession);
      setSession(newSession);
      setNickname('');
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Join failed');
    } finally {
      setJoining(false);
    }
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

  const handleReorder = async (order: string[]) => {
    if (!gameId || !session) {
      return;
    }
    setActionError(null);
    try {
      await reorderPlayers(gameId, session, order);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to reorder players');
    }
  };

  const handleStartRound = async () => {
    if (!gameId || !session) {
      return;
    }
    setActionError(null);
    try {
      await startRound(gameId, session);
      await connection.requestState();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start the round');
    }
  };

  const handleNextRound = async () => {
    if (!gameId || !session) {
      return;
    }
    setActionError(null);
    try {
      await advanceRound(gameId, session);
      await connection.requestState();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to advance round');
    }
  };

  const handleEndGame = async () => {
    if (!gameId || !session) {
      return;
    }
    setActionError(null);
    try {
      await endGame(gameId, session);
      await connection.requestState();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to end the game');
    }
  };

  if (!gameId) {
    return (
      <main className="page sheet">
        <p className="error">Game code is missing. Return to the home screen.</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="page sheet">
        <section className="host-form">
          <h1>Join the Game</h1>
          <form onSubmit={handleJoin} className="stack">
            <label className="field">
              <span>Enter a nickname</span>
              <input
                className="input"
                maxLength={20}
                value={nickname}
                onChange={handleNicknameChange}
                placeholder="Your nickname"
              />
            </label>
            <button type="submit" className="primary" disabled={joining}>
              {joining ? 'Joining...' : 'Join lobby'}
            </button>
            {nicknameError && <p className="error">{nicknameError}</p>}
            {joinError && <p className="error">{joinError}</p>}
          </form>
        </section>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="page sheet">
        <section className="host-form">
          <p className="tagline">Waiting for game data...</p>
          <p className="footnote">{connection.lastError ?? 'Connecting to the host...'}</p>
        </section>
      </main>
    );
  }

  if (state.phase === 'ENDED') {
    return (
      <main className="page sheet">
        <section className="host-form">
          <h1>Game ended</h1>
          <p className="footnote">The session has concluded. Start a new game to keep playing.</p>
          <Link to="/" className="primary">
            Back home
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page sheet">
      {state.phase === 'LOBBY' && (
        <LobbyView
          state={state}
          joinUrl={joinUrl}
          onStartRound={handleStartRound}
          onReorder={handleReorder}
          onOpenInvite={() => setInviteOpen(true)}
          actionError={actionError}
        />
      )}
      {state.phase === 'ACTIVE' && (
        <RoundView
          state={state}
          questionBank={questionBank}
          onNextRound={handleNextRound}
          onEndGame={handleEndGame}
          onOpenInvite={() => setInviteOpen(true)}
          actionError={actionError}
        />
      )}
      <AddPlayerPanel
        joinUrl={joinUrl}
        gameCode={gameId ?? ''}
        visible={Boolean(state && inviteOpen && (state.phase === 'LOBBY' || state.yourRole === 'HOST'))}
        onClose={() => setInviteOpen(false)}
      />
    </main>
  );
}

