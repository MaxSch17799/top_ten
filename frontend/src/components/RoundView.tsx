import { useMemo } from 'react';
import type { QuestionBank, SerializedStateForPlayer } from '../lib/types';

interface RoundViewProps {
  state: SerializedStateForPlayer;
  questionBank?: QuestionBank | null;
  onNextRound: () => Promise<void>;
  onEndGame: () => Promise<void>;
  onOpenInvite: () => void;
  actionError?: string | null;
}

export default function RoundView({ state, questionBank, onNextRound, onEndGame, onOpenInvite, actionError }: RoundViewProps) {
  const questionMaster = useMemo(
    () => state.players.find((player) => player.playerId === state.roundHostPlayerId),
    [state.players, state.roundHostPlayerId]
  );
  const isSessionHost = state.yourRole === 'HOST';
  const isQuestionMaster = Boolean(state.yourPlayerId && state.yourPlayerId === state.roundHostPlayerId);
  const promptIds = isQuestionMaster ? state.promptOptions ?? [] : [];
  const promptDetails = useMemo(() => {
    if (!questionBank || !promptIds.length) {
      return [];
    }
    return promptIds.map((id) => ({
      id,
      prompt: questionBank.questions.find((question) => question.id === id)?.prompt ?? 'Prompt not available',
    }));
  }, [questionBank, promptIds]);

  return (
    <section className="game-view">
      <header className="game-header">
        <div>
          <p className="eyebrow">Round {state.round}</p>
          <h2>{questionMaster ? `${questionMaster.nickname} is the question master` : 'Awaiting question master'}</h2>
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
        <div className="number-display">
          {state.yourSecretNumber ?? '??'}
        </div>
        <p className="footnote">Keep your number secret.</p>
        {isQuestionMaster && (
          <div className="prompt-list">
            <h3>Prompt options</h3>
            <div className="prompt-items">
              {promptDetails.map((item) => (
                <div key={item.id} className={`prompt-chip ${state.chosenPromptId === item.id ? 'chosen' : ''}`}>
                  <span className="prompt-id">{item.id}</span>
                  <p>{item.prompt}</p>
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

