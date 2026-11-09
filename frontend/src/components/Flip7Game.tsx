import { useRoomCommand } from '../hooks/useRoomCommand';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { flipLabel, type FlipAction, type FlipPlayer, type FlipView } from '../../../shared/flip7';
import { joinGame } from '../api';
import { useGameConnection } from '../hooks/useGameConnection';
import { loadSessionForGame, saveSession } from '../lib/session';
import type { SessionData } from '../lib/types';
import AddPlayerPanel from './AddPlayerPanel';
import FlipCard from './FlipCard';
import FlipActionReveal from './FlipActionReveal';
import FlipSettings, { FlipRulesSummary } from './FlipSettings';

type Act = (type: string, payload?: Record<string, unknown>) => Promise<boolean>;
const playerName = (s: FlipView, id?: string | null) => s.players.find(p => p.playerId === id)?.nickname ?? 'Player';

function Timer({ s, receivedAt }: { s: FlipView; receivedAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  const at = s.deadline ?? s.nextRoundAt;
  return at ? <span className="f7-timer" role="timer">{s.paused ? 'Paused' : `${Math.max(0, Math.ceil((at - s.serverNow - (now - receivedAt)) / 1000))}s`}{s.nextRoundAt ? ' · next round' : ' · decision'}</span> : null;
}

/** Event IDs prevent replay after rerenders. Animation never sends gameplay actions. */
function Motion({ s, enabled }: { s: FlipView; enabled: boolean }) {
  const seen = useRef(0);
  const running = useRef(new Set<{ node: HTMLElement; animation: Animation }>());
  useEffect(() => () => { for (const f of running.current) { f.animation.cancel(); f.node.remove(); } running.current.clear(); }, []);
  useEffect(() => {
    const fresh = s.events.filter(e => e.id > seen.current && e.at > s.serverNow - 4000);
    seen.current = s.events.at(-1)?.id ?? seen.current;
    if (!enabled || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const e of fresh) {
      const seat = document.querySelector(`[data-flip-player="${CSS.escape(e.actor ?? '')}"]`);
      if (!seat) continue;
      if (['bust', 'save', 'freeze', 'flip7', 'win'].includes(e.type)) {
        seat.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(1.6)', transform: e.type === 'bust' ? 'translateX(6px)' : 'scale(1.025)' }, { filter: 'brightness(1)', transform: 'none' }], { duration: 650 });
      }
      if (e.type !== 'draw' && e.type !== 'save') continue;
      const source = e.type === 'save' ? seat : document.querySelector('.f7-deck');
      const dest = e.type === 'save' ? document.querySelector('.f7-discard') : seat.querySelector('.f7-hand');
      if (!source || !dest || !e.card) continue;
      const a = source.getBoundingClientRect(), b = dest.getBoundingClientRect();
      const node = document.createElement('div'); node.className = 'f7-flight'; node.setAttribute('aria-hidden', 'true');
      const svg = document.querySelector(`[data-flip-card-id="${CSS.escape(e.card.id)}"]`) ?? document.querySelector('.f7-reveal svg');
      if (svg) node.append(svg.cloneNode(true)); else node.textContent = flipLabel(e.card);
      node.style.left = `${a.x + a.width / 2}px`; node.style.top = `${a.y + a.height / 2}px`; document.body.append(node);
      const dx = b.x + b.width / 2 - a.x - a.width / 2, dy = b.y + b.height / 2 - a.y - a.height / 2;
      const animation = node.animate([
        { transform: 'translate(-50%, -50%) rotateY(180deg) scale(.65)', opacity: .4 },
        { transform: `translate(calc(-50% + ${dx * .7}px), calc(-50% + ${dy * .7}px)) rotateY(70deg)`, opacity: 1, offset: .55 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotateY(0deg) scale(.85)`, opacity: 0 },
      ], { duration: e.type === 'save' ? 600 : 540, delay: e.type === 'save' ? 260 : 0, easing: 'cubic-bezier(.2,.7,.3,1)' });
      const item = { node, animation }; running.current.add(item);
      animation.onfinish = () => { node.remove(); running.current.delete(item); };
      if (e.type === 'save') {
        const chance = node.cloneNode(true) as HTMLElement;
        const labels = chance.querySelectorAll('text');
        if (labels[0]) labels[0].textContent = '↻';
        if (labels[1]) labels[1].textContent = '↻';
        if (labels[2]) labels[2].textContent = 'SECOND CHANCE';
        document.body.append(chance);
        const discard = chance.animate([
          { transform: 'translate(-35%, -50%) rotate(-12deg)', opacity: 1 },
          { transform: `translate(calc(-50% + ${dx + 20}px), calc(-50% + ${dy}px)) rotate(20deg) scale(.7)`, opacity: 0 },
        ], { duration: 600, delay: 360, easing: 'ease-in' });
        const protectedCard = { node: chance, animation: discard }; running.current.add(protectedCard);
        discard.onfinish = () => { chance.remove(); running.current.delete(protectedCard); };
      }
    }
  }, [s.events, s.serverNow, enabled]);
  return null;
}

function PlayerSeat({ p, s, index }: { p: FlipPlayer; s: FlipView; index: number }) {
  const current = (s.pending?.owner ?? s.forced?.playerId ?? s.turn) === p.playerId;
  const busted = p.hand.status === 'busted';
  const numbers = p.hand.cards.filter(c => c.kind === 'number');
  const duplicate = numbers.find((c, i) => numbers.findIndex(other => other.value === c.value) !== i)?.value;
  const extras = p.hand.cards.filter(c => c.kind !== 'number');
  return <article className={`f7-seat ${current ? 'is-current' : ''} is-${p.hand.status} ${p.hand.flip7 ? 'is-seven' : ''}`} data-flip-player={p.playerId} style={{ '--seat-color': ['#8be2b4', '#b8b4f5', '#f4b39a', '#91d9f4', '#f1d784', '#eba7ce'][index % 6] } as CSSProperties}>
    <div className="f7-seat-top"><span className="f7-avatar" aria-hidden="true">{p.nickname.slice(0, 1).toUpperCase()}</span><div className="f7-player-name"><h2>{p.nickname}{p.playerId === s.yourPlayerId && <small> you</small>}</h2><span>{!p.connected ? 'Offline · ' : ''}{p.playerId === s.dealer ? 'Dealer · ' : ''}{p.hand.flip7 ? `FLIP ${s.settings.rules.unique}!` : p.hand.status === 'active' ? current ? s.pending ? 'Choosing a target' : s.forced ? 'Flipping three' : 'Your move' : 'In the round' : p.hand.status}</span></div><div className="f7-total"><strong key={p.total}>{p.total}</strong><small>total</small></div></div>
    <div className="f7-hand" style={{ '--card-slots': Math.max(7, numbers.length) } as CSSProperties}>{numbers.length ? numbers.map(c => <FlipCard key={c.id} card={c} highlight={busted && c.value === duplicate} />) : <span className="f7-empty-hand">{s.dealing ? 'Dealing…' : 'No number cards yet'}</span>}</div>
    <div className="f7-modifiers">{extras.map(c => <span key={c.id} className={`f7-mod f7-mod-${c.kind}`} title={flipLabel(c)}><FlipCard card={c} /><span>{flipLabel(c)}</span></span>)}{s.forced?.playerId === p.playerId && <span className="f7-forced">{s.forced.remaining} forced draws left</span>}</div>
    <div className="f7-seat-bottom"><span className={`f7-status f7-status-${p.hand.status}`}>{p.hand.status === 'active' ? `${numbers.length}/${s.settings.rules.unique} unique` : p.hand.status === 'busted' ? 'BUST · 0 points' : `${p.hand.status} · secured`}</span><span><strong>{p.potential}</strong> <small>round pts</small></span></div>
  </article>;
}

function Table({ s }: { s: FlipView }) {
  const latest = s.events.at(-1);
  const reveal = [...s.events].reverse().find(e => e.card && e.type === 'draw');
  return <section className="f7-table" aria-label="Complete game table">
    <div className="f7-table-center"><div className="f7-deck"><FlipCard back /><strong>{s.deckCount}</strong><small>draw pile</small></div>
      <div className="f7-table-message"><p className="eyebrow">{s.paused ? 'Take a breather' : s.phase === 'RESULTS' ? 'Round complete' : s.phase === 'COMPLETED' ? 'Good game' : s.pending ? `${playerName(s, s.pending.owner)} chooses` : s.forced ? `${playerName(s, s.forced.playerId)} flips three` : s.dealing ? 'A fresh round of possibilities' : `${playerName(s, s.turn)}’s turn`}</p>
        <h2>{s.paused ? 'Game paused' : s.pending ? flipLabel(s.pending.card) : s.forced ? `${s.forced.remaining} cards to go` : s.phase === 'PLAY' && !s.dealing ? 'One more?' : s.phase === 'COMPLETED' && s.winner ? `${playerName(s, s.winner)} wins!` : `Round ${s.round}`}</h2>
        <p className={`f7-event f7-event-${latest?.type}`} key={latest?.id} aria-live="polite">{latest?.message ?? 'The table is ready.'}</p>
      </div><div className="f7-reveal" key={reveal?.id}>{reveal?.card && <FlipCard card={reveal.card} />}</div><div className="f7-discard"><span>↻</span><strong>{s.discardCount}</strong><small>discard pile</small></div>
    </div>
    <div className="f7-seats" data-player-count={s.players.length}>{s.players.map((p, i) => <PlayerSeat key={p.playerId} p={p} s={s} index={i} />)}</div>
  </section>;
}

function Controls({ s, act, busy, compact }: { s: FlipView; act: Act; busy: boolean; compact: boolean }) {
  const own = s.players.find(p => p.playerId === s.yourPlayerId)!;
  const mine = s.pending?.owner === own.playerId;
  return <section className={`f7-controller ${compact ? 'f7-controller-party' : ''}`} aria-label="Player controls">
    {compact && <><p className="eyebrow">{own.nickname}</p><div className="f7-controller-score"><strong>{own.potential}</strong><span>round points</span></div></>}
    {s.paused ? <h2>Game paused</h2> : mine && s.pending ? <><p className="eyebrow">Your choice</p><h2>{flipLabel(s.pending.card)}</h2><p>{s.pending.card.kind === 'freeze' ? 'Who banks their points?' : s.pending.card.kind === 'flip-three' ? 'Who takes three cards?' : 'Who gets a Second Chance?'}</p>
      <div className="f7-targets">{s.pending.eligible.map(id => <button className="secondary" disabled={busy} key={id} onClick={() => void act('target', { target: id })}>{playerName(s, id)}{id === s.yourPlayerId ? ' (you)' : ''}</button>)}</div></>
      : s.phase === 'RESULTS' || s.phase === 'COMPLETED' ? <h2>{s.winner ? `${playerName(s, s.winner)} wins!` : s.phase === 'COMPLETED' ? 'Good game!' : 'Points banked. Nice round.'}</h2>
      : own.hand.status !== 'active' ? <><h2 className={`f7-controller-${own.hand.status}`}>{own.hand.status === 'busted' ? 'BUST!' : own.hand.status === 'frozen' ? 'Frozen ❄' : 'Points secured'}</h2><p>{own.hand.status === 'busted' ? 'A fresh chance next round.' : `${own.potential} points safe. Sit back and watch.`}</p></>
      : s.canHit ? <><h2>Your turn.</h2><p>{compact ? 'Eyes on the table. Trust your luck.' : `${own.potential} points on the table. What’s your move?`}</p><div className="f7-play-buttons"><button className="f7-hit" disabled={busy} onClick={() => void act('hit')}><span>＋</span>HIT<small>Take a chance</small></button><button className="f7-stay" disabled={busy || !s.canStay} onClick={() => void act('stay')}><span>✓</span>STAY<small>Bank {own.potential} points</small></button></div>{!s.canStay && <p className="f7-help">You need a card before you can Stay.</p>}</>
      : <><span className="f7-wait-orbit" aria-hidden="true">✦</span><h2>{s.dealing ? 'Cards on the way' : s.forced?.playerId === own.playerId ? `Flipping three · ${s.forced.remaining} left` : 'You’re up soon.'}</h2><p>{s.dealing ? 'Watch the opening deal.' : `${playerName(s, s.pending?.owner ?? s.forced?.playerId ?? s.turn)} ${s.pending ? 'is choosing a target' : s.forced ? 'is flipping three' : 'is taking their turn'}.`}</p></>}
    {compact && <p className="f7-controller-total">{own.total} total points · Round {s.round}</p>}
  </section>;
}

function Results({ s }: { s: FlipView }) {
  const sorted = [...s.players].sort((a, b) => b.total - a.total);
  return <section className={`f7-results ${s.winner ? 'f7-winner' : ''}`} aria-label={s.winner ? 'Final scoreboard' : 'Round results'}>
    <div><p className="eyebrow">{s.winner ? '✦ The nerve. The glory. ✦' : `Round ${s.round} results`}</p><h2>{s.winner ? `${playerName(s, s.winner)} wins!` : s.result?.flip7 ? `FLIP ${s.settings.rules.unique}!` : 'Banked & brilliant.'}</h2><p>{s.endedReason ?? (s.result?.tied ? 'Tied at the top. Everyone joins the tie-break round.' : s.result?.flip7 ? `${playerName(s, s.result.flip7)} earns +${s.settings.rules.bonus} bonus.` : 'Every point counts.')}</p></div>
    <ol className="f7-scoreboard">{sorted.map(p => <li key={p.playerId}><span>{p.nickname}</span><span className="f7-earned">+{s.result?.scores[p.playerId] ?? 0}</span><strong>{p.total}</strong><div style={{ width: `${Math.min(100, p.total / Math.max(s.settings.rules.target, ...sorted.map(p => p.total), 1) * 100)}%` }} /></li>)}</ol>
  </section>;
}

function HostMenu({ s, act, busy }: { s: FlipView; act: Act; busy: boolean }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const decision = s.pending?.owner ?? s.turn;
  const offline = decision && !s.players.find(p => p.playerId === decision)?.connected;
  return <details className="f7-host-menu"><summary>Host controls</summary><div className="f7-host-panel">
    <label className="field"><span>Display Mode</span><select className="input" aria-label="Display Mode" value={s.settings.displayMode} disabled={busy} onChange={e => void act('display-mode', { mode: e.target.value })}><option value="normal">Normal · full table on every phone</option><option value="tv">TV / Party · phones as controllers</option></select></label>
    {s.displayUrl && <a className="secondary f7-display-link" href={s.displayUrl} target="_blank" rel="noopener noreferrer">Open TV Display ↗</a>}
    <p className="f7-help">Open this link on your shared screen. To return everyone to full phone play, choose Normal. The display never takes a player seat.</p>
    <div className="f7-buttons">{(s.phase === 'PLAY' || s.phase === 'RESULTS') && <button className="secondary" disabled={busy} onClick={() => void act(s.paused ? 'resume' : 'pause')}>{s.paused ? 'Resume game' : 'Pause game'}</button>}
      {s.deadline && <button className="secondary" disabled={busy} onClick={() => void act('extend')}>Add 30 seconds</button>}
      {offline && s.phase === 'PLAY' && <button className="secondary" disabled={busy || s.paused} onClick={() => void act('recover')}>Resolve offline player’s decision</button>}
      {s.phase !== 'LOBBY' && <><button className="secondary" disabled={busy} onClick={() => setConfirm('restart')}>Restart game</button><button className="secondary" disabled={busy} onClick={() => setConfirm('lobby')}>Return to lobby</button></>}
      {s.phase !== 'COMPLETED' && <button className="secondary" disabled={busy} onClick={() => setConfirm('end')}>End game</button>}
    </div>
    {confirm && <div role="alertdialog" aria-label="Confirm game change"><p>{confirm === 'end' ? 'End this game and keep completed round totals?' : 'Clear all game progress? Players will keep their seats.'}</p><div className="f7-buttons"><button className="primary" disabled={busy} onClick={async () => { if (await act(confirm)) setConfirm(null); }}>Confirm {confirm === 'lobby' ? 'return to lobby' : confirm}</button><button className="secondary" onClick={() => setConfirm(null)}>Cancel</button></div></div>}
    <FlipRulesSummary settings={s.settings} />
  </div></details>;
}

export default function Flip7Game({ gameId, display = false }: { gameId: string; display?: boolean }) {
  const [session, setSession] = useState<SessionData | null>(() => display ? null : loadSessionForGame(gameId));
  const [displayToken] = useState(() => {
    if (!display) return undefined;
    const key = `flip7-display-${gameId}`;
    const t = new URLSearchParams(location.hash.slice(1)).get('token') ?? new URLSearchParams(location.search).get('token');
    try { if (t) sessionStorage.setItem(key, t); return t ?? sessionStorage.getItem(key) ?? undefined; } catch { return t ?? undefined; }
  });
  const token = display ? displayToken : session?.playerToken;
  const { state: s, wsStatus, lastError, requestState, receivedAt } = useGameConnection<FlipView>({ gameId, playerToken: token });
  const [nickname, setNickname] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''),
    [invite, setInvite] = useState(false), [inspect, setInspect] = useState(false);
  const { send, retry } = useRoomCommand<FlipAction>({
    gameId, token: display ? undefined : session?.playerToken,
    refresh: requestState, setBusy, setError,
  });
  const act: Act = async (type, payload = {}) => s ? send({ id: crypto.randomUUID(), type, payload, generation: s.generation, revision: s.revision, round: s.round }) : false;
  const join = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await joinGame(gameId, nickname.trim()); const value: SessionData = { gameId, playerId: r.playerId, playerToken: r.playerToken, role: 'PLAYER' }; saveSession(value); setSession(value); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not join'); } finally { setBusy(false); }
  };
  if (!session && !display) return <main className="page sheet f7"><section className="host-form"><Link to="/">← All games</Link><p className="eyebrow">Room {gameId}</p><h1>FLIP 7</h1><p>A little luck. A lot of nerve.</p><form className="stack" onSubmit={join}><label className="field"><span>Your nickname</span><input className="input" autoComplete="nickname" required maxLength={20} value={nickname} onChange={e => setNickname(e.target.value)} /></label><button className="primary" disabled={busy}>Join lobby</button></form>{error && <p className="error" role="alert">{error}</p>}</section></main>;
  if (!s) return <main className="page sheet f7"><section className="host-form"><p role="status">{lastError ?? (display && !token ? 'Use the Open TV Display link from the host.' : 'Reconnecting to your table…')}</p><button className="secondary" onClick={() => void requestState()}>Retry connection</button><Link to="/">All games</Link></section></main>;
  const host = !display && s.yourRole === 'HOST', party = !display && s.settings.displayMode === 'tv' && s.phase !== 'LOBBY';
  const fullTable = display || !party || inspect;
  return <main className={`f7 f7-game ${display ? 'f7-display' : ''} ${party ? 'f7-party' : ''}`}>
    <FlipActionReveal key={`${s.gameId}-${s.generation}`} s={s} />
    <Motion s={s} enabled={fullTable && s.phase !== 'LOBBY'} />
    <header className="f7-header"><div className="f7-brand">FLIP <span>7</span><small>{display ? 'THE SHARED TABLE' : `ROOM ${gameId}`}</small></div>
      <div className="f7-header-meta"><span>{s.round ? `ROUND ${s.round}` : 'LET’S GET TOGETHER'}</span>{s.round > 0 && <span>{s.settings.rules.fixedRounds ? `${s.settings.rules.fixedRounds} rounds` : `Race to ${s.settings.rules.target}`}</span>}<Timer s={s} receivedAt={receivedAt} /></div>
      {display ? <button className="secondary f7-fullscreen" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => setError('Fullscreen is unavailable in this browser.')); }}>Fullscreen</button> : <Link className="f7-home-link" to="/">All games</Link>}
    </header>
    {wsStatus !== 'open' && <p className="f7-connection" role="status">{lastError ?? 'Reconnecting… Your progress is saved.'}</p>}
    {error && <div className="f7-error" role="alert">{error}{retry && <button className="secondary" onClick={() => void send(retry)}>Retry same action safely</button>}</div>}
    {s.phase === 'LOBBY' ? <section className="f7-lobby"><div className="f7-lobby-main"><p className="eyebrow">The next card could change everything</p><h1>Good friends.<br /><span>Great risks.</span></h1><p>Everyone sees the table. Everyone gets a turn.</p>
      <div className="f7-lobby-players" aria-label="Lobby players">{s.players.map((p, i) => <div key={p.playerId}><span className={`f7-dot ${p.connected ? 'online' : ''}`} /><strong>{p.nickname}</strong><small>{p.role === 'HOST' ? 'Host · playing' : p.connected ? 'Ready' : 'Reconnecting'}</small>{host && <div className="f7-seat-order"><button className="secondary" aria-label={`Move ${p.nickname} up`} disabled={busy || i === 0} onClick={() => { const ids = s.players.map(p => p.playerId); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; void act('reorder', { order: ids }); }}>↑</button><button className="secondary" aria-label={`Move ${p.nickname} down`} disabled={busy || i === s.players.length - 1} onClick={() => { const ids = s.players.map(p => p.playerId); [ids[i], ids[i + 1]] = [ids[i + 1], ids[i]]; void act('reorder', { order: ids }); }}>↓</button>{p.role !== 'HOST' && <button className="secondary" aria-label={`Remove ${p.nickname}`} disabled={busy} onClick={() => void act('remove', { playerId: p.playerId })}>×</button>}</div>}</div>)}</div>
      <FlipRulesSummary settings={s.settings} />
      {!display && <div className="f7-buttons"><button className="secondary" onClick={() => setInvite(true)}>Invite players / QR</button>{host && <button className="primary" disabled={busy || s.players.length < 2} onClick={() => void act('start')}>Start Flip 7</button>}</div>}
      {!host && !display && <p className="f7-help">The host will start when everyone is ready.</p>}
      {host && <HostMenu s={s} act={act} busy={busy} />}
    </div>{host && <FlipSettings key={`${s.generation}-${s.settings.profileId}`} settings={s.settings} busy={busy} apply={value => act('settings', { settings: { ...value, displayMode: s.settings.displayMode } })} />}</section>
      : <>
        {fullTable && <Table s={s} />}
        {(s.phase === 'RESULTS' || s.phase === 'COMPLETED') && fullTable && <Results s={s} />}
        {!display && <><Controls s={s} act={act} busy={busy} compact={party} />
          {party && <button className="f7-inspect secondary" onClick={() => setInspect(v => !v)}>{inspect ? 'Back to controller' : 'Peek at the full table'}</button>}
          {host && s.phase === 'RESULTS' && <button className="primary f7-next" disabled={busy || s.paused} onClick={() => void act('next-round')}>Next round</button>}
          {host && <HostMenu s={s} act={act} busy={busy} />}
        </>}
        {fullTable && <details className="f7-history"><summary>Recent flips & round history</summary><ol>{s.events.slice(-12).reverse().map(e => <li key={e.id}>{e.message}</li>)}</ol>{s.history.map(r => <p key={r.round}>Round {r.round}: {s.players.map(p => `${p.nickname} +${r.scores[p.playerId] ?? 0}`).join(' · ')}</p>)}</details>}
      </>}
    {invite && <AddPlayerPanel gameCode={gameId} joinUrl={`${location.origin}/g/${gameId}`} onClose={() => setInvite(false)} />}
  </main>;
}
