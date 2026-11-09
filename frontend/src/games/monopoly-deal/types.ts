import { type DealView } from "../../../../shared/monopolyDeal";

export type Act = (
  type: string,
  payload?: Record<string, unknown>,
) => Promise<boolean>;
export const playerName = (s: DealView, id: string | null | undefined) =>
  s.players.find((p) => p.playerId === id)?.nickname ?? "Player";
