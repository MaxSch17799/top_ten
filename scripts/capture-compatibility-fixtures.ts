/** Explicit maintainer tool; never run by tests/CI. Captures synthetic Git-baseline rooms. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CHECKPOINT, ROLLBACK, importHistorical } from '../tests/support/historical-source.js';
import { DurableHarness, createRequest, roomRequest } from '../tests/support/durable-harness.js';

if (!process.argv.includes('--write')) throw new Error('Explicit fixture replacement only: pass --write. See docs/compatibility.md before replacing a baseline.');
const now = 1_790_000_000_000;
Date.now = () => now;
const folder = new URL('../tests/fixtures/rooms/', import.meta.url);
mkdirSync(folder, { recursive: true });
const entries = [
  ['top10', 'state', null], ['just-one', 'just-one', 'justOne'],
  ['sounds-fishy', 'sounds-fishy', 'soundsFishy'], ['wavelength', 'wavelength', 'wavelength'],
  ['uno', 'uno', 'uno'], ['monopoly-deal', 'monopoly-deal', 'monopolyDeal'],
  ['flip7', 'flip7', 'flip7'], ['skyjo', 'skyjo', 'skyjo'],
] as const;

for (const [gameType, key, engineFolder] of entries) {
  await capture(CHECKPOINT, gameType, key, engineFolder, gameType);
}
await capture(ROLLBACK, 'monopoly-deal', 'monopoly-deal', 'monopolyDeal', 'deal-staged-payment');
await capture(CHECKPOINT, 'skyjo', 'skyjo', 'skyjo', 'skyjo-final-turns');

async function capture(commit: string, gameType: string, key: string, engineFolder: string | null, name: string) {
  const { GameDurableObject } = await importHistorical(commit, 'backend-do/src/game.ts');
  const h = new DurableHarness(), room = new GameDurableObject(h.ctx, h.env);
  const timedSettings: Record<string, unknown> = {
    'just-one': { clueTimer: true, clueSeconds: 60 },
    'sounds-fishy': { preparationSeconds: 45 },
    wavelength: { dialSeconds: 45 },
    skyjo: { rules: { turnSeconds: 45 } },
    flip7: { rules: { turnSeconds: 45, actionSeconds: 45 } },
  };
  const createdResponse = await room.fetch(createRequest(gameType, timedSettings[gameType]));
  assert.equal(createdResponse.status, 200, await createdResponse.clone().text());
  const host = await createdResponse.json();
  for (let i = 1; i < (['sounds-fishy', 'wavelength'].includes(gameType) ? 4 : 3); i++) {
    const joined = await room.fetch(roomRequest('1234', 'join', undefined, { nickname: `Fixture Guest ${i}` }));
    assert.equal(joined.status, 200, await joined.clone().text());
  }
  await h.drain();
  let state = h.snapshot()[key] as any;
  const hostId = host.playerId;
  let sequence = 0;
  const engine = engineFolder ? await importHistorical(commit, `backend-do/src/${engineFolder}/engine.ts`) : null;
  const action = (type: string, payload: Record<string, unknown> = {}) => ({
    id: `fixture-action-${++sequence}`, type, payload, generation: state.generation,
    revision: state.revision, round: state.round, roundId: state.roundId, phase: state.phase,
  });
  const act = (type: string, payload: Record<string, unknown> = {}, actor = hostId) => engine.applyAction(state, actor, action(type, payload), now);
  let command: any = { type: 'end', payload: {} }, actor = hostId;
  let scenario = 'Active round with private player data and processed request IDs.';

  if (gameType === 'top10') {
    assert.equal((await room.fetch(roomRequest('1234', 'startRound1', host.hostToken, {}))).status, 200);
    await h.drain(); state = h.snapshot()[key];
    command = { route: 'nextRound', body: {} };
    scenario = 'Active legacy Top 10 round, secret assignments and embedded question-bank snapshot.';
  } else {
    act('start');
    if (gameType === 'just-one') {
      act('draft-clues', { clues: Array(state.clueCount).fill('synthetic draft') }, state.expected[0]);
      act('pause'); command.type = 'pause';
      scenario = 'Paused clue collection with a private draft and saved timer remainder.';
    } else if (gameType === 'sounds-fishy' || gameType === 'wavelength') {
      act('pause'); command.type = 'resume';
      scenario = gameType === 'sounds-fishy' ? 'Paused preparation with hidden fish roles and answer.' : 'Paused dial phase with private psychic target.';
    } else if (gameType === 'uno') {
      // Rig a legal playable draw without introducing or duplicating a physical card.
      if (state.phase === 'COLOR') act('color', { color: 'red' }, state.turn);
      state.pending = null;
      const index = state.deck.findIndex((c: any) => c.color === state.color || c.value === state.discard.at(-1).value || c.value === 'wild');
      assert.ok(index >= 0);
      state.deck.push(...state.deck.splice(index, 1));
      act('draw', {}, state.turn);
      assert.ok(state.drawnCardId); actor = state.turn; command.type = 'pass';
      scenario = 'Private playable drawn card awaiting play/pass; deck order is frozen.';
    } else if (gameType === 'monopoly-deal') {
      const current = name === 'deal-staged-payment';
      // Move real cards from deck/hands into a controlled attack and payment situation.
      const take = (pred: (c: any) => boolean) => {
        for (const pile of [state.deck, ...Object.values(state.hands)] as any[][]) {
          const index = pile.findIndex(pred); if (index >= 0) return pile.splice(index, 1)[0];
        }
        throw new Error('Missing fixture card');
      };
      const attack = take(c => c.effect === (current ? 'birthday' : 'debtCollector'));
      state.hands[state.turn].push(attack);
      const targets = state.order.filter((id: string) => id !== state.turn);
      for (const id of targets) {
        state.tables[id].bank.push(take(c => c.kind === 'money' && c.value === 1));
        state.tables[id].sets.push({ id: `fixture-set-${id}`, color: 'brown', cards: [take(c => c.kind === 'property' && c.colors[0] === 'brown')], house: null, hotel: null });
      }
      if (current) state.settings.rules.bankFirstPayments = true;
      act('play', { cardId: attack.id, mode: 'action', target: targets[0] }, state.turn);
      if (current) {
        act('respond', { no: false }, state.pending.responder);
        act('pay', { cardIds: state.tables[state.pending.responder].bank.map((c: any) => c.id) }, state.pending.responder);
        assert.equal(state.pending.stage, 'payment'); assert.equal(state.pending.amount, 1);
        actor = state.pending.responder;
        command = { type: 'pay', payload: { cardIds: state.tables[actor].sets.flatMap((s: any) => s.cards.map((c: any) => c.id)) } };
        scenario = 'Bank-first birthday partially paid: remaining debt 1, original amountPerTarget 2, another target pending.';
      } else {
        delete state.settings.rules.bankFirstPayments;
        actor = state.pending.responder; command = { type: 'respond', payload: { no: false } };
        scenario = 'Checkpoint debt-collector response with legacy missing bankFirstPayments setting.';
      }
    } else if (gameType === 'flip7') {
      // Complete the automatic deal using the historical engine, then create a target choice.
      for (const value of [3, 2, 1]) {
        const index = state.deck.findIndex((c: any) => c.kind === 'number' && c.value === value);
        state.deck.push(...state.deck.splice(index, 1));
      }
      for (let n = 0; n < 200 && (state.nextAt !== null || state.pending); n++) {
        if (state.pending) act('target', { target: state.pending.eligible[0] }, state.pending.owner);
        else engine.expireState(state, state.nextAt);
      }
      assert.equal(state.phase, 'PLAY');
      const index = state.deck.findIndex((c: any) => c.kind === 'freeze'); assert.ok(index >= 0);
      state.deck.push(...state.deck.splice(index, 1));
      act('hit', {}, state.turn);
      while (state.nextAt !== null && !state.pending) engine.expireState(state, state.nextAt);
      assert.ok(state.pending); act('pause'); command = { type: 'display-mode', payload: { mode: 'tv' } };
      scenario = 'Paused target choice with automatic-deal continuation and replay IDs.';
    } else if (gameType === 'skyjo') {
      for (const id of state.order) for (let index = 0; index < state.settings.rules.startingCards; index++) act('setup', { index }, id);
      if (name === 'skyjo-final-turns') {
        const finisher = state.turn;
        state.grids[finisher].forEach((slot: any, i: number) => { if (slot) slot.faceUp = i !== 11; });
        act('draw', {}, finisher); act('discard', {}, finisher); act('reveal', { index: 11 }, finisher);
        assert.equal(state.finisher, finisher); assert.equal(state.finalTurns.length, 2);
        command = { type: 'display-mode', payload: { mode: 'tv' } };
        scenario = 'Finisher recorded with exactly two remaining final turns and hidden opponents.';
      } else {
        act('draw', {}, state.turn); act('keep', {}, state.turn); act('pause');
        command = { type: 'display-mode', payload: { mode: 'tv' } };
        scenario = 'Paused Keep & swap with the same private card retained, hidden grid, timer and replay IDs.';
      }
    }
  }
  // Credentials are deliberately labelled fake; no production state is captured.
  for (const [id, p] of Object.entries(state.players) as [string, any][]) {
    const token = `fixture-${gameType}-${id}`;
    if ('playerToken' in p) p.playerToken = token;
    else p.token = token;
  }
  if ('hostToken' in state) state.hostToken = gameType === 'uno' ? state.players[hostId].token : `fixture-${gameType}-host-capability`;
  if ('displayToken' in state) state.displayToken = `fixture-${gameType}-display-capability`;
  const savedCommand = command.route ? command : { route: 'action', body: action(command.type, command.payload) };
  const loaded = new DurableHarness({ [key]: state }), restored = new GameDurableObject(loaded.ctx, loaded.env);
  const viewerTokens = Object.fromEntries(Object.entries(state.players).map(([id, p]: any) => [id, p.token ?? p.playerToken]));
  if (state.displayToken) viewerTokens.$display = state.displayToken;
  const views: Record<string, unknown> = {};
  for (const [id, token] of Object.entries(viewerTokens)) {
    const response = await restored.fetch(roomRequest('1234', 'state', token));
    assert.equal(response.status, 200, await response.clone().text()); views[id] = await response.json();
  }
  const source = { commit, captureTool: 'scripts/capture-compatibility-fixtures.ts', synthetic: true, scenario };
  writeFileSync(new URL(`${name}.json`, folder), JSON.stringify({ source, now, gameType, key, state, views, actor, token: gameType === 'top10' ? state.hostToken : viewerTokens[actor], command: savedCommand }, null, 2) + '\n');
  process.stdout.write(`Captured ${name} from ${commit.slice(0, 7)}\n`);
}
