import { Link } from 'react-router-dom';
import { games } from '../lib/games';

export default function GameSelection() {
  return (
    <main className="page sheet">
      <section className="hero platform-home">
        <p className="eyebrow">Max & Alina’s game night</p>
        <h1>
          Good company.
          <br />
          <span>Great games.</span>
        </h1>
        <p className="tagline">Bring your people. Pick your next obsession.</p>
        <div className="game-grid">
          {games.map((game) => (
            <Link
              className={`game-tile game-${game.id}`}
              key={game.id}
              to={game.path}
            >
              <span className="game-mark" aria-hidden="true">
                {game.mark}
                <span>★</span>
              </span>
              <span className="eyebrow">{game.kind}</span>
              <h2>{game.title}</h2>
              <p>{game.description}</p>
              <span className="game-tile-footer">
                {game.players}
                <strong>Let’s play →</strong>
              </span>
            </Link>
          ))}
        </div>
        <p className="footnote">One phone each. No downloads. Just play.</p>
        <Link to="/admin/login" className="admin-link">
          Admin
        </Link>
      </section>
    </main>
  );
}
