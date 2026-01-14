import { GameDurableObject, Env } from './game.js';
import { generateShortId } from './utils.js';

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
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Player-Token,X-Host-Token',
  };
}

async function handleCreate(request: Request, env: Env): Promise<Response> {
  const corsHeaders = createCorsHeaders(request);
  const payload = await parseJson(request);
  const gameId = generateShortId(6);
  const durable = env.GAME_DO.get(env.GAME_DO.idFromName(gameId));
  const internalRequest = new Request('https://durable.internal/api/internal/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, gameId }),
  });
  const response = await durable.fetch(internalRequest);
  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: createCorsHeaders(request) });
    }
    const url = new URL(request.url);
    if (url.pathname === '/api/game/create' && request.method === 'POST') {
      return handleCreate(request, env);
    }
    const match = url.pathname.match(/^\/api\/game\/([^\/]+)(\/.*)?$/);
    if (match) {
      const gameId = match[1];
      const durable = env.GAME_DO.get(env.GAME_DO.idFromName(gameId));
      return durable.fetch(request);
    }
    return new Response('Not found', { status: 404, headers: createCorsHeaders(request) });
  },
};

export { GameDurableObject };
