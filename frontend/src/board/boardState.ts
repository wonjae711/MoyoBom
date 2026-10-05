import type { BoardConnection, BoardItem, BoardSnapshot } from './types'

/**
 * 보드 카드·연결선 상태를 서버 변경 순번(version)으로 맞춘다 (C-11·L-02, F-10).
 *
 * - 서버는 같은 보드의 변경을 한 줄로 세워 순번을 매긴다 (순번 순서 = 커밋 순서)
 * - 이벤트는 늦게·순서가 바뀌어 도착할 수 있으므로, 카드마다 아는 순번보다 큰 변경만 적용한다
 * - 삭제는 순번을 기억해 두고(tombstone), 그 이하 순번의 늦은 추가·이동으로 카드를 되살리지 않는다
 * - board:join ack(스냅샷)보다 먼저 온 이벤트는 모아 두었다가 스냅샷 위에 다시 적용한다.
 *   스냅샷 순번 이하의 이벤트는 이미 스냅샷에 들어 있으므로 버린다
 * - 연결선(F-10)도 같은 규칙. 연결선은 추가·삭제만 있다
 */
export type BoardEvent =
  | { kind: 'upsert'; item: BoardItem }
  | { kind: 'delete'; itemId: string; version: number }
  | { kind: 'link-add'; connection: BoardConnection }
  | { kind: 'link-delete'; connectionId: string; version: number }

export interface BoardState {
  /** 이 순번까지의 변경은 반영됨 (스냅샷 기준) */
  baseSeq: number
  items: Map<string, BoardItem>
  /** 삭제된 카드 id → 삭제 순번 */
  deleted: Map<string, number>
  connections: Map<string, BoardConnection>
  /** 삭제된 연결선 id → 삭제 순번 */
  deletedConnections: Map<string, number>
}

export const emptyBoardState = (): BoardState => ({
  baseSeq: 0,
  items: new Map(),
  deleted: new Map(),
  connections: new Map(),
  deletedConnections: new Map(),
})

function applyLinkEvent(state: BoardState, event: Extract<BoardEvent, { kind: 'link-add' | 'link-delete' }>): BoardState {
  const id = event.kind === 'link-add' ? event.connection.id : event.connectionId
  const version = event.kind === 'link-add' ? event.connection.version : event.version
  if (version <= state.baseSeq) return state
  if ((state.deletedConnections.get(id) ?? -1) >= version) return state
  const connections = new Map(state.connections)
  if (event.kind === 'link-add') {
    if (connections.has(id)) return state
    connections.set(id, event.connection)
    return { ...state, connections }
  }
  connections.delete(id)
  const deletedConnections = new Map(state.deletedConnections)
  deletedConnections.set(id, version)
  return { ...state, connections, deletedConnections }
}

export function applyEvent(state: BoardState, event: BoardEvent): BoardState {
  if (event.kind === 'link-add' || event.kind === 'link-delete') return applyLinkEvent(state, event)
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
    connections: new Map((snapshot.connections ?? []).map((c) => [c.id, c])),
    deletedConnections: new Map(),
  }
  return buffered.reduce(applyEvent, base)
}

/** 화면에 그릴 순서: 아래(z 작은 것)부터 */
export function stackedItems(state: BoardState): BoardItem[] {
  return [...state.items.values()].sort((a, b) => a.zIndex - b.zIndex || Number(a.id) - Number(b.id))
}

/** 화면에 그릴 연결선: 양 끝 카드가 모두 있는 것만 (카드가 지워지면 서버에서도 함께 지워진다) */
export function visibleConnections(state: BoardState): BoardConnection[] {
  return [...state.connections.values()].filter((c) => state.items.has(c.fromId) && state.items.has(c.toId))
}
