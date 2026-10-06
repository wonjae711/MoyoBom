import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { confirmLink, dismissCluster, getBoard, moveCluster, runClusters } from './api'
import { refreshSession } from '../api/client'
import type { FeedArticle } from '../feed/types'
import {
  applyEvent,
  emptyBoardState,
  fromSnapshot,
  stackedItems,
  visibleConnections,
  type BoardEvent,
  type BoardState,
} from './boardState'
import type { BoardCluster, BoardConnection, BoardItem, BoardMember, BoardRole, BoardSnapshot } from './types'

/** 서버 ack를 기다리는 최대 시간 */
const ACK_TIMEOUT_MS = 8000
/** 드래그 중 위치를 다른 사람에게 보내는 간격 (requirements.md F-05 처리 로직 5: 50~100ms) */
export const MOVING_INTERVAL_MS = 80
/** 다른 사람의 드래그 중 위치를 이 시간 동안 소식이 없으면 버린다 (드래그 끝 이벤트를 놓친 경우 대비) */
const REMOTE_DRAG_TTL_MS = 3000

type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string; message?: string }

export type BoardStatus =
  | 'connecting' // 처음 들어가는 중
  | 'ready'
  | 'reconnecting' // 연결이 끊겨 다시 들어가는 중 (그동안의 변경은 다시 들어갈 때 스냅샷으로 맞춘다)
  | 'gone' // 보드가 없거나, 지워졌거나, 내보내졌다

/** 화면에 그릴 카드: 서버 상태 + 아직 ack를 기다리는 내 변경 */
export interface ViewItem extends BoardItem {
  /** 서버에 저장되기 전 (ack 대기) */
  pending: boolean
  /** 다른 참여자가 지금 끌고 있으면 그 사람 id */
  movingBy?: string
}

interface Overlays {
  /** 추가 대기 중인 카드 (clientId → 임시 카드) */
  adds: Map<string, BoardItem>
  /** 이동 대기 중 (itemId → 위치와 요청 번호 — 같은 카드를 연달아 옮기면 마지막 요청만 반영) */
  moves: Map<string, { x: number; y: number; zIndex: number; req: number }>
  /** 메모 수정 대기 중 */
  memos: Map<string, { content: string; req: number }>
  /** 삭제 대기 중 */
  deleting: Set<string>
}

const emptyOverlays = (): Overlays => ({ adds: new Map(), moves: new Map(), memos: new Map(), deleting: new Set() })

let clientCounter = 0
const newClientId = () => `c${Date.now().toString(36)}${(clientCounter++).toString(36)}`

/**
 * 보드 실시간 동기화 (F-05).
 * - 들어가기: board:join → ack의 스냅샷. ack 전에 도착한 이벤트는 모았다가 스냅샷 위에 다시 적용 (C-11)
 * - 순서: 카드 version(보드 변경 순번)으로 늦게 온 이벤트를 걸러낸다 (L-02, boardState.ts)
 * - 내 변경: 화면에 먼저 반영(Optimistic Update)하고 ack가 오면 서버 결과로 바꾼다. 실패하면 되돌리고 알린다
 * - 재연결: 다시 join해서 스냅샷으로 맞춘다
 */
export function useBoardSync(boardId: string, options: { onError?: (message: string) => void } = {}) {
  const [server, setServer] = useState<BoardState>(emptyBoardState)
  const [overlays, setOverlays] = useState<Overlays>(emptyOverlays)
  const [remoteDrag, setRemoteDrag] = useState<Map<string, { x: number; y: number; at: number; by?: string }>>(new Map())
  const [status, setStatus] = useState<BoardStatus>('connecting')
  const [goneReason, setGoneReason] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [role, setRole] = useState<BoardRole>('editor')
  const [members, setMembers] = useState<BoardMember[]>([])
  /** AI 클러스터 목록과 그 목록의 보드 변경 순번 (순번이 큰 목록만 받아들인다) */
  const [clusters, setClusters] = useState<{ seq: number; list: BoardCluster[] }>({ seq: 0, list: [] })
  /** join 응답 전에 온 클러스터 소식 (스냅샷보다 새것이면 적용) */
  const pendingClusters = useRef<{ seq: number; list: BoardCluster[] } | null>(null)

  const socketRef = useRef<Socket | null>(null)
  /** join ack 전에 받은 이벤트 (null이면 바로 적용) */
  const buffer = useRef<BoardEvent[] | null>([])
  const reqCounter = useRef(0)
  const lastMovingSent = useRef(0)
  const onErrorRef = useRef(options.onError)
  useEffect(() => {
    onErrorRef.current = options.onError
  })
  const fail = useCallback((message: string) => onErrorRef.current?.(message), [])

  const receive = useCallback((event: BoardEvent) => {
    if (event.kind === 'link-add' || event.kind === 'link-delete') {
      if (buffer.current) buffer.current.push(event)
      else setServer((prev) => applyEvent(prev, event))
      return
    }
    const id = event.kind === 'upsert' ? event.item.id : event.itemId
    setRemoteDrag((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    if (buffer.current) buffer.current.push(event)
    else setServer((prev) => applyEvent(prev, event))
  }, [])

  const applySnapshot = useCallback((snapshot: BoardSnapshot) => {
    setServer(fromSnapshot(snapshot, buffer.current ?? []))
    buffer.current = null
    const pending = pendingClusters.current
    pendingClusters.current = null
    setClusters(
      pending && pending.seq > snapshot.board.seq
        ? pending
        : { seq: snapshot.board.seq, list: snapshot.clusters ?? [] },
    )
    setTitle(snapshot.board.title)
    setRole(snapshot.role)
    setMembers(snapshot.members)
    setStatus('ready')
  }, [])

  const leave = useCallback((reason: string) => {
    setGoneReason(reason)
    setStatus('gone')
    socketRef.current?.disconnect()
  }, [])

  useEffect(() => {
    const socket = io({ transports: ['websocket'] })
    socketRef.current = socket

    const join = async () => {
      buffer.current = []
      try {
        const res = (await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('board:join', { boardId })) as Ack<{
          snapshot: BoardSnapshot
        }>
        if (res.ok) applySnapshot(res.snapshot)
        else if (res.error === 'not_found' || res.error === 'invalid') leave('보드를 찾을 수 없거나 참여하지 않은 보드입니다')
        else fail(res.message ?? '보드를 불러오지 못했습니다')
      } catch {
        // ack 시간 초과: 연결이 살아 있으면 다시 시도
        if (socket.connected) void join()
      }
    }

    socket.on('connect', () => void join())
    socket.on('disconnect', () => {
      buffer.current = []
      setStatus((prev) => (prev === 'gone' ? prev : 'reconnecting'))
    })
    socket.on('connect_error', (error) => {
      if (error.message !== 'unauthorized') return
      // 소켓 인증이 거절되면(access token 만료) 갱신 후 다시 연결 (F-07)
      void refreshSession().then((ok) => {
        if (ok) socket.connect()
        else leave('로그인이 필요합니다')
      })
    })

    const mine = (data: { boardId: string }) => data.boardId === boardId
    socket.on('card:added', (d: { boardId: string; item: BoardItem }) => mine(d) && receive({ kind: 'upsert', item: d.item }))
    socket.on('card:moved', (d: { boardId: string; item: BoardItem }) => mine(d) && receive({ kind: 'upsert', item: d.item }))
    socket.on('card:updated', (d: { boardId: string; item: BoardItem }) => mine(d) && receive({ kind: 'upsert', item: d.item }))
    socket.on('card:deleted', (d: { boardId: string; itemId: string; version: number }) => {
      if (mine(d)) receive({ kind: 'delete', itemId: d.itemId, version: d.version })
    })
    socket.on('card:moving', (d: { boardId: string; itemId: string; x: number; y: number; by?: string }) => {
      if (!mine(d)) return
      setRemoteDrag((prev) => new Map(prev).set(d.itemId, { x: d.x, y: d.y, at: Date.now(), by: d.by }))
    })
    socket.on('connection:added', (d: { boardId: string; connection: BoardConnection }) => {
      if (mine(d)) receive({ kind: 'link-add', connection: d.connection })
    })
    socket.on('connection:deleted', (d: { boardId: string; connectionId: string; version: number }) => {
      if (mine(d)) receive({ kind: 'link-delete', connectionId: d.connectionId, version: d.version })
    })
    socket.on('board:clusters', (d: { boardId: string; seq: number; clusters: BoardCluster[] }) => {
      if (!mine(d)) return
      const next = { seq: d.seq, list: d.clusters }
      if (buffer.current) {
        if (!pendingClusters.current || next.seq > pendingClusters.current.seq) pendingClusters.current = next
      } else setClusters((prev) => (next.seq > prev.seq ? next : prev))
    })
    socket.on('board:renamed', (d: { boardId: string; title: string }) => mine(d) && setTitle(d.title))
    socket.on('board:members-changed', (d: { boardId: string }) => {
      if (!mine(d)) return
      getBoard(boardId)
        .then((snapshot) => {
          setMembers(snapshot.members)
          setRole(snapshot.role)
        })
        .catch(() => {})
    })
    socket.on('board:removed', (d: { boardId: string }) => mine(d) && leave('보드에서 내보내졌습니다'))
    socket.on('board:deleted', (d: { boardId: string }) => mine(d) && leave('보드가 삭제되었습니다'))

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [boardId, applySnapshot, receive, leave, fail])

  // 오래된 원격 드래그 위치 정리
  useEffect(() => {
    if (remoteDrag.size === 0) return
    const timer = setInterval(() => {
      const now = Date.now()
      setRemoteDrag((prev) => {
        const next = new Map([...prev].filter(([, v]) => now - v.at < REMOTE_DRAG_TTL_MS))
        return next.size === prev.size ? prev : next
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [remoteDrag.size])

  const send = useCallback(
    async <T,>(event: string, payload: object): Promise<Ack<T>> => {
      const socket = socketRef.current
      if (!socket?.connected) return { ok: false, error: 'offline', message: '연결이 끊겨 저장하지 못했습니다' }
      try {
        return (await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(event, { boardId, ...payload })) as Ack<T>
      } catch {
        return { ok: false, error: 'timeout', message: '서버 응답이 없어 저장하지 못했습니다' }
      }
    },
    [boardId],
  )

  const items = useMemo<ViewItem[]>(() => {
    const list: ViewItem[] = []
    for (const item of stackedItems(server)) {
      if (overlays.deleting.has(item.id)) continue
      const move = overlays.moves.get(item.id)
      const memo = overlays.memos.get(item.id)
      const drag = remoteDrag.get(item.id)
      list.push({
        ...item,
        ...(move ? { x: move.x, y: move.y, zIndex: move.zIndex } : drag ? { x: drag.x, y: drag.y } : {}),
        ...(memo ? { content: memo.content } : {}),
        pending: Boolean(move || memo),
        ...(drag && !move ? { movingBy: drag.by } : {}),
      })
    }
    for (const temp of overlays.adds.values()) list.push({ ...temp, pending: true })
    return list.sort((a, b) => a.zIndex - b.zIndex)
  }, [server, overlays, remoteDrag])

  const topZ = useCallback(() => items.reduce((max, i) => Math.max(max, i.zIndex), 0) + 1, [items])

  /** ack로 받은 서버 결과를 반영 (브로드캐스트와 같은 규칙) */
  const settle = useCallback((item: BoardItem) => setServer((prev) => applyEvent(prev, { kind: 'upsert', item })), [])
  /** 서버에 이미 없는 카드(not_found)는 화면에서도 지운다. 순번을 모르니 가장 큰 값으로 기억해 되살아나지 않게 한다 */
  const forget = useCallback(
    (itemId: string) => setServer((prev) => applyEvent(prev, { kind: 'delete', itemId, version: Number.MAX_SAFE_INTEGER })),
    [],
  )

  const addCard = useCallback(
    async (
      input: { type: 'article'; article: FeedArticle } | { type: 'memo'; content: string },
      x: number,
      y: number,
      /** quiet: 실패 알림을 화면이 직접 띄운다 (다시 시도 버튼 등) */
      options: { quiet?: boolean } = {},
    ) => {
      const clientId = newClientId()
      const temp: BoardItem = {
        id: `tmp-${clientId}`,
        type: input.type,
        articleId: input.type === 'article' ? input.article.id : null,
        article:
          input.type === 'article'
            ? {
                title: input.article.title,
                description: input.article.description,
                source: input.article.source,
                category: input.article.category,
                originalLink: input.article.originalLink,
                publishedAt: input.article.publishedAt,
                collectedAt: input.article.collectedAt,
                submitted: false,
              }
            : null,
        content: input.type === 'memo' ? input.content : null,
        imageKey: null,
        x,
        y,
        rotation: 0,
        zIndex: topZ(),
        createdBy: null,
        updatedAt: new Date().toISOString(),
        version: 0,
        arranged: false,
      }
      setOverlays((prev) => ({ ...prev, adds: new Map(prev.adds).set(clientId, temp) }))
      const payload =
        input.type === 'article'
          ? { type: 'article', articleId: input.article.id, x, y, clientId }
          : { type: 'memo', content: input.content, x, y, clientId }
      const res = await send<{ item: BoardItem }>('card:add', payload)
      if (res.ok) settle(res.item)
      else if (!options.quiet) fail(res.message ?? '카드를 추가하지 못했습니다')
      setOverlays((prev) => {
        const adds = new Map(prev.adds)
        adds.delete(clientId)
        return { ...prev, adds }
      })
      return res.ok ? res.item : null
    },
    [send, settle, fail, topZ],
  )

  const moveCard = useCallback(
    async (itemId: string, x: number, y: number) => {
      const req = ++reqCounter.current
      setOverlays((prev) => ({ ...prev, moves: new Map(prev.moves).set(itemId, { x, y, zIndex: topZ(), req }) }))
      const res = await send<{ item: BoardItem }>('card:move', { itemId, x, y })
      if (res.ok) settle(res.item)
      else if (res.error === 'not_found') {
        forget(itemId)
        fail('다른 사람이 이미 삭제한 카드입니다')
      } else fail(res.message ?? '카드를 옮기지 못했습니다')
      setOverlays((prev) => {
        if (prev.moves.get(itemId)?.req !== req) return prev // 그 사이 다시 옮겼으면 마지막 요청이 정리한다
        const moves = new Map(prev.moves)
        moves.delete(itemId)
        return { ...prev, moves }
      })
      return res.ok
    },
    [send, settle, forget, fail, topZ],
  )

  /** 드래그 중 위치 중계 (저장하지 않음, 간격 제한) */
  const dragCard = useCallback(
    (itemId: string, x: number, y: number) => {
      const now = Date.now()
      if (now - lastMovingSent.current < MOVING_INTERVAL_MS) return
      lastMovingSent.current = now
      socketRef.current?.volatile.emit('card:moving', { boardId, itemId, x, y })
    },
    [boardId],
  )

  const updateMemo = useCallback(
    async (itemId: string, content: string) => {
      const req = ++reqCounter.current
      setOverlays((prev) => ({ ...prev, memos: new Map(prev.memos).set(itemId, { content, req }) }))
      const res = await send<{ item: BoardItem }>('card:update', { itemId, content })
      if (res.ok) settle(res.item)
      else if (res.error === 'not_found') {
        forget(itemId)
        fail('다른 사람이 이미 삭제한 메모입니다')
      } else fail(res.message ?? '메모를 저장하지 못했습니다')
      setOverlays((prev) => {
        if (prev.memos.get(itemId)?.req !== req) return prev
        const memos = new Map(prev.memos)
        memos.delete(itemId)
        return { ...prev, memos }
      })
      return res.ok
    },
    [send, settle, forget, fail],
  )

  const deleteCard = useCallback(
    async (itemId: string) => {
      setOverlays((prev) => ({ ...prev, deleting: new Set(prev.deleting).add(itemId) }))
      const res = await send<{ version: number }>('card:delete', { itemId })
      if (res.ok) setServer((prev) => applyEvent(prev, { kind: 'delete', itemId, version: res.version }))
      else if (res.error === 'not_found') forget(itemId)
      else fail(res.message ?? '카드를 삭제하지 못했습니다')
      setOverlays((prev) => {
        const deleting = new Set(prev.deleting)
        deleting.delete(itemId)
        return { ...prev, deleting }
      })
      return res.ok || res.error === 'not_found'
    },
    [send, forget, fail],
  )

  /**
   * 링크 요약 미리보기를 확인한 뒤 카드로 올린다 (F-03, B12). REST로 처리되고,
   * 서버가 다른 참여자에게도 card:added로 알린다
   */
  const addLink = useCallback(
    async (url: string, x: number, y: number) => {
      const item = await confirmLink(boardId, url, x, y)
      settle(item)
      return item
    },
    [boardId, settle],
  )

  /** AI 이슈 묶기 (F-08). 결과 목록을 바로 반영한다 (같은 소식이 board:clusters로 와도 순번 규칙으로 한 번만) */
  const analyze = useCallback(async () => {
    const result = await runClusters(boardId)
    setClusters((prev) => (result.seq > prev.seq ? { seq: result.seq, list: result.clusters } : prev))
    return result
  }, [boardId])

  /** "제안 무시": 화면에서 먼저 빼고, 서버 소식(board:clusters)으로 확정 */
  const dismiss = useCallback(
    async (clusterId: string) => {
      setClusters((prev) => ({ ...prev, list: prev.list.filter((c) => c.id !== clusterId) }))
      try {
        await dismissCluster(boardId, clusterId)
      } catch {
        fail('제안을 지우지 못했습니다')
        getBoard(boardId)
          .then((s) => setClusters((prev) => (s.board.seq >= prev.seq ? { seq: s.board.seq, list: s.clusters } : prev)))
          .catch(() => {})
      }
    },
    [boardId, fail],
  )

  /** "자동 정렬" / "원래대로" — 옮겨진 카드를 서버 결과로 반영 */
  const arrange = useCallback(
    async (clusterId: string, action: 'arrange' | 'restore') => {
      // 실패를 "옮긴 카드 0장"과 구분해 돌려준다 — 여러 클러스터를 차례로 처리할 때 부분 실패를 알리기 위해
      try {
        const moved = await moveCluster(boardId, clusterId, action)
        moved.forEach(settle)
        return { ok: true, moved: moved.length }
      } catch {
        return { ok: false, moved: 0 }
      }
    },
    [boardId, settle],
  )

  /** 연결선 (F-10): 서버 ack로 확정한다 (선은 가볍고 중복·삭제된 카드 검사가 서버에 있어 낙관적 반영은 하지 않음) */
  const [hiddenConnections, setHiddenConnections] = useState<Set<string>>(new Set())
  const connections = useMemo(
    () => visibleConnections(server).filter((c) => !hiddenConnections.has(c.id)),
    [server, hiddenConnections],
  )

  const addConnection = useCallback(
    async (fromId: string, toId: string) => {
      const res = await send<{ connection: BoardConnection }>('connection:add', { fromId, toId })
      if (res.ok) setServer((prev) => applyEvent(prev, { kind: 'link-add', connection: res.connection }))
      else fail(res.message ?? '연결선을 만들지 못했습니다')
      return res.ok
    },
    [send, fail],
  )

  const deleteConnection = useCallback(
    async (connectionId: string) => {
      setHiddenConnections((prev) => new Set(prev).add(connectionId))
      const res = await send<{ version: number }>('connection:delete', { connectionId })
      if (res.ok) setServer((prev) => applyEvent(prev, { kind: 'link-delete', connectionId, version: res.version }))
      else if (res.error === 'not_found')
        setServer((prev) => applyEvent(prev, { kind: 'link-delete', connectionId, version: Number.MAX_SAFE_INTEGER }))
      else fail(res.message ?? '연결선을 지우지 못했습니다')
      setHiddenConnections((prev) => {
        const next = new Set(prev)
        next.delete(connectionId)
        return next
      })
    },
    [send, fail],
  )

  /** 연결이 끊긴 동안 "다시 연결" (B11) — 자동 재연결을 기다리지 않고 바로 시도 */
  const reconnect = useCallback(() => {
    socketRef.current?.connect()
  }, [])

  const saving = overlays.adds.size + overlays.moves.size + overlays.memos.size + overlays.deleting.size > 0

  return {
    status,
    goneReason,
    title,
    role,
    members,
    items,
    saving,
    addCard,
    moveCard,
    dragCard,
    updateMemo,
    deleteCard,
    addLink,
    clusters: clusters.list,
    connections,
    addConnection,
    deleteConnection,
    analyze,
    dismiss,
    arrange,
    reconnect,
  }
}
