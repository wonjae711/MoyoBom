import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * L-01: 같은 브라우저의 두 탭이 동시에 토큰을 갱신하는 상황.
 * 쿠키 저장소는 탭끼리 공유하고, 서버는 refresh token을 1회용으로 회전하며 실패 응답은 쿠키를 지운다(실제 서버와 같음).
 * 각 탭은 client 모듈을 따로 불러와(모듈 변수 refreshing이 탭마다 따로) 실제 탭처럼 만든다.
 */
function fakeBrowser({ withLocks }: { withLocks: boolean }) {
  const jar = { refresh: 'r1' as string | null }
  let issued = 1
  const valid = new Set(['r1'])

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/auth/logout') {
      // 로그아웃: 요청에 실린 refresh token을 지우고 쿠키를 비운다
      if (jar.refresh) valid.delete(jar.refresh)
      jar.refresh = null
      return new Response(null, { status: 204 })
    }
    if (String(input) !== '/api/auth/refresh') return new Response('{}', { status: 200 })
    const sent = jar.refresh // 요청을 보내는 순간의 쿠키
    if (sent && valid.delete(sent)) {
      const next = `r${++issued}`
      valid.add(next)
      await new Promise((r) => setTimeout(r, 20))
      jar.refresh = next // 성공 응답이 새 쿠키를 심음
      return new Response('{}', { status: 200 })
    }
    await new Promise((r) => setTimeout(r, 40)) // 실패 응답이 성공보다 늦게 도착
    jar.refresh = null // 실패 응답은 쿠키를 지움
    return new Response('{}', { status: 401 })
  })

  // Web Locks 흉내: 같은 이름의 작업을 순서대로 실행
  const queues = new Map<string, Promise<unknown>>()
  const locks = {
    request: <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      const run = (queues.get(name) ?? Promise.resolve()).then(fn)
      queues.set(name, run.catch(() => {}))
      return run
    },
  }

  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('navigator', withLocks ? { locks } : {})
  return { jar, valid, fetchMock }
}

async function openTab() {
  vi.resetModules()
  return import('./client')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('[L-01] 여러 탭의 동시 토큰 갱신', () => {
  it('(문제 재현) 탭 사이 조정이 없으면 늦게 온 실패 응답이 새 쿠키를 지운다', async () => {
    const { jar } = fakeBrowser({ withLocks: false })
    const [tabA, tabB] = [await openTab(), await openTab()]
    const results = await Promise.all([tabA.refreshSession(), tabB.refreshSession()])
    expect(results).toEqual([true, false])
    expect(jar.refresh).toBeNull()
  })

  it('탭 사이에서 줄을 세우면 두 탭 모두 성공하고 로그인 쿠키가 남는다', async () => {
    const { jar, fetchMock } = fakeBrowser({ withLocks: true })
    const [tabA, tabB] = [await openTab(), await openTab()]
    const results = await Promise.all([tabA.refreshSession(), tabB.refreshSession()])
    expect(results).toEqual([true, true])
    expect(jar.refresh).toBe('r3')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('[L-04] 다른 탭이 갱신 중일 때 누른 로그아웃은 갱신이 끝난 뒤 보내져, 새로 받은 토큰까지 지운다', async () => {
    const { jar, valid, fetchMock } = fakeBrowser({ withLocks: true })
    const [tabA, tabB] = [await openTab(), await openTab()]
    const refreshing = tabA.refreshSession()
    await tabB.logoutSession()
    await refreshing
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toEqual(['/api/auth/refresh', '/api/auth/logout'])
    // 로그아웃 요청에는 갱신으로 바뀐 새 토큰이 실려 서버에서 지워지고, 쿠키도 비워진다
    expect(valid.size).toBe(0)
    expect(jar.refresh).toBeNull()
  })

  it('한 탭 안의 동시 갱신은 여전히 한 번만 보낸다', async () => {
    const { fetchMock } = fakeBrowser({ withLocks: true })
    const tab = await openTab()
    await Promise.all([tab.refreshSession(), tab.refreshSession(), tab.refreshSession()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
