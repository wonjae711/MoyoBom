import { useCallback, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { apiFetch, refreshSession } from '../api/client'
import { mergeArticles } from './merge'
import { NEW_ARTICLES_EVENT, type FeedArticle, type FeedPage, type NewArticlesPayload } from './types'

const PAGE_SIZE = 30
/** 새로 들어온 기사를 강조 표시하는 시간 */
const HIGHLIGHT_MS = 4000

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

function fetchFeed(before?: string): Promise<FeedPage> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (before) params.set('before', before)
  // 로그인이 만료됐으면 apiFetch가 토큰 갱신 후 다시 요청하고, 그래도 실패하면 로그인 화면으로 보낸다
  return apiFetch<FeedPage>(`/api/articles?${params}`)
}

/**
 * F-02 실시간 뉴스 피드.
 * - 처음: REST로 최신 기사 조회
 * - 실시간: Socket.io `feed:new-articles` 이벤트로 받은 기사를 맨 위에 추가
 * - 재연결: 끊긴 동안 놓친 기사를 REST로 다시 조회해 합친다
 * - 서버가 한 번에 다 보내지 못했으면(truncated) REST로 다시 조회
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

  /** 최신 페이지를 다시 받아 기존 목록과 합친다. 처음 로드일 때만 "더 보기" 커서를 설정한다 */
  const refreshLatest = useCallback(async () => {
    try {
      const page = await fetchFeed()
      const known = new Set(articlesRef.current.map((a) => a.id))
      setArticles((prev) => mergeArticles(prev, page.articles))
      // 재연결로 새로 채워진 기사만 강조 (첫 로드는 강조하지 않음)
      if (initialized.current) highlight(page.articles.filter((a) => !known.has(a.id)).map((a) => a.id))
      if (!initialized.current) setNextCursor(page.nextCursor)
      initialized.current = true
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '피드를 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [highlight])

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

    // 첫 연결과 재연결 모두 최신 기사를 다시 받아 끊긴 동안의 누락분을 채운다
    socket.on('connect', () => {
      setStatus('connected')
      void refreshLatest()
    })
    socket.on('disconnect', () => setStatus('disconnected'))
    // 연결 단계에서 인증이 거절되면(access token 만료) 토큰을 갱신하고 다시 연결한다.
    // 갱신도 실패하면 아래 REST 호출이 로그아웃 처리를 맡으므로 여기서는 멈춘다.
    socket.on('connect_error', (error) => {
      if (error.message !== 'unauthorized') return
      setStatus('connecting')
      void refreshSession().then((ok) => {
        if (ok) socket.connect()
        else void refreshLatest()
      })
    })
    socket.io.on('reconnect_attempt', () => setStatus('connecting'))

    socket.on(NEW_ARTICLES_EVENT, (payload: NewArticlesPayload) => {
      if (payload.truncated) {
        void refreshLatest()
        return
      }
      setArticles((prev) => mergeArticles(prev, payload.articles))
      highlight(payload.articles.map((a) => a.id))
    })

    return () => {
      socket.disconnect()
    }
  }, [refreshLatest, highlight])

  return { articles, status, loading, error, highlighted, hasMore: nextCursor !== null, loadMore }
}
