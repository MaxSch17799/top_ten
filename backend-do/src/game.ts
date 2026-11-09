import type { Env } from './env.js';
export type { Env } from './env.js';
export type { Phase, PlayerStatus, PlayerRole, GameEndReason, InactivityKind } from './top10/room.js';
import { Top10Room } from './top10/room.js';
import { JustOneRoom } from './justOne/room.js';
import { SoundsFishyRoom } from './soundsFishy/room.js';
import { WavelengthRoom } from './wavelength/room.js';
import { UnoRoom } from './uno/room.js';
import { MonopolyDealRoom } from './monopolyDeal/room.js';
import { Flip7Room } from './flip7/room.js';
import { SkyjoRoom } from './skyjo/room.js';

/** Stable Cloudflare class; each game owns its room implementation and persistence. */
export class GameDurableObject {
  private top10: Top10Room;
  private justOne: JustOneRoom;
  private soundsFishy: SoundsFishyRoom;
  private wavelength: WavelengthRoom;
  private uno: UnoRoom;
  private monopolyDeal: MonopolyDealRoom;
  private flip7: Flip7Room;
  private skyjo: SkyjoRoom;

  constructor(stateController: DurableObjectState, env: Env) {
    this.top10 = new Top10Room(stateController, env);
    this.justOne = new JustOneRoom(stateController, env);
    this.soundsFishy = new SoundsFishyRoom(stateController, env);
    this.wavelength = new WavelengthRoom(stateController, env);
    this.uno = new UnoRoom(stateController, env);
    this.monopolyDeal = new MonopolyDealRoom(stateController, env);
    this.flip7 = new Flip7Room(stateController, env);
    this.skyjo = new SkyjoRoom(stateController, env);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return this.top10.fetch(request);
    if (new URL(request.url).pathname === '/api/internal/create') {
      const payload = await request.clone().json() as Record<string, unknown>;
      if (payload.gameType === 'skyjo' || await this.skyjo.exists()) return this.skyjo.fetch(request);
      if (payload.gameType === 'flip7' || await this.flip7.exists()) return this.flip7.fetch(request);
      if (payload.gameType === 'monopoly-deal' || await this.monopolyDeal.exists()) return this.monopolyDeal.fetch(request);
      if (payload.gameType === 'uno' || await this.uno.exists()) return this.uno.fetch(request);
      if (payload.gameType === 'wavelength' || await this.wavelength.exists()) return this.wavelength.fetch(request);
      if (payload.gameType === 'sounds-fishy' || await this.soundsFishy.exists()) return this.soundsFishy.fetch(request);
      if (payload.gameType === 'just-one' || await this.justOne.exists()) return this.justOne.fetch(request);
      return this.top10.fetch(request);
    }
    if (await this.skyjo.exists()) return this.skyjo.fetch(request);
    if (await this.flip7.exists()) return this.flip7.fetch(request);
    if (await this.monopolyDeal.exists()) return this.monopolyDeal.fetch(request);
    if (await this.uno.exists()) return this.uno.fetch(request);
    if (await this.wavelength.exists()) return this.wavelength.fetch(request);
    if (await this.soundsFishy.exists()) return this.soundsFishy.fetch(request);
    if (await this.justOne.exists()) return this.justOne.fetch(request);
    return this.top10.fetch(request);
  }

  async alarm(): Promise<void> {
    if (await this.skyjo.exists()) return this.skyjo.alarm();
    if (await this.flip7.exists()) return this.flip7.alarm();
    if (await this.monopolyDeal.exists()) return this.monopolyDeal.alarm();
    if (await this.uno.exists()) return this.uno.alarm();
    if (await this.wavelength.exists()) return this.wavelength.alarm();
    if (await this.soundsFishy.exists()) return this.soundsFishy.alarm();
    if (await this.justOne.exists()) return this.justOne.alarm();
    return this.top10.alarm();
  }
}
