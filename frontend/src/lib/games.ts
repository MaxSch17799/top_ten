export const games = [
  {
    id: 'skyjo', title: 'Skyjo', mark: '-2',
    description: 'A little mystery. A lower score. Flip, swap, and clear your way to victory.',
    players: '2–8 players · phones or TV', kind: 'Reveal & outsmart', path: '/skyjo',
  },
  {
    id: 'flip7', title: 'Flip 7', mark: '7',
    description: 'A little luck. A lot of nerve. Bank your points or risk it all for seven.',
    players: '2–12 players · phones or TV', kind: 'Push your luck', path: '/flip7',
  },
  {
    id: 'monopoly-deal', title: 'Monopoly Deal', mark: 'M',
    description: 'Build an empire. Make a little trouble. Three colors and one very good deal.',
    players: '2–5 players · together or online', kind: 'Collect & outsmart', path: '/monopoly-deal',
  },
  {
    id: 'uno', title: 'UNO', mark: '7',
    description: 'One card left. All eyes on you. Classic rules or your favorite chaos.',
    players: '2–10 players · together or online', kind: 'Match & outplay', path: '/uno',
  },
  {
    id: 'wavelength', title: 'Wavelength', mark: '◠',
    description: 'Read the room. Find the frequency.',
    players: '2–24 players · together or online', kind: 'Discuss & connect', path: '/wavelength',
  },
  {
    id: 'top10',
    title: 'Top 10',
    mark: '10',
    description: 'One secret number. A whole spectrum of ridiculous answers.',
    players: '2–10 players',
    kind: 'Rank & laugh',
    path: '/top10',
  },
  {
    id: 'just-one',
    title: 'Just One',
    mark: '1',
    description: 'Think together. Write alone. Make every unique clue count.',
    players: '3–7 · up to 10',
    kind: 'Cooperate & guess',
    path: '/just-one',
  },
  {
    id: 'sounds-fishy', title: 'Sounds Fishy', mark: '><>',
    description: 'One true answer. A sea of convincing lies. How far will you fish?',
    players: '4–10 players', kind: 'Bluff & fish', path: '/sounds-fishy',
  },
] as const;
