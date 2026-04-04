import { fetchQuestionBankById, fetchQuestionBankCatalog } from '../api';
import type { QuestionBank, QuestionBankCatalogItem } from './types';

const bankCache: Record<string, QuestionBank> = {};
let catalogCache: QuestionBankCatalogItem[] | null = null;

async function loadStaticManifestFallback(): Promise<QuestionBankCatalogItem[]> {
  const response = await fetch('/question-banks/manifest.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Could not load question bank manifest');
  }
  const data = (await response.json()) as { banks?: Array<{ id: string; name: string; version: number; questionCount: number }> };
  if (!Array.isArray(data.banks) || data.banks.length === 0) {
    throw new Error('Question bank manifest is invalid');
  }
  return data.banks.map((bank) => ({
    ...bank,
    source: 'static' as const,
    readOnly: true,
  }));
}

async function loadStaticBankFallback(bankId: string): Promise<QuestionBank> {
  const response = await fetch(`/question-banks/${bankId}.json`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Could not load question bank');
  }
  const data = (await response.json()) as QuestionBank;
  if (!data?.questions || !Array.isArray(data.questions) || data.questions.length === 0) {
    throw new Error('Question bank is empty');
  }
  return data;
}

export async function loadQuestionBankCatalog(): Promise<QuestionBankCatalogItem[]> {
  if (catalogCache) {
    return catalogCache;
  }
  try {
    const payload = await fetchQuestionBankCatalog();
    catalogCache = payload.banks;
    return payload.banks;
  } catch {
    const fallback = await loadStaticManifestFallback();
    catalogCache = fallback;
    return fallback;
  }
}

export async function loadQuestionBank(bankId: string): Promise<QuestionBank> {
  if (bankCache[bankId]) {
    return bankCache[bankId];
  }
  try {
    const payload = await fetchQuestionBankById(bankId);
    bankCache[bankId] = payload.bank;
    return payload.bank;
  } catch {
    const fallback = await loadStaticBankFallback(bankId);
    bankCache[bankId] = fallback;
    return fallback;
  }
}
