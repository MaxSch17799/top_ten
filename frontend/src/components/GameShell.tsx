import type { FormEvent, ChangeEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { advanceRound, endGame, joinGame, reorderPlayers, startRound } from '../api';
import { loadSessionForGame, saveSession } from '../lib/session';
import { useGameConnection } from '../hooks/useGameConnection';
import AddPlayerPanel from './AddPlayerPanel';
import LobbyView from './LobbyView';
import RoundView from './RoundView';
import type { SessionData } from '../lib/types';

export default function GameShell() {
  const { gameId } = useParams<{ gameId: string }>();
  const [session, setSession] = useState<SessionData | null>(null);
  const [nickname, setNickname] = useState('');
  const [joining, setJoining] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [joinOrigin, setJoinOrigin] = useState(import.meta.env.VITE_FRONTEND_URL ?? '');
  const [clockNow, setClockNow] = useState(() => Date.now());
  const warningPlayedRef = useRef(false);

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

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const joinUrl = useMemo(() => {
    if (!gameId) {
      return '';
    }
    const origin = (joinOrigin || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
    return `${origin}/g/${gameId}`;
  }, [gameId, joinOrigin]);

  const warningActive = Boolean(
    state &&
      state.phase !== 'ENDED' &&
      state.inactivityWarningAt &&
      state.inactivityEndsAt &&
      clockNow >= state.inactivityWarningAt &&
      clockNow < state.inactivityEndsAt
  );

  const warningLabel = useMemo(() => {
    if (!state?.inactivityEndsAt || !warningActive) {
      return null;
    }
    const remainingSeconds = Math.max(0, Math.ceil((state.inactivityEndsAt - clockNow) / 1000));
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    const prefix =
      state.inactivityKind === 'LOBBY'
        ? 'This lobby will expire soon due to inactivity'
        : 'This round will end soon due to inactivity';
    return `${prefix}: ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, [clockNow, state?.inactivityEndsAt, state?.inactivityKind, warningActive]);

  useEffect(() => {
    if (!warningActive) {
      warningPlayedRef.current = false;
      return;
    }
    if (warningPlayedRef.current) {
      return;
    }
    warningPlayedRef.current = true;
    try {
      const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) {
        return;
      }
      const context = new AudioCtx();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = 880;
      gain.gain.value = 0.015;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.14);
      window.setTimeout(() => void context.close().catch(() => undefined), 250);
    } catch {
      /* warning sound is optional */
    }
  }, [warningActive]);

  const endedMessage = useMemo(() => {
    switch (state?.endedReason) {
      case 'HOST_TIMEOUT':
        return 'The game ended because the host connection was inactive for too long.';
      case 'ROUND_TIMEOUT':
        return 'The game ended because this round was inactive for 30 minutes.';
      case 'LOBBY_TIMEOUT':
        return 'The lobby expired after 30 minutes of inactivity.';
      case 'HOST_REQUESTED':
        return 'The session has concluded. Start a new game to keep playing.';
      default:
        return 'The session has concluded. Start a new game to keep playing.';
    }
  }, [state?.endedReason]);

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
          <p className="footnote">{endedMessage}</p>
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
          warningActive={warningActive}
          warningLabel={warningLabel}
        />
      )}
      {state.phase === 'ACTIVE' && (
        <RoundView
          state={state}
          onNextRound={handleNextRound}
          onEndGame={handleEndGame}
          onOpenInvite={() => setInviteOpen(true)}
          actionError={actionError}
          warningActive={warningActive}
          warningLabel={warningLabel}
        />
      )}
      {state && inviteOpen && (state.phase === 'LOBBY' || state.yourRole === 'HOST') ? (
        <AddPlayerPanel joinUrl={joinUrl} gameCode={gameId ?? ''} onClose={() => setInviteOpen(false)} />
      ) : null}
    </main>
  );
}

