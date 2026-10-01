import type { ProviderName } from './types.js';

/** 일일 호출 한도 초과. 해당 API는 그날 남은 시간 동안 호출을 멈춘다. */
export class QuotaExceededError extends Error {
  constructor(readonly provider: ProviderName) {
    super(`${provider} API 일일 호출 한도 초과`);
    this.name = 'QuotaExceededError';
  }
}

/**
 * 요청 실패(타임아웃, 5xx, 응답 형식 오류 등). 다음 주기에 다시 시도한다.
 * 메시지는 직접 만든 문자열만 쓴다 — 요청 URL에 API 키가 들어갈 수 있어 원본 에러를 그대로 노출하지 않는다.
 */
export class ProviderRequestError extends Error {
  constructor(
    readonly provider: ProviderName,
    detail: string,
  ) {
    super(`${provider} API 요청 실패: ${detail}`);
    this.name = 'ProviderRequestError';
  }
}

/** 인증 실패(401/403). 같은 키를 쓰는 나머지 요청도 실패하므로 이번 주기는 바로 멈춘다. */
export class ProviderAuthError extends ProviderRequestError {
  constructor(provider: ProviderName, status: number) {
    super(provider, `인증 실패(HTTP ${status}) — .env의 API 키를 확인하세요`);
    this.name = 'ProviderAuthError';
  }
}
