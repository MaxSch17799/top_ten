import type {
  Clue,
  Language,
  PotentialDuplicate,
} from '../../../shared/justOne.js';
import { justOneBanks } from '../generated/justOneBanks.js';

// Explicit equivalence groups avoid treating synonyms or arbitrary shared stems as identical.
const groups: Record<Language, string[][]> = {
  en: [
    ['child', 'children'],
    ['mouse', 'mice'],
    ['person', 'people'],
    ['foot', 'feet'],
    ['tooth', 'teeth'],
    ['goose', 'geese'],
    ['man', 'men'],
    ['woman', 'women'],
    ['run', 'running', 'ran', 'runs'],
    ['swim', 'swimming', 'swam', 'swum'],
    ['japan', 'japanese'],
    ['germany', 'german'],
    ['colour', 'color', 'colours', 'colors'],
    ['centre', 'center', 'centres', 'centers'],
    ['theatre', 'theater'],
  ],
  de: [
    ['haus', 'haeuser', 'haeusern', 'hauses'],
    ['baum', 'baeume', 'baeumen', 'baumes'],
    ['maus', 'maeuse', 'maeusen'],
    ['buch', 'buecher', 'buechern', 'buches'],
    ['pferd', 'pferde', 'pferden', 'pferdes'],
    ['hund', 'hunde', 'hunden', 'hundes'],
    ['katze', 'katzen'],
    ['blume', 'blumen'],
    ['apfel', 'aepfel', 'aepfeln', 'apfels'],
    ['kind', 'kinder', 'kindern', 'kindes'],
    ['mann', 'maenner', 'maennern', 'mannes'],
    ['frau', 'frauen'],
    ['vogel', 'voegel', 'voegeln'],
    ['stadt', 'staedte', 'staedten'],
    ['schloss', 'schloesser', 'schloessern', 'schlosses'],
    ['laufen', 'laeuft', 'lief', 'laufend'],
    [
      'japan',
      'japanisch',
      'japanische',
      'japanischer',
      'japanischen',
      'japaner',
    ],
    ['deutschland', 'deutsch', 'deutsche', 'deutscher', 'deutschen'],
  ],
};
export function normalizeWord(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[’‘]/g, "'")
    .replace(/[‐‑–]/g, '-');
}
export function canonical(input: string, language: Language): string {
  const word = normalizeWord(input);
  const group = (groups[language.split('-')[0]] ?? []).find((items) =>
    items.includes(word),
  );
  return group?.[0] ?? word;
}
function inflection(a: string, b: string, language: Language): boolean {
  language = language.split('-')[0];
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (short.length < 3) return false;
  if (language === 'en') {
    if (short === 'new' && long === 'news') return false;
    if (short === 'specie' && long === 'species') return false;
    return (
      long === `${short}s` ||
      (/(s|sh|ch|x|z)$/.test(short) && long === `${short}es`) ||
      (short.endsWith('y') && long === `${short.slice(0, -1)}ies`) ||
      long === `${short}ed` ||
      (short.endsWith('e') && long === `${short}d`) ||
      long === `${short}ing` ||
      (short.endsWith('e') && long === `${short.slice(0, -1)}ing`)
    );
  }
  // German regular feminine plurals and genitives; uncertain suffixes are review suggestions.
  return (
    language === 'de' &&
    ((short.endsWith('e') && long === `${short}n`) ||
      (short.length >= 4 && long === `${short}s`))
  );
}
export function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = old;
    }
  }
  return row[b.length];
}
function transposition(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 4) return false;
  const different = [...a]
    .map((c, i) => (c === b[i] ? -1 : i))
    .filter((i) => i >= 0);
  return (
    different.length === 2 &&
    different[1] === different[0] + 1 &&
    a[different[0]] === b[different[1]] &&
    a[different[1]] === b[different[0]]
  );
}
export type Match = 'equal' | 'possible' | 'different';
const knownWords = new Set(
  Object.values(justOneBanks).flatMap((bank) =>
    bank.cards.flatMap((card) => card.words.map(normalizeWord)),
  ),
);
export function compareWords(
  left: string,
  right: string,
  language: Language,
): Match {
  const a = canonical(left, language),
    b = canonical(right, language);
  if (
    a === b ||
    inflection(a, b, language) ||
    (a.length >= 7 &&
      transposition(a, b) &&
      knownWords.has(a) !== knownWords.has(b))
  )
    return 'equal';
  const min = Math.min(a.length, b.length),
    distance = editDistance(a, b);
  const homophones: Record<string, string[][]> = {
    en: [
      ['knight', 'night'],
      ['sea', 'see'],
      ['flower', 'flour'],
      ['son', 'sun'],
      ['two', 'too', 'to'],
    ],
    de: [
      ['meer', 'mehr'],
      ['seite', 'saite'],
      ['wal', 'wahl'],
      ['lehre', 'leere'],
    ],
  };
  if (
    (homophones[language.split('-')[0]] ?? []).some(
      (group) => group.includes(a) && group.includes(b),
    )
  )
    return 'possible';
  if (
    transposition(a, b) ||
    (min >= 4 && distance <= 1) ||
    (min >= 8 && distance <= 2)
  )
    return 'possible';
  // Conservative stemming: never automatically eliminate ambiguous word families.
  const stem = (s: string) =>
    language.startsWith('de')
      ? s.replace(/(ern|em|er|en|es|e|n|s)$/, '')
      : language.startsWith('en')
        ? s.replace(/(ness|ment|ly|ful|less|er|ing|ed)$/, '')
        : s;
  if (min >= 5 && stem(a).length >= 4 && stem(a) === stem(b)) return 'possible';
  return 'different';
}
export function processClues(
  clues: Clue[],
  mystery: string,
  language: Language,
): PotentialDuplicate[] {
  const potential: PotentialDuplicate[] = [];
  for (const clue of clues) {
    const word = normalizeWord(clue.text);
    if (!word || /\s/u.test(word) || !/[\p{L}\p{N}]/u.test(word)) {
      clue.eliminated = true;
      clue.reason = 'Use a single word, acronym or number';
    } else {
      const match = compareWords(word, mystery, language);
      if (match === 'equal') {
        clue.eliminated = true;
        clue.reason = 'Mystery word or equivalent form';
      } else if (match === 'possible')
        potential.push({
          ids: [clue.id],
          reason: 'Possible mystery-word derivative or spelling variant',
        });
    }
  }
  for (let i = 0; i < clues.length; i++)
    for (let j = i + 1; j < clues.length; j++) {
      const match = compareWords(clues[i].text, clues[j].text, language);
      if (match === 'equal') {
        for (const c of [clues[i], clues[j]]) {
          c.eliminated = true;
          c.reason = 'Duplicate (all copies removed)';
        }
      } else if (match === 'possible')
        potential.push({
          ids: [clues[i].id, clues[j].id],
          reason: 'Possible shared word family or typo',
        });
    }
  return potential;
}
