import { useEffect, useState } from "react";
import type { JustOneView, Outcome } from "../../../../shared/justOne";
import { type Act } from "./types";

export function Outcomes({
  act,
  type,
  busy,
}: {
  act: Act;
  type: 'adjudicate' | 'correct-result';
  busy: boolean;
}) {
  return (
    <div className="button-row outcome-buttons">
      {(['correct', 'incorrect', 'pass'] as Outcome[]).map((outcome) => (
        <button
          className={`outcome-${outcome} ${outcome === 'correct' ? 'primary' : 'secondary'}`}
          disabled={busy}
          key={outcome}
          onClick={() => void act(type, { outcome })}
        >
          {outcome === 'correct'
            ? 'Correct guess'
            : outcome === 'incorrect'
              ? 'Wrong guess'
              : 'Pass'}
        </button>
      ))}
    </div>
  );
}
export function Countdown({
  state,
  receivedAt,
}: {
  state: JustOneView;
  receivedAt: number;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const remaining = state.paused
    ? state.pausedRemaining
    : state.deadline === null
      ? null
      : state.deadline - (now + state.serverNow - receivedAt);
  if (remaining === null)
    return state.paused ? (
      <p className="warning-banner">Game paused by host</p>
    ) : null;
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  return (
    <p
      className={`countdown ${seconds <= 10 ? 'countdown-urgent' : ''}`}
      role="timer"
      aria-label={`${seconds} seconds ${state.paused ? 'paused' : 'remaining'}`}
    >
      {state.paused ? 'Paused · ' : ''}
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </p>
  );
}

