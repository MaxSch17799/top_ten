/** Classic 106-card playable deck (the four reference cards are not game cards). */
export const DEAL_COLORS = [
  "brown",
  "lightBlue",
  "pink",
  "orange",
  "red",
  "yellow",
  "green",
  "darkBlue",
  "railroad",
  "utility",
] as const;
export type DealColor = (typeof DEAL_COLORS)[number];
export const DEAL_GROUPS: Record<
  DealColor,
  { name: string; size: number; value: number; rent: number[] }
> = {
  brown: { name: "Brown", size: 2, value: 1, rent: [1, 2] },
  lightBlue: {
    name: "Sky blue",
    size: 3,
    value: 1,
    rent: [1, 2, 3],
  },
  pink: { name: "Pink", size: 3, value: 2, rent: [1, 2, 4] },
  orange: {
    name: "Orange",
    size: 3,
    value: 2,
    rent: [1, 3, 5],
  },
  red: { name: "Red", size: 3, value: 3, rent: [2, 3, 6] },
  yellow: {
    name: "Yellow",
    size: 3,
    value: 3,
    rent: [2, 4, 6],
  },
  green: {
    name: "Green",
    size: 3,
    value: 4,
    rent: [2, 4, 7],
  },
  darkBlue: {
    name: "Deep blue",
    size: 2,
    value: 4,
    rent: [3, 8],
  },
  railroad: {
    name: "Railroad",
    size: 4,
    value: 2,
    rent: [1, 2, 3, 4],
  },
  utility: {
    name: "Utility",
    size: 2,
    value: 2,
    rent: [1, 2],
  },
};
export type DealEffect =
  | "passGo"
  | "rent"
  | "wildRent"
  | "doubleRent"
  | "debtCollector"
  | "birthday"
  | "slyDeal"
  | "forcedDeal"
  | "dealBreaker"
  | "justSayNo"
  | "house"
  | "hotel";
export interface DealCard {
  id: string;
  kind: "money" | "property" | "wild" | "action";
  title: string;
  value: number;
  colors: DealColor[];
  effect?: DealEffect;
}
export const DEAL_EFFECTS: Record<
  DealEffect,
  { title: string; text: string; symbol: string }
> = {
  passGo: {
    title: "Pass Go",
    text: "Draw two cards. Costs one play.",
    symbol: "+2",
  },
  rent: {
    title: "Rent",
    text: "Charge every opponent rent for one matching property group.",
    symbol: "M",
  },
  wildRent: {
    title: "Wild Rent",
    text: "Charge one opponent rent for any one of your property groups.",
    symbol: "M",
  },
  doubleRent: {
    title: "Double the Rent",
    text: "Play with a Rent card to double its charge. Each card costs one play.",
    symbol: "×2",
  },
  debtCollector: {
    title: "Debt Collector",
    text: "One opponent owes you 5M.",
    symbol: "5M",
  },
  birthday: {
    title: "It’s My Birthday",
    text: "Every opponent owes you 2M.",
    symbol: "2M",
  },
  slyDeal: {
    title: "Sly Deal",
    text: "Steal one property outside a complete set.",
    symbol: "↗",
  },
  forcedDeal: {
    title: "Forced Deal",
    text: "Swap one of your properties for one outside an opponent’s complete set.",
    symbol: "⇄",
  },
  dealBreaker: {
    title: "Deal Breaker",
    text: "Steal a complete property group, including its buildings.",
    symbol: "✦",
  },
  justSayNo: {
    title: "Just Say No",
    text: "Cancel an action against you, or counter a Just Say No. Never costs a play.",
    symbol: "NO",
  },
  house: {
    title: "House",
    text: "Add 3M rent to a complete colored set. No railroads or utilities.",
    symbol: "⌂",
  },
  hotel: {
    title: "Hotel",
    text: "Add 4M more rent to a complete colored set with a House.",
    symbol: "▥",
  },
};
export interface DealSet {
  id: string;
  color: DealColor;
  cards: DealCard[];
  house: DealCard | null;
  hotel: DealCard | null;
}
export interface DealTable {
  bank: DealCard[];
  sets: DealSet[];
  looseBuildings: DealCard[];
}
export const completeDealSet = (s: DealSet) =>
  s.cards.length >= DEAL_GROUPS[s.color].size &&
  s.cards.some((c) => c.value > 0);
export const dealSetCount = (t: DealTable) =>
  new Set(t.sets.filter(completeDealSet).map((s) => s.color)).size;
export const dealRent = (s: DealSet) =>
  !s.cards.some((c) => c.value > 0)
    ? 0
    : DEAL_GROUPS[s.color].rent[
        Math.min(s.cards.length, DEAL_GROUPS[s.color].size) - 1
      ] +
      (completeDealSet(s)
        ? (s.house ? 3 : 0) + (s.hotel && s.house ? 4 : 0)
        : 0);
export const dealBankTotal = (t: DealTable) =>
  t.bank.reduce((sum, c) => sum + c.value, 0);
export function dealAssets(t: DealTable): DealCard[] {
  return [
    ...t.bank,
    ...t.looseBuildings,
    ...t.sets.flatMap((s) => [
      ...s.cards,
      ...(s.house ? [s.house] : []),
      ...(s.hotel ? [s.hotel] : []),
    ]),
  ].filter((c) => c.value > 0);
}
export const buildableDealColor = (color: DealColor) =>
  color !== "railroad" && color !== "utility";
export interface DealRules {
  setsToWin: number;
  startingHand: number;
  handLimit: number;
  playsPerTurn: number;
  drawPerTurn: number;
  dealBreaker: boolean;
  rearrange: boolean;
  ownTurnNoCostsPlay: boolean;
  responseSeconds: number;
  turnSeconds: number;
  autoPay: boolean;
  bankFirstPayments: boolean;
}
export const CLASSIC_DEAL_RULES: DealRules = {
  setsToWin: 3,
  startingHand: 5,
  handLimit: 7,
  playsPerTurn: 3,
  drawPerTurn: 2,
  dealBreaker: true,
  rearrange: true,
  ownTurnNoCostsPlay: false,
  responseSeconds: 0,
  turnSeconds: 0,
  autoPay: false,
  bankFirstPayments: false,
};
export interface DealProfile {
  id: string;
  name: string;
  description: string;
  rules: DealRules;
}
export const DEAL_PROFILES: DealProfile[] = [
  {
    id: "classic",
    name: "Classic Monopoly Deal",
    description: "Official 106-card game. Three different complete colors win.",
    rules: { ...CLASSIC_DEAL_RULES },
  },
  {
    id: "printed2024",
    name: "2024 printed edition",
    description: "G0351 edition: a No during your own turn costs one play.",
    rules: { ...CLASSIC_DEAL_RULES, ownTurnNoCostsPlay: true },
  },
  {
    id: "quick",
    name: "Quick Deal",
    description: "House rules: two colors win. Everything else stays classic.",
    rules: { ...CLASSIC_DEAL_RULES, setsToWin: 2 },
  },
  {
    id: "party",
    name: "Party / Chaos Deal",
    description: "House rules: four plays and three draws per turn.",
    rules: { ...CLASSIC_DEAL_RULES, playsPerTurn: 4, drawPerTurn: 3 },
  },
];
export const DEAL_RULE_INFO: {
  key: keyof DealRules;
  label: string;
  text: string;
  min?: number;
  max?: number;
}[] = [
  {
    key: "setsToWin",
    label: "Colors to win",
    text: "Complete sets must be different colors.",
    min: 2,
    max: 4,
  },
  {
    key: "startingHand",
    label: "Starting hand",
    text: "Cards dealt before the first turn.",
    min: 3,
    max: 7,
  },
  {
    key: "handLimit",
    label: "Hand limit",
    text: "Discard down to this many at turn end.",
    min: 5,
    max: 10,
  },
  {
    key: "playsPerTurn",
    label: "Plays per turn",
    text: "Double Rent costs a play; reactive No cards never do.",
    min: 2,
    max: 5,
  },
  {
    key: "drawPerTurn",
    label: "Turn draw",
    text: "An empty hand always draws five instead.",
    min: 1,
    max: 3,
  },
  {
    key: "dealBreaker",
    label: "Allow Deal Breaker",
    text: "When off, Deal Breaker cards can only be banked.",
  },
  {
    key: "rearrange",
    label: "Allow property rearrangement",
    text: "Classic: move wilds between allowed colors, and ordinary properties between same-color groups, free on your turn. Disabling this is a house rule.",
  },
  {
    key: "ownTurnNoCostsPlay",
    label: "2024 own-turn No rule",
    text: "G0351 printed edition: a No on your turn costs one play. Off-turn Nos are always free. Classic uses the Hasbro FAQ: all Nos are free.",
  },
  {
    key: "responseSeconds",
    label: "Response timer",
    text: "0 = off; otherwise 15–120 seconds. Expiry accepts/stops countering; pays bank first, then cheapest assets; places received property in its first printed color and first open matching group.",
    min: 0,
    max: 120,
  },
  {
    key: "turnSeconds",
    label: "Turn timer",
    text: "0 = off; otherwise 30–300 seconds. Pauses for responses. Expiry ends the turn, discarding highest-value hand cards if needed.",
    min: 0,
    max: 300,
  },
  {
    key: "autoPay",
    label: "Automatic payments",
    text: "Convenience house rule: bank first, then lowest-value properties and buildings. May surrender strategic properties.",
  },
  {
    key: "bankFirstPayments",
    label: "Bank-first payments",
    text: "House rule: use bank cards before properties or buildings. If the bank cannot cover a debt, pay it first, then choose property payments. Classic lets you choose either.",
  },
];
export interface DealSettings {
  profileId: string;
  profileName: string;
  rules: DealRules;
  mode: "single" | "bestOf" | "games";
  games: number;
}
export const DEFAULT_DEAL_SETTINGS: DealSettings = {
  profileId: "classic",
  profileName: "Classic Monopoly Deal",
  rules: { ...CLASSIC_DEAL_RULES },
  mode: "single",
  games: 3,
};
export function checkedDealSettings(
  raw: unknown,
  base: DealSettings = DEFAULT_DEAL_SETTINGS,
): DealSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid Deal settings");
  const p = raw as Partial<DealSettings>,
    rules = { ...CLASSIC_DEAL_RULES, ...base.rules };
  if (p.rules !== undefined) {
    if (!p.rules || typeof p.rules !== "object" || Array.isArray(p.rules))
      throw new Error("Invalid house rules");
    for (const info of DEAL_RULE_INFO) {
      const v = p.rules[info.key];
      if (v === undefined) continue;
      if (typeof CLASSIC_DEAL_RULES[info.key] === "boolean") {
        if (typeof v !== "boolean")
          throw new Error(`${info.label} must be on or off`);
      } else if (
        typeof v !== "number" ||
        !Number.isInteger(v) ||
        v < info.min! ||
        v > info.max!
      )
        throw new Error(`Invalid ${info.label.toLowerCase()}`);
      Object.assign(rules, { [info.key]: v });
    }
  }
  if (rules.responseSeconds > 0 && rules.responseSeconds < 15)
    throw new Error("Response timer is 0 or at least 15 seconds");
  if (rules.turnSeconds > 0 && rules.turnSeconds < 30)
    throw new Error("Turn timer is 0 or at least 30 seconds");
  const mode = p.mode ?? base.mode,
    games = p.games ?? base.games;
  if (
    !["single", "bestOf", "games"].includes(mode) ||
    !Number.isInteger(games) ||
    games < 1 ||
    games > 15 ||
    (mode === "bestOf" && ![3, 5].includes(games))
  )
    throw new Error("Choose single, best of 3/5, or 1–15 games");
  const preset = DEAL_PROFILES.find(
    (v) => JSON.stringify(v.rules) === JSON.stringify(rules),
  );
  const custom =
    typeof p.profileId === "string" && p.profileId.startsWith("custom-");
  return {
    rules,
    mode,
    games,
    profileId:
      (!custom && preset?.id) || String(p.profileId ?? "custom").slice(0, 80),
    profileName:
      (!custom && preset?.name) ||
      String(p.profileName ?? "Custom Deal")
        .trim()
        .slice(0, 40) ||
      "Custom Deal",
  };
}
export type DealPhase =
  "LOBBY" | "PLAY" | "DISCARD" | "ROUND_OVER" | "COMPLETED";
export interface DealPending {
  actor: string;
  kind: DealEffect;
  amount: number;
  amountPerTarget?: number;
  targets: string[];
  index: number;
  target: string;
  responder: string;
  cancelled: boolean;
  depth: number;
  stage: "response" | "payment" | "placement";
  placements: { owner: string; card: DealCard }[];
  targetSetId?: string;
  targetCardId?: string;
  giveCardId?: string;
  deadline: number | null;
}
export interface DealEvent {
  id: number;
  type:
    | "draw"
    | "bank"
    | "property"
    | "action"
    | "payment"
    | "steal"
    | "no"
    | "set"
    | "win"
    | "turn"
    | "notice";
  actor: string | null;
  target?: string;
  message: string;
  card?: DealCard;
}
export interface DealResult {
  round: number;
  winner: string;
  totals: Record<string, number>;
}
export interface DealPlayer {
  playerId: string;
  nickname: string;
  role: "HOST" | "PLAYER";
  connected: boolean;
  cardCount: number;
  table: DealTable;
  completeSets: number;
  wins: number;
}
export interface DealView {
  gameType: "monopoly-deal";
  gameId: string;
  version: number;
  revision: number;
  generation: number;
  phase: DealPhase;
  yourPlayerId: string;
  yourRole: "HOST" | "PLAYER" | "DISPLAY";
  players: DealPlayer[];
  order: string[];
  settings: DealSettings;
  round: number;
  turn: string | null;
  playsLeft: number;
  hand: DealCard[];
  deckCount: number;
  discardCount: number;
  top: DealCard | null;
  pending: DealPending | null;
  turnDeadline: number | null;
  events: DealEvent[];
  result: DealResult | null;
  history: DealResult[];
  winners: string[];
  serverNow: number;
  displayToken?: string;
}
export interface DealAction {
  id: string;
  type: string;
  generation: number;
  revision: number;
  round: number;
  payload?: Record<string, unknown>;
}
