import { useCallback, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { apiFetch, refreshSession } from '../api/client'
import { CATCH_UP_PAGE_SIZE, catchUp, catchUpStart, cursorOf, laterCursor } from './catchUp'
import { mergeArticles } from './merge'
import { NEW_ARTICLES_EVENT, type FeedArticle, type FeedPage, type NewArticlesPayload } from './types'

const PAGE_SIZE = 30
/** 새로 들어온 기사를 강조 표시하는 시간 */
const HIGHLIGHT_MS = 4000

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

// 로그인이 만료됐으면 apiFetch가 토큰 갱신 후 다시 요청하고, 그래도 실패하면 로그인 화면으로 보낸다
function fetchFeed(before?: string): Promise<FeedPage> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (before) params.set('before', before)
  return apiFetch<FeedPage>(`/api/articles?${params}`)
}

function fetchCollectedAfter(cursor: string): Promise<FeedPage> {
  const params = new URLSearchParams({ limit: String(CATCH_UP_PAGE_SIZE), collectedAfter: cursor })
  return apiFetch<FeedPage>(`/api/articles?${params}`)
}

/** 둘 중 앞선 위치 (null = 처음부터) */
const earlierCursor = (a: string | null, b: string | null) => (laterCursor(a, b) === a ? b : a)

/**
 * F-02 실시간 뉴스 피드.
 * - 처음: REST로 최신 기사 조회 + 지금까지 수집된 위치(collectedCursor)를 기억
 * - 실시간: Socket.io `feed:new-articles` 이벤트로 받은 기사를 합치고, 받은 위치를 앞으로 옮긴다
 * - 재연결·truncated: 끊기기 직전 위치 뒤에 수집된 기사를 수집 순서대로 끝까지 받아 합친다 (C-10)
 *   너무 많이 놓쳤으면(최대 500건 초과) 이어 받지 않고 목록을 최신 페이지로 새로 시작한다
 * - 인증: 소켓 연결이 거절되면 토큰을 갱신해 다시 연결 (F-07)
 */
export function useNewsFeed() {
  const [articles, setArticles] = useState<FeedArticle[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set())
  const initialized = useRef(false)
  // 비동기 콜백에서 최신 목록을 읽기 위한 사본 (상태 업데이트 함수 안에서는 부수효과를 내지 않는다)
  const articlesRef = useRef<FeedArticle[]>([])
  useEffect(() => {
    articlesRef.current = articles
  }, [articles])
  /** 여기까지 수집된 기사는 받았다는 위치 */
  const collected = useRef<string | null>(null)
  /** 놓친 구간의 시작 위치. 끊긴 동안 받은 위치가 실시간 이벤트로 앞당겨져도 구간 시작은 그대로 남긴다 (undefined = 놓친 구간 없음) */
  const gapFrom = useRef<string | null | undefined>(undefined)
  const syncing = useRef<Promise<void> | null>(null)
  const syncAgain = useRef(false)

  const highlight = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    setHighlighted((prev) => new Set([...prev, ...ids]))
    setTimeout(() => {
      setHighlighted((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      })
    }, HIGHLIGHT_MS)
  }, [])

  const markGap = useCallback(() => {
    if (gapFrom.current === undefined) gapFrom.current = collected.current
  }, [])

  /** 최신 페이지로 목록을 채운다. reset이면 기존 목록을 버린다 */
  const loadLatest = useCallback(async (reset: boolean) => {
    const page = await fetchFeed()
    setArticles((prev) => mergeArticles(reset ? [] : prev, page.articles))
    setNextCursor(page.nextCursor)
    collected.current = laterCursor(collected.current, page.collectedCursor)
    initialized.current = true
  }, [])

  /** 처음이면 최신 페이지를, 놓친 구간이 있으면 그 구간을 받는다 */
  const runSync = useCallback(async () => {
    if (!initialized.current) {
      gapFrom.current = undefined
      await loadLatest(false)
      return
    }
    if (gapFrom.current === undefined) return
    const from = gapFrom.current
    gapFrom.current = undefined
    try {
      const result = await catchUp(fetchCollectedAfter, catchUpStart(from))
      if (!result.complete) {
        setHighlighted(new Set())
        await loadLatest(true)
        return
      }
      const known = new Set(articlesRef.current.map((a) => a.id))
      setArticles((prev) => mergeArticles(prev, result.articles))
      highlight(result.articles.filter((a) => !known.has(a.id)).map((a) => a.id))
      collected.current = laterCursor(collected.current, result.reached)
    } catch (e) {
      // 실패하면 놓친 구간을 되살려 다음 연결 때 다시 받는다
      gapFrom.current = gapFrom.current === undefined ? from : earlierCursor(from, gapFrom.current)
      throw e
    }
  }, [loadLatest, highlight])

  /** 한 번에 하나만 실행하고, 실행 중에 다시 요청되면 끝난 뒤 한 번 더 실행한다 */
  const sync = useCallback(() => {
    if (syncing.current) {
      syncAgain.current = true
      return syncing.current
    }
    syncing.current = (async () => {
      try {
        do {
          syncAgain.current = false
          await runSync()
        } while (syncAgain.current)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : '피드를 불러오지 못했습니다')
      } finally {
        setLoading(false)
        syncing.current = null
      }
    })()
    return syncing.current
  }, [runSync])

  const loadMore = useCallback(async () => {
    if (!nextCursor) return
    try {
      const page = await fetchFeed(nextCursor)
      setArticles((prev) => mergeArticles(prev, page.articles))
      setNextCursor(page.nextCursor)
    } catch (e) {
      setError(e instanceof Error ? e.message : '이전 기사를 불러오지 못했습니다')
    }
  }, [nextCursor])

  useEffect(() => {
    // 같은 출처의 /socket.io로 연결 (개발: Vite 프록시, 배포: nginx)
    const socket = io({ transports: ['websocket'] })

    // 첫 연결이면 최신 기사를, 재연결이면 끊긴 동안 수집된 기사를 받는다
    socket.on('connect', () => {
      setStatus('connected')
      void sync()
    })
    socket.on('disconnect', () => {
      markGap()
      setStatus('disconnected')
    })
    // 연결 단계에서 인증이 거절되면(access token 만료) 토큰을 갱신하고 다시 연결한다.
    // 갱신도 실패하면 REST 호출이 로그아웃 처리를 맡도록 sync를 부른다.
    socket.on('connect_error', (error) => {
      if (error.message !== 'unauthorized') return
      setStatus('connecting')
      void refreshSession().then((ok) => {
        if (ok) socket.connect()
        else void sync()
      })
    })
    socket.io.on('reconnect_attempt', () => setStatus('connecting'))

    socket.on(NEW_ARTICLES_EVENT, (payload: NewArticlesPayload) => {
      if (payload.truncated) {
        // 서버가 다 보내지 못했다 — 지금 위치 뒤에 수집된 기사를 REST로 받는다
        markGap()
        void sync()
        return
      }
      setArticles((prev) => mergeArticles(prev, payload.articles))
      highlight(payload.articles.map((a) => a.id))
      for (const article of payload.articles) collected.current = laterCursor(collected.current, cursorOf(article))
    })

    return () => {
      socket.disconnect()
    }
  }, [sync, markGap, highlight])

  return { articles, status, loading, error, highlighted, hasMore: nextCursor !== null, loadMore }
}
