import { questionBanks as staticQuestionBanks } from './generated/questionBanks.js';
import type {
  AdminQuestionBankDetail,
  QuestionBankCatalogItem,
  QuestionBankDefinition,
  QuestionBankRevisionSummary,
} from './questionBankTypes.js';
import {
  createQuestionId,
  MAX_BANK_DESCRIPTION_LENGTH,
  MAX_BANK_NAME_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_QUESTIONS_PER_BANK,
} from './questionBankTypes.js';
import { generateShortId } from './utils.js';

export interface D1UsageDelta {
  rowsRead: number;
  rowsWritten: number;
}

export interface DbEnv {
  QUESTION_BANKS_DB?: D1Database;
}

export interface DbBankMutationInput {
  name: string;
  description?: string;
  questions: Array<{ prompt?: string } | string>;
  changeSummary?: string;
  importMode?: string;
  createdBy?: string | null;
}

export interface DbImportInput extends DbBankMutationInput {
  mode: 'append' | 'overwrite';
}

type RowRecord = Record<string, unknown>;

function emptyUsage(): D1UsageDelta {
  return { rowsRead: 0, rowsWritten: 0 };
}

function applyMeta(usage: D1UsageDelta, meta: { rows_read?: number; rows_written?: number } | null | undefined): D1UsageDelta {
  if (!meta) {
    return usage;
  }
  usage.rowsRead += Number(meta.rows_read ?? 0);
  usage.rowsWritten += Number(meta.rows_written ?? 0);
  return usage;
}

function mergeUsage(usage: D1UsageDelta, delta: D1UsageDelta | null | undefined): D1UsageDelta {
  if (!delta) {
    return usage;
  }
  usage.rowsRead += Number(delta.rowsRead ?? 0);
  usage.rowsWritten += Number(delta.rowsWritten ?? 0);
  return usage;
}

async function firstRow<T extends RowRecord>(
  statement: D1PreparedStatement,
  usage?: D1UsageDelta
): Promise<T | null> {
  const result = await statement.all<T>();
  if (usage) {
    applyMeta(usage, result.meta);
  }
  return (result.results[0] as T | undefined) ?? null;
}

function isDuplicateNameError(error: unknown): boolean {
  return error instanceof Error && error.message === 'A question bank with that name already exists';
}

function requireDb(env: DbEnv): D1Database {
  if (!env.QUESTION_BANKS_DB) {
    throw new Error('Question bank database is not configured');
  }
  return env.QUESTION_BANKS_DB;
}

function normalizeName(name: string): string {
  return name.trim();
}

function normalizeDescription(description: string | undefined): string {
  return (description ?? '').trim();
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || `bank-${generateShortId(6)}`;
}

function parseSnapshot(snapshotJson: string): QuestionBankDefinition {
  const parsed = JSON.parse(snapshotJson) as QuestionBankDefinition;
  if (!parsed?.id || !parsed?.name || !Array.isArray(parsed.questions)) {
    throw new Error('Stored question bank snapshot is invalid');
  }
  return parsed;
}

function normalizeQuestions(rawQuestions: Array<{ prompt?: string } | string>) {
  const prompts = rawQuestions
    .map((entry) => (typeof entry === 'string' ? entry : String(entry.prompt ?? '')))
    .map((prompt) => prompt.trim())
    .filter(Boolean);
  if (prompts.length === 0) {
    throw new Error('A question bank must contain at least one question');
  }
  if (prompts.length > MAX_QUESTIONS_PER_BANK) {
    throw new Error(`Question banks can contain at most ${MAX_QUESTIONS_PER_BANK} questions`);
  }
  return prompts.map((prompt, index) => {
    if (prompt.length > MAX_PROMPT_LENGTH) {
      throw new Error(`Question ${index + 1} exceeds the ${MAX_PROMPT_LENGTH} character limit`);
    }
    return { id: createQuestionId(index), prompt };
  });
}

function buildSnapshot(bankId: string, name: string, version: number, questions: Array<{ id: string; prompt: string }>): QuestionBankDefinition {
  return { id: bankId, name, version, questions };
}

function validateMutationInput(input: DbBankMutationInput): { name: string; description: string } {
  const name = normalizeName(input.name);
  const description = normalizeDescription(input.description);
  if (!name) {
    throw new Error('Enter a bank name');
  }
  if (name.length > MAX_BANK_NAME_LENGTH) {
    throw new Error(`Bank names are limited to ${MAX_BANK_NAME_LENGTH} characters`);
  }
  if (description.length > MAX_BANK_DESCRIPTION_LENGTH) {
    throw new Error(`Descriptions are limited to ${MAX_BANK_DESCRIPTION_LENGTH} characters`);
  }
  return { name, description };
}

function ensureStaticNameAvailable(name: string, currentBankId?: string): void {
  const lowered = name.toLowerCase();
  for (const bank of Object.values(staticQuestionBanks)) {
    if (bank.id === currentBankId) {
      continue;
    }
    if (bank.name.trim().toLowerCase() === lowered) {
      throw new Error('A question bank with that name already exists');
    }
  }
}

async function ensureDbNameAvailable(db: D1Database, name: string, usage: D1UsageDelta, ignoreBankId?: string): Promise<void> {
  const row = await firstRow<{ id: string }>(
    db
      .prepare(
        `
        SELECT id
        FROM question_banks
        WHERE lower(name) = lower(?1)
          AND (?2 IS NULL OR id != ?2)
        LIMIT 1
        `
      )
      .bind(name, ignoreBankId ?? null),
    usage
  );
  if (row?.id) {
    throw new Error('A question bank with that name already exists');
  }
}

async function createUniqueSlug(db: D1Database, name: string, usage: D1UsageDelta): Promise<string> {
  const baseSlug = slugify(name);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    const row = await firstRow<{ slug: string }>(
      db.prepare('SELECT slug FROM question_banks WHERE slug = ?1 LIMIT 1').bind(slug),
      usage
    );
    if (!row?.slug) {
      return slug;
    }
  }
  return `${baseSlug}-${generateShortId(4)}`;
}

function mapRevisionRow(row: RowRecord): QuestionBankRevisionSummary {
  return {
    revision: Number(row.revision ?? 0),
    name: String(row.name ?? ''),
    description: String(row.description ?? ''),
    questionCount: Number(row.question_count ?? 0),
    createdAt: Number(row.created_at ?? 0),
    createdBy: row.created_by === null ? null : String(row.created_by ?? ''),
    importMode: String(row.import_mode ?? 'manual'),
    changeSummary: String(row.change_summary ?? ''),
  };
}

export async function listMergedCatalog(env: DbEnv): Promise<{ items: QuestionBankCatalogItem[]; usage: D1UsageDelta }> {
  const usage = emptyUsage();
  const items: QuestionBankCatalogItem[] = Object.values(staticQuestionBanks).map((bank) => ({
    id: bank.id,
    name: bank.name,
    version: bank.version,
    questionCount: bank.questions.length,
    source: 'static',
    readOnly: true,
  }));

  if (!env.QUESTION_BANKS_DB) {
    return { items: items.sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })), usage };
  }

  const rows = await env.QUESTION_BANKS_DB
    .prepare(
      `
      SELECT
        qb.id,
        qb.name,
        qb.updated_at,
        qb.status,
        qb.current_revision,
        qbr.question_count
      FROM question_banks qb
      JOIN question_bank_revisions qbr
        ON qbr.bank_id = qb.id
       AND qbr.revision = qb.current_revision
      WHERE qb.status = 'active'
      ORDER BY lower(qb.name) ASC
      `
    )
    .all<RowRecord>();
  applyMeta(usage, rows.meta);

  items.push(
    ...rows.results.map((row) => ({
      id: String(row.id ?? ''),
      name: String(row.name ?? ''),
      version: Number(row.current_revision ?? 1),
      questionCount: Number(row.question_count ?? 0),
      source: 'db' as const,
      readOnly: false,
      updatedAt: Number(row.updated_at ?? 0),
      archived: String(row.status ?? 'active') !== 'active',
    }))
  );

  return { items: items.sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })), usage };
}

export async function getQuestionBankById(env: DbEnv, bankId: string): Promise<{ bank: QuestionBankDefinition | null; source: 'static' | 'db' | null; usage: D1UsageDelta }> {
  const staticBank = staticQuestionBanks[bankId];
  if (staticBank) {
    return { bank: staticBank as QuestionBankDefinition, source: 'static', usage: emptyUsage() };
  }
  if (!env.QUESTION_BANKS_DB) {
    return { bank: null, source: null, usage: emptyUsage() };
  }
  const usage = emptyUsage();
  const row = await firstRow<{ snapshot_json: string }>(
    env.QUESTION_BANKS_DB
      .prepare(
        `
        SELECT qbr.snapshot_json
        FROM question_banks qb
        JOIN question_bank_revisions qbr
          ON qbr.bank_id = qb.id
         AND qbr.revision = qb.current_revision
        WHERE qb.id = ?1
          AND qb.status = 'active'
        LIMIT 1
        `
      )
      .bind(bankId),
    usage
  );
  if (!row?.snapshot_json) {
    return { bank: null, source: null, usage };
  }
  return { bank: parseSnapshot(row.snapshot_json), source: 'db', usage };
}

export async function listAdminBanks(env: DbEnv) {
  return listMergedCatalog(env);
}

export async function getAdminBankDetail(env: DbEnv, bankId: string): Promise<{ detail: AdminQuestionBankDetail | null; usage: D1UsageDelta }> {
  const usage = emptyUsage();
  const staticBank = staticQuestionBanks[bankId];
  if (staticBank) {
    return {
      detail: {
        id: staticBank.id,
        source: 'static',
        readOnly: true,
        archived: false,
        description: '',
        currentRevision: staticBank.version,
        updatedAt: undefined,
        bank: staticBank as QuestionBankDefinition,
        revisions: [],
      },
      usage,
    };
  }

  const db = requireDb(env);
  const row = await firstRow<RowRecord>(
    db
      .prepare(
        `
        SELECT qb.id, qb.description, qb.status, qb.updated_at, qb.current_revision, qbr.snapshot_json
        FROM question_banks qb
        JOIN question_bank_revisions qbr
          ON qbr.bank_id = qb.id
         AND qbr.revision = qb.current_revision
        WHERE qb.id = ?1
        LIMIT 1
        `
      )
      .bind(bankId),
    usage
  );
  if (!row?.snapshot_json) {
    return { detail: null, usage };
  }
  const revisions = await db
    .prepare(
      `
      SELECT revision, name, description, question_count, created_at, created_by, import_mode, change_summary
      FROM question_bank_revisions
      WHERE bank_id = ?1
      ORDER BY revision DESC
      `
    )
    .bind(bankId)
    .all<RowRecord>();
  applyMeta(usage, revisions.meta);
  return {
    detail: {
      id: bankId,
      source: 'db',
      readOnly: false,
      archived: String(row.status ?? 'active') !== 'active',
      description: String(row.description ?? ''),
      currentRevision: Number(row.current_revision ?? 1),
      updatedAt: Number(row.updated_at ?? 0),
      bank: parseSnapshot(String(row.snapshot_json)),
      revisions: revisions.results.map(mapRevisionRow),
    },
    usage,
  };
}

async function fetchCurrentDbBank(db: D1Database, bankId: string): Promise<{
  detail: QuestionBankDefinition;
  currentRevision: number;
  description: string;
  usage: D1UsageDelta;
} | null> {
  const usage = emptyUsage();
  const row = await firstRow<RowRecord>(
    db
      .prepare(
        `
        SELECT qb.current_revision, qb.description, qbr.snapshot_json
        FROM question_banks qb
        JOIN question_bank_revisions qbr
          ON qbr.bank_id = qb.id
         AND qbr.revision = qb.current_revision
        WHERE qb.id = ?1
          AND qb.status = 'active'
        LIMIT 1
        `
      )
      .bind(bankId),
    usage
  );
  if (!row?.snapshot_json) {
    return null;
  }
  return {
    detail: parseSnapshot(String(row.snapshot_json)),
    currentRevision: Number(row.current_revision ?? 1),
    description: String(row.description ?? ''),
    usage,
  };
}

export async function createDbQuestionBank(env: DbEnv, input: DbBankMutationInput): Promise<{ detail: AdminQuestionBankDetail; usage: D1UsageDelta }> {
  const db = requireDb(env);
  const usage = emptyUsage();
  const { name, description } = validateMutationInput(input);
  ensureStaticNameAvailable(name);
  await ensureDbNameAvailable(db, name, usage);

  const bankId = `db_${generateShortId(10)}`;
  const questions = normalizeQuestions(input.questions);
  const slug = await createUniqueSlug(db, name, usage);
  const snapshot = buildSnapshot(bankId, name, 1, questions);
  const now = Date.now();
  const importMode = input.importMode ?? 'manual';
  const changeSummary = (input.changeSummary ?? '').trim();
  const createdBy = input.createdBy ?? null;

  const insertBank = await db
    .prepare(
      `
      INSERT INTO question_banks (id, slug, name, status, created_at, updated_at, created_by, description, current_revision)
      VALUES (?1, ?2, ?3, 'active', ?4, ?4, ?5, ?6, 1)
      `
    )
    .bind(bankId, slug, name, now, createdBy, description)
    .run();
  applyMeta(usage, insertBank.meta);

  const insertRevision = await db
    .prepare(
      `
      INSERT INTO question_bank_revisions
      (bank_id, revision, name, description, import_mode, change_summary, created_at, created_by, question_count, snapshot_json)
      VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      `
    )
    .bind(bankId, name, description, importMode, changeSummary, now, createdBy, snapshot.questions.length, JSON.stringify(snapshot))
    .run();
  applyMeta(usage, insertRevision.meta);

  const detail = await getAdminBankDetail(env, bankId);
  mergeUsage(usage, detail.usage);
  if (!detail.detail) {
    throw new Error('Could not load created question bank');
  }
  return { detail: detail.detail, usage };
}

export async function updateDbQuestionBank(env: DbEnv, bankId: string, input: DbBankMutationInput): Promise<{ detail: AdminQuestionBankDetail; usage: D1UsageDelta }> {
  const db = requireDb(env);
  const usage = emptyUsage();
  const current = await fetchCurrentDbBank(db, bankId);
  if (!current) {
    throw new Error('Question bank not found');
  }
  mergeUsage(usage, current.usage);

  const { name, description } = validateMutationInput(input);
  ensureStaticNameAvailable(name, bankId);
  await ensureDbNameAvailable(db, name, usage, bankId);
  const questions = normalizeQuestions(input.questions);
  const nextRevision = current.currentRevision + 1;
  const snapshot = buildSnapshot(bankId, name, nextRevision, questions);
  const now = Date.now();
  const importMode = input.importMode ?? 'manual';
  const changeSummary = (input.changeSummary ?? '').trim();
  const createdBy = input.createdBy ?? null;

  const updateBank = await db
    .prepare(
      `
      UPDATE question_banks
      SET name = ?2,
          description = ?3,
          updated_at = ?4,
          current_revision = ?5
      WHERE id = ?1
      `
    )
    .bind(bankId, name, description, now, nextRevision)
    .run();
  applyMeta(usage, updateBank.meta);

  const insertRevision = await db
    .prepare(
      `
      INSERT INTO question_bank_revisions
      (bank_id, revision, name, description, import_mode, change_summary, created_at, created_by, question_count, snapshot_json)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
      `
    )
    .bind(bankId, nextRevision, name, description, importMode, changeSummary, now, createdBy, snapshot.questions.length, JSON.stringify(snapshot))
    .run();
  applyMeta(usage, insertRevision.meta);

  const detail = await getAdminBankDetail(env, bankId);
  mergeUsage(usage, detail.usage);
  if (!detail.detail) {
    throw new Error('Could not load updated question bank');
  }
  return { detail: detail.detail, usage };
}

export async function importIntoDbQuestionBank(env: DbEnv, bankId: string, input: DbImportInput): Promise<{ detail: AdminQuestionBankDetail; usage: D1UsageDelta }> {
  const db = requireDb(env);
  const current = await fetchCurrentDbBank(db, bankId);
  if (!current) {
    throw new Error('Question bank not found');
  }
  const mergedQuestions =
    input.mode === 'overwrite'
      ? input.questions
      : [...current.detail.questions.map((question) => question.prompt), ...input.questions];
  return updateDbQuestionBank(env, bankId, {
    name: input.name || current.detail.name,
    description: input.description ?? current.description,
    questions: mergedQuestions,
    changeSummary: input.changeSummary ?? `${input.mode === 'overwrite' ? 'Overwrite' : 'Append'} import`,
    importMode: input.mode === 'overwrite' ? 'overwrite_upload' : 'append_upload',
    createdBy: input.createdBy ?? null,
  });
}

export async function restoreDbQuestionBankRevision(env: DbEnv, bankId: string, revision: number, createdBy?: string | null): Promise<{ detail: AdminQuestionBankDetail; usage: D1UsageDelta }> {
  const db = requireDb(env);
  const usage = emptyUsage();
  const row = await firstRow<RowRecord>(
    db
      .prepare(
        `
        SELECT snapshot_json, description
        FROM question_bank_revisions
        WHERE bank_id = ?1
          AND revision = ?2
        LIMIT 1
        `
      )
      .bind(bankId, revision),
    usage
  );
  if (!row?.snapshot_json) {
    throw new Error('Revision not found');
  }
  const snapshot = parseSnapshot(String(row.snapshot_json));
  const restored = await updateDbQuestionBank(env, bankId, {
    name: snapshot.name,
    description: String(row.description ?? ''),
    questions: snapshot.questions.map((question) => question.prompt),
    changeSummary: `Restored revision ${revision}`,
    importMode: 'restore',
    createdBy: createdBy ?? null,
  });
  mergeUsage(usage, restored.usage);
  return { detail: restored.detail, usage };
}

export async function getRevisionSnapshot(env: DbEnv, bankId: string, revision: number): Promise<{ detail: AdminQuestionBankDetail | null; usage: D1UsageDelta }> {
  const db = requireDb(env);
  const usage = emptyUsage();
  const row = await firstRow<RowRecord>(
    db
      .prepare(
        `
        SELECT revision, name, description, question_count, created_at, created_by, import_mode, change_summary, snapshot_json
        FROM question_bank_revisions
        WHERE bank_id = ?1
          AND revision = ?2
        LIMIT 1
        `
      )
      .bind(bankId, revision),
    usage
  );
  if (!row?.snapshot_json) {
    return { detail: null, usage };
  }
  return {
    detail: {
      id: bankId,
      source: 'db',
      readOnly: false,
      archived: false,
      description: String(row.description ?? ''),
      currentRevision: Number(row.revision ?? revision),
      updatedAt: Number(row.created_at ?? 0),
      bank: parseSnapshot(String(row.snapshot_json)),
      revisions: [mapRevisionRow(row)],
    },
    usage,
  };
}

export async function copyQuestionBankToDb(env: DbEnv, bankId: string, createdBy?: string | null): Promise<{ detail: AdminQuestionBankDetail; usage: D1UsageDelta }> {
  const usage = emptyUsage();
  const source = await getQuestionBankById(env, bankId);
  mergeUsage(usage, source.usage);
  if (!source.bank) {
    throw new Error('Question bank not found');
  }
  const db = requireDb(env);
  let copyName = `${source.bank.name} (Copy)`;
  let suffix = 2;
  while (true) {
    try {
      ensureStaticNameAvailable(copyName);
      await ensureDbNameAvailable(db, copyName, usage);
      break;
    } catch (error) {
      if (!isDuplicateNameError(error)) {
        throw error;
      }
      copyName = `${source.bank.name} (Copy ${suffix})`;
      suffix += 1;
    }
  }
  const copied = await createDbQuestionBank(env, {
    name: copyName,
    description: '',
    questions: source.bank.questions.map((question) => question.prompt),
    changeSummary: `Copied from ${source.bank.name}`,
    importMode: 'copy',
    createdBy: createdBy ?? null,
  });
  mergeUsage(usage, copied.usage);
  return { detail: copied.detail, usage };
}
