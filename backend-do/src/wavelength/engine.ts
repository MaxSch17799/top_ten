import {
  defaultWaveSettings,
  WAVE_GEOMETRY,
  waveScore,
  type Spectrum,
  type WaveAction,
  type WaveAudit,
  type WaveChat,
  type WavePlayer,
  type WaveResult,
  type WaveSettings,
  type WaveTiebreak,
  type WaveView,
} from "../../../shared/wavelength.js";
import { wavePacks, wavePackSummaries } from "../generated/wavelengthPacks.js";

export class GameError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function need(ok: unknown, message: string, status = 400): asserts ok {
  if (!ok) throw new GameError(message, status);
}
export interface StoredPlayer extends WavePlayer {
  token: string;
  disconnectedAt: number | null;
}
interface MatchSnapshot {
  scores: [number, number];
  remaining: number;
  tiebreak: WaveTiebreak | null;
}
export interface WaveState {
  gameType: "wavelength";
  gameId: string;
  hostToken: string;
  displayToken: string;
  version: number;
  revision: number;
  generation: number;
  roundId: string;
  phase: WaveView["phase"];
  players: Record<string, StoredPlayer>;
  order: string[];
  teams: [string, string];
  settings: WaveSettings;
  roundSettings: WaveSettings | null;
  round: number;
  activeTeam: number;
  psychicId: string | null;
  controllerId: string | null;
  controlEpoch: number;
  dialSequence: number;
  dial: number;
  target: number | null;
  spectrum: Spectrum | null;
  candidates: Spectrum[];
  clue: string | null;
  scores: [number, number];
  remaining: number;
  prediction: "left" | "right" | null;
  result: WaveResult | null;
  history: WaveResult[];
  chat: WaveChat[];
  used: Record<string, string[]>;
  cycle: Record<string, number>;
  rotation: [string[], string[]];
  deadline: number | null;
  paused: boolean;
  pausedRemaining: number | null;
  timerExpired: boolean;
  expiresAt: number;
  notice: string | null;
  nextTeam: number;
  catchUpTurn: boolean;
  tiebreak: WaveTiebreak | null;
  winner: number | null;
  before: MatchSnapshot | null;
  processed: string[];
  audit: WaveAudit[];
  replacements: number;
}
export function checkedSettings(
  current: WaveSettings,
  value: unknown,
): WaveSettings {
  need(
    value && typeof value === "object" && !Array.isArray(value),
    "Invalid settings",
  );
  need(
    Object.keys(value).every((k) => Object.hasOwn(defaultWaveSettings, k)),
    "Unknown setting",
  );
  const s = { ...current, ...value } as WaveSettings;
  need(
    Object.hasOwn(wavePacks, s.packId),
    "Selected spectrum pack is unavailable",
  );
  need(
    ["party", "written"].includes(s.mode) &&
      ["competitive", "cooperative"].includes(s.gameMode) &&
      ["auto", "two"].includes(s.selection),
    "Invalid game mode",
  );
  for (const key of [
    "compact",
    "automaticScoring",
    "startingBonus",
    "catchUp",
    "prediction",
    "coopBonus",
    "autoExpiry",
  ] as const)
    need(typeof s[key] === "boolean", "Invalid switch");
  for (const key of ["targetScore", "coopRounds"] as const)
    need(
      Number.isInteger(s[key]) && s[key] >= 1 && s[key] <= 200,
      "Length must be 1–200",
    );
  need(
    Number.isInteger(s.fixedRounds) &&
      (s.fixedRounds === 0 ||
        (s.fixedRounds >= 2 &&
          s.fixedRounds <= 200 &&
          s.fixedRounds % 2 === 0)),
    "Fixed rounds must be zero or an even number from 2–200",
  );
  for (const key of [
    "clueSeconds",
    "dialSeconds",
    "predictionSeconds",
  ] as const)
    need(
      Number.isInteger(s[key]) && s[key] >= 0 && s[key] <= 3600,
      "Timer must be 0–3600 seconds",
    );
  need(
    Number.isInteger(s.autoNextSeconds) &&
      (s.autoNextSeconds === 0 ||
        (s.autoNextSeconds >= 5 && s.autoNextSeconds <= 120)),
    "Reveal delay must be zero or 5–120 seconds",
  );
  return s;
}
export function createState(
  gameId: string,
  host: StoredPlayer,
  hostToken: string,
  settings: unknown,
  now = Date.now(),
): WaveState {
  return {
    gameType: "wavelength",
    gameId,
    hostToken,
    displayToken: crypto.randomUUID(),
    version: 1,
    revision: 1,
    generation: 1,
    roundId: "",
    phase: "LOBBY",
    players: { [host.playerId]: host },
    order: [host.playerId],
    teams: ["Team Sun", "Team Moon"],
    settings: checkedSettings(defaultWaveSettings, settings ?? {}),
    roundSettings: null,
    round: 0,
    activeTeam: 0,
    psychicId: null,
    controllerId: null,
    controlEpoch: 0,
    dialSequence: 0,
    dial: 90,
    target: null,
    spectrum: null,
    candidates: [],
    clue: null,
    scores: [0, 0],
    remaining: 0,
    prediction: null,
    result: null,
    history: [],
    chat: [],
    used: {},
    cycle: {},
    rotation: [[], []],
    deadline: null,
    paused: false,
    pausedRemaining: null,
    timerExpired: false,
    expiresAt: now + 30 * 60_000,
    notice: null,
    nextTeam: 0,
    catchUpTurn: false,
    tiebreak: null,
    winner: null,
    before: null,
    processed: [],
    audit: [],
    replacements: 0,
  };
}
export function randomIndex(n: number): number {
  need(Number.isInteger(n) && n > 0, "Empty random pool");
  const limit = Math.floor(0x100000000 / n) * n;
  let x: number;
  do {
    x = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (x >= limit);
  return x % n;
}
/** Uniform circular orientation conditioned on some central wedge being visible.
 * Open interval (-4,184), including clipped centers beyond both endpoints. No wrap scoring.
 */
export function generateTarget(): number {
  return (
    -WAVE_GEOMETRY.centerHalf +
    ((crypto.getRandomValues(new Uint32Array(1))[0] + 0.5) / 0x100000000) *
      (180 + 2 * WAVE_GEOMETRY.centerHalf)
  );
}
export function draw(s: WaveState): Spectrum {
  const pack = wavePacks[s.settings.packId];
  need(pack?.spectrums.length, "Selected spectrum pack is unavailable");
  let used = s.used[pack.packId] ?? [],
    pool = pack.spectrums.filter((q) => !used.includes(q.id));
  if (!pool.length) {
    const last = used.at(-1);
    used = [];
    pool = pack.spectrums.filter(
      (q) => pack.spectrums.length === 1 || q.id !== last,
    );
    s.cycle[pack.packId] = (s.cycle[pack.packId] ?? 1) + 1;
  }
  const item = pool[randomIndex(pool.length)];
  s.used[pack.packId] = [...used, item.id];
  s.cycle[pack.packId] ??= 1;
  return structuredClone(item);
}
const cooperative = (s: WaveState) => s.settings.gameMode === "cooperative";
const exposed = (s: WaveState) =>
  ["REVIEW", "REVEAL", "COMPLETED"].includes(s.phase);
const active = (s: WaveState) =>
  ["SELECTION", "CLUE", "DIAL", "PREDICTION", "REVIEW"].includes(s.phase);
const eligible = (s: WaveState, team: number) =>
  s.order.filter(
    (id) =>
      s.players[id].team !== null &&
      (cooperative(s) || s.players[id].team === team),
  );
const guesser = (s: WaveState, id: string) =>
  id !== s.psychicId && eligible(s, s.activeTeam).includes(id);
function audit(s: WaveState, actor: string, message: string, now: number) {
  s.audit.push({ at: now, actor, message });
  s.audit = s.audit.slice(-100);
}
function timer(s: WaveState, seconds: number, now: number) {
  s.deadline = seconds ? now + seconds * 1000 : null;
  s.pausedRemaining = s.paused && seconds ? seconds * 1000 : null;
  if (s.paused) s.deadline = null;
  s.timerExpired = false;
}
function phaseSeconds(s: WaveState): number {
  return s.phase === "CLUE" || s.phase === "SELECTION"
    ? s.settings.clueSeconds
    : s.phase === "DIAL"
      ? s.settings.dialSeconds
      : s.phase === "PREDICTION"
        ? s.settings.predictionSeconds
        : s.phase === "REVEAL"
          ? s.settings.autoNextSeconds
          : 0;
}
function phase(s: WaveState, value: WaveState["phase"], now: number) {
  s.phase = value;
  timer(s, phaseSeconds(s), now);
}
function choosePsychic(
  s: WaveState,
  team: number,
  previous: string | null,
): string {
  const ids = eligible(s, team);
  need(ids.length >= 2, "Each active team needs a Psychic and a guesser");
  let served = s.rotation[team].filter((id) => ids.includes(id));
  if (ids.every((id) => served.includes(id))) served = [];
  const available = ids.filter((id) => !served.includes(id));
  const id = available.find((id) => id !== previous) ?? available[0];
  s.rotation[team] = [...served, id];
  return id;
}
function controller(s: WaveState, id: string | null) {
  s.controllerId = id;
  s.controlEpoch++;
  s.dialSequence = 0;
}
function prepareTarget(s: WaveState, now: number) {
  s.target = generateTarget();
  phase(s, s.roundSettings!.mode === "written" ? "CLUE" : "DIAL", now);
}
function setupRound(
  s: WaveState,
  now: number,
  replay = false,
  forcedPsychic?: string,
) {
  const team = replay ? s.activeTeam : s.nextTeam;
  const nextPsychic =
    forcedPsychic ??
    (replay && s.psychicId && eligible(s, team).includes(s.psychicId)
      ? s.psychicId
      : choosePsychic(s, team, s.psychicId));
  need(
    eligible(s, team).length >= 2 &&
      (cooperative(s) || eligible(s, 1 - team).length >= 2),
    "Each active team needs a Psychic and a guesser",
  );
  s.activeTeam = team;
  s.psychicId = nextPsychic;
  s.roundSettings = { ...s.settings };
  s.roundId = crypto.randomUUID();
  if (!replay) s.round++;
  s.clue = null;
  s.target = null;
  s.spectrum = null;
  s.candidates = [];
  s.result = null;
  s.before = null;
  s.prediction = null;
  s.dial = 90;
  s.paused = false;
  s.pausedRemaining = null;
  s.notice = null;
  s.replacements = 0;
  const guessers = eligible(s, team).filter((id) => id !== nextPsychic);
  controller(s, guessers.find((id) => s.players[id].connected) ?? guessers[0]);
  if (s.settings.selection === "two") {
    s.candidates = [draw(s), draw(s)];
    phase(s, "SELECTION", now);
  } else {
    s.spectrum = draw(s);
    prepareTarget(s, now);
  }
}
function snapshot(s: WaveState): MatchSnapshot {
  return structuredClone({
    scores: s.scores,
    remaining: s.remaining,
    tiebreak: s.tiebreak,
  });
}
function restoreBefore(s: WaveState) {
  need(s.before, "No result to correct");
  s.scores = [...s.before.scores];
  s.remaining = s.before.remaining;
  s.tiebreak = structuredClone(s.before.tiebreak);
  s.winner = null;
  s.catchUpTurn = false;
}
/** Recalculate progression from the pre-result match snapshot for corrections/voids. */
export function resolveProgress(s: WaveState, result: WaveResult) {
  s.scores[result.team] += result.points;
  if (!cooperative(s)) s.scores[1 - result.team] += result.opponentPoints;
  s.nextTeam = cooperative(s) ? 0 : 1 - result.team;
  s.catchUpTurn = false;
  s.winner = null;
  if (cooperative(s)) {
    s.remaining = Math.max(
      0,
      s.remaining - 1 + (result.centerHit && s.settings.coopBonus ? 1 : 0),
    );
    if (!s.remaining) s.winner = 0;
    return;
  }
  if (s.tiebreak) {
    s.tiebreak.remaining--;
    // Sudden death guarantees one turn per team; catch-up never adds a turn inside a pair.
    if (s.tiebreak.remaining === 0) {
      const earned = [
        s.scores[0] - s.tiebreak.base[0],
        s.scores[1] - s.tiebreak.base[1],
      ];
      if (earned[0] !== earned[1]) s.winner = earned[0] > earned[1] ? 0 : 1;
      else
        s.tiebreak = {
          remaining: 2,
          base: [...s.scores],
          firstTeam: s.nextTeam,
          pair: s.tiebreak.pair + 1,
        };
    }
    return;
  }
  const end = s.settings.fixedRounds
    ? s.round >= s.settings.fixedRounds
    : Math.max(...s.scores) >= s.settings.targetScore;
  if (end) {
    if (s.scores[0] !== s.scores[1])
      s.winner = s.scores[0] > s.scores[1] ? 0 : 1;
    else
      s.tiebreak = {
        remaining: 2,
        base: [...s.scores],
        firstTeam: s.nextTeam,
        pair: 1,
      };
  } else if (
    s.settings.catchUp &&
    result.points === 4 &&
    s.scores[result.team] < s.scores[1 - result.team]
  ) {
    s.catchUpTurn = true;
    s.nextTeam = result.team;
  }
}
function finish(
  s: WaveState,
  now: number,
  override?: { points: number; opponentPoints: number },
) {
  need(
    s.target !== null && s.spectrum && !s.result,
    "Round is already resolved",
  );
  s.before = snapshot(s);
  const scored = waveScore(s.target, s.dial, cooperative(s));
  const predicted =
    s.prediction ===
    (s.target < s.dial ? "left" : s.target > s.dial ? "right" : null);
  const points = override?.points ?? scored.points;
  const opponentPoints =
    cooperative(s) || points === 4 || !s.roundSettings!.prediction
      ? 0
      : (override?.opponentPoints ?? (predicted ? 1 : 0));
  const result: WaveResult = {
    roundId: s.roundId,
    round: s.round,
    team: s.activeTeam,
    psychicId: s.psychicId!,
    spectrum: structuredClone(s.spectrum),
    center: s.target,
    dial: s.dial,
    prediction: s.prediction,
    points,
    opponentPoints,
    centerHit: scored.centerHit,
    void: false,
    reason: override ? "Host-confirmed score" : null,
  };
  s.result = result;
  s.history.push(result);
  s.history = s.history.slice(-100);
  resolveProgress(s, result);
  phase(s, "REVEAL", now);
  if (s.winner !== null) timer(s, 0, now);
}
function reveal(s: WaveState, now: number) {
  if (s.roundSettings!.automaticScoring) finish(s, now);
  else phase(s, "REVIEW", now);
}
function lock(s: WaveState, now: number) {
  if (cooperative(s) || !s.roundSettings!.prediction) reveal(s, now);
  else phase(s, "PREDICTION", now);
}
function next(s: WaveState, now: number) {
  need(s.phase === "REVEAL", "Wait for the reveal");
  if (s.winner !== null) phase(s, "COMPLETED", now);
  else setupRound(s, now);
}
function validPoints(s: WaveState, p: Record<string, unknown>) {
  need(
    (cooperative(s) ? [0, 2, 3] : [0, 2, 3, 4]).includes(Number(p.points)) &&
      typeof p.points === "number",
    "Invalid score",
  );
  need(
    typeof p.opponentPoints === "number" && [0, 1].includes(p.opponentPoints),
    "Invalid prediction score",
  );
  return { points: p.points, opponentPoints: p.opponentPoints };
}
function reason(p: Record<string, unknown>) {
  need(
    typeof p.reason === "string" &&
      p.reason.trim().length > 0 &&
      p.reason.length <= 200,
    "A short reason is required",
  );
  return p.reason.trim();
}
export function applyAction(
  s: WaveState,
  id: string,
  action: WaveAction,
  now = Date.now(),
): void {
  need(
    action &&
      typeof action.id === "string" &&
      action.id.length > 0 &&
      action.id.length <= 100 &&
      typeof action.type === "string",
    "Invalid action",
  );
  const player = Object.hasOwn(s.players, id) ? s.players[id] : undefined;
  need(player, "Unknown player", 401);
  // Deduplication is scoped to the authenticated identity; another player cannot suppress a command.
  const eventId = `${id}:${action.id}`;
  if (s.processed.includes(eventId)) return;
  need(
    action.generation === s.generation &&
      action.roundId === s.roundId &&
      action.phase === s.phase &&
      action.revision === s.revision,
    "State changed. Please try again.",
    409,
  );
  const p = action.payload ?? {};
  need(p && typeof p === "object" && !Array.isArray(p), "Invalid payload");
  const host = player.role === "HOST",
    type = action.type;
  if (
    [
      "settings",
      "teams",
      "team",
      "randomize",
      "order",
      "start",
      "pause",
      "resume",
      "reset-timer",
      "add-time",
      "replace",
      "replace-psychic",
      "controller",
      "skip-prediction",
      "reopen",
      "confirm",
      "correct",
      "void",
      "restart",
      "end",
      "transfer-host",
    ].includes(type)
  )
    need(host, "Only the host can do that", 403);
  if (s.paused)
    need(
      [
        "resume",
        "settings",
        "reset-timer",
        "add-time",
        "void",
        "restart",
        "end",
        "transfer-host",
        "claim-host",
      ].includes(type),
      "Game is paused",
    );
  switch (type) {
    case "settings": {
      const settings = checkedSettings(s.settings, p);
      if (s.phase !== "LOBBY")
        for (const key of [
          "gameMode",
          "targetScore",
          "fixedRounds",
          "startingBonus",
          "catchUp",
          "prediction",
          "coopRounds",
          "coopBonus",
        ] as const)
          need(
            settings[key] === s.settings[key],
            "Change scoring rules in the lobby",
          );
      const beforeSeconds = phaseSeconds(s);
      s.settings = settings;
      if (beforeSeconds !== phaseSeconds(s)) timer(s, phaseSeconds(s), now);
      if (s.roundSettings && active(s))
        s.notice =
          "Mode, pack, selection and scoring confirmation changes apply next round.";
      break;
    }
    case "team": {
      need(
        ["LOBBY", "REVEAL"].includes(s.phase),
        "Change teams between rounds",
      );
      const targetId = String(p.playerId);
      need(Object.hasOwn(s.players, targetId), "Unknown player");
      const target = s.players[targetId];
      need(p.team === null || p.team === 0 || p.team === 1, "Invalid team");
      target.team = p.team as number | null;
      break;
    }
    case "teams":
      need(
        Array.isArray(p.names) &&
          p.names.length === 2 &&
          p.names.every(
            (x) =>
              typeof x === "string" && x.trim().length > 0 && x.length <= 30,
          ),
        "Invalid team names",
      );
      s.teams = (p.names as string[]).map((x) => x.trim()) as [string, string];
      break;
    case "randomize": {
      need(s.phase === "LOBBY", "Randomize teams in the lobby");
      const ids = s.order.filter((pid) => s.players[pid].team !== null);
      for (let i = ids.length - 1; i > 0; i--) {
        const j = randomIndex(i + 1);
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      ids.forEach((pid, i) => {
        s.players[pid].team = i % 2;
      });
      break;
    }
    case "order":
      need(
        ["LOBBY", "REVEAL"].includes(s.phase) &&
          Array.isArray(p.order) &&
          p.order.length === s.order.length &&
          new Set(p.order).size === s.order.length &&
          p.order.every(
            (pid) => typeof pid === "string" && s.order.includes(pid),
          ),
        "Invalid seat order",
      );
      s.order = p.order as string[];
      s.rotation = [[], []];
      break;
    case "start": {
      need(s.phase === "LOBBY", "Game already started");
      s.scores = [0, cooperative(s) || !s.settings.startingBonus ? 0 : 1];
      s.remaining = s.settings.coopRounds;
      s.nextTeam = 0;
      setupRound(s, now);
      break;
    }
    case "choose":
      need(
        s.phase === "SELECTION" && id === s.psychicId,
        "Only the Psychic can choose",
        403,
      );
      need(p.index === 0 || p.index === 1, "Invalid spectrum");
      s.spectrum = s.candidates[Number(p.index)];
      s.candidates = [];
      prepareTarget(s, now);
      break;
    case "clue":
      need(
        s.phase === "CLUE" && id === s.psychicId,
        "Only the Psychic can give the clue",
        403,
      );
      need(
        typeof p.text === "string" &&
          p.text.trim().length > 0 &&
          p.text.length <= 160,
        "Clue must contain 1–160 characters",
      );
      s.clue = p.text.trim();
      phase(s, "DIAL", now);
      break;
    case "claim":
      need(
        s.phase === "DIAL" && guesser(s, id),
        "Only a guessing teammate can control the dial",
        403,
      );
      controller(s, id);
      break;
    case "controller":
      need(
        s.phase === "DIAL" && guesser(s, String(p.playerId)),
        "Choose a guessing teammate",
      );
      controller(s, String(p.playerId));
      break;
    case "skip-prediction":
      need(s.phase === "PREDICTION", "Wait for the opposing prediction");
      s.prediction = null;
      audit(s, id, `Prediction skipped without bonus: ${reason(p)}`, now);
      reveal(s, now);
      break;
    case "move": {
      need(
        s.phase === "DIAL" && guesser(s, id) && s.controllerId === id,
        "You are not the dial controller",
        403,
      );
      need(
        p.epoch === s.controlEpoch &&
          Number.isInteger(p.sequence) &&
          Number(p.sequence) > s.dialSequence,
        "Obsolete dial movement",
        409,
      );
      need(
        typeof p.value === "number" &&
          Number.isFinite(p.value) &&
          p.value >= 0 &&
          p.value <= 180,
        "Invalid dial position",
      );
      s.dial = p.value;
      s.dialSequence = Number(p.sequence);
      break;
    }
    case "lock":
      need(
        s.phase === "DIAL" && guesser(s, id) && s.controllerId === id,
        "Only the dial controller can lock",
        403,
      );
      need(
        p.epoch === s.controlEpoch &&
          typeof p.value === "number" &&
          Number.isFinite(p.value) &&
          p.value >= 0 &&
          p.value <= 180,
        "Invalid dial position",
      );
      s.dial = p.value;
      lock(s, now);
      break;
    case "predict":
      need(
        s.phase === "PREDICTION" &&
          player.team === 1 - s.activeTeam &&
          id !== s.psychicId,
        "Only the opposing team can predict",
        403,
      );
      need(p.side === "left" || p.side === "right", "Choose left or right");
      s.prediction = p.side;
      reveal(s, now);
      break;
    case "chat": {
      need(player.team !== null, "Spectators cannot post", 403);
      need(
        !(
          id === s.psychicId &&
          !exposed(s) &&
          (s.clue !== null || s.roundSettings?.mode === "party")
        ),
        "Psychic stays silent until reveal",
        403,
      );
      need(
        typeof p.text === "string" &&
          p.text.trim().length > 0 &&
          p.text.length <= 300,
        "Message must contain 1–300 characters",
      );
      const last = [...s.chat].reverse().find((m) => m.playerId === id);
      need(
        !last || now - last.at >= 700,
        "Please wait before posting again",
        429,
      );
      s.chat.push({
        id: crypto.randomUUID(),
        at: now,
        playerId: id,
        text: p.text.trim(),
      });
      s.chat = s.chat.slice(-80);
      break;
    }
    case "next":
      need(
        host || (s.result && eligible(s, s.result.team).includes(id)),
        "Only the host or active team can continue",
        403,
      );
      next(s, now);
      break;
    case "pause":
      need(active(s) || s.phase === "REVEAL", "No active round");
      s.paused = true;
      s.pausedRemaining =
        s.deadline === null ? null : Math.max(0, s.deadline - now);
      s.deadline = null;
      break;
    case "resume":
      need(s.paused, "Game is not paused");
      s.paused = false;
      s.deadline = s.pausedRemaining === null ? null : now + s.pausedRemaining;
      s.pausedRemaining = null;
      break;
    case "reset-timer":
      timer(s, phaseSeconds(s), now);
      break;
    case "add-time":
      need(
        s.deadline !== null || s.pausedRemaining !== null,
        "Enable a timer first",
      );
      if (s.paused) s.pausedRemaining = (s.pausedRemaining ?? 0) + 30000;
      else s.deadline = Math.max(now, s.deadline ?? now) + 30000;
      s.timerExpired = false;
      break;
    case "replace":
      need(
        ["SELECTION", "CLUE", "DIAL"].includes(s.phase) &&
          !s.clue &&
          s.replacements < 1,
        "Use void / replay after giving a clue",
      );
      s.replacements++;
      s.roundId = crypto.randomUUID();
      s.target = null;
      s.clue = null;
      s.spectrum = draw(s);
      s.candidates = [];
      s.dial = 90;
      controller(s, s.controllerId);
      prepareTarget(s, now);
      audit(
        s,
        id,
        "Spectrum replaced before clue; use only before a verbal clue.",
        now,
      );
      break;
    case "replace-psychic": {
      need(active(s) && !exposed(s), "No hidden round to replace");
      const replacement = String(p.playerId);
      need(
        eligible(s, s.activeTeam).includes(replacement) &&
          replacement !== s.psychicId,
        "Choose a different teammate",
      );
      // A new secret and round ID prevent reuse of a target the replacement already guessed.
      setupRound(s, now, true, replacement);
      audit(s, id, "Psychic replaced with a fresh spectrum and target.", now);
      break;
    }
    case "reopen":
      need(
        s.phase === "PREDICTION",
        "A revealed target cannot be hidden again",
      );
      s.prediction = null;
      phase(s, "DIAL", now);
      controller(s, s.controllerId);
      audit(s, id, "Dial reopened before reveal.", now);
      break;
    case "confirm":
      need(s.phase === "REVIEW", "No score awaiting confirmation");
      finish(s, now, validPoints(s, p));
      audit(s, id, "Host confirmed the revealed score.", now);
      break;
    case "correct": {
      need(
        (s.phase === "REVEAL" || s.phase === "COMPLETED") &&
          s.result &&
          !s.result.void,
        "Only the latest revealed result can be corrected",
      );
      const why = reason(p),
        points = validPoints(s, p);
      restoreBefore(s);
      s.result.points = points.points;
      s.result.opponentPoints =
        cooperative(s) || points.points === 4 || !s.roundSettings!.prediction
          ? 0
          : points.opponentPoints;
      s.result.reason = why;
      resolveProgress(s, s.result);
      s.history[s.history.length - 1] = structuredClone(s.result);
      phase(s, "REVEAL", now);
      timer(s, 0, now);
      audit(s, id, `Score corrected: ${why}`, now);
      break;
    }
    case "void": {
      need(s.round > 0 && s.phase !== "LOBBY", "No round to void");
      const why = reason(p);
      if (s.result) {
        restoreBefore(s);
        const last = s.history.at(-1);
        if (last?.roundId === s.roundId) {
          last.void = true;
          last.reason = why;
        }
      }
      // Fresh target, never returning a disclosed target to a hidden phase.
      setupRound(s, now, true);
      audit(s, id, `Round void; fresh target: ${why}`, now);
      break;
    }
    case "restart": {
      const fresh = createState(
        s.gameId,
        s.players[id],
        s.hostToken,
        s.settings,
        now,
      );
      Object.assign(s, {
        ...fresh,
        players: s.players,
        order: s.order,
        teams: s.teams,
        displayToken: s.displayToken,
        generation: s.generation + 1,
        version: s.version,
        revision: s.revision,
        audit: s.audit,
      });
      audit(s, id, "Returned to lobby; scores reset.", now);
      break;
    }
    case "end":
      phase(s, "COMPLETED", now);
      s.notice = "Game ended by the host.";
      audit(s, id, "Game ended by the host.", now);
      break;
    case "transfer-host": {
      const targetId = String(p.playerId);
      need(
        Object.hasOwn(s.players, targetId) && targetId !== id,
        "Choose another player",
      );
      const target = s.players[targetId];
      player.role = "PLAYER";
      target.role = "HOST";
      audit(s, id, `Host transferred to ${target.nickname}`, now);
      break;
    }
    case "claim-host": {
      const previous = Object.values(s.players).find((x) => x.role === "HOST");
      need(
        player.team !== null &&
          previous &&
          !previous.connected &&
          previous.disconnectedAt !== null &&
          now - previous.disconnectedAt >= 60000,
        "Host can be recovered after 60 seconds offline",
        403,
      );
      previous.role = "PLAYER";
      player.role = "HOST";
      audit(s, id, `Host recovered by ${player.nickname}`, now);
      break;
    }
    default:
      throw new GameError("Unknown action");
  }
  // Dial movements and chat do not invalidate unrelated decisions. Their own sequence/phase checks do.
  if (!["move", "chat"].includes(type)) s.revision++;
  s.version++;
  s.expiresAt = now + 120 * 60_000;
  s.processed.push(eventId);
  s.processed = s.processed.slice(-400);
}
export function expireState(s: WaveState, now = Date.now()): boolean {
  if (s.phase === "COMPLETED") return false;
  if (now >= s.expiresAt) {
    phase(s, "COMPLETED", now);
    s.notice = "Room expired after inactivity.";
    s.version++;
    s.revision++;
    return true;
  }
  if (s.paused || s.deadline === null || now < s.deadline) return false;
  s.deadline = null;
  s.timerExpired = true;
  if (s.phase === "REVEAL") {
    try {
      next(s, now);
    } catch (error) {
      if (!(error instanceof GameError)) throw error;
      s.notice = error.message;
    }
  } else if (s.settings.autoExpiry && s.phase === "DIAL") lock(s, now);
  else if (s.settings.autoExpiry && s.phase === "PREDICTION") {
    s.prediction = null;
    reveal(s, now);
  } else s.notice = "Time is up. Finish the current action when ready.";
  s.version++;
  s.revision++;
  return true;
}
export function playerDisconnected(s: WaveState, id: string, now = Date.now()) {
  const p = s.players[id];
  if (!p) return;
  p.connected = false;
  p.disconnectedAt = now;
  // Another eligible teammate can immediately take control. Never transfer Psychic secrets.
  if (s.controllerId === id) controller(s, null);
}
/** Explicit allowlist projection. Never spread persistent state into a network response. */
export function serializeForPlayer(
  s: WaveState,
  id: string,
  now = Date.now(),
): WaveView {
  const player = Object.hasOwn(s.players, id) ? s.players[id] : undefined,
    display = id === "$display";
  need(player || display, "Unknown player", 401);
  const host = !display && player?.role === "HOST";
  const view: WaveView = {
    gameType: "wavelength",
    gameId: s.gameId,
    version: s.version,
    revision: s.revision,
    generation: s.generation,
    roundId: s.roundId,
    phase: s.phase,
    serverNow: now,
    yourPlayerId: id,
    yourRole: display ? "DISPLAY" : player!.role,
    players: s.order.map((pid) => {
      const p = s.players[pid];
      return {
        playerId: p.playerId,
        nickname: p.nickname,
        role: p.role,
        connected: p.connected,
        team: p.team,
      };
    }),
    order: [...s.order],
    teams: [...s.teams],
    settings: { ...s.settings },
    roundSettings: s.roundSettings ? { ...s.roundSettings } : null,
    packs: wavePackSummaries,
    round: s.round,
    activeTeam: s.activeTeam,
    psychicId: s.psychicId,
    controllerId: s.controllerId,
    controlEpoch: s.controlEpoch,
    dialSequence: s.dialSequence,
    dial: s.dial,
    clue: s.clue,
    spectrum: s.spectrum ? structuredClone(s.spectrum) : null,
    scores: [...s.scores],
    remaining: s.remaining,
    prediction: s.prediction,
    result: s.result ? structuredClone(s.result) : null,
    history: structuredClone(s.history),
    chat: [...s.chat],
    deadline: s.deadline,
    paused: s.paused,
    pausedRemaining: s.pausedRemaining,
    timerExpired: s.timerExpired,
    nextTeam: s.nextTeam,
    catchUpTurn: s.catchUpTurn,
    tiebreak: s.tiebreak ? structuredClone(s.tiebreak) : null,
    winner: s.winner,
    notice: s.notice,
    audit: [...s.audit],
    poolRemaining: Math.max(
      0,
      (wavePacks[s.settings.packId]?.spectrums.length ?? 0) -
        (s.used[s.settings.packId]?.length ?? 0),
    ),
    poolCycle: s.cycle[s.settings.packId] ?? 1,
  };
  if (!display && id === s.psychicId && s.phase === "SELECTION")
    view.candidates = structuredClone(s.candidates);
  if (s.target !== null && (exposed(s) || (!display && id === s.psychicId)))
    view.target = s.target;
  if (host) view.displayToken = s.displayToken;
  return view;
}
