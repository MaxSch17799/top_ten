import { GAME_TYPES, type GameType } from '../../shared/games.js';
import type { Env } from './env.js';
import { Top10Room } from './top10/room.js';
import { JustOneRoom } from './justOne/room.js';
import { SoundsFishyRoom } from './soundsFishy/room.js';
import { WavelengthRoom } from './wavelength/room.js';
import { UnoRoom } from './uno/room.js';
import { MonopolyDealRoom } from './monopolyDeal/room.js';
import { Flip7Room } from './flip7/room.js';
import { SkyjoRoom } from './skyjo/room.js';
import { checkedSettings as checkedJustOneSettings } from './justOne/engine.js';
import { checkedSettings as checkedFishySettings } from './soundsFishy/engine.js';
import { checkedSettings as checkedWaveSettings } from './wavelength/engine.js';
import { defaultJustOneSettings } from '../../shared/justOne.js';
import { defaultFishySettings } from '../../shared/soundsFishy.js';
import { defaultWaveSettings } from '../../shared/wavelength.js';
import { checkedUnoSettings } from '../../shared/uno.js';
import { checkedDealSettings } from '../../shared/monopolyDeal.js';
import { checkedFlipSettings } from '../../shared/flip7.js';
import { checkedSkySettings } from '../../shared/skyjo.js';
import { fishyBankSummaries } from './generated/soundsFishyBanks.js';

export interface RoomAdapter {
  exists(): Promise<boolean>;
  fetch(request: Request): Promise<Response>;
  alarm(): Promise<void>;
}
interface Registration {
  storageKey: string;
  create(ctx: DurableObjectState, env: Env): RoomAdapter;
  preflight(settings: unknown): unknown;
}

/** Server-only. Never import factories, engines or secret banks into a browser manifest. */
export const registrations = {
  top10: { storageKey: 'state', create: (ctx, env) => new Top10Room(ctx, env), preflight: () => undefined },
  'just-one': { storageKey: 'just-one', create: (ctx, env) => new JustOneRoom(ctx, env), preflight: settings => checkedJustOneSettings(defaultJustOneSettings, settings ?? {}) },
  'sounds-fishy': { storageKey: 'sounds-fishy', create: (ctx, env) => new SoundsFishyRoom(ctx, env), preflight: settings => checkedFishySettings({ ...defaultFishySettings, bankId: fishyBankSummaries.some(b => b.bankId === defaultFishySettings.bankId) ? defaultFishySettings.bankId : fishyBankSummaries[0]?.bankId ?? '' }, settings ?? {}) },
  wavelength: { storageKey: 'wavelength', create: (ctx, env) => new WavelengthRoom(ctx, env), preflight: settings => checkedWaveSettings(defaultWaveSettings, settings ?? {}) },
  uno: { storageKey: 'uno', create: (ctx, env) => new UnoRoom(ctx, env), preflight: settings => checkedUnoSettings(settings ?? {}) },
  'monopoly-deal': { storageKey: 'monopoly-deal', create: (ctx, env) => new MonopolyDealRoom(ctx, env), preflight: settings => checkedDealSettings(settings ?? {}) },
  flip7: { storageKey: 'flip7', create: (ctx, env) => new Flip7Room(ctx, env), preflight: settings => checkedFlipSettings(settings ?? {}) },
  skyjo: { storageKey: 'skyjo', create: (ctx, env) => new SkyjoRoom(ctx, env), preflight: settings => checkedSkySettings(settings ?? {}) },
} satisfies Record<GameType, Registration>;

/** Legacy ownership precedence, deliberately independent of homepage/shared-ID order. */
export const ROOM_PRECEDENCE: readonly GameType[] = ['skyjo', 'flip7', 'monopoly-deal', 'uno', 'wavelength', 'sounds-fishy', 'just-one', 'top10'];

export function createAdapters(ctx: DurableObjectState, env: Env): Record<GameType, RoomAdapter> {
  const rooms: Partial<Record<GameType, RoomAdapter>> = {};
  for (const id of GAME_TYPES) rooms[id] = registrations[id].create(ctx, env);
  return rooms as Record<GameType, RoomAdapter>;
}
