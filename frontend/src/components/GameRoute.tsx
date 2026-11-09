import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BACKEND_BASE, request } from '../api';
import GameShell from './GameShell';
import JustOneGame from './JustOneGame';
import SoundsFishyGame from './SoundsFishyGame';
import WavelengthGame from './WavelengthGame';
import UnoGame from './UnoGame';
const MonopolyDealGame = lazy(() => import('./MonopolyDealGame'));
const SkyjoGame = lazy(() => import('./SkyjoGame'));
const Flip7Game = lazy(() => import('./Flip7Game'));

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
  if (display && (info.gameType === 'top10' || info.gameType === 'just-one'))
    return (
      <main className="page sheet">
        <section className="host-form stack" style={{ fontFamily: 'var(--font-body)' }}>
          <p className="eyebrow">{info.gameType === 'top10' ? 'Top 10' : 'Just One'}</p>
          <h1>TV display unavailable</h1>
          <p>This game does not have a dedicated TV display. Play in the regular room on each player’s device.</p>
          <Link to={`/g/${encodeURIComponent(gameId)}`}>Open game room</Link>
          <Link to="/">All games</Link>
        </section>
      </main>
    );
  return info.gameType === 'skyjo' ? (
    <Suspense fallback={<main className="page">Opening your table…</main>}><SkyjoGame key={`${gameId}-${display}`} gameId={gameId} display={display} /></Suspense>
  ) : info.gameType === 'flip7' ? (
    <Suspense fallback={<main className="page">Opening the table…</main>}><Flip7Game key={`${gameId}-${display}`} gameId={gameId} display={display} /></Suspense>
  ) : info.gameType === 'monopoly-deal' ? (
    <Suspense fallback={<main className="page">Opening your table…</main>}><MonopolyDealGame key={`${gameId}-${display}`} gameId={gameId} display={display} /></Suspense>
  ) : info.gameType === 'uno' ? (
    <UnoGame key={`${gameId}-${display}`} gameId={gameId} display={display} />
  ) : info.gameType === 'wavelength' ? (
    <WavelengthGame key={`${gameId}-${display}`} gameId={gameId} display={display} />
  ) : info.gameType === 'sounds-fishy' ? (
    <SoundsFishyGame key={`${gameId}-${display}`} gameId={gameId} display={display} />
  ) : info.gameType === 'just-one' ? (
    <JustOneGame key={gameId} gameId={gameId} />
  ) : (
    <GameShell key={gameId} />
  );
}
