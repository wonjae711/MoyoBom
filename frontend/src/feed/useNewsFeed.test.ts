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
  const fn = vi.fn(async () => responses.shift()!())
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
