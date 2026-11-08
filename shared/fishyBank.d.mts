import type { FishyBank } from './soundsFishy.js';
export const categories: string[];
export const answerTypes: string[];
export function normalizeFishyText(value: string): string;
export function validateFishyBank(value: unknown): FishyBank;
