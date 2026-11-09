import { lazy, type ComponentType } from 'react';
import type { GameType } from '../../../shared/games';
import { games } from '../lib/games';
import LandingView from '../components/LandingView';
import JustOneHome from '../components/JustOneHome';
import SoundsFishyHome from '../components/SoundsFishyHome';
import WavelengthHome from '../components/WavelengthHome';
import UnoHome from '../components/UnoHome';
import GameShell from '../components/GameShell';
import JustOneGame from '../components/JustOneGame';
import SoundsFishyGame from '../components/SoundsFishyGame';
import WavelengthGame from '../components/WavelengthGame';
import UnoGame from '../components/UnoGame';

const MonopolyDealHome = lazy(() => import('../components/MonopolyDealHome'));
const Flip7Home = lazy(() => import('../components/Flip7Home'));
const SkyjoHome = lazy(() => import('../components/SkyjoHome'));
const MonopolyDealGame = lazy(() => import('../components/MonopolyDealGame'));
const Flip7Game = lazy(() => import('../components/Flip7Game'));
const SkyjoGame = lazy(() => import('../components/SkyjoGame'));

interface GameRegistration {
  Home: ComponentType;
  Room: ComponentType<{ gameId: string; display?: boolean }>;
  hasDisplay: boolean;
  path: string;
  title: string;
  loading: string;
}
const listing = (id: GameType) => {
  const game = games.find(entry => entry.id === id);
  if (!game) throw new Error(`Missing homepage listing: ${id}`);
  return game;
};

/** Frontend components only. Existing eager/lazy boundaries and URL paths are retained. */
export const gameComponents = {
  top10: { ...listing('top10'), Home: LandingView, Room: GameShell, hasDisplay: false, loading: 'Finding your game…' },
  'just-one': { ...listing('just-one'), Home: JustOneHome, Room: JustOneGame, hasDisplay: false, loading: 'Finding your game…' },
  'sounds-fishy': { ...listing('sounds-fishy'), Home: SoundsFishyHome, Room: SoundsFishyGame, hasDisplay: true, loading: 'Finding your game…' },
  wavelength: { ...listing('wavelength'), Home: WavelengthHome, Room: WavelengthGame, hasDisplay: true, loading: 'Finding your game…' },
  uno: { ...listing('uno'), Home: UnoHome, Room: UnoGame, hasDisplay: true, loading: 'Finding your game…' },
  'monopoly-deal': { ...listing('monopoly-deal'), Home: MonopolyDealHome, Room: MonopolyDealGame, hasDisplay: true, loading: 'Opening your table…' },
  flip7: { ...listing('flip7'), Home: Flip7Home, Room: Flip7Game, hasDisplay: true, loading: 'Opening the table…' },
  skyjo: { ...listing('skyjo'), Home: SkyjoHome, Room: SkyjoGame, hasDisplay: true, loading: 'Opening your table…' },
} satisfies Record<GameType, GameRegistration>;
