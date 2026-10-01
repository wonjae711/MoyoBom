import { ProviderAuthError, ProviderRequestError, QuotaExceededError } from '../errors.js';
import type { ProviderName } from '../types.js';

export type FetchFn = typeof fetch;

export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * 외부 뉴스 API를 호출해 JSON을 돌려준다.
 * 429 → QuotaExceededError, 401·403 → ProviderAuthError, 그 밖의 실패(타임아웃·네트워크·5xx·JSON 아님) → ProviderRequestError.
 * 즉시 재시도는 하지 않는다 — 다음 수집 주기가 재시도 역할을 한다 (연쇄 실패 방지).
 */
export async function requestJson(
  provider: ProviderName,
  url: URL,
  init: RequestInit,
  fetchFn: FetchFn,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new ProviderRequestError(provider, timedOut ? '타임아웃' : '네트워크 오류');
  }

  if (res.status === 429) throw new QuotaExceededError(provider);
  if (res.status === 401 || res.status === 403) throw new ProviderAuthError(provider, res.status);
  if (!res.ok) throw new ProviderRequestError(provider, `HTTP ${res.status}`);

  try {
    return await res.json();
  } catch {
    throw new ProviderRequestError(provider, 'JSON이 아닌 응답');
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
