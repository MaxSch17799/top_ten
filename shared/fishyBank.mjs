export const categories = ['animals', 'nature', 'history', 'science', 'geography', 'food', 'inventions', 'everyday_life', 'culture', 'human_behavior', 'extraordinary_events', 'technology'];
export const answerTypes = ['person', 'place', 'animal', 'object', 'number', 'date', 'phrase', 'other'];
export const normalizeFishyText = (s) => s.normalize('NFKC').toLocaleLowerCase().replace(/[\u200b-\u200d\ufeff]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
export function validateFishyBank(bank) {
  const check = (ok, message) => { if (!ok) throw new Error(`Sounds Fishy bank: ${message}`); };
  const text = (s, max = 2000) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
  check(bank && typeof bank === 'object', 'expected an object');
  check(bank.schemaVersion === 1, 'schemaVersion must be 1');
  check(text(bank.bankId, 100) && /^[a-z0-9-]+$/.test(bank.bankId), 'invalid bankId');
  check(text(bank.language, 30) && /^[a-z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(bank.language), 'invalid language');
  check(text(bank.title, 100), 'title is required');
  check(bank.development === undefined || typeof bank.development === 'boolean', 'invalid development flag');
  check(Array.isArray(bank.questions) && bank.questions.length > 0, 'questions must not be empty');
  const ids = new Set(), prompts = new Set();
  for (const q of bank.questions) {
    check(q && typeof q === 'object', 'invalid question');
    check(text(q.id, 100) && !ids.has(q.id), 'question IDs must be unique'); ids.add(q.id);
    check(text(q.question, 600), `${q.id}: question is required (max 600)`);
    const normalized = normalizeFishyText(q.question);
    check(normalized && !prompts.has(normalized), `${q.id}: duplicate question`); prompts.add(normalized);
    check(text(q.answer, 240), `${q.id}: answer is required (max 240)`);
    check(Array.isArray(q.acceptedAnswers) && q.acceptedAnswers.every(a => text(a, 240)), `${q.id}: invalid acceptedAnswers`);
    check(categories.includes(q.category) && answerTypes.includes(q.answerType), `${q.id}: invalid category/answerType`);
    check(Number.isInteger(q.difficulty) && q.difficulty >= 1 && q.difficulty <= 3, `${q.id}: difficulty must be 1–3`);
    check(text(q.explanation) && text(q.verificationNotes), `${q.id}: explanation and verificationNotes required`);
    check(Array.isArray(q.sources) && q.sources.length > 0, `${q.id}: sources required`);
    for (const s of q.sources) {
      check(s && text(s.title) && text(s.publisher), `${q.id}: source title/publisher required`);
      let url; try { url = new URL(s.url); } catch { /* rejected below */ }
      check(url?.protocol === 'https:', `${q.id}: source must have an HTTPS URL`);
      check(typeof s.accessed === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.accessed) && !isNaN(Date.parse(s.accessed)) && new Date(s.accessed).toISOString().slice(0, 10) === s.accessed, `${q.id}: invalid accessed date`);
    }
  }
  return bank;
}
