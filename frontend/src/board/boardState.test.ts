import { describe, expect, it } from 'vitest'
import { applyEvent, emptyBoardState, fromSnapshot, stackedItems, type BoardEvent } from './boardState'
import type { BoardItem, BoardSnapshot } from './types'

function item(id: string, version: number, x = 0, zIndex = version): BoardItem {
  return {
    id,
    type: 'memo',
    articleId: null,
    article: null,
    content: id,
    imageKey: null,
    x,
    y: 0,
    rotation: 0,
    zIndex,
    createdBy: '1',
    updatedAt: '2026-10-04T00:00:00.000Z',
    version,
  }
}

function snapshot(seq: number, items: BoardItem[]): BoardSnapshot {
  return { board: { id: '1', title: 'b', ownerId: '1', updatedAt: '', seq }, role: 'owner', members: [], items }
}

const upsert = (i: BoardItem): BoardEvent => ({ kind: 'upsert', item: i })
const remove = (itemId: string, version: number): BoardEvent => ({ kind: 'delete', itemId, version })

describe('[L-02] 보드 상태 — 변경 순번으로 맞추기', () => {
  it('순서가 바뀌어 도착해도 순번이 큰 변경이 남는다', () => {
    let state = applyEvent(emptyBoardState(), upsert(item('1', 7, 700)))
    state = applyEvent(state, upsert(item('1', 6, 600)))
    expect(state.items.get('1')?.x).toBe(700)
  })

  it('삭제 뒤에 늦게 도착한 이동·추가로 카드가 되살아나지 않는다', () => {
    let state = applyEvent(emptyBoardState(), upsert(item('1', 3)))
    state = applyEvent(state, remove('1', 5))
    state = applyEvent(state, upsert(item('1', 4, 99)))
    expect(state.items.has('1')).toBe(false)
  })

  it('삭제가 이동보다 먼저 도착해도(이동 순번이 더 작음) 삭제가 유지된다', () => {
    let state = applyEvent(emptyBoardState(), remove('1', 5))
    state = applyEvent(state, upsert(item('1', 2)))
    expect(state.items.size).toBe(0)
  })

  it('같은 순번이 다시 와도(내 ack와 브로드캐스트 중복 등) 한 번만 반영된다', () => {
    const once = applyEvent(emptyBoardState(), upsert(item('1', 3)))
    expect(applyEvent(once, upsert(item('1', 3, 50)))).toBe(once)
  })
})

describe('[C-11] 스냅샷 + join 전에 받은 이벤트', () => {
  it('스냅샷 순번 이하의 이벤트는 버리고, 이후 이벤트만 적용한다', () => {
    const snap = snapshot(10, [item('1', 8, 80)])
    const state = fromSnapshot(snap, [
      upsert(item('1', 9, 90)), // 스냅샷에 이미 들어 있는 변경
      upsert(item('1', 11, 110)),
      upsert(item('2', 12)), // 스냅샷에 없던 새 카드
    ])
    expect(state.items.get('1')?.x).toBe(110)
    expect(state.items.has('2')).toBe(true)
  })

  it('스냅샷에 있던 카드를 지운 이벤트가 먼저 와 있었으면 스냅샷 위에서 지운다', () => {
    const state = fromSnapshot(snapshot(10, [item('1', 4)]), [remove('1', 11)])
    expect(state.items.size).toBe(0)
  })

  it('스냅샷 이전에 지워진 카드의 늦은 이벤트(순번이 스냅샷 이하)는 무시한다', () => {
    const state = fromSnapshot(snapshot(10, []), [upsert(item('9', 7))])
    expect(state.items.size).toBe(0)
  })

  it('화면에는 z 순서대로 쌓는다', () => {
    const state = fromSnapshot(snapshot(10, [item('1', 1, 0, 5), item('2', 2, 0, 3)]))
    expect(stackedItems(state).map((i) => i.id)).toEqual(['2', '1'])
  })
})
