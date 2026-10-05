// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedArticle, FeedPage } from './types'

/** socket.io-client 흉내: 테스트가 connect·disconnect·이벤트를 직접 일으킨다 */
const fakeSocket = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void
  const handlers = new Map<string, Handler[]>()
  return {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    },
    fire(event: string, ...args: unknown[]) {
      handlers.get(event)?.forEach((h) => h(...args))
    },
    reset() {
      handlers.clear()
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
    io: { on: vi.fn() },
  }
})
vi.mock('socket.io-client', () => ({ io: () => fakeSocket }))

const { useNewsFeed, AUTO_RETRY_DELAYS_MS } = await import('./useNewsFeed')

function article(id: string): FeedArticle {
  return {
    id,
    title: `기사 ${id}`,
    description: '',
    source: 's',
    category: 'economy',
    originalLink: `https://e.com/${id}`,
    publishedAt: `2026-10-04T0${id}:00:00.000Z`,
    collectedAt: `2026-10-04T0${id}:00:00.000Z`,
  }
}

const page = (articles: FeedArticle[], collectedCursor = '100_1'): FeedPage => ({ articles, nextCursor: null, collectedCursor })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

/** 응답을 차례로 꺼내 주는 fetch */
function serve(...responses: (() => Response)[]) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    void input
    return responses.shift()!()
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  fakeSocket.reset()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('[F-04] 검색·필터', () => {
  it('모든 조회에 같은 조건을 붙이고, 실시간 기사도 조건에 맞는 것만 보여 준다', async () => {
    const fetchMock = serve(() => json(page([article('1')])))
    const { result } = renderHook(() => useNewsFeed({ q: '반도체', category: 'economy' }))
    act(() => fakeSocket.fire('connect'))
    await flush()
    const url = String(fetchMock.mock.calls[0]![0])
    expect(url).toContain('q=%EB%B0%98%EB%8F%84%EC%B2%B4')
    expect(url).toContain('category=economy')

    act(() =>
      fakeSocket.fire('feed:new-articles', {
        truncated: false,
        total: 2,
        articles: [
          { ...article('8'), title: '반도체 수출 호조' },
          { ...article('7'), title: '프로야구 순위' },
        ],
      }),
    )
    expect(result.current.articles.map((a) => a.id)).toEqual(['8', '1'])
  })
})

describe('[L-07] 이전 기사 더 보기 실패에서 회복', () => {
  it('더 보기가 실패하면 그 오류만 따로 보이고, 다시 시도하면 같은 페이지를 실제로 다시 받는다', async () => {
    const first: FeedPage = { articles: [article('9')], nextCursor: 'cursor-9', collectedCursor: '100_9' }
    const older: FeedPage = { articles: [article('5')], nextCursor: null, collectedCursor: null }
    const fetchMock = serve(
      () => json(first),
      () => json({ error: '서버 오류' }, 500),
      () => json(older),
    )
    const { result } = renderHook(() => useNewsFeed())
    act(() => fakeSocket.fire('connect'))
    await flush()

    await act(async () => {
      await result.current.loadMore()
    })
    expect(result.current.moreError).toBe('서버 오류')
    expect(result.current.error).toBeNull() // 피드 전체 오류와는 따로
    expect(result.current.hasMore).toBe(true)

    await act(async () => {
      await result.current.loadMore()
    })
    const calls = fetchMock.mock.calls.map(([u]) => String(u))
    expect(calls[1]).toContain('before=cursor-9')
    expect(calls[2]).toContain('before=cursor-9') // 실패한 바로 그 페이지를 다시 요청
    expect(result.current.moreError).toBeNull()
    expect(result.current.articles.map((a) => a.id)).toEqual(['9', '5'])
    expect(result.current.hasMore).toBe(false)
  })
})

describe('[L-03] 피드 조회 실패에서 회복', () => {
  it('처음 조회가 실패해도 연결이 유지된 채 자동으로 다시 받아 오류가 사라진다', async () => {
    const fetchMock = serve(
      () => json({ error: '서버 오류' }, 500),
      () => json(page([article('1'), article('2')])),
    )
    const { result } = renderHook(() => useNewsFeed())
    act(() => fakeSocket.fire('connect'))
    await flush()
    expect(result.current.error).toBe('서버 오류')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RETRY_DELAYS_MS[0]!)
    })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.error).toBeNull()
    expect(result.current.articles.map((a) => a.id)).toEqual(['2', '1'])
  })

  it('자동 재시도를 다 써도 "다시 시도"로 회복한다', async () => {
    const fail = () => json({ error: '서버 오류' }, 500)
    serve(fail, fail, fail, fail, () => json(page([article('1')])))
    const { result } = renderHook(() => useNewsFeed())
    act(() => fakeSocket.fire('connect'))
    await flush()
    for (const delay of AUTO_RETRY_DELAYS_MS) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay)
      })
      await flush()
    }
    expect(result.current.error).toBe('서버 오류')

    await act(async () => {
      await result.current.retry()
    })
    expect(result.current.error).toBeNull()
    expect(result.current.articles).toHaveLength(1)
  })

  it('재연결 후 누락분 보완이 실패해도, 다시 끊기지 않고 자동 재시도로 놓친 기사를 받는다', async () => {
    serve(
      () => json(page([article('1')], '100_1')),
      () => json({ error: '서버 오류' }, 500),
      () => json(page([article('3')], '300_3')),
    )
    const { result } = renderHook(() => useNewsFeed())
    act(() => fakeSocket.fire('connect'))
    await flush()
    act(() => fakeSocket.fire('disconnect'))
    act(() => fakeSocket.fire('connect'))
    await flush()
    expect(result.current.error).toBe('서버 오류')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RETRY_DELAYS_MS[0]!)
    })
    await flush()
    expect(result.current.error).toBeNull()
    expect(result.current.articles.map((a) => a.id)).toEqual(['3', '1'])
  })
})
