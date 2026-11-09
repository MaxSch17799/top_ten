import { gameComponents } from '../app/games';
import { isGameType } from '../../../shared/games';
import { Suspense, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BACKEND_BASE, request } from '../api';

export default function GameRoute({ display = false }: { display?: boolean }) {
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
  const game = gameComponents[isGameType(info.gameType) ? info.gameType : 'top10'];
  if (display && isGameType(info.gameType) && !game.hasDisplay)
    return (
      <main className="page sheet">
        <section className="host-form stack" style={{ fontFamily: 'var(--font-body)' }}>
          <p className="eyebrow">{game.title}</p>
          <h1>TV display unavailable</h1>
          <p>This game does not have a dedicated TV display. Play in the regular room on each player’s device.</p>
          <Link to={`/g/${encodeURIComponent(gameId)}`}>Open game room</Link>
          <Link to="/">All games</Link>
        </section>
      </main>
    );
  const Room = game.Room;
  return <Suspense fallback={<main className="page">{game.loading}</main>}>
    <Room key={game.hasDisplay ? `${gameId}-${display}` : gameId} gameId={gameId} display={display} />
  </Suspense>;
}
