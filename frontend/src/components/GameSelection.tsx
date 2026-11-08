import { Link } from 'react-router-dom';
import { games } from '../lib/games';
import { useFishyLanguage } from '../lib/fishyI18n';

export default function GameSelection() {
  const { language, setLanguage, t } = useFishyLanguage();
  return (
    <main className="page sheet">
      <section className="hero platform-home">
        <select className="platform-language" aria-label={t('Interface language')} value={language} onChange={e => setLanguage(e.target.value)}><option value="en">English</option><option value="de">Deutsch</option></select>
        <p className="eyebrow">Max & Alina’s game night</p>
        <h1>
          {t('Good company.')}
          <br />
          <span>{t('Great games.')}</span>
        </h1>
        <p className="tagline">{t('Bring your people. Pick your next obsession.')}</p>
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
              <span className="eyebrow">{t(game.kind)}</span>
              <h2>{game.title}</h2>
              <p>{t(game.description)}</p>
              <span className="game-tile-footer">
                {t(game.players)}
                <strong>{t('Let’s play →')}</strong>
              </span>
            </Link>
          ))}
        </div>
        <p className="footnote">{t('One phone each. No downloads. Just play.')}</p>
        <Link to="/admin/login" className="admin-link">
          Admin
        </Link>
      </section>
    </main>
  );
}
