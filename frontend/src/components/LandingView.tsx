import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function LandingView() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  const handleJoinClick = () => {
    const trimmed = code.trim();
    if (trimmed) {
      navigate(`/g/${trimmed}`);
    }
  };

  return (
    <main className="page sheet">
      <section className="hero">
        <p className="eyebrow">Retro party PWA</p>
        <h1>Top 10</h1>
        <p className="tagline">
          Secret numbers, rotating hosts, and neon CRT vibes. Host from any device and share a QR.
        </p>
        <div className="button-row">
          <button className="primary" onClick={() => navigate('/host')}>
            Host Game
          </button>
          <div className="join-inline">
            <input
              type="text"
              className="input"
              maxLength={10}
              placeholder="Game code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <button className="secondary" onClick={handleJoinClick}>
              Join
            </button>
          </div>
        </div>
        <p className="footnote">Supports iOS Safari, Android Chrome, and desktop browsers.</p>
      </section>
    </main>
  );
}
