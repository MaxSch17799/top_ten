import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type {
  JustOneAction,
  JustOneView,
  Outcome,
} from '../../../shared/justOne';
import { BACKEND_BASE, joinGame, request } from '../api';
import { useGameConnection } from '../hooks/useGameConnection';
import { useDraftSync } from '../hooks/useDraftSync';
import type { SessionData } from '../lib/types';
import { loadSessionForGame, saveSession } from '../lib/session';
import AddPlayerPanel from './AddPlayerPanel';
import SessionNavigation from './SessionNavigation';
import JustOneSettings from './JustOneSettings';

type Act = (type: string, payload?: Record<string, unknown>) => Promise<void>;
function ClueForm({
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
function GuessForm({
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
function Outcomes({
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
function Countdown({
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

export default function JustOneGame({ gameId }: { gameId: string }) {
  const [session, setSession] = useState(() => loadSessionForGame(gameId));
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState(false);
  const { state, receivedAt, wsStatus, lastError, requestState } =
    useGameConnection<JustOneView>({
      gameId,
      playerToken: session?.playerToken,
    });
  const join = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await joinGame(gameId, nickname.trim());
      const next = {
        gameId,
        playerId: p.playerId,
        playerToken: p.playerToken,
        role: p.role,
      };
      saveSession(next);
      setSession(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not join');
    } finally {
      setBusy(false);
    }
  };
  const act: Act = async (type, payload = {}) => {
    if (!state || !session || busy) return;
    setBusy(true);
    setError(null);
    const action: JustOneAction = {
      id: crypto.randomUUID(),
      type,
      generation: state.generation,
      round: state.round,
      phase: state.phase,
      payload,
    };
    try {
      await request(`${BACKEND_BASE}/api/game/${gameId}/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.playerToken}`,
        },
        body: JSON.stringify(action),
      });
      await requestState();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed');
      await requestState();
    } finally {
      setBusy(false);
    }
  };
  if (!session)
    return (
      <main className="page sheet just-one">
        <section className="host-form">
          <SessionNavigation />
          <p className="eyebrow">Lobby {gameId}</p>
          <h1>Join Just One</h1>
          <form className="stack" onSubmit={join}>
            <label className="field">
              <span>Your nickname</span>
              <input
                className="input"
                maxLength={20}
                required
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              Join lobby
            </button>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </form>
        </section>
      </main>
    );
  if (!state)
    return (
      <main className="page sheet just-one">
        <section className="host-form">
          <SessionNavigation />
          <p role="status">{lastError ?? 'Reconnecting to your team…'}</p>
          <button className="secondary" onClick={() => void requestState()}>
            Retry connection
          </button>
        </section>
      </main>
    );

  const host = state.yourRole === 'HOST';
  const guesser = state.yourPlayerId === state.guesserId;
  const reviewer = state.yourPlayerId === state.reviewerId;
  const clueGiver = state.expected.includes(state.yourPlayerId);
  const canAdjudicate = reviewer || (host && clueGiver && !guesser);
  const playerName = (id: string | null) =>
    state.players.find((p) => p.playerId === id)?.nickname ?? 'your team';
  const active = !['LOBBY', 'COMPLETED'].includes(state.phase);
  const scoreRatio =
    state.score /
    (state.settings.scoring === 'original'
      ? 13
      : state.settings.scoring === 'infinite'
        ? Math.max(1, state.round)
        : state.settings.length);
  const bank = state.banks.find((b) => b.id === state.settings.bankId);
  const joinUrl = `${(import.meta.env.VITE_FRONTEND_URL || window.location.origin).replace(/\/$/, '')}/g/${gameId}`;
  const phases: Record<JustOneView['phase'], string> = {
    LOBBY: 'Gather your team',
    SELECTION: 'Pick a number',
    CLUES: 'Think of a unique clue',
    REVIEW: 'Check the clues',
    GUESSING: 'Just one guess',
    ANSWER_REVIEW: 'One answer, under review',
    RESULT: 'The word is out',
    COMPLETED: 'That’s a team effort',
  };
  return (
    <main className="page sheet just-one">
      <section className="game-view jo-game">
        <SessionNavigation active={active} />
        <header className="jo-header">
          <div>
            <p className="eyebrow">Just One · {gameId}</p>
            <h1>{phases[state.phase]}</h1>
          </div>
          <button className="ghost" onClick={() => setInvite(true)}>
            Invite players
          </button>
        </header>
        <div className="score-strip">
          <span>
            Team score <strong>{state.score}</strong>
          </span>
          <span>
            {state.settings.scoring === 'original'
              ? 'Cards left'
              : state.settings.scoring === 'infinite'
                ? 'Endless mode'
                : 'Turns left'}{' '}
            <strong>{state.remaining ?? '∞'}</strong>
          </span>
          <span>
            Round <strong>{state.round || '—'}</strong>
          </span>
        </div>
        {wsStatus !== 'open' && (
          <p className="footnote" role="status">
            Reconnecting · checking for updates automatically
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {lastError && (
          <p className="error" role="alert">
            {lastError}
          </p>
        )}
        <Countdown state={state} receivedAt={receivedAt} />
        {state.phase !== 'LOBBY' && state.phase !== 'COMPLETED' && (
          <p className="role-banner">
            {guesser
              ? 'You are guessing'
              : `${playerName(state.guesserId)} is guessing`}
            {reviewer ? ' · You are the reviewer' : ''}
          </p>
        )}

        {state.phase === 'LOBBY' ? (
          <div className="card">
            <h2>Your team</h2>
            <p className="footnote">
              3–7 is classic. Up to 10 can play as a house rule. The host plays
              too.
            </p>
            {bank?.development && (
              <p className="warning-banner">
                Development word bank · {bank.cardCount} cards. Full English and
                German banks can be installed later.
              </p>
            )}
            <PlayerList state={state} act={act} busy={busy} />
            {host ? (
              <>
                <p className="footnote">
                  {state.players.filter((p) => p.participating).length <= 4 &&
                  state.settings.cluesPerPlayer === 0
                    ? 'Each clue-giver will write two clues.'
                    : 'Unique clues make the difference.'}
                </p>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    state.players.filter((p) => p.participating).length < 3
                  }
                  onClick={() => void act('start')}
                >
                  Start game
                </button>
              </>
            ) : (
              <p className="footnote">
                The host will start when everyone is ready.
              </p>
            )}
          </div>
        ) : null}

        {state.phase === 'SELECTION' && (
          <div className="card">
            <p className="footnote">
              {guesser
                ? 'Choose a number. Only your teammates can see the words.'
                : `${playerName(state.guesserId)} chooses a number. You can suggest one!`}
            </p>
            <div className="word-options">
              {[1, 2, 3, 4, 5].map((n) =>
                guesser ? (
                  <button
                    className="secondary"
                    disabled={busy || state.paused}
                    key={n}
                    onClick={() => void act('choose', { number: n })}
                  >
                    {n}
                  </button>
                ) : (
                  <p key={n}>
                    <strong>{n}</strong> {state.options?.[n - 1] ?? 'Hidden'}
                  </p>
                ),
              )}
            </div>
          </div>
        )}
        {state.word && !['RESULT', 'COMPLETED'].includes(state.phase) && (
          <div className="mystery-card">
            <span className="eyebrow">Mystery word · keep it secret</span>
            <strong data-testid="mystery-word">{state.word}</strong>
          </div>
        )}
        {state.phase === 'CLUES' && (
          <div className="card">
            {clueGiver ? (
              <ClueForm
                key={state.round}
                state={state}
                busy={busy}
                act={act}
                session={session}
                receivedAt={receivedAt}
              />
            ) : (
              <>
                <h2>
                  {guesser
                    ? 'Your team is thinking…'
                    : 'You’ll join next round'}
                </h2>
                <p className="footnote">
                  {guesser
                    ? 'The word and all clues stay hidden for now.'
                    : 'Watch the game while your seat is prepared.'}
                </p>
              </>
            )}
            <p className="submission-count" role="status">
              {state.submitted.length} / {state.expected.length} submitted
            </p>
            <div className="submission-dots">
              {state.expected.map((id) => (
                <span
                  key={id}
                  className={state.submitted.includes(id) ? 'done' : ''}
                >
                  {playerName(id)} {state.submitted.includes(id) ? '✓' : '…'}
                </span>
              ))}
            </div>
          </div>
        )}
        {state.phase === 'REVIEW' && (
          <div className="card">
            {reviewer ? (
              <>
                <h2>Keep the clues fair</h2>
                <p className="footnote">
                  Obvious duplicates were removed automatically. Check
                  translations, homophones and related word forms. Restore any
                  mistaken elimination.
                </p>
                <div className="review-list">
                  {state.reviewClues?.map((c) => (
                    <div
                      className={`review-clue ${c.eliminated ? 'eliminated' : ''}`}
                      key={c.id}
                    >
                      <div>
                        <strong>{c.text}</strong>
                        <small>
                          {playerName(c.playerId)} · {c.reason ?? 'Unique clue'}
                        </small>
                      </div>
                      <button
                        className="secondary"
                        disabled={busy || state.paused}
                        onClick={() =>
                          void act('review-clue', {
                            clueId: c.id,
                            eliminated: !c.eliminated,
                          })
                        }
                      >
                        {c.eliminated ? 'Restore' : 'Remove'}
                      </button>
                    </div>
                  ))}
                </div>
                {state.potentialDuplicates?.map((group, i) => (
                  <div className="potential-group" key={group.ids.join(':')}>
                    <p>
                      {group.reason}:{' '}
                      <strong>
                        {group.ids
                          .map(
                            (id) =>
                              state.reviewClues?.find((c) => c.id === id)?.text,
                          )
                          .join(' / ')}
                      </strong>
                    </p>
                    <div className="button-row">
                      <button
                        className="secondary"
                        disabled={busy || state.paused}
                        onClick={() =>
                          void act('review-group', {
                            index: i,
                            eliminate: true,
                          })
                        }
                      >
                        Remove group
                      </button>
                      <button
                        className="ghost"
                        disabled={busy || state.paused}
                        onClick={() =>
                          void act('review-group', {
                            index: i,
                            eliminate: false,
                          })
                        }
                      >
                        Keep as distinct
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  className="primary"
                  disabled={busy || state.paused}
                  onClick={() => void act('reveal')}
                >
                  Finalize & reveal clues
                </button>
              </>
            ) : (
              <>
                <h2>Checking for duplicates…</h2>
                <p className="footnote">
                  {playerName(state.reviewerId)} is reviewing the clues. They’ll
                  appear together when ready.
                </p>
              </>
            )}
          </div>
        )}
        {['GUESSING', 'ANSWER_REVIEW'].includes(state.phase) && (
          <div className="card">
            <div className="surviving-clues">
              {state.survivingClues?.map((clue, i) => (
                <span key={i}>{clue}</span>
              ))}
            </div>
            {state.phase === 'ANSWER_REVIEW' ? (
              <>
                <p>
                  Committed answer: <strong>{state.committedGuess}</strong>
                </p>
                <p className="footnote">
                  {reviewer
                    ? 'The spelling or word form is borderline. Decide whether this one committed answer counts.'
                    : `${playerName(state.reviewerId)} will check this borderline answer.`}
                </p>
                {canAdjudicate && (
                  <Outcomes
                    act={act}
                    type="adjudicate"
                    busy={busy || state.paused}
                  />
                )}
              </>
            ) : state.settings.guessing === 'typed' ? (
              guesser ? (
                <GuessForm
                  busy={busy}
                  paused={state.paused}
                  act={act}
                  state={state}
                  session={session}
                  receivedAt={receivedAt}
                />
              ) : (
                <p className="footnote">
                  {playerName(state.guesserId)} is writing their one answer.
                </p>
              )
            ) : (
              <>
                <h2>
                  {guesser ? 'Say your answer aloud' : 'Listen for the answer'}
                </h2>
                <p className="footnote">
                  {guesser && host
                    ? `You are guessing, so ${playerName(state.reviewerId)} marks the result.`
                    : canAdjudicate
                      ? 'Mark the spoken answer below.'
                      : `${playerName(state.reviewerId)} records the result.`}{' '}
                  No typing needed.
                </p>
                {canAdjudicate && (
                  <Outcomes
                    act={act}
                    type="adjudicate"
                    busy={busy || state.paused}
                  />
                )}
                {guesser && (
                  <button
                    className="ghost"
                    disabled={busy || state.paused}
                    onClick={() => void act('pass')}
                  >
                    Pass this word
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {state.phase === 'RESULT' && state.result && (
          <div className={`card result-card result-${state.result.outcome}`}>
            <p className="eyebrow">
              {state.result.outcome === 'correct'
                ? 'You got it! +1 point'
                : state.result.outcome === 'incorrect'
                  ? 'Not quite this time'
                  : state.result.outcome === 'no-clues'
                    ? 'All clues eliminated'
                    : 'Word passed'}
            </p>
            <h2>{state.word}</h2>
            {state.result.guess && (
              <p className="footnote">Answer: {state.result.guess}</p>
            )}
            {state.settings.scoring === 'original' &&
              state.result.outcome === 'incorrect' && (
                <p className="footnote">
                  {(state.result.remainingBefore ?? 0) > 1
                    ? 'Current card and one extra card lost.'
                    : 'Last card: one previously won point is lost if available.'}
                </p>
              )}
            {host && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void act('next')}
              >
                {state.remaining !== 0 ? 'Next word →' : 'Show final score'}
              </button>
            )}
          </div>
        )}
        {state.phase === 'COMPLETED' && (
          <div className="card final-score">
            <span aria-hidden="true">★</span>
            <h2>
              {state.score}
              {state.settings.scoring === 'infinite'
                ? state.score === 1
                  ? ' point'
                  : ' points'
                : ' / '}
              {state.settings.scoring === 'infinite'
                ? ''
                : state.settings.scoring === 'original'
                  ? 13
                  : state.settings.length}
            </h2>
            <p>
              {scoreRatio >= 0.77
                ? 'A remarkable team effort!'
                : scoreRatio >= 0.38
                  ? 'Great minds, growing together.'
                  : 'Every unique clue is a new beginning.'}
            </p>
            <p className="footnote">
              {state.endedReason ?? `${state.round} rounds played together.`}
            </p>
            {host && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      'Start a fresh game with this team? Scores and used words will reset.',
                    )
                  )
                    void act('restart');
                }}
              >
                Play again
              </button>
            )}
            <Link className="secondary-link" to="/">
              Choose another game
            </Link>
          </div>
        )}
        {host && (
          <details
            className="card host-controls"
            open={state.phase === 'LOBBY'}
          >
            <summary>Host settings & controls</summary>
            <JustOneSettings
              settings={state.settings}
              banks={state.banks}
              running={state.phase !== 'LOBBY'}
              busy={busy}
              onApply={(settings) => act('settings', { ...settings })}
              onLiveChange={(patch) => act('settings', patch)}
            />
            {active && (
              <>
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={busy || state.phase === 'RESULT'}
                    onClick={() => void act('pause')}
                  >
                    {state.paused ? 'Resume game' : 'Pause game'}
                  </button>
                  {['CLUES', 'GUESSING'].includes(state.phase) && (
                    <>
                      <button
                        className="ghost"
                        disabled={busy}
                        onClick={() => void act('timer', { operation: 'add' })}
                      >
                        +30 seconds
                      </button>
                      <button
                        className="ghost"
                        disabled={busy}
                        onClick={() =>
                          void act('timer', { operation: 'reset' })
                        }
                      >
                        Reset timer
                      </button>
                    </>
                  )}
                  {state.phase === 'CLUES' && (
                    <button
                      className="secondary"
                      disabled={busy || state.paused}
                      onClick={() => void act('close-clues')}
                    >
                      Continue with submitted clues
                    </button>
                  )}
                </div>
                {['SELECTION', 'CLUES', 'REVIEW', 'GUESSING'].includes(
                  state.phase,
                ) && (
                  <button
                    className="ghost"
                    disabled={busy || state.paused}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Pass this word for the team? This uses the current card.',
                        )
                      )
                        void act('skip-round');
                    }}
                  >
                    Pass current word
                  </button>
                )}
                <label className="field">
                  <span>Next guesser · applies next round</span>
                  <select
                    className="input"
                    disabled={busy}
                    value={state.nextGuesserId ?? ''}
                    onChange={(e) =>
                      void act('next-guesser', {
                        playerId: e.target.value || null,
                      })
                    }
                  >
                    <option value="">Automatic rotation</option>
                    {state.players
                      .filter((p) => p.participating)
                      .map((p) => (
                        <option key={p.playerId} value={p.playerId}>
                          {p.nickname}
                        </option>
                      ))}
                  </select>
                </label>
                <PlayerList state={state} act={act} busy={busy} />
              </>
            )}
            {state.result && ['RESULT', 'COMPLETED'].includes(state.phase) && (
              <details>
                <summary>Correct the last result</summary>
                <p className="footnote">
                  Recalculates this result from its original score. This does
                  not submit another guess.
                </p>
                <Outcomes act={act} type="correct-result" busy={busy} />
              </details>
            )}
            {state.phase !== 'COMPLETED' && (
              <button
                className="ghost danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm('End this game for everyone?'))
                    void act('end');
                }}
              >
                End game
              </button>
            )}
          </details>
        )}
        {state.history.length > 0 && (
          <details className="card">
            <summary>
              {state.round > state.history.length
                ? 'Recent words'
                : 'Words played'}{' '}
              · {state.history.length}
            </summary>
            <ol className="round-history">
              {state.history.map((r) => (
                <li key={r.round}>
                  <strong>{r.word}</strong>
                  <span>
                    {r.outcome}
                    {r.corrected ? ' · corrected' : ''}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}
        {invite && (
          <AddPlayerPanel
            gameCode={gameId}
            joinUrl={joinUrl}
            onClose={() => setInvite(false)}
          />
        )}
      </section>
    </main>
  );
}

function PlayerList({
  state,
  act,
  busy,
}: {
  state: JustOneView;
  act: Act;
  busy: boolean;
}) {
  const host = state.yourRole === 'HOST';
  const move = (index: number, delta: number) => {
    const order = [...state.order];
    [order[index], order[index + delta]] = [order[index + delta], order[index]];
    void act('reorder', { order });
  };
  return (
    <div className="jo-player-list">
      {state.order.map((id, i) => {
        const p = state.players.find((player) => player.playerId === id)!;
        return (
          <div className="jo-player" key={id}>
            <span
              className={`connection-dot ${p.connected ? 'connected' : ''}`}
              aria-label={p.connected ? 'Connected' : 'Disconnected'}
            />
            <span className="jo-player-name">
              {i + 1}. {p.nickname}
              <small>
                {p.role === 'HOST' ? 'Host · ' : ''}
                {p.pending
                  ? 'Joining next round'
                  : p.participating
                    ? 'Playing'
                    : 'Sitting out'}
                {p.playerId === state.guesserId ? ' · Guesser' : ''}
              </small>
            </span>
            {host && (
              <div className="player-actions">
                {state.phase === 'LOBBY' && (
                  <>
                    <button
                      className="ghost"
                      aria-label={`Move ${p.nickname} up`}
                      disabled={busy || i === 0}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="ghost"
                      aria-label={`Move ${p.nickname} down`}
                      disabled={busy || i === state.order.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                  </>
                )}
                <button
                  className="ghost"
                  disabled={busy}
                  aria-label={`${p.participating ? 'Sit out' : 'Include'} ${p.nickname}`}
                  onClick={() =>
                    void act('participation', {
                      playerId: id,
                      participating: !p.participating,
                    })
                  }
                >
                  {p.participating ? 'Sit out' : 'Include'}
                </button>
              </div>
            )}
          </div>
        );
      })}
      {state.phase !== 'LOBBY' && host && (
        <p className="footnote">
          Participation changes apply next round. Use “Continue with submitted
          clues” for absent players.
        </p>
      )}
    </div>
  );
}
