export type QuestionBankSource = 'static' | 'db';

export interface QuestionDefinition {
  id: string;
  prompt: string;
}

export interface QuestionBankDefinition {
  id: string;
  name: string;
  version: number;
  questions: QuestionDefinition[];
}

export interface QuestionBankCatalogItem {
  id: string;
  name: string;
  version: number;
  questionCount: number;
  source: QuestionBankSource;
  readOnly: boolean;
  updatedAt?: number;
  archived?: boolean;
}

export interface QuestionBankRevisionSummary {
  revision: number;
  name: string;
  description: string;
  questionCount: number;
  createdAt: number;
  createdBy: string | null;
  importMode: string;
  changeSummary: string;
}

export interface AdminQuestionBankDetail {
  id: string;
  source: QuestionBankSource;
  readOnly: boolean;
  archived: boolean;
  description: string;
  currentRevision: number;
  updatedAt?: number;
  bank: QuestionBankDefinition;
  revisions: QuestionBankRevisionSummary[];
}

export const MAX_BANK_NAME_LENGTH = 80;
export const MAX_BANK_DESCRIPTION_LENGTH = 280;
export const MAX_QUESTIONS_PER_BANK = 1000;
export const MAX_PROMPT_LENGTH = 600;

export function createQuestionId(index: number): string {
  return `q${String(index + 1).padStart(3, '0')}`;
}
