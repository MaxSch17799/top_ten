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
  const host = useMemo(() => state.players.find((player) => player.playerId === state.roundHostPlayerId), [state.players, state.roundHostPlayerId]);
  const promptDetails = useMemo(() => {
    if (!state.promptOptions || !questionBank) {
      return [];
    }
    return state.promptOptions.map((id) => ({
      id,
      prompt: questionBank.questions.find((question) => question.id === id)?.prompt ?? 'Prompt not available',
    }));
  }, [questionBank, state.promptOptions]);

  const isHost = state.yourRole === 'HOST';

  return (
    <section className="game-view">
      <header className="game-header">
        <div>
          <p className="eyebrow">Round {state.round}</p>
          <h2>{host ? `${host.nickname} is the host` : 'Awaiting host'}</h2>
        </div>
        <div className="button-row">
          <button className="ghost" onClick={onOpenInvite}>
            Add player
          </button>
          {isHost && (
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
        <p className="footnote">Keep your number secret, even after refresh.</p>
        {isHost && (
          <div className="prompt-list">
            <h3>Prompt options</h3>
            <div className="prompt-items">
              {promptDetails.map((item) => (
                <div key={item.id} className={`prompt-chip ${state.chosenPromptId === item.id ? 'chosen' : ''}`}>
                  <span className="prompt-id">{item.id}</span>
                  <p>{item.prompt}</p>
                </div>
              ))}
              {!promptDetails.length && <p className="footnote">Prompts loading…</p>}
            </div>
            {state.chosenPromptId && <p className="status">Chosen prompt: {state.chosenPromptId}</p>}
          </div>
        )}
        {actionError && <p className="error">{actionError}</p>}
        {isHost && (
          <div className="button-row">
            <button className="ghost" onClick={onEndGame}>
              End game
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
