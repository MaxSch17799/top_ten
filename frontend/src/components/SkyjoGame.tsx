import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { SkyAction, SkyPlayer, SkyView } from '../../../shared/skyjo';
import { ApiError, BACKEND_BASE, joinGame, request } from '../api';
import { useGameConnection } from '../hooks/useGameConnection';
import { loadSessionForGame, saveSession } from '../lib/session';
import type { SessionData } from '../lib/types';
import AddPlayerPanel from './AddPlayerPanel';
import SkyCard from './SkyCard';
import SkySettings, { SkyRulesSummary } from './SkySettings';

type Act = (type: string, payload?: Record<string, unknown>) => Promise<boolean>;
const playerName = (s: SkyView, id?: string | null) => s.players.find(p => p.playerId === id)?.nickname ?? 'Player';
const accents = ['#b6e6d3', '#c7b6f6', '#f3ac94', '#b8dbf4', '#f3d782', '#efb7dc', '#b4dca5', '#e5c9b5'];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function Timer({ s, receivedAt }: { s: SkyView; receivedAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  const at = s.deadline ?? s.nextRoundAt;
  return at ? <span className="sky-timer" role="timer">{s.paused ? 'Paused' : `${Math.max(0, Math.ceil((at - s.serverNow - (now - receivedAt)) / 1000))}s`}{s.nextRoundAt ? ' · next round' : ' · turn'}</span> : null;
}

function Grid({ p, s, act, busy, compact = false }: { p: SkyPlayer; s: SkyView; act?: Act; busy: boolean; compact?: boolean }) {
  const own = s.yourPlayerId === p.playerId, opening = s.phase === 'SETUP' && p.startingRevealed < s.settings.rules.startingCards;
  const choosing = s.phase === 'PLAY' && s.turn === p.playerId && ['replace', 'reveal'].includes(s.step);
  const interactive = !!act && own && !s.paused && (opening || choosing);
  const action = opening ? 'setup' : s.step === 'replace' ? 'replace' : 'reveal';
  const recent = [...s.events].reverse().find(e => e.actor === p.playerId);
  return <article className={`sky-seat ${s.turn === p.playerId ? 'is-current' : ''} ${compact ? 'is-compact' : ''}`} data-sky-player={p.playerId} style={{ '--seat-accent': accents[s.players.indexOf(p) % accents.length] } as CSSProperties}>
    <div className="sky-seat-heading"><div className="sky-avatar" aria-hidden="true">{p.nickname.slice(0, 1).toUpperCase()}</div><div className="sky-seat-name"><h2>{p.nickname}{own && <small> you</small>}</h2><span>{!p.connected ? 'Offline · ' : ''}{s.phase === 'SETUP' ? `${p.startingRevealed}/${s.settings.rules.startingCards} revealed` : s.finisher === p.playerId ? 'Closed the round' : s.turn === p.playerId ? 'Taking a turn' : `${p.hidden} hidden`}</span></div><div className="sky-seat-total"><strong key={p.total}>{p.total}</strong><small>total</small></div></div>
    <div className="sky-grid" aria-label={`${p.nickname}'s card grid`}>
      {p.grid.map((slot, i) => {
        const valid = interactive && slot && (action === 'replace' || slot.value === null);
        const label = `Row ${Math.floor(i / 4) + 1}, column ${i % 4 + 1}: ${slot ? slot.value === null ? 'hidden' : slot.value : 'removed'}`;
        return <div className={`sky-position ${valid ? 'is-target' : ''} ${!slot ? 'is-empty' : ''}`} data-sky-index={i} key={i}>
          {slot ? <button className="sky-grid-card" key={`${slot.id}-${slot.value}`} disabled={!valid || busy} aria-label={`${valid ? `${action === 'replace' ? 'Replace' : 'Reveal'} ` : ''}${label}`} onClick={e => {
            // Native scroll snap cancels touch clicks; also guard custom pointer swipes.
            if (e.detail > 0 && e.currentTarget.closest('[data-swiping="true"]')) return;
            if (valid) void act?.(action, { index: i });
          }} style={{ '--deal-delay': `${i * 22}ms` } as CSSProperties}><SkyCard value={slot.value} /></button>
            : <span className="sky-empty" aria-label={label}><span>✦</span></span>}
        </div>;
      })}
    </div>
    <div className="sky-seat-footer"><span><strong key={p.visible}>{p.visible}</strong> visible pts {p.hidden > 0 && <small>+ {p.hidden} hidden</small>}</span><span className="sky-update" key={recent?.id}>{recent?.type === 'column' ? '✦ Column cleared' : s.finalTurns.includes(p.playerId) ? 'Final turn' : s.phase === 'RESULTS' || s.phase === 'COMPLETED' ? 'Round scored' : '3 of a kind clears a column'}</span></div>
  </article>;
}

/** Native scrolling keeps gestures reliable, accessible, and independent of gameplay. */
function PhoneTable({ s, act, busy }: { s: SkyView; act: Act; busy: boolean }) {
  const rail = useRef<HTMLDivElement>(null), chips = useRef<HTMLDivElement>(null), pointer = useRef<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<'turn' | 'mine' | 'browse'>(() => s.phase === 'SETUP' ? 'mine' : 'turn');
  const [focused, setFocused] = useState(s.phase === 'SETUP' ? s.yourPlayerId : s.turn ?? s.yourPlayerId);
  const target = mode === 'turn' ? s.turn ?? s.yourPlayerId : mode === 'mine' ? s.yourPlayerId : null;
  useEffect(() => {
    const node = rail.current, index = s.players.findIndex(p => p.playerId === target);
    if (node && index >= 0) node.scrollTo({ left: index * node.clientWidth, behavior: reduced() ? 'instant' : 'smooth' });
  }, [target, s.players, s.round]);
  // Keep the active navigation chip visible without shifting the page vertically.
  useEffect(() => {
    const node = chips.current, item = node?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (node && item) node.scrollTo({ left: item.offsetLeft - node.offsetLeft - node.clientWidth / 2 + item.clientWidth / 2, behavior: reduced() ? 'instant' : 'smooth' });
  }, [focused]);
  const jump = (id: string, follow: 'turn' | 'mine' | 'browse' = 'browse') => {
    setMode(follow); setFocused(id); const node = rail.current, i = s.players.findIndex(p => p.playerId === id);
    node?.scrollTo({ left: i * node.clientWidth, behavior: reduced() ? 'instant' : 'smooth' });
  };
  return <section className="sky-phone-table" aria-label="Complete public table">
    <div className="sky-player-strip" ref={chips} aria-label="Browse players">{s.players.map((p, i) => {
      const latest = [...s.events].reverse().find(e => e.actor === p.playerId);
      return <button className={`sky-player-chip ${s.turn === p.playerId ? 'is-current' : ''}`} key={p.playerId} aria-pressed={focused === p.playerId} onClick={() => jump(p.playerId)} style={{ '--seat-accent': accents[i] } as CSSProperties}>
        <span className="sky-chip-dot" key={latest?.id} /><span>{p.nickname}</span><strong>{p.total}</strong>{s.turn === p.playerId && <small>turn</small>}
      </button>;
    })}</div>
    <div className="sky-browse-tools"><button className={`sky-text-button ${mode === 'mine' ? 'is-selected' : ''}`} onClick={() => jump(s.yourPlayerId!, 'mine')}>⌂ My cards</button>
      <span>{Math.max(1, s.players.findIndex(p => p.playerId === focused) + 1)} / {s.players.length} <small>· swipe to browse</small></span>
      <button className={`sky-text-button ${mode === 'turn' ? 'is-selected' : ''}`} aria-pressed={mode === 'turn'} onClick={() => jump(s.turn ?? s.yourPlayerId!, 'turn')}>↗ Follow turn</button></div>
    <div className="sky-carousel" ref={rail} tabIndex={0} aria-label="Swipe between player grids" onKeyDown={e => {
      if (e.target !== e.currentTarget || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); const current = s.players.findIndex(p => p.playerId === focused);
      const i = e.key === 'Home' ? 0 : e.key === 'End' ? s.players.length - 1 : Math.max(0, Math.min(s.players.length - 1, current + (e.key === 'ArrowRight' ? 1 : -1)));
      jump(s.players[i].playerId);
    }} onPointerDown={e => { pointer.current = { x: e.clientX, y: e.clientY }; if (rail.current) rail.current.dataset.swiping = 'false'; }} onPointerMove={e => {
      if (pointer.current && Math.abs(e.clientX - pointer.current.x) > 12 && Math.abs(e.clientX - pointer.current.x) > Math.abs(e.clientY - pointer.current.y)) {
        setMode('browse'); if (rail.current) rail.current.dataset.swiping = 'true';
      }
    }} onTouchMove={() => { setMode('browse'); if (rail.current) rail.current.dataset.swiping = 'true'; }} onPointerUp={() => { pointer.current = null; }} onPointerCancel={() => { pointer.current = null; }}
      onWheel={e => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) setMode('browse'); }} onScroll={e => {
        const node = e.currentTarget, i = Math.round(node.scrollLeft / node.clientWidth); if (s.players[i]) setFocused(s.players[i].playerId);
      }}>
      {s.players.map(p => <div className="sky-slide" key={p.playerId} inert={p.playerId !== focused}><Grid p={p} s={s} act={act} busy={busy} /></div>)}
    </div>
    {!s.paused && s.turn === s.yourPlayerId && focused !== s.yourPlayerId && <button className="primary sky-return" onClick={() => jump(s.yourPlayerId!, 'mine')}>Your turn · return to your cards →</button>}
  </section>;
}

function Piles({ s, act, busy }: { s: SkyView; act?: Act; busy: boolean }) {
  const enabled = !!act && !busy && !s.paused && s.phase === 'PLAY' && s.turn === s.yourPlayerId && s.step === 'choose';
  return <div className="sky-piles"><button className="sky-pile sky-deck" disabled={!enabled || !s.deckCount && s.discardCount < 2} onClick={() => void act?.('draw')} aria-label="Draw a hidden card"><SkyCard back /><span>Draw<small>{s.deckCount} cards</small></span></button>
    <span className="sky-pile-or">or</span><button className="sky-pile sky-discard" disabled={!enabled || !s.discardTop} onClick={() => void act?.('take')} aria-label={s.discardTop ? `Take discard ${s.discardTop.value}` : 'Discard pile empty'}>{s.discardTop ? <SkyCard value={s.discardTop.value} /> : <span className="sky-pile-empty">—</span>}<span>Take discard<small>{s.discardCount} cards</small></span></button></div>;
}

function Controls({ s, act, busy, compact }: { s: SkyView; act: Act; busy: boolean; compact: boolean }) {
  const own = s.players.find(p => p.playerId === s.yourPlayerId)!;
  const opening = s.phase === 'SETUP', mine = s.turn === own.playerId, playing = s.phase === 'PLAY';
  const canReturnDiscard = s.step === 'replace' && s.pending?.source === 'discard';
  const canCancelKeep = s.step === 'replace' && s.pending?.source === 'deck';
  let title = '', help = '';
  if (s.paused) { title = 'A little breather.'; help = 'The host will resume the table. Your decision is saved.'; }
  else if (opening) { title = own.startingRevealed < s.settings.rules.startingCards ? `Reveal ${s.settings.rules.startingCards - own.startingRevealed} starting card${s.settings.rules.startingCards - own.startingRevealed === 1 ? '' : 's'}.` : 'Looking good. Waiting for friends.'; help = 'Tap face-down positions in your own grid. The highest opening sum starts round one.'; }
  else if (!playing) { title = s.winners.length ? `${s.winners.map(id => playerName(s, id)).join(' & ')} ${s.winners.length > 1 ? 'share the win!' : 'wins!'}` : 'Every little point counts.'; help = s.phase === 'RESULTS' ? 'Round complete. The full score breakdown is below.' : s.endedReason ?? 'Thanks for playing.'; }
  else if (!mine) { title = `${playerName(s, s.turn)}’s turn`; help = s.pending ? s.pending.source === 'deck' ? 'Choosing what to do with a private card.' : `Placing the ${s.pending.card?.value} from the discard pile.` : s.step === 'reveal' ? 'Choosing a hidden card to reveal.' : compact ? 'Eyes on the TV. Your controller is ready when you are.' : 'Browse the table while you wait.'; }
  else if (s.step === 'choose') { title = 'Your turn. Find a little less.'; help = 'Draw a private card, or take the visible discard.'; }
  else if (s.step === 'drawn') { title = 'A little keeper?'; help = 'Only you can see this card. Keep it to swap, or discard it and flip a hidden card.'; }
  else if (s.step === 'replace') { title = `Place your ${s.yourCard?.value}.`; help = canReturnDiscard ? 'Swap into an occupied position, or return this card to the discard pile and choose again.' : 'Swap into an occupied position, or go back to keep / discard with this same private card.'; }
  else { title = 'Turn over a little mystery.'; help = 'Your drawn card is discarded. Tap one hidden card in your grid to reveal it.'; }
  return <section className={`sky-controls ${compact ? 'sky-controller-party' : ''}`} aria-label="Player controls">
    <div className="sky-instruction"><p className="eyebrow">{s.paused ? 'Paused' : opening ? 'Opening reveal' : mine && playing ? 'Your move' : compact ? own.nickname : 'At the table'}</p><h2>{title}</h2><p className="sky-help">{help}</p></div>
    {s.yourCard && !s.paused && playing && mine ? <div className="sky-drawn"><div className="sky-held" key={s.yourCard.id}><SkyCard value={s.yourCard.value} /><small>{s.pending?.source === 'deck' ? 'Only you' : 'From discard'}</small></div>{s.step === 'drawn' ? <div className="sky-draw-choices"><button className="primary" disabled={busy} onClick={() => void act('keep')}>Keep & swap</button><button className="secondary" disabled={busy || !own.hidden} onClick={() => void act('discard')}>Discard & flip</button>{!own.hidden && <small>No hidden cards left. You must swap.</small>}</div> : <div className="sky-draw-choices"><p className="sky-target-note">{compact ? '↓' : '↑'} Tap a glowing position<br /><small>The swap completes your turn.</small></p>{canReturnDiscard && <button className="secondary" disabled={busy} onClick={() => void act('return-discard')}>Return to discard</button>}{canCancelKeep && <button className="secondary" disabled={busy} onClick={() => void act('cancel-keep')}>Back to choices</button>}</div>}</div>
      : !s.paused && (playing && (!compact || mine)) && <Piles s={s} act={act} busy={busy} />}
    {compact && !s.paused && ((playing && mine && s.step !== 'drawn') || opening && own.startingRevealed < s.settings.rules.startingCards) && <Grid p={own} s={s} act={act} busy={busy} />}
  </section>;
}

function TVTable({ s }: { s: SkyView }) {
  const id = s.turn ?? (s.phase === 'SETUP' ? s.players.find(p => p.startingRevealed < s.settings.rules.startingCards)?.playerId : s.finisher) ?? s.players[0].playerId;
  const active = s.players.find(p => p.playerId === id)!;
  return <section className="sky-tv-layout" data-count={s.players.length} aria-label="Shared public table"><div className="sky-tv-spotlight"><p className="eyebrow">{s.phase === 'SETUP' ? 'Opening reveals' : s.phase === 'RESULTS' || s.phase === 'COMPLETED' ? 'The round is in' : 'In the spotlight'}</p><Grid p={active} s={s} busy={false} />
    <div className="sky-tv-center"><Piles s={s} busy={false} />{s.pending && <div className="sky-tv-pending"><SkyCard value={s.pending.card?.value} /><small>{s.pending.source === 'deck' ? 'Private draw' : 'Selected discard'}</small></div>}</div></div>
    <div className="sky-tv-overview">{s.players.filter(p => p.playerId !== id).map(p => <Grid key={p.playerId} p={p} s={s} busy={false} compact />)}</div></section>;
}

/** Public event animations are decorative; they never hold up or submit a game action. */
function Motion({ s }: { s: SkyView }) {
  const seen = useRef<number | null>(null), flights = useRef(new Set<{ node: HTMLElement; animation: Animation }>());
  useEffect(() => { const active = flights.current; return () => { for (const f of active) { f.animation.cancel(); f.node.remove(); } active.clear(); }; }, []);
  useEffect(() => {
    const fresh = seen.current === null ? [] : s.events.filter(e => e.id > seen.current! && e.at >= s.serverNow - 3000);
    seen.current = s.events.at(-1)?.id ?? 0; if (reduced()) return;
    for (const e of fresh) {
      const seat = [...document.querySelectorAll<HTMLElement>(`[data-sky-player="${CSS.escape(e.actor ?? '')}"]`)].find(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.left < innerWidth && r.top < innerHeight && r.bottom > 0; });
      if (!seat) continue;
      if (e.type === 'column') {
        seat.animate([{ boxShadow: '0 0 0 0 #b6e6d300' }, { boxShadow: '0 0 40px 3px #b6e6d380' }, { boxShadow: '0 0 0 0 #b6e6d300' }], { duration: 650 });
        for (const i of [e.column!, e.column! + 4, e.column! + 8]) {
          const source = seat.querySelector<HTMLElement>(`[data-sky-index="${i}"]`), dest = document.querySelector('.sky-discard');
          if (!source || !dest) continue;
          const node = document.createElement('div'); node.className = 'sky-flight sky-clear-flight'; node.textContent = `${e.card?.value ?? ''}`; node.setAttribute('aria-hidden', 'true');
          const a = source.getBoundingClientRect(), b = dest.getBoundingClientRect(); node.style.cssText = `left:${a.x}px;top:${a.y}px;width:${a.width}px;height:${a.height}px`; document.body.append(node);
          const animation = node.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'translateY(-20px) scale(1.08)', opacity: 1, offset: .3 }, { transform: `translate(${b.x - a.x}px,${b.y - a.y}px) rotate(20deg) scale(.3)`, opacity: 0 }], { duration: 750, delay: Math.floor(i / 4) * 70, easing: 'ease-in-out' });
          const f = { node, animation }; flights.current.add(f); animation.onfinish = () => { node.remove(); flights.current.delete(f); };
        }
      } else if (['swap', 'draw', 'discard', 'take'].includes(e.type)) {
        const source = document.querySelector(e.type === 'take' ? '.sky-discard svg' : '.sky-deck svg');
        const dest = e.type === 'swap' ? seat.querySelector(`[data-sky-index="${e.index}"]`) : e.type === 'discard' ? document.querySelector('.sky-discard') : seat;
        if (!source || !dest) continue;
        const a = source.getBoundingClientRect(), b = dest.getBoundingClientRect(), node = document.createElement('div'); node.className = 'sky-flight'; node.setAttribute('aria-hidden', 'true');
        // After taking a discard, the pile already shows the card beneath it. Animate the selected value.
        if (e.type === 'take' && e.card) { node.classList.add('sky-clear-flight'); node.textContent = String(e.card.value); }
        else { const face = e.type === 'swap' ? dest.querySelector('svg') : source; if (face) node.append(face.cloneNode(true)); }
        node.style.cssText = `left:${a.x}px;top:${a.y}px;width:60px;height:80px`; document.body.append(node);
        const animation = node.animate([{ transform: 'scale(.7) rotate(-8deg)', opacity: .7 }, { transform: `translate(${b.x + b.width / 2 - a.x - 30}px,${b.y + b.height / 2 - a.y - 40}px) rotate(5deg)`, opacity: 0 }], { duration: 420, easing: 'ease-out' });
        const f = { node, animation }; flights.current.add(f); animation.onfinish = () => { node.remove(); flights.current.delete(f); };
      }
    }
  }, [s.events, s.serverNow]);
  return null;
}

function Results({ s }: { s: SkyView }) {
  const sorted = [...s.players].sort((a, b) => a.total - b.total);
  return <section className={`sky-results ${s.winners.length ? 'sky-winner' : ''}`} aria-label={s.winners.length ? 'Final scoreboard' : 'Round results'}>
    <div><p className="eyebrow">{s.winners.length ? '✦ Less is victory ✦' : `Round ${s.round} · the reveal`}</p><h2>{s.winners.length ? `${s.winners.map(id => playerName(s, id)).join(' & ')} ${s.winners.length > 1 ? 'share the win.' : 'wins.'}` : 'A little less. A little closer.'}</h2>
      <p className="sky-help">{s.endedReason ?? (s.result?.doubled ? `${playerName(s, s.result.finisher)} closed the round without the strictly lowest score. Their positive score doubles: ${s.result.raw[s.result.finisher]} × 2 = ${s.result.scores[s.result.finisher]}.` : s.result ? `${playerName(s, s.result.finisher)} closed the round. No doubling penalty.` : 'Completed round totals.')}</p></div>
    <ol className="sky-scoreboard">{sorted.map((p, i) => <li key={p.playerId} className={s.winners.includes(p.playerId) ? 'is-winner' : ''}><span className="sky-rank">{i > 0 && sorted[i - 1].total === p.total ? '=' : i + 1}</span><strong>{p.nickname}</strong><span className="sky-earned">{(s.result?.scores[p.playerId] ?? 0) >= 0 ? '+' : ''}{s.result?.scores[p.playerId] ?? 0}{s.result?.doubled && s.result.finisher === p.playerId ? ' (×2)' : ''}</span><b key={p.total}>{p.total}<small> total</small></b></li>)}</ol>
  </section>;
}

function HostMenu({ s, act, busy }: { s: SkyView; act: Act; busy: boolean }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const offline = s.phase === 'SETUP' ? s.players.some(p => p.startingRevealed < s.settings.rules.startingCards) && s.players.filter(p => p.startingRevealed < s.settings.rules.startingCards).every(p => !p.connected) : s.turn && !s.players.find(p => p.playerId === s.turn)?.connected;
  return <details className="sky-host-menu"><summary>Host controls</summary><div className="sky-host-panel">
    <label className="field"><span>Display Mode</span><select className="input" aria-label="Display Mode" value={s.settings.displayMode} disabled={busy} onChange={e => void act('display-mode', { mode: e.target.value })}><option value="normal">Normal · full table on every phone</option><option value="tv">TV / Party · phones as controllers</option></select></label>
    {s.displayUrl && <a className="secondary" href={s.displayUrl} target="_blank" rel="noopener noreferrer">Open TV Display ↗</a>}
    <p className="sky-help">Open the display link on your TV. Switching modes preserves the current turn and every card. Gameplay rules stay locked after starting.</p>
    <div className="sky-buttons">{['SETUP', 'PLAY', 'RESULTS'].includes(s.phase) && <button className="secondary" disabled={busy} onClick={() => void act(s.paused ? 'resume' : 'pause')}>{s.paused ? 'Resume game' : 'Pause game'}</button>}
      {s.deadline && <button className="secondary" disabled={busy} onClick={() => void act('extend')}>Add 30 seconds</button>}
      {offline && !s.paused && <button className="secondary" disabled={busy} onClick={() => setConfirm('recover')}>Resolve offline decision</button>}
      {s.phase !== 'LOBBY' && <><button className="secondary" disabled={busy} onClick={() => setConfirm('restart')}>Restart game</button><button className="secondary" disabled={busy} onClick={() => setConfirm('lobby')}>Return to lobby</button></>}
      {s.phase !== 'COMPLETED' && <button className="secondary" disabled={busy} onClick={() => setConfirm('end')}>End game</button>}</div>
    {confirm && <div className="sky-confirm" role="alertdialog" aria-label="Confirm game change"><p>{confirm === 'recover' ? 'Use the documented automatic policy to finish the offline decision? A drawn card is discarded to reveal the first hidden position; a kept or taken card replaces it.' : confirm === 'end' ? 'End the game and keep completed round totals?' : 'Clear all game progress? Everyone keeps their seat.'}</p><div className="sky-buttons"><button className="primary" disabled={busy} onClick={async () => { if (await act(confirm)) setConfirm(null); }}>Confirm {confirm === 'lobby' ? 'return to lobby' : confirm}</button><button className="secondary" onClick={() => setConfirm(null)}>Cancel</button></div></div>}
    <SkyRulesSummary settings={s.settings} />
  </div></details>;
}

export default function SkyjoGame({ gameId, display = false }: { gameId: string; display?: boolean }) {
  const [session, setSession] = useState<SessionData | null>(() => display ? null : loadSessionForGame(gameId));
  const [displayToken] = useState(() => {
    if (!display) return undefined;
    const key = `skyjo-display-${gameId}`, t = new URLSearchParams(location.hash.slice(1)).get('token') ?? new URLSearchParams(location.search).get('token');
    try { if (t) sessionStorage.setItem(key, t); return t ?? sessionStorage.getItem(key) ?? undefined; } catch { return t ?? undefined; }
  });
  const token = display ? displayToken : session?.playerToken;
  const { state: s, wsStatus, lastError, requestState, receivedAt } = useGameConnection<SkyView>({ gameId, playerToken: token });
  const [nickname, setNickname] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''),
    [invite, setInvite] = useState(false), [inspect, setInspect] = useState(false), [retry, setRetry] = useState<SkyAction | null>(null);
  const lock = useRef(false);
  const send = async (a: SkyAction) => {
    if (!session || display || lock.current) return false;
    lock.current = true; setBusy(true); setError(''); setRetry(null);
    try {
      await request(`${BACKEND_BASE}/api/game/${gameId}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.playerToken}` }, body: JSON.stringify(a), signal: AbortSignal.timeout(12_000) });
      await requestState(); return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Connection failed'); if (!(e instanceof ApiError) || e.retryable) setRetry(a); await requestState(); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  const act: Act = async (type, payload = {}) => s ? send({ id: crypto.randomUUID(), type, payload, generation: s.generation, revision: s.revision, round: s.round }) : false;
  const join = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await joinGame(gameId, nickname.trim()); const value: SessionData = { gameId, playerId: r.playerId, playerToken: r.playerToken, role: 'PLAYER' }; saveSession(value); setSession(value); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not join'); } finally { setBusy(false); }
  };
  if (!session && !display) return <main className="page sheet sky"><section className="host-form sky-home"><Link to="/">← All games</Link><p className="eyebrow">Room {gameId}</p><h1>SKYJO</h1><p>There’s a little space for you.</p><form className="stack" onSubmit={join}><label className="field"><span>Your nickname</span><input className="input" autoComplete="nickname" required maxLength={20} value={nickname} onChange={e => setNickname(e.target.value)} /></label><button className="primary" disabled={busy}>Join lobby</button></form>{error && <p className="error" role="alert">{error}</p>}</section></main>;
  if (!s) return <main className="page sheet sky"><section className="host-form sky-home"><p role="status">{lastError ?? (display && !token ? 'Use the Open TV Display link from the host.' : 'Reconnecting to your table…')}</p><button className="secondary" onClick={() => void requestState()}>Retry connection</button><Link to="/">All games</Link></section></main>;
  const host = !display && s.yourRole === 'HOST', party = !display && s.settings.displayMode === 'tv' && s.phase !== 'LOBBY';
  const fullTable = !party || inspect, finished = s.phase === 'RESULTS' || s.phase === 'COMPLETED';
  return <main className={`sky sky-game ${display ? 'sky-display' : ''} ${party ? 'sky-party' : ''}`}>
    <Motion s={s} />
    <header className="sky-header"><div className="sky-brand">SKY<span>JO</span><i>✦</i><small>{display ? 'THE SHARED TABLE' : `ROOM ${gameId}`}</small></div><div className="sky-header-meta"><span>{s.round ? `ROUND ${s.round}` : 'A LITTLE GET-TOGETHER'}</span>{s.round > 0 && <span>{s.settings.rules.fixedRounds ? `${s.settings.rules.fixedRounds} rounds` : `${s.settings.rules.target} pts · lowest wins`}</span>}<Timer s={s} receivedAt={receivedAt} /></div>
      {display ? <button className="secondary" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => setError('Fullscreen is unavailable in this browser.')); }}>Fullscreen</button> : <Link className="sky-home-link" to="/">All games</Link>}</header>
    {wsStatus !== 'open' && <p className="sky-notice" role="status">{lastError ?? 'Reconnecting… Your progress is saved.'}</p>}
    {error && <div className="sky-notice sky-error" role="alert">{error}{retry && <button className="secondary" onClick={() => void send(retry)}>Retry same action safely</button>}</div>}
    {s.phase === 'LOBBY' ? <section className="sky-lobby"><div><p className="eyebrow">Friends around a little table</p><h1>A little mystery.<br /><span>A lovely rivalry.</span></h1><p className="sky-help">Invite your people. Leave the high cards behind.</p>
      <div className="sky-lobby-players" aria-label="Lobby players">{s.players.map((p, i) => <div key={p.playerId}><span className={`sky-dot ${p.connected ? 'online' : ''}`} /><strong>{p.nickname}</strong><small>{p.role === 'HOST' ? 'Host · playing' : p.connected ? 'Ready' : 'Offline'}</small>{host && <div className="sky-seat-order"><button className="secondary" aria-label={`Move ${p.nickname} up`} disabled={busy || i === 0} onClick={() => { const ids = s.players.map(p => p.playerId); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; void act('reorder', { order: ids }); }}>↑</button><button className="secondary" aria-label={`Move ${p.nickname} down`} disabled={busy || i === s.players.length - 1} onClick={() => { const ids = s.players.map(p => p.playerId); [ids[i], ids[i + 1]] = [ids[i + 1], ids[i]]; void act('reorder', { order: ids }); }}>↓</button>{p.role !== 'HOST' && <button className="secondary" aria-label={`Remove ${p.nickname}`} disabled={busy} onClick={() => void act('remove', { playerId: p.playerId })}>×</button>}</div>}</div>)}</div>
      <SkyRulesSummary settings={s.settings} />{!display && <div className="sky-buttons"><button className="secondary" onClick={() => setInvite(true)}>Invite players / QR</button>{host && <button className="primary" disabled={busy || s.players.length < 2} onClick={() => void act('start')}>Start Skyjo</button>}</div>}
      {!host && !display && <p className="sky-help">The host will start when everyone is ready.</p>}{host && <HostMenu s={s} act={act} busy={busy} />}
    </div>{host && <SkySettings key={`${s.generation}-${s.settings.profileId}`} settings={s.settings} busy={busy} apply={v => act('settings', { settings: { ...v, displayMode: s.settings.displayMode } })} />}</section>
      : <><div className={`sky-table-status ${s.finisher ? 'is-final' : ''}`}><span className="sky-status-dot" /><strong>{s.paused ? 'Game paused' : s.phase === 'SETUP' ? 'Choose your opening cards' : finished ? s.winners.length ? 'The lowest score takes the stars.' : 'Round complete' : `${playerName(s, s.turn)}’s turn`}</strong>{s.finisher && !finished && <span>Final lap · {s.finalTurns.length} turn{s.finalTurns.length === 1 ? '' : 's'} left</span>}</div>
        <div className="sky-live-event" aria-live="polite" aria-atomic="true"><span key={s.events.at(-1)?.id}>{s.events.at(-1)?.message}</span></div>
        {display ? <>{finished && <Results s={s} />}<TVTable s={s} /></> : <div className="sky-play-layout">
          {finished && <Results s={s} />}
          {fullTable && <PhoneTable key={`${s.round}-${s.phase === 'SETUP' ? 'opening' : 'table'}`} s={s} act={act} busy={busy} />}
          <Controls s={s} act={act} busy={busy} compact={party && !inspect} />
        </div>}
        {!display && <>{party && <button className="secondary sky-inspect" onClick={() => setInspect(v => !v)}>{inspect ? 'Back to controller' : 'Peek at the full table'}</button>}
          {host && s.phase === 'RESULTS' && <button className="primary sky-next" disabled={busy || s.paused} onClick={() => void act('next-round')}>Next round</button>}{host && <HostMenu s={s} act={act} busy={busy} />}
          <details className="sky-history"><summary>Rules, activity & scores</summary><SkyRulesSummary settings={s.settings} /><p className="sky-help">Take a discard to swap, or draw privately and keep it to swap / discard it to reveal. Three equal vertical cards clear. The finisher must be strictly lowest or their positive score doubles. First-round opening ties use seat order; final ties share the win. Empty draw piles recycle discards except the top card.</p><ol>{s.events.slice(-12).reverse().map(e => <li key={e.id}>{e.message}</li>)}</ol>{s.history.map(r => <p key={r.round}>Round {r.round}: {s.players.map(p => `${p.nickname} ${r.scores[p.playerId] >= 0 ? '+' : ''}${r.scores[p.playerId] ?? 0}`).join(' · ')}</p>)}</details>
        </>}
      </>}
    {invite && <AddPlayerPanel gameCode={gameId} joinUrl={`${location.origin}/g/${gameId}`} onClose={() => setInvite(false)} />}
  </main>;
}
