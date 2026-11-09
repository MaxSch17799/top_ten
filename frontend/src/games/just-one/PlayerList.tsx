import type { JustOneView } from "../../../../shared/justOne";
import { type Act } from "./types";

export function PlayerList({
  state,
  act,
  busy,
}: {
  state: JustOneView;
  act: Act;
  busy: boolean;
}) {
  const host = state.yourRole === 'HOST';
  const move = (index: number, delta: number) => {
    const order = [...state.order];
    [order[index], order[index + delta]] = [order[index + delta], order[index]];
    void act('reorder', { order });
  };
  return (
    <div className="jo-player-list">
      {state.order.map((id, i) => {
        const p = state.players.find((player) => player.playerId === id)!;
        return (
          <div className="jo-player" key={id}>
            <span
              className={`connection-dot ${p.connected ? 'connected' : ''}`}
              aria-label={p.connected ? 'Connected' : 'Disconnected'}
            />
            <span className="jo-player-name">
              {i + 1}. {p.nickname}
              <small>
                {p.role === 'HOST' ? 'Host · ' : ''}
                {p.pending
                  ? 'Joining next round'
                  : p.participating
                    ? 'Playing'
                    : 'Sitting out'}
                {p.playerId === state.guesserId ? ' · Guesser' : ''}
              </small>
            </span>
            {host && (
              <div className="player-actions">
                {state.phase === 'LOBBY' && (
                  <>
                    <button
                      className="ghost"
                      aria-label={`Move ${p.nickname} up`}
                      disabled={busy || i === 0}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="ghost"
                      aria-label={`Move ${p.nickname} down`}
                      disabled={busy || i === state.order.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                  </>
                )}
                <button
                  className="ghost"
                  disabled={busy}
                  aria-label={`${p.participating ? 'Sit out' : 'Include'} ${p.nickname}`}
                  onClick={() =>
                    void act('participation', {
                      playerId: id,
                      participating: !p.participating,
                    })
                  }
                >
                  {p.participating ? 'Sit out' : 'Include'}
                </button>
              </div>
            )}
          </div>
        );
      })}
      {state.phase !== 'LOBBY' && host && (
        <p className="footnote">
          Participation changes apply next round. Use “Continue with submitted
          clues” for absent players.
        </p>
      )}
    </div>
  );
}
