import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminReauthorize, ApiError, createGame } from '../api';
import { loadOverrideToken, saveOverrideToken } from '../lib/adminSession';
import { saveSession } from '../lib/session';
import { DEFAULT_SKY_SETTINGS } from '../../../shared/skyjo';
import SkyCard from './SkyCard';
import PasswordPromptDialog from './PasswordPromptDialog';

export default function SkyjoHome() {
  const navigate = useNavigate(), [nickname, setNickname] = useState(''), [code, setCode] = useState(''),
    [busy, setBusy] = useState(false), [error, setError] = useState(''), [override, setOverride] = useState(false), [password, setPassword] = useState('');
  const create = async (token?: string | null) => {
    const r = await createGame({ gameType: 'skyjo', hostNickname: nickname.trim(), settings: DEFAULT_SKY_SETTINGS, overrideToken: token ?? undefined });
    saveSession({ gameId: r.gameId, playerId: r.playerId, playerToken: r.playerToken, hostToken: r.hostToken, role: 'HOST' }); navigate(`/g/${r.gameId}`);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await create(loadOverrideToken()); }
    catch (e) { if (e instanceof ApiError && e.code === 'LIMIT_NEAR') setOverride(true); else setError(e instanceof Error ? e.message : 'Connection failed'); }
    finally { setBusy(false); }
  };
  return <main className="page sheet sky"><section className="hero sky-home">
    <Link className="sky-back" to="/">← All games</Link><p className="eyebrow">A good night for a low score.</p>
    <div className="sky-home-fan" aria-hidden="true"><SkyCard value={12} /><SkyCard back /><SkyCard value={-2} /></div>
    <h1>SKY<span>JO</span><i>✦</i></h1><p className="tagline">Less is a little more.</p>
    <p className="sky-help">Twelve hidden cards. A few clever swaps. Reveal a little, risk a little, and leave the big numbers behind.</p>
    <form className="stack sky-create" onSubmit={submit}><label className="field"><span>Your nickname</span><input className="input" autoComplete="nickname" required maxLength={20} value={nickname} onChange={e => setNickname(e.target.value)} /></label><button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create Skyjo lobby'}</button></form>
    <p className="sky-small">2–8 friends · Phones or TV · No downloads</p>
    <form className="sky-join" onSubmit={e => { e.preventDefault(); navigate(`/g/${code.trim()}`); }}><label className="field"><span>Have an invite? Room code</span><input className="input" inputMode="numeric" pattern="[0-9]{4}" required maxLength={4} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></label><button className="secondary">Join game</button></form>
    {error && <p className="error" role="alert">{error}</p>}
    <details className="sky-how"><summary>New to the table? How to play</summary><p>Flip two cards to begin. On your turn, take the discard and swap it into your grid, or draw a private card. Keep it to replace any card, or discard it and reveal one hidden card. Three equal cards in a vertical column clear together.</p><p>Reveal all your cards to close the round. Everyone else gets one last turn. Your positive round score doubles if you did not finish strictly lowest. When anyone reaches 100 total points, the lowest total wins.</p><p>Opening ties use seat order. Equal winning totals share the win. Empty draw piles recycle all discards except the top card.</p></details>
    <p className="sky-small">A private fan-made table for the classic game by Magilano.<br />Original digital card artwork.</p>
    {override && <PasswordPromptDialog title="Usage limit override" message="Enter the admin password to create this lobby near the configured free-tier limit." password={password} loading={busy} error={error || null} onPasswordChange={setPassword} onClose={() => setOverride(false)} onSubmit={async () => {
      setBusy(true); setError(''); try { const r = await adminReauthorize(password); saveOverrideToken(r.token); await create(r.token); setOverride(false); } catch (e) { setError(e instanceof Error ? e.message : 'Could not create lobby'); } finally { setBusy(false); }
    }} />}
  </section></main>;
}
