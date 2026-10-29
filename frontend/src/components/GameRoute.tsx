import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BACKEND_BASE, request } from '../api';
import GameShell from './GameShell';
import JustOneGame from './JustOneGame';

export default function GameRoute() {
  const { gameId = '' } = useParams();
  const [info, setInfo] = useState<{ gameId: string; gameType: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const retry = () => {
      setError(null);
      setAttempt((n) => n + 1);
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, []);
  useEffect(() => {
    let cancelled = false;
    request<{ gameType: string }>(
      `${BACKEND_BASE}/api/game/${encodeURIComponent(gameId)}/info`,
    )
      .then((data) => {
        if (!cancelled) setInfo({ gameId, gameType: data.gameType });
      })
      .catch(() => {
        if (!cancelled)
          setError(
            'Lobby not found or connection unavailable. Check the code and try again.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, attempt]);
  if (info?.gameId !== gameId)
    return (
      <main className="page sheet">
        <section className="host-form">
          <p role="status">{error ?? 'Finding your game…'}</p>
          {error && (
            <button
              className="secondary"
              onClick={() => {
                setError(null);
                setAttempt((n) => n + 1);
              }}
            >
              Retry connection
            </button>
          )}
          <Link to="/">All games</Link>
        </section>
      </main>
    );
  return info.gameType === 'just-one' ? (
    <JustOneGame key={gameId} gameId={gameId} />
  ) : (
    <GameShell key={gameId} />
  );
}
