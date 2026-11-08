import { readdir, readFile, mkdir } from 'node:fs/promises';
import { writeIfChanged } from './lib/write-if-changed.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateFishyBank, normalizeFishyText } from '../shared/fishyBank.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'question-banks/sounds-fishy');
const files = (await readdir(directory)).filter(f => f.endsWith('.json') && !f.endsWith('.schema.json')).sort();
const banks = {}, seen = new Set(), prompts = new Set();
for (const file of files) {
  const bank = validateFishyBank(JSON.parse(await readFile(path.join(directory, file), 'utf8')));
  if (banks[bank.bankId]) throw new Error(`Duplicate bank ID: ${bank.bankId}`);
  for (const q of bank.questions) {
    if (seen.has(q.id)) throw new Error(`Duplicate question ID: ${q.id}`);
    seen.add(q.id);
    const key = `${bank.language}:${normalizeFishyText(q.question)}`;
    if (prompts.has(key)) throw new Error(`Duplicate question: ${q.id}`);
    prompts.add(key);
  }
  banks[bank.bankId] = bank;
}
if (!files.length) throw new Error('No Sounds Fishy banks installed. Restore a sample bank or add a validated bank.');
const summaries = Object.values(banks).map(({ bankId, title, language, development, questions }) => ({ bankId, title, language, development: !!development, questionCount: questions.length }));
await mkdir(path.join(root, 'backend-do/src/generated'), { recursive: true });
await writeIfChanged(path.join(root, 'backend-do/src/generated/soundsFishyBanks.ts'), `// Generated. Server only. Edit question-banks/sounds-fishy/*.json.\nimport type { FishyBank, FishyBankSummary } from '../../../shared/soundsFishy.js';\nimport { validateFishyBank } from '../../../shared/fishyBank.mjs';\nconst sourceBanks: Record<string, FishyBank> = ${JSON.stringify(banks)};\nexport const fishyBanks: Record<string, FishyBank> = Object.fromEntries(Object.entries(sourceBanks).map(([id, bank]) => [id, validateFishyBank(bank)]));\nexport const fishyBankSummaries: FishyBankSummary[] = ${JSON.stringify(summaries)};\n`);
console.log(`Sounds Fishy: validated ${files.length} private banks (${seen.size} questions). No public bank assets written.`);
