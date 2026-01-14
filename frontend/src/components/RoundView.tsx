import { useEffect, useMemo, useState } from 'react';
import type { QuestionBank, SerializedStateForPlayer } from '../lib/types';

interface RoundViewProps {
  state: SerializedStateForPlayer;
  questionBank?: QuestionBank | null;
  onNextRound: () => Promise<void>;
  onEndGame: () => Promise<void>;
  onOpenInvite: () => void;
  actionError?: string | null;
}

function splitPromptExample(prompt: string): { main: string; example?: string } {
  const lower = prompt.toLowerCase();
  const marker = lower.indexOf('from 1');
  if (marker === -1) {
    return { main: prompt };
  }
  const main = prompt.slice(0, marker).trim().replace(/[;:]\s*$/, '');
  const example = prompt.slice(marker).trim();
  return { main, example };
}

export default function RoundView({ state, questionBank, onNextRound, onEndGame, onOpenInvite, actionError }: RoundViewProps) {
  const questionMaster = useMemo(
    () => state.players.find((player) => player.playerId === state.roundHostPlayerId),
    [state.players, state.roundHostPlayerId]
  );
  const isSessionHost = state.yourRole === 'HOST';
  const isQuestionMaster = Boolean(state.yourPlayerId && state.yourPlayerId === state.roundHostPlayerId);
  const [revealed, setRevealed] = useState(false);
  const promptIds = isQuestionMaster ? state.promptOptions ?? [] : [];
  const promptDetails = useMemo(() => {
    if (!questionBank || !promptIds.length) {
      return [];
    }
    return promptIds.map((id) => ({
      id,
      ...splitPromptExample(
        questionBank.questions.find((question) => question.id === id)?.prompt ?? 'Prompt not available'
      ),
    }));
  }, [questionBank, promptIds]);

  useEffect(() => {
    setRevealed(false);
  }, [state.round, state.yourPlayerId]);

  return (
    <section className="game-view">
      <header className="game-header">
        <div>
          <p className="eyebrow">Round {state.round}</p>
          <h2>
            {isQuestionMaster
              ? 'You are the question master'
              : questionMaster
                ? `${questionMaster.nickname} is the question master`
                : 'Awaiting question master'}
          </h2>
        </div>
        <div className="button-row">
          {isSessionHost && (
            <button className="ghost" onClick={onOpenInvite}>
              Add player
            </button>
          )}
          {isSessionHost && (
            <button className="primary" onClick={onNextRound}>
              Next round
            </button>
          )}
        </div>
      </header>
      <div className="card round-card">
        <button
          type="button"
          className={`secret-card ${revealed ? 'revealed' : ''}`}
          onClick={() => setRevealed((current) => !current)}
          aria-pressed={revealed}
        >
          <div className="secret-number">{state.yourSecretNumber ?? '??'}</div>
          <div className="secret-cover">
            <span>{revealed ? 'Tap to hide your number' : 'Tap to reveal your number'}</span>
          </div>
          <div className="secret-footnote">Keep your number secret.</div>
        </button>
        {isQuestionMaster && (
          <div className="prompt-list">
            <h3>Prompt options</h3>
            <div className="prompt-items">
              {promptDetails.map((item) => (
                <div key={item.id} className={`prompt-chip ${state.chosenPromptId === item.id ? 'chosen' : ''}`}>
                  <span className="prompt-id">{item.id}</span>
                  <p>{item.main}</p>
                  {item.example && <p className="prompt-example">{item.example}</p>}
                </div>
              ))}
              {!promptDetails.length && <p className="footnote">Prompts loading.</p>}
            </div>
            {state.chosenPromptId && <p className="status">Chosen prompt: {state.chosenPromptId}</p>}
          </div>
        )}
        {actionError && <p className="error">{actionError}</p>}
      </div>
      {isSessionHost && (
        <div className="button-row end-row">
          <button className="ghost" onClick={onEndGame}>
            End game
          </button>
        </div>
      )}
    </section>
  );
}

