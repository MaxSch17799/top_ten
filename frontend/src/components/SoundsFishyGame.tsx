import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { FishyAction, FishyView } from '../../../shared/soundsFishy';
import { BACKEND_BASE, joinGame, request } from '../api';
import { useGameConnection } from '../hooks/useGameConnection';
import type { SessionData } from '../lib/types';
import { loadSessionForGame, saveSession } from '../lib/session';
import { fishyRules, useFishyLanguage, type FishyTranslate } from '../lib/fishyI18n';
import AddPlayerPanel from './AddPlayerPanel';
import SoundsFishySettings, { type FishyAct } from './SoundsFishySettings';

function Countdown({ state: s, receivedAt, t }: { state: FishyView; receivedAt: number; t: FishyTranslate }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, []);
  if (s.paused) return <p className="sf-timer" role="status">Ⅱ {t('Paused')}{s.pausedRemaining !== null && ` · ${Math.ceil(s.pausedRemaining / 1000)} s`}</p>;
  if (!s.deadline) return null;
  const left = Math.max(0, Math.ceil((s.deadline - s.serverNow - Math.max(0, now - receivedAt)) / 1000));
  return <p className="sf-timer" role="timer">{s.phase === 'RESULT' ? t('Next round') : t(s.phase === 'ELIMINATION' ? 'Decision timer' : 'Preparation timer')} · {left} s</p>;
}
function AnswerForm({ s, act, disabled, t }: { s: FishyView; act: FishyAct; disabled: boolean; t: FishyTranslate }) {
  const key = `fishy-answer-${s.gameId}-${s.roundId}-${s.yourPlayerId}`;
  const [text, setText] = useState(() => s.ownSubmission ?? (s.ownRole === 'blue' ? s.answer ?? '' : sessionStorage.getItem(key) ?? ''));
  if (s.ownSubmission !== undefined) return <div className="sf-submitted"><strong>✓ {t('Your answer is locked in')}</strong><p>{s.ownSubmission}</p></div>;
  return <form className="stack" onSubmit={async e => { e.preventDefault(); if (await act('submit', { answer: text })) sessionStorage.removeItem(key); }}>
    <label className="field"><span>{t('Your answer')}</span><input className="input sf-answer-input" value={text} maxLength={240} required autoComplete="off" readOnly={s.ownRole === 'blue'} disabled={disabled} onChange={e => { setText(e.target.value); sessionStorage.setItem(key, e.target.value); }} /></label>
    <button className="primary" disabled={disabled || !text.trim()}>{t('Submit answer')}</button>
  </form>;
}
function Administration({ s, act, busy, t }: { s: FishyView; act: FishyAct; busy: boolean; t: FishyTranslate }) {
  const [reason, setReason] = useState('');
  const [player, setPlayer] = useState(s.yourPlayerId), [delta, setDelta] = useState(1);
  return <details className="sf-admin"><summary>{t('Host controls')}</summary><div className="stack">
    <p className="footnote">{t('Permanent departure: restart, then sit out missing players in the lobby.')}</p>
    {s.phase !== 'LOBBY' && <SoundsFishySettings state={s} act={act} busy={busy} t={t} />}
    {!['LOBBY', 'COMPLETED'].includes(s.phase) && <>
      <button className="secondary" disabled={busy} onClick={() => void act(s.paused ? 'resume' : 'pause')}>{t(s.paused ? 'Resume' : 'Pause')}</button>
      {['PREPARATION', 'COLLECTION'].includes(s.phase) && s.submitted.length === 0 && <button className="secondary" disabled={busy || s.paused} onClick={() => void act('replace')}>{t('Replace question')}</button>}
      <form className="stack" onSubmit={e => { e.preventDefault(); void act('void', { reason }); }}><label className="field"><span>{t('Reason')}</span><input className="input" required maxLength={200} value={reason} onChange={e => setReason(e.target.value)} /></label><button className="secondary" disabled={busy || s.result?.outcome === 'void'}>{t('Void / replay round')}</button></form>
    </>}
    <form className="stack" onSubmit={e => { e.preventDefault(); void act('score', { playerId: player, delta, reason }); }}>
      <h3>{t('Score correction')}</h3>
      <label className="field"><span>{t('Player')}</span><select className="input" value={player} onChange={e => setPlayer(e.target.value)}>{s.players.map(p => <option key={p.playerId} value={p.playerId}>{p.nickname}</option>)}</select></label>
      <label className="field"><span>{t('Adjustment')}</span><input className="input" type="number" required min={-100} max={100} value={delta} onChange={e => setDelta(Number(e.target.value))} /></label>
      <label className="field"><span>{t('Reason')}</span><input className="input" required maxLength={200} value={reason} onChange={e => setReason(e.target.value)} /></label><button className="secondary" disabled={busy}>{t('Apply correction')}</button>
    </form>
    <label className="field"><span>{t('Transfer host')}</span><select className="input" value="" disabled={busy} onChange={e => { if (e.target.value) void act('transfer-host', { playerId: e.target.value }); }}><option value="">—</option>{s.players.filter(p => p.playerId !== s.yourPlayerId).map(p => <option key={p.playerId} value={p.playerId}>{p.nickname}</option>)}</select></label>
    <div className="sf-buttons"><button className="secondary" disabled={busy} onClick={() => { if (window.confirm(t('Restart and reset all scores?'))) void act('restart'); }}>{t('Restart game')}</button>{s.phase !== 'COMPLETED' && <button className="ghost danger" disabled={busy} onClick={() => { if (window.confirm(t('End this game? The unresolved round will be void.'))) void act('end'); }}>{t('End game')}</button>}</div>
    {s.audit.length > 0 && <ol className="sf-audit">{s.audit.map((entry, i) => <li key={i}>{entry.message}</li>)}</ol>}
  </div></details>;
}
export default function SoundsFishyGame({ gameId: propId, display = false }: { gameId?: string; display?: boolean }) {
  const params = useParams(), gameId = propId ?? params.gameId ?? '', navigate = useNavigate();
  const { language, setLanguage, t } = useFishyLanguage();
  const [session, setSession] = useState<SessionData | null>(() => display ? null : loadSessionForGame(gameId));
  const [displayToken] = useState(() => display ? window.location.hash.slice(1) : '');
  const { state: s, wsStatus, lastError, requestState, receivedAt } = useGameConnection<FishyView>({ gameId, playerToken: display ? displayToken : session?.playerToken });
  const [nickname, setNickname] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [invite, setInvite] = useState(false);
  const [selected, setSelected] = useState<{ roundId: string; playerId: string } | null>(null);
  const join = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { const result = await joinGame(gameId, nickname); const next = { gameId, playerId: result.playerId, playerToken: result.playerToken, role: result.role }; saveSession(next); setSession(next); }
    catch(e) { setError(e instanceof Error ? e.message : 'Retry connection'); } finally { setBusy(false); }
  };
  const act: FishyAct = async (type, payload = {}) => {
    if (!s || !session || busy) return false;
    setBusy(true); setError('');
    const action: FishyAction = { id: crypto.randomUUID(), type, generation: s.generation, roundId: s.roundId, phase: s.phase, payload };
    try {
      await request(`${BACKEND_BASE}/api/game/${gameId}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.playerToken}` }, body: JSON.stringify(action) });
      await requestState(); return true;
    } catch(e) { setError(e instanceof Error ? e.message : 'Retry connection'); await requestState(); return false; }
    finally { setBusy(false); }
  };
  const nav = <nav className="sf-top"><Link to="/">← {t('All games')}</Link><select aria-label={t('Interface language')} value={language} onChange={e => setLanguage(e.target.value)}><option value="en">English</option><option value="de">Deutsch</option></select></nav>;
  if (!session && !display) return <main className="page sheet sounds-fishy"><section className="host-form">{nav}<p className="eyebrow">Sounds Fishy · {gameId}</p><h1>{t('Join Sounds Fishy')}</h1><form className="stack" onSubmit={join}><label className="field"><span>{t('Your nickname')}</span><input className="input" maxLength={20} required autoComplete="nickname" value={nickname} onChange={e => setNickname(e.target.value)} /></label><button className="primary" disabled={busy}>{t('Join lobby')}</button>{error && <p className="error" role="alert">{t(error)}</p>}</form></section></main>;
  if (!s) return <main className="page sheet sounds-fishy"><section className="host-form">{nav}<p role="status">{t(display && !displayToken ? 'Shared display link is missing. Open the host’s display link.' : lastError ?? 'Connecting to your shoal…')}</p><button className="secondary" onClick={() => void requestState()}>{t('Retry connection')}</button></section></main>;
  const host = s.yourRole === 'HOST', guesser = s.yourPlayerId === s.guesserId;
  const canDecide = !display && (guesser || (host && !!s.roundSettings?.facilitator));
  const active = !['LOBBY', 'RESULT', 'COMPLETED'].includes(s.phase), frozen = busy || s.paused;
  const name = (id: string | null) => s.players.find(p => p.playerId === id)?.nickname ?? '—';
  const current = s.players.find(p => p.playerId === s.yourPlayerId);
  const titles = { LOBBY: 'Gather your shoal', PREPARATION: 'Think of a believable answer', COLLECTION: 'Write your answer', ELIMINATION: 'Keep fishing?', RESULT: 'The truth surfaces', COMPLETED: 'The final catch' };
  const joinUrl = `${(import.meta.env.VITE_FRONTEND_URL || window.location.origin).replace(/\/$/, '')}/g/${gameId}`;
  const roundBank = s.banks.find(b => b.bankId === (s.roundSettings ?? s.settings).bankId);
  const rank = [...s.players].sort((a, b) => (s.scores[b.playerId] ?? 0) - (s.scores[a.playerId] ?? 0));
  return <main className={`page sheet sounds-fishy ${display ? 'sf-display' : ''}`}><section className="game-view sf-game">{nav}
    <header className="sf-header"><div><p className="eyebrow">Sounds Fishy · {gameId}</p><h1>{t(titles[s.phase])}</h1></div>{!display && <button className="ghost" onClick={() => setInvite(true)}>{t('Invite players')}</button>}</header>
    <div className="score-strip sf-strip"><span>{t('Round')}<strong>{s.round} / {s.totalRounds}</strong></span><span>{t('Guesser')}<strong>{name(s.guesserId)}</strong></span><span>{t('At risk')}<strong>{s.phase === 'ELIMINATION' ? s.provisional : 0}</strong></span></div>
    {wsStatus !== 'open' && <p className="footnote" role="status">{t('Reconnecting… updates resume automatically.')}</p>}
    {(error || lastError) && <p className="error" role="alert">{t(error || lastError || '')}</p>}
    {s.notice && <p className="warning-banner" role="status">{t(s.notice)}</p>}
    {roundBank?.development && (s.phase === 'LOBBY' || s.phase === 'RESULT') && <p className="warning-banner">{t('Sample questions only · full English and German banks are still to be supplied.')}</p>}
    <Countdown state={s} receivedAt={receivedAt} t={t} />
    {current?.pending && <p className="role-banner">{t('Spectating until the next game')}</p>}
    {s.phase === 'LOBBY' ? <div className="card sf-lobby">
      <p className="footnote">4–10 · {t('Late arrivals join as spectators until the host restarts.')}</p>
      <ol className="sf-roster">{s.order.map((id, i) => { const p = s.players.find(p => p.playerId === id)!; return <li key={id}>
        <span><strong>{p.nickname}</strong> {p.role === 'HOST' && <small>{t('Host')}</small>}<small>{t(p.connected ? 'Online' : 'Offline')} · {t(p.participating ? 'Playing' : 'Sitting out')}</small></span>
        {host && <div className="sf-seat-buttons"><button className="ghost" disabled={busy || i === 0} aria-label={`${t('Move up')} ${p.nickname}`} onClick={() => { const order = [...s.order]; [order[i - 1], order[i]] = [order[i], order[i - 1]]; void act('order', { order }); }}>↑</button><button className="ghost" disabled={busy || i === s.order.length - 1} aria-label={`${t('Move down')} ${p.nickname}`} onClick={() => { const order = [...s.order]; [order[i + 1], order[i]] = [order[i], order[i + 1]]; void act('order', { order }); }}>↓</button><input type="checkbox" aria-label={`${t('Playing')} ${p.nickname}`} checked={p.participating} disabled={busy} onChange={e => void act('participation', { playerId: id, participating: e.target.checked })} /></div>}
      </li>; })}</ol>
      {host && <SoundsFishySettings state={s} act={act} busy={busy} t={t} />}
      {host ? <button className="primary" disabled={busy || s.players.filter(p => p.participating).length < 4} onClick={() => void act('start')}>{t('Start game')}</button> : <p className="footnote">{t('Waiting for the host')}</p>}
    </div> : <>
      {s.question && <div className="sf-question" data-testid="fishy-question"><p className="eyebrow">{t('Round')} {s.round}</p><h2>{s.question}</h2></div>}
      {active && guesser && <p className="role-banner">{t('You are the Guesser')} · {t('Listen to every answer. Eliminate lies, then bank your points.')}</p>}
      {active && s.ownRole && <aside className={`sf-private sf-${s.ownRole}`} data-testid="fishy-private"><p className="eyebrow">{t('Private · for your eyes only')}</p><h2>{t(s.ownRole === 'blue' ? 'True Blue Kipper' : 'Red Herring')}</h2><strong className="sf-real-answer">{s.answer}</strong><p>{t(s.ownRole === 'blue' ? 'Say the real answer, but make it sound suspicious.' : 'Invent a believable false answer.')}</p></aside>}
      {s.phase === 'PREPARATION' && <div className="sf-preparation"><p>{t('Take about 15 seconds to think. Then answer aloud in this order.')}</p><h3>{t('Speaking order')}</h3><ol className="sf-speaking">{s.fish.map(id => <li key={id}>{name(id)}</li>)}</ol>{canDecide ? <button className="primary" disabled={frozen} onClick={() => void act('present')}>{t('Start guessing')}</button> : <p className="footnote">{t('Waiting for the Guesser')}</p>}</div>}
      {s.phase === 'COLLECTION' && <div className="card"><p role="status">{s.submitted.length} / {s.fish.length} · {t('Waiting for')} {s.fish.filter(id => !s.submitted.includes(id)).map(id => name(id)).join(', ') || '—'}</p>{s.ownRole && <AnswerForm key={s.roundId} s={s} act={act} disabled={frozen} t={t} />}</div>}
      {['ELIMINATION', 'RESULT', 'COMPLETED'].includes(s.phase) && <>
        <div className="sf-fish-grid">{s.fish.map((id, i) => { const role = s.roles[id], eliminated = s.eliminated.includes(id), chosen = selected?.roundId === s.roundId && selected.playerId === id; return <div className={`sf-fish ${role ? `sf-${role}` : ''} ${chosen ? 'sf-chosen' : ''}`} key={id}>
          <span className="sf-fish-art" aria-hidden="true">&gt;&lt;&gt;</span><strong>{name(id)}</strong>
          {s.answers?.[id] && <p className="sf-written-answer">{s.answers[id]}</p>}
          <small>{role ? `${eliminated ? `${t('Eliminated')} · ` : ''}${t(role === 'red' ? 'Red Herring' : 'True Blue Kipper')}` : `${i + 1} · ${t('Hidden fish')}`}</small>
          {canDecide && s.phase === 'ELIMINATION' && !eliminated && <button className={chosen ? 'primary' : 'secondary'} disabled={frozen} aria-label={`${t(chosen ? 'Reveal fish' : 'Eliminate')} ${name(id)}`} onClick={() => {
            if (!chosen) setSelected({ roundId: s.roundId, playerId: id });
            else { setSelected(null); void act('eliminate', { playerId: id }); }
          }}>{t(chosen ? 'Reveal fish' : 'Eliminate')}</button>}
          {chosen && s.phase === 'ELIMINATION' && <button className="ghost" onClick={() => setSelected(null)}>{t('Cancel')}</button>}
        </div>; })}</div>
        {s.phase === 'ELIMINATION' && <div className="sf-decision"><p>{t('Keep fishing by choosing another suspected lie. A blue fish loses your round points.')}</p>{canDecide && <button className="primary" disabled={frozen} onClick={() => void act('bank')}>{t('Bank points')} · {s.provisional}</button>}</div>}
      </>}
      {s.result && <div className="sf-result" role="status"><h2>{t({ blue: 'Blue caught · Guesser scores zero', 'all-reds': 'All Reds caught · bonus point!', banked: 'Points banked', void: 'Round void · no points' }[s.result.outcome])}</h2><p className="eyebrow">{t('The real answer')}</p><strong className="sf-real-answer" data-testid="fishy-revealed-answer">{s.answer}</strong><p>{s.explanation}</p>{s.result.reason && <p>{t(s.result.reason)}</p>}
        <ul className="sf-round-points" aria-label={t('Round points')}>{Object.entries(s.result.points).map(([id, n]) => <li key={id}><span>{name(id)}</span><strong>+{n}</strong></li>)}</ul>
        {s.sources && <details><summary>{t('Sources')}</summary>{s.sources.map(source => <p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.publisher} · {source.title} ↗</a></p>)}</details>}
        {host && s.phase === 'RESULT' && <button className="primary" disabled={frozen} onClick={() => void act('next')}>{t(s.result.outcome === 'void' ? 'Replay with a new question' : s.round >= s.totalRounds ? 'Show final ranking' : 'Next round')}</button>}
      </div>}
      {s.phase === 'COMPLETED' && <div className="sf-winners"><h2>{t(s.winners.length > 1 ? 'Shared victory' : 'Winner')}</h2><strong>{s.winners.map(id => name(id)).join(' & ')}</strong>{s.endedReason && <p>{t(s.endedReason)}</p>}</div>}
    </>}
    {s.phase !== 'LOBBY' && <details className="sf-ranking" open={s.phase === 'RESULT' || s.phase === 'COMPLETED' || display}><summary>{t('Overall ranking')}</summary><ol>{rank.map(p => <li key={p.playerId}><span>{p.nickname}{p.role === 'HOST' ? ` · ${t('Host')}` : ''}{p.pending ? ` · ${t('Spectator')}` : ''}</span><strong>{s.scores[p.playerId] ?? 0}</strong></li>)}</ol></details>}
    {host && s.displayToken && <p className="sf-display-link"><a href={`${joinUrl}/display#${s.displayToken}`} target="_blank" rel="noreferrer">▣ {t('Shared display')} ↗</a></p>}
    {host && <Administration s={s} act={act} busy={busy} t={t} />}
    {!host && !display && s.players.some(p => p.role === 'HOST' && !p.connected) && !current?.pending && <button className="secondary" disabled={busy} onClick={() => void act('claim-host')}>{t('Recover host after 60 seconds offline')}</button>}
    {s.paused && guesser && !host && <button className="primary" disabled={busy} onClick={() => void act('resume')}>{t('Resume')}</button>}
    <details className="sf-rules"><summary>{t('How to play')}</summary><p>{fishyRules[language === 'de' ? 'de' : 'en']}</p><p>{t('Reconnects keep the same seat and private role.')}</p><p>{t('Question pool')}: {s.poolRemaining} {t('remaining')} · {t('cycle')} {s.poolCycle}</p></details>
    {!display && <button className="ghost" disabled={busy} onClick={async () => { if (window.confirm(t('Leave this game? Your seat stays saved for reconnection.')) && await act('leave')) navigate('/'); }}>{t('Leave room')}</button>}
    {invite && <AddPlayerPanel joinUrl={joinUrl} gameCode={gameId} translate={t} onClose={() => setInvite(false)} />}
  </section></main>;
}
