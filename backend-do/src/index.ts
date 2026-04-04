import {
  createAdminToken,
  createOverrideToken,
  extractBearerToken,
  getAdminPassword,
  verifyAdminToken,
  verifyOverrideToken,
} from './auth.js';
import { GameDurableObject, type Env } from './game.js';
import {
  copyQuestionBankToDb,
  createDbQuestionBank,
  getAdminBankDetail,
  getQuestionBankById,
  getRevisionSnapshot,
  importIntoDbQuestionBank,
  listAdminBanks,
  listMergedCatalog,
  restoreDbQuestionBankRevision,
  updateDbQuestionBank,
  type D1UsageDelta,
} from './questionBanksDb.js';
import { fetchUsageStatus, trackUsageEvent, UsageMonitorDurableObject } from './usageMonitor.js';
import { generateNumericCode } from './utils.js';

type JsonPayload = Record<string, unknown>;

async function parseJson(request: Request): Promise<JsonPayload> {
  try {
    const result = await request.json();
    return typeof result === 'object' && result !== null ? (result as JsonPayload) : {};
  } catch {
    return {};
  }
}

function createCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Player-Token,X-Host-Token',
  };
}

function jsonResponse(
  request: Request,
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...createCorsHeaders(request), ...extraHeaders },
  });
}

function errorResponse(request: Request, status: number, error: string, message?: string, extras: JsonPayload = {}): Response {
  return jsonResponse(request, status, { error, message: message ?? error, ...extras });
}

function getOverrideTokenFromPayload(request: Request, payload: JsonPayload): string | null {
  if (typeof payload.overrideToken === 'string') {
    return payload.overrideToken;
  }
  const header = request.headers.get('x-override-token');
  return header?.trim() || null;
}

function normalizeQuestionsInput(value: unknown): Array<{ prompt?: string } | string> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => {
    if (typeof entry === 'string') {
      return entry;
    }
    if (entry && typeof entry === 'object') {
      return { prompt: String((entry as { prompt?: unknown }).prompt ?? '') };
    }
    return '';
  });
}

function normalizeRevisionParam(raw: string | undefined): number | null {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function trackD1Usage(ctx: ExecutionContext, env: Env, usage: D1UsageDelta | null | undefined): void {
  if (!usage || (!usage.rowsRead && !usage.rowsWritten)) {
    return;
  }
  ctx.waitUntil(
    trackUsageEvent(env, {
      type: 'D1_USAGE',
      rowsRead: usage.rowsRead,
      rowsWritten: usage.rowsWritten,
    }).catch(() => undefined)
  );
}

async function requireAdmin(request: Request, env: Env): Promise<boolean> {
  const token = extractBearerToken(request);
  const payload = await verifyAdminToken(token, env);
  return Boolean(payload);
}

async function requireOverrideIfNeeded(request: Request, env: Env, payload: JsonPayload): Promise<Response | null> {
  const usage = await fetchUsageStatus(env);
  if (!usage.nearLimit) {
    return null;
  }
  const overrideToken = getOverrideTokenFromPayload(request, payload);
  const validOverride = await verifyOverrideToken(overrideToken, env);
  if (validOverride) {
    return null;
  }
  return errorResponse(
    request,
    409,
    'LIMIT_NEAR',
    usage.warningMessage ?? 'Free-tier usage is near the configured limit.',
    {
      nearLimit: usage.nearLimit,
      hardBlock: usage.hardBlock,
    }
  );
}

async function handleCreate(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const payload = await parseJson(request);
  const overrideRequired = await requireOverrideIfNeeded(request, env, payload);
  if (overrideRequired) {
    return overrideRequired;
  }

  const requestedBankId = typeof payload.questionBankId === 'string' ? payload.questionBankId : '';
  const resolvedBank = await getQuestionBankById(env, requestedBankId);
  trackD1Usage(ctx, env, resolvedBank.usage);
  if (!resolvedBank.bank || !resolvedBank.source) {
    return errorResponse(request, 400, 'QUESTION_BANK_NOT_FOUND', 'Could not find the selected question bank');
  }

  let attempts = 0;
  while (attempts < 12) {
    const gameId = generateNumericCode(4);
    const durable = env.GAME_DO.get(env.GAME_DO.idFromName(gameId));
    const internalRequest = new Request('https://durable.internal/api/internal/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        gameId,
        questionBankId: resolvedBank.bank.id,
        questionBankSource: resolvedBank.source,
        questionBankRevision: resolvedBank.bank.version,
        questionBankSnapshot: resolvedBank.bank,
      }),
    });
    const response = await durable.fetch(internalRequest);
    if (response.status === 409) {
      attempts += 1;
      continue;
    }
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json', ...createCorsHeaders(request) },
    });
  }

  return errorResponse(request, 503, 'CODE_UNAVAILABLE', 'Could not generate a free game code');
}

async function handlePublicCatalog(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const result = await listMergedCatalog(env);
  trackD1Usage(ctx, env, result.usage);
  return jsonResponse(request, 200, { banks: result.items });
}

async function handlePublicQuestionBank(request: Request, env: Env, ctx: ExecutionContext, bankId: string): Promise<Response> {
  const result = await getQuestionBankById(env, bankId);
  trackD1Usage(ctx, env, result.usage);
  if (!result.bank) {
    return errorResponse(request, 404, 'QUESTION_BANK_NOT_FOUND', 'Question bank not found');
  }
  return jsonResponse(request, 200, { source: result.source, bank: result.bank });
}

async function handlePublicUsageStatus(request: Request, env: Env): Promise<Response> {
  const usage = await fetchUsageStatus(env);
  return jsonResponse(request, 200, {
    nearLimit: usage.nearLimit,
    hardBlock: usage.hardBlock,
    warningMessage: usage.warningMessage,
    counters: usage.counters,
  });
}

async function handleAdminLogin(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const payload = await parseJson(request);
  if (String(payload.password ?? '') !== getAdminPassword(env)) {
    return errorResponse(request, 401, 'INVALID_PASSWORD', 'Password incorrect');
  }
  ctx.waitUntil(trackUsageEvent(env, { type: 'ADMIN_LOGIN' }).catch(() => undefined));
  const token = await createAdminToken(env);
  return jsonResponse(request, 200, { token, expiresInMs: 7 * 24 * 60 * 60 * 1000 });
}

async function handleOverrideLogin(request: Request, env: Env): Promise<Response> {
  const payload = await parseJson(request);
  if (String(payload.password ?? '') !== getAdminPassword(env)) {
    return errorResponse(request, 401, 'INVALID_PASSWORD', 'Password incorrect');
  }
  const token = await createOverrideToken(env);
  return jsonResponse(request, 200, { token, expiresInMs: 12 * 60 * 60 * 1000 });
}

async function handleAdminList(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!(await requireAdmin(request, env))) {
    return errorResponse(request, 401, 'UNAUTHORIZED', 'Admin session missing or expired');
  }
  const result = await listAdminBanks(env);
  trackD1Usage(ctx, env, result.usage);
  return jsonResponse(request, 200, { banks: result.items });
}

async function handleAdminDetail(request: Request, env: Env, ctx: ExecutionContext, bankId: string): Promise<Response> {
  if (!(await requireAdmin(request, env))) {
    return errorResponse(request, 401, 'UNAUTHORIZED', 'Admin session missing or expired');
  }
  const result = await getAdminBankDetail(env, bankId);
  trackD1Usage(ctx, env, result.usage);
  if (!result.detail) {
    return errorResponse(request, 404, 'QUESTION_BANK_NOT_FOUND', 'Question bank not found');
  }
  return jsonResponse(request, 200, { detail: result.detail });
}

async function handleAdminCreate(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!(await requireAdmin(request, env))) {
    return errorResponse(request, 401, 'UNAUTHORIZED', 'Admin session missing or expired');
  }
  const payload = await parseJson(request);
  const overrideRequired = await requireOverrideIfNeeded(request, env, payload);
  if (overrideRequired) {
    return overrideRequired;
  }
  try {
    const result = await createDbQuestionBank(env, {
      name: String(payload.name ?? ''),
      description: String(payload.description ?? ''),
      questions: normalizeQuestionsInput(payload.questions),
      changeSummary: String(payload.changeSummary ?? ''),
      importMode: 'manual',
      createdBy: 'admin',
    });
    trackD1Usage(ctx, env, result.usage);
    ctx.waitUntil(trackUsageEvent(env, { type: 'ADMIN_WRITE' }).catch(() => undefined));
    return jsonResponse(request, 200, { detail: result.detail });
  } catch (error) {
    return errorResponse(request, 400, 'BANK_SAVE_FAILED', error instanceof Error ? error.message : 'Could not save bank');
  }
}

async function handleAdminUpdate(request: Request, env: Env, ctx: ExecutionContext, bankId: string): Promise<Response> {
  if (!(await requireAdmin(request, env))) {
    return errorResponse(request, 401, 'UNAUTHORIZED', 'Admin session missing or expired');
  }
  const payload = await parseJson(request);
  const overrideRequired = await requireOverrideIfNeeded(request, env, payload);
  if (overrideRequired) {
    return overrideRequired;
  }
  try {
    const result = await updateDbQuestionBank(env, bankId, {
      name: String(payload.name ?? ''),
      description: String(payload.description ?? ''),
      questions: normalizeQuestionsInput(payload.questions),
      changeSummary: String(payload.changeSummary ?? ''),
      importMode: 'manual',
      createdBy: 'admin',
    });
    trackD1Usage(ctx, env, result.usage);
    ctx.waitUntil(trackUsageEvent(env, { type: 'ADMIN_WRITE' }).catch(() => undefined));
    return jsonResponse(request, 200, { detail: result.detail });
  } catch (error) {
    return errorResponse(request, 400, 'BANK_SAVE_FAILED', error instanceof Error ? error.message : 'Could not update bank');
  }
}

async function handleAdminImport(request: Request, env: Env, ctx: ExecutionContext, bankId: string): Promise<Response> {
  if (!(await requireAdmin(request, env))) {
    return errorResponse(request, 401, 'UNAUTHORIZED', 'Admin session missing or expired');
  }
  const payload = await parseJson(request);
  const overrideRequired = await requireOverrideIfNeeded(request, env, payload);
  if (overrideRequired) {
    return overrideRequired;
  }
  try {
    const result = await importIntoDbQuestionBank(env, bankId, {
      name: String(payload.name ?? ''),
      description: String(payload.description ?? ''),
      questions: normalizeQuestionsInput(payload.questions),
      changeSummary: String(payload.changeSummary ?? ''),
      importMode: String(payload.importMode ?? 'append_upload'),
      createdBy: 'admin',
      mode: payload.mode === 'overwrite' ? 'overwrite' : 'append',
    });
    trackD1Usage(ctx, env, result.usage);
    ctx.waitUntil(trackUsageEvent(env, { type: 'ADMIN_WRITE' }).catch(() => undefined));
    return jsonResponse(request, 200, { detail: result.detail });
  } catch (error) {
    return errorResponse(request, 400, 'BANK_IMPORT_FAILED', error instanceof Error ? error.message : 'Could not import bank');
  }
}

async function handleAdminCopy(request: Request, env: Env, ctx: ExecutionContext, bankId: string): Promise<Response> {
  if (!(await requireAdmin(request, env))) {
    return errorResponse(request, 401, 'UNAUTHORIZED', 'Admin session missing or expired');
  }
  const payload = await parseJson(request);
  const overrideRequired = await requireOverrideIfNeeded(request, env, payload);
  if (overrideRequired) {
    return overrideRequired;
  }
  try {
    const result = await copyQuestionBankToDb(env, bankId, 'admin');
    trackD1Usage(ctx, env, result.usage);
    ctx.waitUntil(trackUsageEvent(env, { type: 'ADMIN_WRITE' }).catch(() => undefined));
    return jsonResponse(request, 200, { detail: result.detail });
  } catch (error) {
    return errorResponse(request, 400, 'BANK_COPY_FAILED', error instanceof Error ? error.message : 'Could not copy bank');
  }
}

async function handleAdminRevision(request: Request, env: Env, ctx: ExecutionContext, bankId: string, revision: number): Promise<Response> {
  if (!(await requireAdmin(request, env))) {
    return errorResponse(request, 401, 'UNAUTHORIZED', 'Admin session missing or expired');
  }
  const result = await getRevisionSnapshot(env, bankId, revision);
  trackD1Usage(ctx, env, result.usage);
  if (!result.detail) {
    return errorResponse(request, 404, 'REVISION_NOT_FOUND', 'Revision not found');
  }
  return jsonResponse(request, 200, { detail: result.detail });
}

async function handleAdminRestore(request: Request, env: Env, ctx: ExecutionContext, bankId: string, revision: number): Promise<Response> {
  if (!(await requireAdmin(request, env))) {
    return errorResponse(request, 401, 'UNAUTHORIZED', 'Admin session missing or expired');
  }
  const payload = await parseJson(request);
  const overrideRequired = await requireOverrideIfNeeded(request, env, payload);
  if (overrideRequired) {
    return overrideRequired;
  }
  try {
    const result = await restoreDbQuestionBankRevision(env, bankId, revision, 'admin');
    trackD1Usage(ctx, env, result.usage);
    ctx.waitUntil(trackUsageEvent(env, { type: 'ADMIN_WRITE' }).catch(() => undefined));
    return jsonResponse(request, 200, { detail: result.detail });
  } catch (error) {
    return errorResponse(request, 400, 'BANK_RESTORE_FAILED', error instanceof Error ? error.message : 'Could not restore revision');
  }
}

async function handleAdminUsageStatus(request: Request, env: Env): Promise<Response> {
  if (!(await requireAdmin(request, env))) {
    return errorResponse(request, 401, 'UNAUTHORIZED', 'Admin session missing or expired');
  }
  return jsonResponse(request, 200, await fetchUsageStatus(env));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: createCorsHeaders(request) });
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/game/create' && request.method === 'POST') {
      return handleCreate(request, env, ctx);
    }
    if (url.pathname === '/api/question-banks/catalog' && request.method === 'GET') {
      return handlePublicCatalog(request, env, ctx);
    }
    if (url.pathname === '/api/usage-status' && request.method === 'GET') {
      return handlePublicUsageStatus(request, env);
    }
    const publicBankMatch = url.pathname.match(/^\/api\/question-banks\/([^/]+)$/);
    if (publicBankMatch && request.method === 'GET') {
      return handlePublicQuestionBank(request, env, ctx, decodeURIComponent(publicBankMatch[1]));
    }
    if (url.pathname === '/api/admin/login' && request.method === 'POST') {
      return handleAdminLogin(request, env, ctx);
    }
    if (url.pathname === '/api/admin/reauthorize' && request.method === 'POST') {
      return handleOverrideLogin(request, env);
    }
    if (url.pathname === '/api/admin/usage-status' && request.method === 'GET') {
      return handleAdminUsageStatus(request, env);
    }
    if (url.pathname === '/api/admin/question-banks' && request.method === 'GET') {
      return handleAdminList(request, env, ctx);
    }
    if (url.pathname === '/api/admin/question-banks' && request.method === 'POST') {
      return handleAdminCreate(request, env, ctx);
    }

    const restoreMatch = url.pathname.match(/^\/api\/admin\/question-banks\/([^/]+)\/revisions\/([^/]+)\/restore$/);
    if (restoreMatch && request.method === 'POST') {
      const revision = normalizeRevisionParam(restoreMatch[2]);
      if (!revision) {
        return errorResponse(request, 400, 'INVALID_REVISION', 'Revision must be a positive integer');
      }
      return handleAdminRestore(request, env, ctx, decodeURIComponent(restoreMatch[1]), revision);
    }

    const revisionMatch = url.pathname.match(/^\/api\/admin\/question-banks\/([^/]+)\/revisions\/([^/]+)$/);
    if (revisionMatch && request.method === 'GET') {
      const revision = normalizeRevisionParam(revisionMatch[2]);
      if (!revision) {
        return errorResponse(request, 400, 'INVALID_REVISION', 'Revision must be a positive integer');
      }
      return handleAdminRevision(request, env, ctx, decodeURIComponent(revisionMatch[1]), revision);
    }

    const importMatch = url.pathname.match(/^\/api\/admin\/question-banks\/([^/]+)\/import$/);
    if (importMatch && request.method === 'POST') {
      return handleAdminImport(request, env, ctx, decodeURIComponent(importMatch[1]));
    }

    const copyMatch = url.pathname.match(/^\/api\/admin\/question-banks\/([^/]+)\/copy$/);
    if (copyMatch && request.method === 'POST') {
      return handleAdminCopy(request, env, ctx, decodeURIComponent(copyMatch[1]));
    }

    const detailMatch = url.pathname.match(/^\/api\/admin\/question-banks\/([^/]+)$/);
    if (detailMatch && request.method === 'GET') {
      return handleAdminDetail(request, env, ctx, decodeURIComponent(detailMatch[1]));
    }
    if (detailMatch && request.method === 'PUT') {
      return handleAdminUpdate(request, env, ctx, decodeURIComponent(detailMatch[1]));
    }

    const gameMatch = url.pathname.match(/^\/api\/game\/([^/]+)(\/.*)?$/);
    if (gameMatch) {
      const durable = env.GAME_DO.get(env.GAME_DO.idFromName(gameMatch[1]));
      return durable.fetch(request);
    }

    return new Response('Not found', { status: 404, headers: createCorsHeaders(request) });
  },
};

export { GameDurableObject, UsageMonitorDurableObject };
