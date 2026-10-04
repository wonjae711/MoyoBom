import type { BoardItem, BoardSnapshot } from './types'

/**
 * 보드 카드 상태를 서버 변경 순번(version)으로 맞춘다 (C-11·L-02).
 *
 * - 서버는 같은 보드의 변경을 한 줄로 세워 순번을 매긴다 (순번 순서 = 커밋 순서)
 * - 이벤트는 늦게·순서가 바뀌어 도착할 수 있으므로, 카드마다 아는 순번보다 큰 변경만 적용한다
 * - 삭제는 순번을 기억해 두고(tombstone), 그 이하 순번의 늦은 추가·이동으로 카드를 되살리지 않는다
 * - board:join ack(스냅샷)보다 먼저 온 이벤트는 모아 두었다가 스냅샷 위에 다시 적용한다.
 *   스냅샷 순번 이하의 이벤트는 이미 스냅샷에 들어 있으므로 버린다
 */
export type BoardEvent = { kind: 'upsert'; item: BoardItem } | { kind: 'delete'; itemId: string; version: number }

export interface BoardState {
  /** 이 순번까지의 변경은 반영됨 (스냅샷 기준) */
  baseSeq: number
  items: Map<string, BoardItem>
  /** 삭제된 카드 id → 삭제 순번 */
  deleted: Map<string, number>
}

export const emptyBoardState = (): BoardState => ({ baseSeq: 0, items: new Map(), deleted: new Map() })

export function applyEvent(state: BoardState, event: BoardEvent): BoardState {
  const id = event.kind === 'upsert' ? event.item.id : event.itemId
  const version = event.kind === 'upsert' ? event.item.version : event.version
  if (version <= state.baseSeq) return state
  if ((state.deleted.get(id) ?? -1) >= version) return state
  const current = state.items.get(id)
  if (current && current.version >= version) return state

  const items = new Map(state.items)
  if (event.kind === 'upsert') {
    items.set(id, event.item)
    return { ...state, items }
  }
  items.delete(id)
  const deleted = new Map(state.deleted)
  deleted.set(id, version)
  return { ...state, items, deleted }
}

/** 스냅샷으로 상태를 새로 만들고, join 응답 전에 모아 둔 이벤트를 그 위에 적용한다 */
export function fromSnapshot(snapshot: BoardSnapshot, buffered: BoardEvent[] = []): BoardState {
  const base: BoardState = {
    baseSeq: snapshot.board.seq,
    items: new Map(snapshot.items.map((item) => [item.id, item])),
    deleted: new Map(),
  }
  return buffered.reduce(applyEvent, base)
}

/** 화면에 그릴 순서: 아래(z 작은 것)부터 */
export function stackedItems(state: BoardState): BoardItem[] {
  return [...state.items.values()].sort((a, b) => a.zIndex - b.zIndex || Number(a.id) - Number(b.id))
}
