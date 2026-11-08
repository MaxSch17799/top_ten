export const UNO_COLORS = ["red", "yellow", "green", "blue"] as const;
export type UnoColor = (typeof UNO_COLORS)[number];
export type UnoValue =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "skip"
  | "reverse"
  | "draw2"
  | "wild"
  | "draw4";
export interface UnoCard {
  id: string;
  color: UnoColor | null;
  value: UnoValue;
}
export interface UnoRules {
  stack2: boolean;
  stack4: boolean;
  mixedStack: boolean;
  jumpIn: boolean;
  sevenZero: boolean;
  drawUntil: boolean;
  multiples: boolean;
  forcedPlay: boolean;
}
export const CLASSIC_RULES: UnoRules = {
  stack2: false,
  stack4: false,
  mixedStack: false,
  jumpIn: false,
  sevenZero: false,
  drawUntil: false,
  multiples: false,
  forcedPlay: false,
};
export interface UnoProfile {
  id: string;
  name: string;
  description: string;
  rules: UnoRules;
}
export const UNO_PROFILES: UnoProfile[] = [
  {
    id: "classic",
    name: "Classic UNO",
    description:
      "The classic 108-card game. Draw one, no stacking, no house rules.",
    rules: { ...CLASSIC_RULES },
  },
  {
    id: "stacking",
    name: "Stacking UNO",
    description:
      "Pass on +2 with +2, or +4 with +4. Challenges still apply. No mixed stacking.",
    rules: { ...CLASSIC_RULES, stack2: true, stack4: true },
  },
  {
    id: "chaos",
    name: "Party / Chaos UNO",
    description:
      "Same-type stacking, exact-card Jump-In, and 7–0 hand swaps. Expect surprises.",
    rules: {
      ...CLASSIC_RULES,
      stack2: true,
      stack4: true,
      jumpIn: true,
      sevenZero: true,
    },
  },
];
export const UNO_RULE_INFO: {
  key: keyof UnoRules;
  label: string;
  explanation: string;
}[] = [
  {
    key: "stack2",
    label: "+2 stacking",
    explanation:
      "Answer a pending +2 with any +2. The total passes to the next player, who draws and loses their turn if they cannot or choose not to stack.",
  },
  {
    key: "stack4",
    label: "+4 stacking",
    explanation:
      "Answer a pending +4 with another +4. Stacking accepts the previous +4; only the latest +4 can be challenged. Its player must have no card of the previously active color.",
  },
  {
    key: "mixedStack",
    label: "Mixed stacking",
    explanation:
      "Requires both stacking switches. A +4 can go on +2; a +2 can go on +4 only in the chosen color. Challenges affect the latest +4 only; an older debt remains with the challenger.",
  },
  {
    key: "jumpIn",
    label: "Jump-In",
    explanation:
      "Steal the turn with the exact same color and number or action. No Wild Jump-In, no Jump-In during a draw, color choice or pending penalty. First accepted move wins the race.",
  },
  {
    key: "sevenZero",
    label: "7–0 hands",
    explanation:
      "A 7 swaps your remaining hand with a chosen player; a 0 passes all hands in the playing direction. Resolve the transfer before checking the winner. Transferred one-card hands are announced automatically.",
  },
  {
    key: "drawUntil",
    label: "Draw until playable",
    explanation:
      "Draw until a legally playable card is found, then play that card or pass. Penalties still draw their exact total. If no cards remain available, pass automatically.",
  },
  {
    key: "multiples",
    label: "Multiple identical cards",
    explanation:
      "On your turn, play up to two identical NUMBER cards of the same color together. Actions and Wilds stay single. 7–0 triggers once. After drawing or jumping in, play one card only.",
  },
  {
    key: "forcedPlay",
    label: "Forced play",
    explanation:
      "If you have a legal card, drawing is disabled. A playable drawn card must be played. A legal penalty stack must also be played. A risky +4 bluff never counts as a required legal move.",
  },
];
export interface UnoSettings {
  profileId: string;
  profileName: string;
  rules: UnoRules;
  mode: "single" | "rounds" | "points";
  rounds: number;
  targetScore: number;
}
export const DEFAULT_UNO_SETTINGS: UnoSettings = {
  profileId: "classic",
  profileName: "Classic UNO",
  rules: { ...CLASSIC_RULES },
  mode: "single",
  rounds: 3,
  targetScore: 500,
};
export function checkedUnoSettings(
  raw: unknown,
  base: UnoSettings = DEFAULT_UNO_SETTINGS,
): UnoSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid UNO settings");
  const p = raw as Partial<UnoSettings>,
    rules = { ...base.rules };
  if (p.rules !== undefined) {
    if (!p.rules || typeof p.rules !== "object" || Array.isArray(p.rules))
      throw new Error("Invalid house rules");
    for (const key of Object.keys(CLASSIC_RULES) as (keyof UnoRules)[]) {
      if (key in p.rules) {
        if (typeof p.rules[key] !== "boolean")
          throw new Error("House rules must be on or off");
        rules[key] = p.rules[key];
      }
    }
  }
  if (rules.mixedStack && (!rules.stack2 || !rules.stack4))
    throw new Error("Mixed stacking requires both +2 and +4 stacking");
  const mode = p.mode ?? base.mode,
    rounds = p.rounds ?? base.rounds,
    targetScore = p.targetScore ?? base.targetScore;
  if (!["single", "rounds", "points"].includes(mode))
    throw new Error("Choose a valid game length");
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100)
    throw new Error("Choose 1–100 rounds");
  if (!Number.isInteger(targetScore) || targetScore < 50 || targetScore > 10000)
    throw new Error("Choose a target of 50–10,000 points");
  const preset = UNO_PROFILES.find(
    (v) => JSON.stringify(v.rules) === JSON.stringify(rules),
  );
  const saved =
    typeof p.profileId === "string" && p.profileId.startsWith("custom-");
  return {
    rules,
    mode,
    rounds,
    targetScore,
    profileId:
      (!saved && preset?.id) || String(p.profileId ?? "custom").slice(0, 80),
    profileName:
      (!saved && preset?.name) ||
      String(p.profileName ?? "Custom rules")
        .trim()
        .slice(0, 40) ||
      "Custom rules",
  };
}
export const unoCardLabel = (c: UnoCard) =>
  `${c.color ? c.color + " " : ""}${({ skip: "Skip", reverse: "Reverse", draw2: "Draw Two", wild: "Wild", draw4: "Wild Draw Four" } as Record<string, string>)[c.value] ?? c.value}`;
export const isUnoNumber = (c: UnoCard) => /^\d$/.test(c.value);
export const sameUnoCard = (a: UnoCard, b: UnoCard) =>
  a.color === b.color && a.value === b.value;
export type UnoPhase = "LOBBY" | "COLOR" | "PLAY" | "ROUND_OVER" | "COMPLETED";
export interface UnoPlayer {
  playerId: string;
  nickname: string;
  role: "HOST" | "PLAYER";
  connected: boolean;
  cardCount: number;
  score: number;
  wins: number;
  saidUno: boolean;
}
export interface UnoEvent {
  id: number;
  type:
    | "play"
    | "draw"
    | "skip"
    | "reverse"
    | "uno"
    | "catch"
    | "swap"
    | "round"
    | "challenge"
    | "notice";
  actor: string | null;
  target?: string;
  card?: UnoCard;
  count?: number;
  message: string;
}
export interface UnoResult {
  round: number;
  winner: string | null;
  points: number;
  totals: Record<string, number>;
  remaining: Record<string, number>;
}
export interface UnoView {
  gameType: "uno";
  gameId: string;
  version: number;
  revision: number;
  generation: number;
  phase: UnoPhase;
  yourPlayerId: string;
  yourRole: "HOST" | "PLAYER" | "DISPLAY";
  players: UnoPlayer[];
  order: string[];
  settings: UnoSettings;
  round: number;
  turn: string | null;
  direction: 1 | -1;
  color: UnoColor | null;
  top: UnoCard | null;
  deckCount: number;
  hand: UnoCard[];
  legalCardIds: string[];
  bluffCardIds: string[];
  canDraw: boolean;
  canPass: boolean;
  drawnCardId: string | null;
  pending: {
    amount: number;
    kind: "draw2" | "draw4";
    offender: string | null;
    canChallenge: boolean;
  } | null;
  unoVulnerable: string | null;
  events: UnoEvent[];
  result: UnoResult | null;
  history: UnoResult[];
  winners: string[];
  nextRoundAt: number | null;
  serverNow: number;
  displayToken?: string;
  challengeProof?: {
    offender: string;
    cards: UnoCard[];
    guilty: boolean;
    color: UnoColor;
  };
}
export interface UnoAction {
  id: string;
  type: string;
  generation: number;
  revision: number;
  round: number;
  payload?: Record<string, unknown>;
}
