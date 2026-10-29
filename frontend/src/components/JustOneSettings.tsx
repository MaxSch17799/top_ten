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
  onLiveChange,
}: {
  settings: Settings;
  banks: BankSummary[];
  running: boolean;
  busy: boolean;
  onApply: (settings: Settings) => Promise<void>;
  onLiveChange: (patch: Partial<Settings>) => Promise<void>;
}) {
  const [local, setLocal] = useState({ base: settings, draft: settings });
  // Preserve unsaved lobby choices when an immediate control updates the server.
  if (JSON.stringify(local.base) !== JSON.stringify(settings)) {
    const next = { ...settings };
    for (const key of Object.keys(settings) as Array<keyof Settings>) {
      if (
        local.draft[key] !== local.base[key] &&
        settings[key] === local.base[key]
      )
        Object.assign(next, { [key]: local.draft[key] });
    }
    setLocal({ base: settings, draft: next });
  }
  const draft = local.draft;
  const update = <K extends keyof Settings>(
    key: K,
    value: Settings[K],
    live = false,
  ) => {
    setLocal((old) => ({ ...old, draft: { ...old.draft, [key]: value } }));
    if (live) void onLiveChange({ [key]: value });
  };
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
          ? 'Guessing mode and timer switches apply immediately. Use Apply settings for durations and next-round word bank, selection and clue count changes.'
          : 'Choose original scoring, a custom round count, or endless play. Guessing mode and timer switches save immediately; use Apply settings for other choices.'}
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
            <option value="fixed">Custom rounds · choose a number</option>
            <option value="infinite">Endless · running score</option>
          </select>
        </label>
        {draft.scoring === 'fixed' && (
          <label className="field">
            <span>Number of rounds</span>
            <input
              className="input"
              type="number"
              min={1}
              max={1000}
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
            disabled={busy}
            onChange={(e) =>
              update('guessing', e.target.value as Settings['guessing'], true)
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
              disabled={busy}
              onChange={(e) => update('clueTimer', e.target.checked, true)}
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
              disabled={busy}
              onChange={(e) => update('guessTimer', e.target.checked, true)}
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
        <label className="check-field">
          <input
            type="checkbox"
            checked={draft.autoSubmitClues}
            disabled={busy}
            onChange={(e) => update('autoSubmitClues', e.target.checked, true)}
          />{' '}
          Submit saved clues when time runs out
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={draft.autoSubmitGuess}
            disabled={busy}
            onChange={(e) => update('autoSubmitGuess', e.target.checked, true)}
          />{' '}
          Submit saved answer when time runs out
        </label>
      </div>
      {draft.scoring !== 'original' && (
        <p className="footnote">
          The word bank reshuffles after every card has been used.{' '}
          {draft.scoring === 'infinite'
            ? 'Your score keeps growing until the host ends the game.'
            : 'Play exactly the number of rounds you choose.'}
        </p>
      )}
      <button className="secondary" disabled={busy} type="submit">
        Apply settings
      </button>
    </form>
  );
}
