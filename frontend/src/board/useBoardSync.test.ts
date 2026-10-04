// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardItem, BoardSnapshot } from './types'

/**
 * socket.io-client 흉내. emitWithAck는 테스트가 응답을 정할 때까지 기다리게 해서
 * "ack 전에 이벤트가 먼저 도착" 같은 순서를 재현한다.
 */
const fake = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void
  const handlers = new Map<string, Handler[]>()
  const pending: { event: string; payload: Record<string, unknown>; resolve: (v: unknown) => void }[] = []
  const socket = {
    connected: true,
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    },
    fire(event: string, ...args: unknown[]) {
      handlers.get(event)?.forEach((h) => h(...args))
    },
    timeout: () => ({
      emitWithAck: (event: string, payload: Record<string, unknown>) =>
        new Promise((resolve) => pending.push({ event, payload, resolve })),
    }),
    volatile: { emit: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
  return {
    socket,
    pending,
    /** 가장 먼저 보낸 해당 이벤트에 응답 */
    reply(event: string, response: unknown) {
      const i = pending.findIndex((p) => p.event === event)
      const [call] = pending.splice(i, 1)
      call!.resolve(response)
      return call!.payload
    },
    reset() {
      handlers.clear()
      pending.length = 0
    },
  }
})
vi.mock('socket.io-client', () => ({ io: () => fake.socket }))

const { useBoardSync } = await import('./useBoardSync')

function item(id: string, version: number, x = 0): BoardItem {
  return {
    id,
    type: 'memo',
    articleId: null,
    article: null,
    content: `메모 ${id}`,
    imageKey: null,
    x,
    y: 0,
    rotation: 0,
    zIndex: version,
    createdBy: '1',
    updatedAt: '2026-10-04T00:00:00.000Z',
    version,
  }
}

function snapshot(seq: number, items: BoardItem[]): BoardSnapshot {
  return {
    board: { id: '7', title: '반도체 이슈', ownerId: '1', updatedAt: '', seq },
    role: 'owner',
    members: [{ userId: '1', nickname: '주인', role: 'owner' }],
    items,
  }
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

async function joined(items: BoardItem[] = [], seq = 10) {
  const onError = vi.fn()
  const hook = renderHook(() => useBoardSync('7', { onError }))
  act(() => fake.socket.fire('connect'))
  await act(async () => {
    fake.reply('board:join', { ok: true, snapshot: snapshot(seq, items) })
  })
  await flush()
  return { ...hook, onError }
}

beforeEach(() => {
  fake.reset()
  fake.socket.connected = true
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('[F-05] 보드 실시간 동기화 훅', () => {
  it('[C-11] join 응답 전에 온 이벤트는 모았다가 스냅샷 위에 적용한다 (스냅샷에 이미 든 것은 버림)', async () => {
    const { result } = renderHook(() => useBoardSync('7'))
    act(() => fake.socket.fire('connect'))
    act(() => {
      fake.socket.fire('card:added', { boardId: '7', item: item('2', 12) }) // 스냅샷 이후 변경
      fake.socket.fire('card:moved', { boardId: '7', item: item('1', 9, 999) }) // 스냅샷에 이미 반영된 변경
    })
    expect(result.current.status).toBe('connecting')

    await act(async () => {
      fake.reply('board:join', { ok: true, snapshot: snapshot(10, [item('1', 8, 80)]) })
    })
    await flush()
    expect(result.current.status).toBe('ready')
    expect(result.current.title).toBe('반도체 이슈')
    expect(result.current.items.map((i) => [i.id, i.x])).toEqual([
      ['1', 80],
      ['2', 0],
    ])
  })

  it('다른 보드의 이벤트는 무시하고, 늦게 온 오래된 이동은 반영하지 않는다 (L-02)', async () => {
    const { result } = await joined([item('1', 8, 80)])
    act(() => {
      fake.socket.fire('card:moved', { boardId: '7', item: item('1', 15, 150) })
      fake.socket.fire('card:moved', { boardId: '7', item: item('1', 14, 140) })
      fake.socket.fire('card:added', { boardId: '99', item: item('5', 20) })
    })
    expect(result.current.items.map((i) => [i.id, i.x])).toEqual([['1', 150]])
  })

  it('카드 추가는 바로 화면에 보이고(저장 대기 표시), ack가 오면 서버 카드로 바뀐다', async () => {
    const { result } = await joined()
    let added: Promise<BoardItem | null> = Promise.resolve(null)
    act(() => {
      added = result.current.addCard({ type: 'memo', content: '초안' }, 10, 20)
    })
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0]).toMatchObject({ content: '초안', pending: true })
    expect(result.current.saving).toBe(true)

    const payload = fake.reply('card:add', { ok: true, item: { ...item('31', 11), content: '초안', x: 10, y: 20 } })
    expect(payload).toMatchObject({ boardId: '7', type: 'memo', content: '초안', x: 10, y: 20 })
    await act(async () => {
      await added
    })
    expect(result.current.items.map((i) => [i.id, i.pending])).toEqual([['31', false]])
    expect(result.current.saving).toBe(false)
  })

  it('카드 이동이 실패하면 원래 위치로 되돌리고 알린다', async () => {
    const { result, onError } = await joined([item('1', 8, 80)])
    let moved: Promise<void> = Promise.resolve()
    act(() => {
      moved = result.current.moveCard('1', 300, 300)
    })
    expect(result.current.items[0]).toMatchObject({ x: 300, pending: true })

    await act(async () => {
      fake.reply('card:move', { ok: false, error: 'server_error', message: '서버 오류' })
      await moved
    })
    expect(result.current.items[0]).toMatchObject({ x: 80, pending: false })
    expect(onError).toHaveBeenCalledWith('서버 오류')
  })

  it('다른 사람이 이미 지운 카드를 옮기면(not_found) 화면에서도 지운다', async () => {
    const { result, onError } = await joined([item('1', 8, 80)])
    let moved: Promise<void> = Promise.resolve()
    act(() => {
      moved = result.current.moveCard('1', 5, 5)
    })
    await act(async () => {
      fake.reply('card:move', { ok: false, error: 'not_found', message: '이미 삭제된 카드입니다' })
      await moved
    })
    expect(result.current.items).toEqual([])
    expect(onError).toHaveBeenCalled()
  })

  it('삭제 이벤트 뒤에 늦게 온 이동으로 카드가 되살아나지 않는다', async () => {
    const { result } = await joined([item('1', 8, 80)])
    act(() => {
      fake.socket.fire('card:deleted', { boardId: '7', itemId: '1', version: 12 })
      fake.socket.fire('card:moved', { boardId: '7', item: item('1', 11, 110) })
    })
    expect(result.current.items).toEqual([])
  })

  it('다른 사람이 드래그 중인 위치를 보여 주고, 드래그가 끝나면(저장 이벤트) 서버 위치로 바꾼다', async () => {
    const { result } = await joined([item('1', 8, 80)])
    act(() => fake.socket.fire('card:moving', { boardId: '7', itemId: '1', x: 200, y: 50 }))
    expect(result.current.items[0]).toMatchObject({ x: 200, y: 50 })
    act(() => fake.socket.fire('card:moved', { boardId: '7', item: item('1', 11, 210) }))
    expect(result.current.items[0]).toMatchObject({ x: 210, y: 0 })
  })

  it('내보내지거나 보드가 삭제되면 더 이상 보드를 쓸 수 없다고 알린다', async () => {
    const { result } = await joined()
    act(() => fake.socket.fire('board:removed', { boardId: '7' }))
    expect(result.current.status).toBe('gone')
    expect(result.current.goneReason).toBe('보드에서 내보내졌습니다')
  })

  it('연결이 끊겼다 다시 이어지면 다시 join해서 스냅샷으로 맞춘다', async () => {
    const { result } = await joined([item('1', 8, 80)])
    act(() => fake.socket.fire('disconnect'))
    expect(result.current.status).toBe('reconnecting')

    act(() => fake.socket.fire('connect'))
    await act(async () => {
      fake.reply('board:join', { ok: true, snapshot: snapshot(20, [item('1', 18, 180), item('3', 19)]) })
    })
    await flush()
    expect(result.current.status).toBe('ready')
    expect(result.current.items.map((i) => [i.id, i.x])).toEqual([
      ['1', 180],
      ['3', 0],
    ])
  })

  it('연결이 끊긴 상태에서의 변경은 저장하지 못했다고 바로 알린다', async () => {
    const { result, onError } = await joined([item('1', 8, 80)])
    fake.socket.connected = false
    await act(async () => {
      await result.current.deleteCard('1')
    })
    expect(result.current.items).toHaveLength(1)
    expect(onError).toHaveBeenCalledWith('연결이 끊겨 저장하지 못했습니다')
  })
})
