// Shared, dependency-free runtime validation, also used by the build-time sync.
export function validateWordBank(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Word bank must be an object');
  }
  const allowed = [
    'id',
    'name',
    'language',
    'version',
    'development',
    'description',
    'theme',
    'difficulty',
    'cards',
  ];
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('Unknown word-bank field');
  if (
    typeof value.id !== 'string' ||
    !/^[a-z0-9_]+$/.test(value.id) ||
    typeof value.name !== 'string' ||
    !value.name.trim()
  ) {
    throw new Error('Invalid bank id or name');
  }
  if (
    typeof value.language !== 'string' ||
    !/^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(value.language) ||
    !Number.isInteger(value.version) ||
    value.version < 1
  ) {
    throw new Error('Invalid language or version');
  }
  for (const key of ['description', 'theme', 'difficulty']) {
    if (value[key] !== undefined && typeof value[key] !== 'string')
      throw new Error(`Invalid ${key}`);
  }
  if (value.development !== undefined && typeof value.development !== 'boolean')
    throw new Error('Invalid development flag');
  if (!Array.isArray(value.cards) || !value.cards.length)
    throw new Error('Bank must contain cards');
  const ids = new Set();
  const words = new Set();
  for (const card of value.cards) {
    if (
      !card ||
      typeof card.id !== 'string' ||
      !card.id.trim() ||
      ids.has(card.id)
    )
      throw new Error('Card ids must be unique');
    if (Object.keys(card).some((key) => !['id', 'words'].includes(key)))
      throw new Error(`Unknown field in ${card.id}`);
    ids.add(card.id);
    if (!Array.isArray(card.words) || card.words.length !== 5)
      throw new Error(`Card ${card.id} must contain exactly five words`);
    for (const word of card.words) {
      if (
        typeof word !== 'string' ||
        !word.trim() ||
        word !== word.trim() ||
        word.length > 60
      )
        throw new Error(`Invalid word in ${card.id}`);
      const key = word.normalize('NFKC').toLocaleLowerCase(value.language);
      if (words.has(key)) throw new Error(`Repeated word: ${word}`);
      words.add(key);
    }
  }
}
