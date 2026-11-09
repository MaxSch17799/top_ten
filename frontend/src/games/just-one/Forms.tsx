import { useState } from "react";
import type { JustOneView } from "../../../../shared/justOne";
import { useDraftSync } from "../../hooks/useDraftSync";
import type { SessionData } from "../../lib/types";
import { type Act } from "./types";

export function ClueForm({
  state,
  busy,
  act,
  session,
  receivedAt,
}: {
  state: JustOneView;
  busy: boolean;
  act: Act;
  session: SessionData;
  receivedAt: number;
}) {
  const key = `jo-draft-${state.gameId}-${state.generation}-${state.round}-${state.yourPlayerId}`;
  const [clues, setClues] = useState<string[]>(() => {
    if (state.ownClueDraft) return state.ownClueDraft;
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      if (
        Array.isArray(saved) &&
        saved.length === state.clueCount &&
        saved.every((c) => typeof c === 'string')
      )
        return saved;
    } catch {
      /* draft is optional */
    }
    return Array.from({ length: state.clueCount }, () => '');
  });
  const draft = useDraftSync({
    state,
    session,
    type: 'draft-clues',
    payload: { clues },
    enabled: !state.ownClues,
    receivedAt,
  });
  if (state.ownClues)
    return (
      <div className="submitted-state">
        <p className="status">✓ Clues locked in</p>
        <p>{state.ownClues.join(' · ')}</p>
        <p className="footnote">Waiting for the rest of your team.</p>
      </div>
    );
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void act('clues', { clues });
      }}
    >
      <p className="footnote">
        Think of{' '}
        {state.clueCount === 2 ? 'two distinct clues' : 'one unique clue'}. Keep
        each to one word. Submitted clues are locked.
      </p>
      {clues.map((clue, i) => (
        <label className="field" key={i}>
          <span>Clue {i + 1}</span>
          <input
            className="input clue-input"
            value={clue}
            required
            maxLength={60}
            autoComplete="off"
            onBlur={draft.flush}
            disabled={busy || state.paused}
            onChange={(e) => {
              draft.markDirty();
              const next = clues.map((c, index) =>
                index === i ? e.target.value : c,
              );
              setClues(next);
              sessionStorage.setItem(key, JSON.stringify(next));
            }}
          />
        </label>
      ))}
      <p className="footnote" role="status">
        {draft.status}
        {state.settings.autoSubmitClues && state.settings.clueTimer
          ? ' · Your saved clues submit when time runs out.'
          : ''}
      </p>
      <button className="primary" disabled={busy || state.paused}>
        Submit clues
      </button>
    </form>
  );
}
export function GuessForm({
  busy,
  paused,
  act,
  state,
  session,
  receivedAt,
}: {
  busy: boolean;
  paused: boolean;
  act: Act;
  state: JustOneView;
  session: SessionData;
  receivedAt: number;
}) {
  const key = `jo-answer-${state.gameId}-${state.generation}-${state.round}-${state.yourPlayerId}`;
  const [guess, setGuess] = useState(
    () => state.ownGuessDraft ?? sessionStorage.getItem(key) ?? '',
  );
  const draft = useDraftSync({
    state,
    session,
    type: 'draft-guess',
    payload: { guess },
    receivedAt,
  });
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void act('guess', { guess });
      }}
    >
      <label className="field">
        <span>Your one answer</span>
        <input
          className="input clue-input"
          autoComplete="off"
          required
          maxLength={100}
          value={guess}
          disabled={busy || paused}
          onChange={(e) => {
            draft.markDirty();
            setGuess(e.target.value);
            sessionStorage.setItem(key, e.target.value);
          }}
          onBlur={draft.flush}
        />
      </label>
      <p className="footnote" role="status">
        {draft.status}
        {state.settings.autoSubmitGuess && state.settings.guessTimer
          ? ' · Your saved answer submits when time runs out.'
          : ''}
      </p>
      <button className="primary" disabled={busy || paused}>
        Commit answer
      </button>
      <button
        type="button"
        className="ghost"
        disabled={busy || paused}
        onClick={() => void act('pass')}
      >
        Pass this word
      </button>
    </form>
  );
}
