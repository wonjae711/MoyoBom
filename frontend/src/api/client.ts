/** 로그인이 풀려 다시 로그인해야 하는 상태 */
export class UnauthorizedError extends Error {
  constructor() {
    super('로그인이 필요합니다')
    this.name = 'UnauthorizedError'
  }
}

/** 서버가 보낸 에러 메시지를 담은 실패 응답 */
export class ApiError extends Error {
  readonly status: number
  readonly fields: string[]

  constructor(status: number, message: string, fields: string[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fields = fields
  }
}

type Listener = () => void
const unauthorizedListeners = new Set<Listener>()

/** 토큰 갱신까지 실패해 로그아웃 상태가 되면 호출된다 (AuthProvider가 구독) */
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener)
  return () => unauthorizedListeners.delete(listener)
}

let refreshing: Promise<boolean> | null = null

/**
 * refresh token 쿠키로 새 access token을 받는다.
 * 여러 요청이 동시에 401을 받아도 갱신 요청은 한 번만 보낸다 (refresh token은 한 번 쓰면 바뀌기 때문).
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: string[] }
  return new ApiError(res.status, body.error ?? `요청 실패 (HTTP ${res.status})`, body.fields)
}

/** 401이어도 토큰 갱신을 시도하지 않는 경로 (갱신 자체·로그인 시도·로그아웃 — 재귀 갱신 방지) */
const NO_REFRESH_PATHS = ['/api/auth/refresh', '/api/auth/login', '/api/auth/signup', '/api/auth/logout']
/** 401이 "로그인 정보가 틀림"을 뜻하는 경로 — 로그아웃 상태로 알리지 않고 서버 메시지를 그대로 전달 */
const CREDENTIAL_PATHS = ['/api/auth/login', '/api/auth/signup']

const matches = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(`${p}?`))

/**
 * 백엔드 API 호출. 토큰은 httpOnly 쿠키라 브라우저가 알아서 보낸다.
 * access token이 만료돼 401이 오면 한 번 갱신하고 다시 시도하며, 그래도 안 되면 로그아웃 상태로 알린다.
 * `/api/auth/me`도 갱신 대상이다 — access가 만료된 채 페이지를 다시 열어도 refresh가 유효하면 로그인이 유지된다.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const request = () =>
    fetch(path, {
      ...init,
      headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
    })

  let res = await request()
  if (res.status === 401 && !matches(path, NO_REFRESH_PATHS)) {
    if (await refreshSession()) res = await request()
  }
  if (res.status === 401 && !matches(path, CREDENTIAL_PATHS)) {
    unauthorizedListeners.forEach((listener) => listener())
    throw new UnauthorizedError()
  }
  if (!res.ok) throw await toApiError(res)
  return (res.status === 204 ? undefined : await res.json()) as T
}
