type JsonPayload = Record<string, unknown>;

export class ApiError extends Error {
  code: string;
  payload: JsonPayload;
  status: number;
  constructor(message: string, code = 'REQUEST_FAILED', payload: JsonPayload = {}, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.payload = payload;
    this.status = status;
  }
  get retryable() { return this.payload.retryable === true || this.status >= 500; }
}

export async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    if (response.ok) return {} as T;
    throw new ApiError('Empty response', 'REQUEST_FAILED', {}, response.status);
  }
  const payload = JSON.parse(text) as JsonPayload;
  if (!response.ok) throw new ApiError(String(payload.message ?? payload.error ?? 'Request failed'), String(payload.error ?? 'REQUEST_FAILED'), payload, response.status);
  return payload as T;
}

export async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  return parseJson<T>(await fetch(input, init));
}

/** Keep the original ID and replay metadata: an unconfirmed request may have committed. */
export const isUncertainFailure = (error: unknown): boolean => !(error instanceof ApiError) || error.retryable;
