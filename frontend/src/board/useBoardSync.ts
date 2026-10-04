import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { addLink as postLink, getBoard } from './api'
import { refreshSession } from '../api/client'
import type { FeedArticle } from '../feed/types'
import { applyEvent, emptyBoardState, fromSnapshot, stackedItems, type BoardEvent, type BoardState } from './boardState'
import type { BoardItem, BoardMember, BoardRole, BoardSnapshot } from './types'

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
  const [remoteDrag, setRemoteDrag] = useState<Map<string, { x: number; y: number; at: number }>>(new Map())
  const [status, setStatus] = useState<BoardStatus>('connecting')
  const [goneReason, setGoneReason] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [role, setRole] = useState<BoardRole>('editor')
  const [members, setMembers] = useState<BoardMember[]>([])

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
    socket.on('card:moving', (d: { boardId: string; itemId: string; x: number; y: number }) => {
      if (!mine(d)) return
      setRemoteDrag((prev) => new Map(prev).set(d.itemId, { x: d.x, y: d.y, at: Date.now() }))
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
    async (input: { type: 'article'; article: FeedArticle } | { type: 'memo'; content: string }, x: number, y: number) => {
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
      }
      setOverlays((prev) => ({ ...prev, adds: new Map(prev.adds).set(clientId, temp) }))
      const payload =
        input.type === 'article'
          ? { type: 'article', articleId: input.article.id, x, y, clientId }
          : { type: 'memo', content: input.content, x, y, clientId }
      const res = await send<{ item: BoardItem }>('card:add', payload)
      if (res.ok) settle(res.item)
      else fail(res.message ?? '카드를 추가하지 못했습니다')
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
    },
    [send, forget, fail],
  )

  /** 링크 요약 카드 추가 (F-03). REST로 처리되고, 서버가 다른 참여자에게도 card:added로 알린다 */
  const addLink = useCallback(
    async (url: string, x: number, y: number) => {
      const result = await postLink(boardId, url, x, y)
      settle(result.item)
      return result
    },
    [boardId, settle],
  )

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
  }
}
