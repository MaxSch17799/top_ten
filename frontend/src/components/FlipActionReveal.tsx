import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { flipLabel, type FlipCard as Card, type FlipEvent, type FlipView } from '../../../shared/flip7';
import FlipCard from './FlipCard';

const REVEAL_MS = 4800;
const ACTION_KINDS = new Set<Card['kind']>(['second-chance', 'freeze', 'flip-three']);
const descriptions = {
  'second-chance': 'One extra life. A duplicate number gets a second chance.',
  freeze: 'Someone must bank their points and sit out the rest of the round.',
  'flip-three': 'Someone must flip three cards. No stopping in between.',
};
type ActionKind = keyof typeof descriptions;
interface Reveal {
  id: number;
  card: Card & { kind: ActionKind };
  announcement: string;
  detail: string;
  saved?: boolean;
  drawer?: string | null;
  deferred?: boolean;
  resolved?: boolean;
}

/** Every client consumes the same public events, including controller-only phones.
 * Keep a reveal alive through incoming snapshots and queue fast action chains.
 * This presentation has no effect on the rules, decisions, or server timers.
 */
export default function FlipActionReveal({ s }: { s: FlipView }) {
  const seen = useRef<number | null>(null);
  const queue = useRef<Reveal[]>([]);
  const current = useRef<Reveal | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);

  useEffect(() => {
    // Collect a whole snapshot before presenting it: a draw and its resolution
    // often arrive together. Scheduling also handles Strict Mode cleanup safely.
    const frame = requestAnimationFrame(() => {
      const last = s.events.at(-1)?.id ?? 0;
      if (s.phase === 'LOBBY') {
        seen.current = last; queue.current = []; current.current = null;
        setReveal(null); return;
      }
      const floor = seen.current ?? [...s.events].reverse().find(e => e.type === 'round')?.id ?? 0;
      const fresh = s.events.filter(e => e.id > floor && e.at >= s.serverNow - 10_000);
      seen.current = Math.max(seen.current ?? 0, last);
      const name = (id: string | null) => s.players.find(p => p.playerId === id)?.nickname ?? 'A player';
      const drawn = (e: FlipEvent): Reveal => ({
        id: e.id, card: e.card as Reveal['card'], announcement: `${name(e.actor)} drew`,
        drawer: e.actor, deferred: e.remaining !== undefined && e.card!.kind !== 'second-chance',
        detail: e.remaining !== undefined && e.card!.kind !== 'second-chance'
          ? 'Queued until the Flip Three finishes.' : descriptions[e.card!.kind as ActionKind],
      });
      for (const e of fresh) {
        if (e.type === 'draw' && e.card && ACTION_KINDS.has(e.card.kind)) {
          queue.current.push(drawn(e));
        } else if (e.type === 'save') {
          queue.current.push({ id: e.id, card: { id: `saved-${e.id}`, kind: 'second-chance', value: 0 },
            announcement: `${name(e.actor)} is saved!`, saved: true,
            detail: `Duplicate ${e.card?.value ?? 'number'} discarded. Still in the round!` });
        } else if (['freeze', 'flip-three', 'second-chance'].includes(e.type) && e.card) {
          // Update the original reveal rather than announcing the same card twice.
          // After a longer target decision, announce the outcome on its own.
          const index = queue.current.map(r => r.card.id).lastIndexOf(e.card.id);
          if (index >= 0) queue.current[index] = { ...queue.current[index], detail: e.message, resolved: true };
          else if (current.current?.card.id === e.card.id) current.current = { ...current.current, detail: e.message, resolved: true };
          else {
            const draw = [...s.events].reverse().find(d => d.id < e.id && d.type === 'draw' && d.card?.id === e.card!.id);
            queue.current.push({ ...(draw ? drawn(draw) : drawn(e)), id: e.id, detail: e.message, resolved: true,
              ...(!draw ? { announcement: 'Action card played' } : {}) });
          }
        } else if (e.type === 'bust' || e.type === 'flip7') {
          const cancelDeferred = (r: Reveal): Reveal => r.deferred && !r.resolved && (e.type === 'flip7' || r.drawer === e.actor)
            ? { ...r, detail: e.type === 'flip7' ? 'The round ended before this action was played.' : `${name(e.actor)} busted. This queued action is discarded.`, resolved: true } : r;
          queue.current = queue.current.map(cancelDeferred);
          if (current.current) current.current = cancelDeferred(current.current);
        }
      }
      queue.current = queue.current.slice(-60);
      current.current ??= queue.current.shift() ?? null;
      setReveal(current.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [s.events, s.players, s.phase, s.serverNow]);

  const revealId = reveal?.id;
  useEffect(() => {
    if (revealId === undefined) return;
    const timer = window.setTimeout(() => {
      current.current = queue.current.shift() ?? null;
      setReveal(current.current);
    }, REVEAL_MS);
    return () => clearTimeout(timer);
  }, [revealId]);

  if (!reveal) return null;
  const kind = reveal.card.kind;
  const deciding = s.canHit || (s.yourPlayerId !== null && s.pending?.owner === s.yourPlayerId);
  return <section key={reveal.id} className={`f7-action-reveal f7-action-${kind} ${reveal.saved ? 'is-saved' : ''} ${deciding ? 'is-deciding' : ''}`}
    role="status" aria-live="polite" aria-atomic="true" aria-label="Action card reveal" data-reveal-id={reveal.id}
    style={{ '--reveal-ms': `${REVEAL_MS}ms` } as CSSProperties}>
    <div className="f7-action-spotlight" aria-hidden="true" />
    <div className="f7-action-scene">
      <div className="f7-action-particles" aria-hidden="true">{Array.from({ length: 16 }, (_, i) => <span key={i}
        style={{ '--particle': i, '--particle-size': `${16 + i % 4 * 5}px`, '--drift': `${(i % 2 ? 1 : -1) * (24 + i % 5 * 13)}px`, '--spin': `${i * 41}deg` } as CSSProperties}>
        {kind === 'second-chance' ? '♥' : kind === 'freeze' ? '❄' : '✦'}
      </span>)}</div>
      <div className="f7-action-panel">
        {kind === 'freeze' && <svg className="f7-action-icicles" viewBox="0 0 440 65" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0H440V12L425 10L416 47L405 10L380 15L370 35L358 9L333 10L324 61L310 10L281 13L269 42L255 8L230 12L217 56L201 10L172 15L160 37L146 9L121 10L110 60L96 9L65 14L53 40L39 10L18 14L8 48L0 10Z" /></svg>}
        <p className="f7-action-announcement">{reveal.announcement}</p>
        <div className="f7-action-art" aria-hidden="true">
          <div className="f7-action-halo" />
          {kind === 'flip-three' ? <div className="f7-action-fan">{[-1, 0, 1].map((position, i) => <div key={position}
            style={{ '--fan-position': position, '--fan-delay': `${i * 160}ms` } as CSSProperties}>
            <FlipCard card={position === 0 ? reveal.card : undefined} back={position !== 0} />
          </div>)}</div> : <div className="f7-action-feature-card"><FlipCard card={reveal.card} /></div>}
          {kind === 'second-chance' && <span className="f7-action-heart">♥</span>}
          {kind === 'freeze' && <svg className="f7-action-crystal" viewBox="0 0 100 100"><g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">{[0, 60, 120].map(angle => <g key={angle} transform={`rotate(${angle} 50 50)`}><path d="M50 7V93M37 18L50 31L63 18M37 82L50 69L63 82" /></g>)}</g></svg>}
        </div>
        <h2>{reveal.saved ? 'Second Chance!' : flipLabel(reveal.card)}</h2>
        <p className="f7-action-detail">{reveal.detail}</p>
        <div className="f7-action-lifetime" aria-hidden="true"><span /></div>
      </div>
    </div>
  </section>;
}
