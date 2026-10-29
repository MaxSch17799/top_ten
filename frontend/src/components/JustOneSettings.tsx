import { useState } from 'react';
import type {
  BankSummary,
  JustOneSettings as Settings,
} from '../../../shared/justOne';

export default function JustOneSettings({
  settings,
  banks,
  running,
  busy,
  onApply,
}: {
  settings: Settings;
  banks: BankSummary[];
  running: boolean;
  busy: boolean;
  onApply: (settings: Settings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((old) => ({ ...old, [key]: value }));
  return (
    <form
      className="stack jo-settings"
      onSubmit={(event) => {
        event.preventDefault();
        void onApply(draft);
      }}
    >
      <p className="footnote">
        {running
          ? 'Guessing mode and timers apply immediately. Word bank, word selection and clue count apply next round. Timer changes restart the active countdown.'
          : 'Set up your cooperative game. You can adjust modes and timers as you play.'}
      </p>
      <div className="settings-grid">
        <label className="field">
          <span>Word bank · next round</span>
          <select
            className="input"
            value={draft.bankId}
            onChange={(e) => update('bankId', e.target.value)}
          >
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.development ? ' · development set' : ''} ({b.cardCount}{' '}
                cards)
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Scoring mode</span>
          <select
            disabled={running}
            className="input"
            value={draft.scoring}
            onChange={(e) =>
              update('scoring', e.target.value as Settings['scoring'])
            }
          >
            <option value="original">Original · 13 cards</option>
            <option value="fixed">Fixed guessing rounds</option>
          </select>
        </label>
        {draft.scoring === 'fixed' && (
          <label className="field">
            <span>Number of rounds</span>
            <input
              className="input"
              type="number"
              min={1}
              max={100}
              required
              disabled={running}
              value={draft.length}
              onChange={(e) => update('length', Number(e.target.value))}
            />
          </label>
        )}
        <label className="field">
          <span>Word selection · next round</span>
          <select
            className="input"
            value={draft.selection}
            onChange={(e) =>
              update('selection', e.target.value as Settings['selection'])
            }
          >
            <option value="automatic">Automatic random word</option>
            <option value="five">Guesser chooses 1 of 5</option>
          </select>
        </label>
        <label className="field">
          <span>Guessing mode · immediate</span>
          <select
            className="input"
            value={draft.guessing}
            onChange={(e) =>
              update('guessing', e.target.value as Settings['guessing'])
            }
          >
            <option value="typed">Typed · automatic checking</option>
            <option value="verbal">Party · verbal answer</option>
          </select>
        </label>
        <label className="field">
          <span>Clues per person · next round</span>
          <select
            className="input"
            value={draft.cluesPerPlayer}
            onChange={(e) =>
              update(
                'cluesPerPlayer',
                Number(e.target.value) as Settings['cluesPerPlayer'],
              )
            }
          >
            <option value={0}>Auto · 2 for 3–4 players</option>
            <option value={1}>1 clue each</option>
            <option value={2}>2 clues each</option>
          </select>
        </label>
        <div className="timer-setting">
          <label className="check-field">
            <input
              type="checkbox"
              checked={draft.clueTimer}
              onChange={(e) => update('clueTimer', e.target.checked)}
            />{' '}
            Clue timer
          </label>
          <label className="field">
            <span>Clue seconds</span>
            <input
              type="number"
              className="input"
              min={5}
              max={1800}
              required
              value={draft.clueSeconds}
              onChange={(e) => update('clueSeconds', Number(e.target.value))}
            />
          </label>
        </div>
        <div className="timer-setting">
          <label className="check-field">
            <input
              type="checkbox"
              checked={draft.guessTimer}
              onChange={(e) => update('guessTimer', e.target.checked)}
            />{' '}
            Guess timer
          </label>
          <label className="field">
            <span>Guess seconds</span>
            <input
              type="number"
              className="input"
              min={5}
              max={1800}
              required
              value={draft.guessSeconds}
              onChange={(e) => update('guessSeconds', Number(e.target.value))}
            />
          </label>
        </div>
      </div>
      <button className="secondary" disabled={busy} type="submit">
        Apply settings
      </button>
    </form>
  );
}
