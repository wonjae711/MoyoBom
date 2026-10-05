import { useEffect, useSyncExternalStore } from 'react'
import { io } from 'socket.io-client'
import { listDigests, type Digest } from './api'

/**
 * 안 읽은 다이제스트 개수와 새 다이제스트 도착 알림 (F-09).
 * 머리글의 알림함 표시와 알림함 화면이 같은 값을 보도록 모듈 하나에 둔다.
 */
let unread: number | null = null
const countListeners = new Set<() => void>()
const arrivalListeners = new Set<(digest: Digest) => void>()

function emitCount() {
  for (const listener of countListeners) listener()
}

export function setUnread(value: number) {
  unread = Math.max(0, value)
  emitCount()
}

export function adjustUnread(delta: number) {
  if (unread !== null) setUnread(unread + delta)
}

export function useUnreadCount(): number | null {
  return useSyncExternalStore(
    (listener) => {
      countListeners.add(listener)
      return () => countListeners.delete(listener)
    },
    () => unread,
  )
}

/** 새 다이제스트가 도착하면 불린다 (알림함 화면이 목록 맨 위에 넣는 데 씀) */
export function onDigestArrived(listener: (digest: Digest) => void): () => void {
  arrivalListeners.add(listener)
  return () => arrivalListeners.delete(listener)
}

/**
 * 안 읽은 개수를 불러오고, 본인 방(user:{id})의 digest:new를 받는다.
 * 머리글이 한 화면에 하나뿐이라 연결도 하나다
 */
export function useDigestSubscription(): void {
  useEffect(() => {
    let cancelled = false
    listDigests({ limit: 1 })
      .then((page) => !cancelled && setUnread(page.unread))
      .catch(() => {})
    const socket = io({ transports: ['websocket'] })
    socket.on('digest:new', ({ digest }: { digest: Digest }) => {
      adjustUnread(1)
      for (const listener of arrivalListeners) listener(digest)
    })
    return () => {
      cancelled = true
      socket.disconnect()
    }
  }, [])
}
