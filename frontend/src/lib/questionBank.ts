import type { QuestionBank } from './types';

const cache: Record<string, QuestionBank> = {};

export async function loadQuestionBank(bankId: string): Promise<QuestionBank> {
  if (cache[bankId]) {
    return cache[bankId];
  }
  const response = await fetch(`/question-banks/${bankId}.json`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Could not load question bank');
  }
  const data = (await response.json()) as QuestionBank;
  if (!data?.questions || !Array.isArray(data.questions) || data.questions.length === 0) {
    throw new Error('Question bank is empty');
  }
  cache[bankId] = data;
  return data;
}
