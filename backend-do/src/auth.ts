import { generateShortId } from './utils.js';

interface SignedTokenPayload {
  type: 'admin' | 'override';
  exp: number;
  nonce: string;
}

export interface AdminSessionPayload extends SignedTokenPayload {
  type: 'admin';
}

export interface OverrideSessionPayload extends SignedTokenPayload {
  type: 'override';
}

function toBase64Url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signPayload(payload: SignedTokenPayload, secret: string): Promise<string> {
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload));
  return `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`;
}

async function verifySignedPayload<T extends SignedTokenPayload>(token: string, secret: string): Promise<T | null> {
  const [encodedPayload, encodedSignature] = token.split('.');
  if (!encodedPayload || !encodedSignature) {
    return null;
  }
  const key = await importKey(secret);
  const signature = fromBase64Url(encodedSignature);
  const signatureBuffer = signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength) as ArrayBuffer;
  const valid = await crypto.subtle.verify('HMAC', key, signatureBuffer, new TextEncoder().encode(encodedPayload));
  if (!valid) {
    return null;
  }
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as T;
    if (!payload?.type || typeof payload.exp !== 'number' || typeof payload.nonce !== 'string') {
      return null;
    }
    if (Date.now() >= payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function getAdminPassword(env: { ADMIN_PASSWORD?: string }): string {
  return env.ADMIN_PASSWORD?.trim() || 'MAX';
}

export function getAdminSessionSecret(env: { ADMIN_SESSION_SECRET?: string }): string {
  return env.ADMIN_SESSION_SECRET?.trim() || 'top10-dev-admin-secret';
}

export async function createAdminToken(env: { ADMIN_SESSION_SECRET?: string }): Promise<string> {
  return signPayload(
    {
      type: 'admin',
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
      nonce: generateShortId(12),
    },
    getAdminSessionSecret(env)
  );
}

export async function createOverrideToken(env: { ADMIN_SESSION_SECRET?: string }): Promise<string> {
  return signPayload(
    {
      type: 'override',
      exp: Date.now() + 12 * 60 * 60 * 1000,
      nonce: generateShortId(12),
    },
    getAdminSessionSecret(env)
  );
}

export async function verifyAdminToken(token: string | null, env: { ADMIN_SESSION_SECRET?: string }): Promise<AdminSessionPayload | null> {
  if (!token) {
    return null;
  }
  const payload = await verifySignedPayload<AdminSessionPayload>(token, getAdminSessionSecret(env));
  return payload?.type === 'admin' ? payload : null;
}

export async function verifyOverrideToken(token: string | null, env: { ADMIN_SESSION_SECRET?: string }): Promise<OverrideSessionPayload | null> {
  if (!token) {
    return null;
  }
  const payload = await verifySignedPayload<OverrideSessionPayload>(token, getAdminSessionSecret(env));
  return payload?.type === 'override' ? payload : null;
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? request.headers.get('authorization');
  if (!header) {
    return null;
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}
