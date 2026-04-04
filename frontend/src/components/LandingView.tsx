import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function LandingView() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);

  const handleJoinClick = () => {
    const trimmed = code.trim().replace(/\D/g, '').slice(0, 4);
    if (trimmed.length === 4) {
      navigate(`/g/${trimmed}`);
    }
  };

  return (
    <main className="page sheet">
      <section className="hero">
        <h1>Top 10</h1>
        <p className="tagline">
          Answer a prompt with a secret number while the question master tries to guess the correct order.
        </p>
        <div className="button-row">
          <button className="primary" onClick={() => navigate('/host')}>
            Host Game
          </button>
          <span className="divider-text">or</span>
          <div className="join-inline">
            <input
              type="text"
              className="input"
              inputMode="numeric"
              maxLength={4}
              placeholder="4-digit code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
            />
            <button className="secondary" onClick={handleJoinClick}>
              Join
            </button>
          </div>
        </div>
        <button type="button" className="ghost info-button" onClick={() => setInfoOpen(true)}>
          Info
        </button>
        <Link to="/admin/login" className="admin-link">
          Admin
        </Link>
      </section>
      {infoOpen && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="info-card">
            <div className="info-header">
              <h3>How to play</h3>
              <button
                type="button"
                className="ghost info-close"
                onClick={() => setInfoOpen(false)}
                aria-label="Close rules"
              >
                X
              </button>
            </div>
            <p className="info-body">
              The host starts a game and shares the link, QR, or game code.
              <br />
              Each round, one player is the question master and everyone gets a secret number from 1 to 10.
              <br />
              Answer the prompt to match your number. The question master guesses the correct order.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
