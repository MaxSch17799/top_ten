export const games = [
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
