import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, UnauthorizedError, apiFetch, onUnauthorized } from './client'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function mockFetch(responder: (url: string) => Response) {
  const fn = vi.fn(async (input: RequestInfo | URL) => responder(String(input)))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiFetch', () => {
  it('성공 응답의 JSON을 돌려준다', async () => {
    mockFetch(() => json({ ok: true }))
    expect(await apiFetch('/api/articles')).toEqual({ ok: true })
  })

  it('access token이 만료(401)되면 한 번 갱신하고 다시 요청한다', async () => {
    let articlesCalls = 0
    const fn = mockFetch((url) => {
      if (url === '/api/auth/refresh') return json({ user: {} })
      articlesCalls++
      return articlesCalls === 1 ? json({ error: '로그인이 필요합니다' }, 401) : json({ articles: [] })
    })

    expect(await apiFetch('/api/articles')).toEqual({ articles: [] })
    expect(fn.mock.calls.map(([u]) => String(u))).toEqual(['/api/articles', '/api/auth/refresh', '/api/articles'])
  })

  it('동시에 여러 요청이 401을 받아도 갱신 요청은 한 번만 보낸다', async () => {
    let refreshed = false
    const fn = mockFetch((url) => {
      if (url === '/api/auth/refresh') {
        refreshed = true
        return json({})
      }
      return refreshed ? json({}) : json({}, 401)
    })

    await Promise.all([apiFetch('/api/a'), apiFetch('/api/b'), apiFetch('/api/c')])
    expect(fn.mock.calls.filter(([u]) => String(u) === '/api/auth/refresh')).toHaveLength(1)
  })

  it('갱신도 실패하면 로그아웃 상태를 알리고 UnauthorizedError를 던진다', async () => {
    mockFetch(() => json({}, 401))
    const listener = vi.fn()
    const off = onUnauthorized(listener)

    await expect(apiFetch('/api/articles')).rejects.toBeInstanceOf(UnauthorizedError)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
  })

  it('로그인 실패(401)는 갱신을 시도하지 않고 서버 메시지를 그대로 전달한다', async () => {
    const fn = mockFetch(() => json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' }, 401))
    const error = await apiFetch('/api/auth/login', { method: 'POST', body: '{}' }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toBe('이메일 또는 비밀번호가 올바르지 않습니다')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('[C-09] access가 만료된 채 페이지를 다시 열어도 /api/auth/me는 갱신 후 다시 요청해 로그인을 유지한다', async () => {
    let meCalls = 0
    const fn = mockFetch((url) => {
      if (url === '/api/auth/refresh') return json({ user: {} })
      meCalls++
      return meCalls === 1 ? json({ error: '로그인이 필요합니다' }, 401) : json({ user: { nickname: '주인' } })
    })
    const listener = vi.fn()
    const off = onUnauthorized(listener)

    expect(await apiFetch('/api/auth/me')).toEqual({ user: { nickname: '주인' } })
    expect(fn.mock.calls.map(([u]) => String(u))).toEqual(['/api/auth/me', '/api/auth/refresh', '/api/auth/me'])
    expect(listener).not.toHaveBeenCalled()
    off()
  })

  it('[C-09] /api/auth/me와 다른 요청이 동시에 401을 받아도 갱신은 한 번만 보낸다', async () => {
    let refreshed = false
    const fn = mockFetch((url) => {
      if (url === '/api/auth/refresh') {
        refreshed = true
        return json({})
      }
      return refreshed ? json({}) : json({}, 401)
    })

    await Promise.all([apiFetch('/api/auth/me'), apiFetch('/api/articles'), apiFetch('/api/boards')])
    expect(fn.mock.calls.filter(([u]) => String(u) === '/api/auth/refresh')).toHaveLength(1)
  })

  it('refresh·logout 요청 자신은 401이어도 다시 갱신을 시도하지 않는다', async () => {
    const fn = mockFetch(() => json({}, 401))
    await expect(apiFetch('/api/auth/logout', { method: 'POST' })).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(apiFetch('/api/auth/refresh', { method: 'POST' })).rejects.toBeInstanceOf(UnauthorizedError)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('400 응답의 잘못된 필드 목록을 전달한다', async () => {
    mockFetch(() => json({ error: '입력값을 확인해 주세요', fields: ['email'] }, 400))
    const error = (await apiFetch('/api/auth/signup', { method: 'POST', body: '{}' }).catch((e: unknown) => e)) as ApiError
    expect(error.status).toBe(400)
    expect(error.fields).toEqual(['email'])
  })
})
