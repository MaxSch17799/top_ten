import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminReauthorize, ApiError, createGame } from '../api';
import { loadOverrideToken, saveOverrideToken } from '../lib/adminSession';
import { saveSession } from '../lib/session';
import { DEFAULT_FLIP_SETTINGS } from '../../../shared/flip7';
import FlipCard from './FlipCard';
import PasswordPromptDialog from './PasswordPromptDialog';

export default function Flip7Home() {
  const navigate = useNavigate(), [nickname, setNickname] = useState(''), [code, setCode] = useState(''),
    [busy, setBusy] = useState(false), [error, setError] = useState(''), [override, setOverride] = useState(false), [password, setPassword] = useState('');
  const create = async (token?: string | null) => {
    const r = await createGame({ gameType: 'flip7', hostNickname: nickname.trim(), settings: DEFAULT_FLIP_SETTINGS, overrideToken: token ?? undefined });
    saveSession({ gameId: r.gameId, playerId: r.playerId, playerToken: r.playerToken, hostToken: r.hostToken, role: 'HOST' });
    navigate(`/g/${r.gameId}`);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await create(loadOverrideToken()); }
    catch (e) { if (e instanceof ApiError && e.code === 'LIMIT_NEAR') setOverride(true); else setError(e instanceof Error ? e.message : 'Connection failed'); }
    finally { setBusy(false); }
  };
  return <main className="page sheet f7"><section className="hero f7-home">
    <Link className="f7-back" to="/">← All games</Link>
    <div className="f7-home-fan" aria-hidden="true">{[4, 12, 7].map(value => <FlipCard key={value} card={{ id: `home-${value}`, kind: 'number', value }} />)}</div>
    <p className="eyebrow">2–12 friends · one more card?</p><h1>FLIP <span>7</span></h1>
    <p className="tagline">A little luck. A lot of nerve.</p><p className="f7-help">Bank your points, or risk it all for seven. Play on your phones or bring the whole table to the TV.</p>
    <form className="stack f7-create" onSubmit={submit}><label className="field"><span>Your nickname</span><input className="input" autoComplete="nickname" required maxLength={20} value={nickname} onChange={e => setNickname(e.target.value)} /></label>
      <button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create Flip 7 lobby'}</button></form>
    <form className="f7-join" onSubmit={e => { e.preventDefault(); navigate(`/g/${code.trim()}`); }}><label className="field"><span>Already invited? Enter the room code</span><input className="input" inputMode="numeric" pattern="[0-9]{4}" required maxLength={4} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></label><button className="secondary">Join game</button></form>
    {error && <p className="error" role="alert">{error}</p>}
    <details className="f7-how"><summary>How to play</summary><p>Take turns choosing HIT or STAY. A repeated number busts your round. Seven different numbers ends the round and earns 15 extra points. Reach 200 to win.</p><p>Freeze banks someone’s points. Flip Three forces three draws. Second Chance saves you from one duplicate. Modifiers add points; ×2 doubles only your number total.</p></details>
    {override && <PasswordPromptDialog title="Usage limit override" message="Enter the admin password to create this lobby near the configured free-tier limit." password={password} loading={busy} error={error || null} onPasswordChange={setPassword} onClose={() => setOverride(false)} onSubmit={async () => {
      setBusy(true); setError(''); try { const r = await adminReauthorize(password); saveOverrideToken(r.token); await create(r.token); setOverride(false); } catch (e) { setError(e instanceof Error ? e.message : 'Could not create lobby'); } finally { setBusy(false); }
    }} />}
  </section></main>;
}
