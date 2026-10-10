import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/useAuth'
import { DigestLink } from '../digests/DigestLink'
import { CATEGORY_LABELS, type FeedArticle } from '../feed/types'
import { useNow, useToast } from '../ui/hooks'
import { Icon } from '../ui/Icon'
import { clusterQuota, linkQuota } from './api'
import { AskPanel } from './AskPanel'
import { BoardCanvas, DRAFT_MEMO_ID, type ClusterAction, type MemoEdit, type Tool } from './BoardCanvas'
import { BoardNameDialog, DeleteBoardDialog, LeaveBoardDialog } from './BoardDialogs'
import { LinkDialog, MembersDialog } from './BoardModals'
import { AiPanel, ArticleDetail, SidePanel, type AiState, type DetailArticle } from './BoardPanels'
import { ZOOM_STEP, categoryLabel, centerOn, fitView, toBoard, zoomAt, type View } from './cardLayout'
import { sourceDiversity } from './diversity'
import { FeedPanel } from './FeedPanel'
import { arrangeOutcome, type ArrangeResult } from './arrangeOutcome'
import { PHOTO_ACCEPT, PhotoUploadError, checkPhoto, uploadPhoto } from './photoUpload'
import { ROLE_LABEL } from './roles'
import type { BoardItem } from './types'
import { useBoardSync, type ViewItem } from './useBoardSync'
import './BoardPage.css'

type Right =
  | { kind: 'detail'; itemId: string }
  | { kind: 'feed'; article: FeedArticle }
  | { kind: 'ai' }
  | { kind: 'ask' }
type Dialog = 'rename' | 'delete' | 'leave' | 'members' | 'link' | null

/** 이보다 좁으면 보드를 편집하지 않는다 */
const MIN_WIDTH = 760
/** 이보다 좁으면 양쪽 패널을 함께 열지 않는다 (캔버스가 너무 좁아지지 않게) */
const BOTH_PANELS_WIDTH = 1280

const feedDetail = (a: FeedArticle): DetailArticle => ({
  title: a.title,
  source: a.source,
  category: CATEGORY_LABELS[a.category] ?? a.category,
  publishedAt: a.publishedAt,
  collectedAt: a.collectedAt,
  description: a.description,
  originalLink: a.originalLink,
  submitted: false,
  imageUrl: a.imageUrl,
})

const itemDetail = (item: BoardItem): DetailArticle | null =>
  item.article && {
    title: item.article.title,
    source: item.article.source,
    category: categoryLabel(item),
    publishedAt: item.article.publishedAt,
    collectedAt: item.article.collectedAt,
    description: item.article.description,
    originalLink: item.article.originalLink,
    submitted: item.article.submitted,
    imageUrl: item.article.imageUrl,
  }

function useViewportWidth() {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

/** 협업 보드 (F-05, 보라 테마 프로토타입) */
export function BoardPage() {
  const { boardId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const toast = useToast()
  const showToast = toast.show
  const [syncFailed, setSyncFailed] = useState(false)
  const onError = useCallback(
    (message: string) => {
      setSyncFailed(true)
      showToast(message, { tone: 'err' })
    },
    [showToast],
  )
  const board = useBoardSync(boardId, { onError })
  const now = useNow(30_000)
  const vw = useViewportWidth()

  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [heights, setHeights] = useState<Map<string, number>>(new Map())
  const [tool, setTool] = useState<Tool>('select')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
  const [connectMode, setConnectMode] = useState(false)
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [memoEdit, setMemoEdit] = useState<MemoEdit | null>(null)
  /** 메모 편집 세션 번호 — 늦게 온 저장 결과가 다른(새) 편집을 닫지 않게 (Codex 281c5f2 리뷰 1) */
  const memoSession = useRef(0)
  const [draftAt, setDraftAt] = useState<{ x: number; y: number } | null>(null)
  const [newsOpen, setNewsOpen] = useState(() => window.innerWidth >= 1100)
  const [right, setRight] = useState<Right | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [srcOpen, setSrcOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [linkRemaining, setLinkRemaining] = useState<number | null>(null)
  const [clusterRemaining, setClusterRemaining] = useState<number | null>(null)
  const [aiState, setAiState] = useState<AiState>('idle')
  const [aiBusy, setAiBusy] = useState(false)
  const [analyzedIds, setAnalyzedIds] = useState<Set<string> | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const srcRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const locked = board.status !== 'ready'
  const members = useMemo(() => new Map(board.members.map((m) => [m.userId, m])), [board.members])
  const articles = useMemo(() => board.items.filter((i) => i.type === 'article' && !i.id.startsWith('tmp-')), [board.items])
  /** AI로 정리 대상: 기사 카드 + 내용이 4자 이상인 메모·사진 카드 (2026-10-06 메모·사진도 함께 묶기) */
  const aiCards = useMemo(
    () =>
      board.items.filter(
        (i) =>
          !i.id.startsWith('tmp-') && (i.type === 'article' || ((i.type === 'memo' || i.type === 'photo') && (i.content ?? '').trim().length >= 4)),
      ),
    [board.items],
  )
  const owner = board.role === 'owner'

  useEffect(() => {
    clusterQuota(boardId)
      .then(setClusterRemaining)
      .catch(() => setClusterRemaining(null))
    linkQuota(boardId)
      .then(setLinkRemaining)
      .catch(() => setLinkRemaining(null))
  }, [boardId])

  // 새 변경을 저장하기 시작하면 "저장하지 못했어요" 표시를 지운다
  const [wasSaving, setWasSaving] = useState(board.saving)
  if (wasSaving !== board.saving) {
    setWasSaving(board.saving)
    if (board.saving && syncFailed) setSyncFailed(false)
  }

  // 패널: 좁은 화면에서는 한쪽만 연다
  const openRight = useCallback(
    (next: Right) => {
      setRight(next)
      if (vw < BOTH_PANELS_WIDTH) setNewsOpen(false)
    },
    [vw],
  )
  const toggleNews = () => {
    setNewsOpen((open) => {
      if (!open && vw < BOTH_PANELS_WIDTH) setRight(null)
      return !open
    })
  }
  const [lastVw, setLastVw] = useState(vw)
  if (lastVw !== vw) {
    setLastVw(vw)
    if (vw < BOTH_PANELS_WIDTH && newsOpen && right) setNewsOpen(false)
  }

  const onHeight = useCallback((id: string, h: number) => {
    setHeights((prev) => (prev.get(id) === h ? prev : new Map(prev).set(id, h)))
  }, [])
  const onSize = useCallback((width: number, height: number) => {
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
  }, [])

  const fit = useCallback(() => setView(fitView(board.items, heights, size.width, size.height)), [board.items, heights, size])

  // 처음 들어왔을 때 카드가 모두 보이게 맞춘다 (뉴스 화면에서 고른 카드가 있으면 그 카드로)
  const wantSelect = (location.state as { select?: string } | null)?.select ?? null
  const [fitted, setFitted] = useState(false)
  useEffect(() => {
    if (fitted || board.status !== 'ready' || !size.width) return
    const target = wantSelect ? board.items.find((i) => i.id === wantSelect) : undefined
    const timer = setTimeout(() => {
      setFitted(true)
      if (target) {
        setSelectedId(target.id)
        setView((v) => centerOn({ ...v, scale: 1 }, target.x, target.y, size.width, size.height))
      } else setView(fitView(board.items, heights, size.width, size.height))
    }, 0)
    return () => clearTimeout(timer)
  }, [fitted, board.status, board.items, heights, size, wantSelect])

  const zoomBy = (factor: number) => setView((v) => zoomAt(v, v.scale * factor, size.width / 2, size.height / 2))

  /** 지금 보고 있는 화면 가운데 근처 (겹치지 않게 조금씩 비켜 놓음) */
  const viewCenter = () => {
    const c = toBoard(view, size.width / 2, size.height / 2)
    const n = board.items.length % 5
    return { x: Math.round(c.x + n * 24 - 48), y: Math.round(c.y + n * 24 - 48) }
  }

  const addArticle = (article: FeedArticle, x?: number, y?: number) => {
    if (locked) return
    const at = x === undefined || y === undefined ? viewCenter() : { x: Math.round(x), y: Math.round(y) }
    const dup = board.items.some((i) => i.articleId === article.id)
    void board.addCard({ type: 'article', article }, at.x, at.y, { quiet: true }).then((item) => {
      if (!item) {
        setSyncFailed(true)
        showToast('기사를 보드에 추가하지 못했어요.', { tone: 'err', action: { label: '다시 시도', run: () => addArticle(article, at.x, at.y) } })
        return
      }
      setSelectedId(item.id)
      showToast(dup ? '이 보드에 이미 있는 기사예요. 카드를 한 장 더 추가했어요.' : '보드에 기사를 추가했어요.', { tone: dup ? 'info' : 'ok' })
    })
  }

  // ---------- 사진 카드 (F-05, S3) ----------
  const photoInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  /** 사진을 S3에 올린 뒤 그 key로 카드를 만든다. x·y가 없으면 화면 가운데 */
  const addPhoto = async (file: File, x?: number, y?: number) => {
    if (locked || uploading) return
    const problem = checkPhoto(file)
    if (problem) return showToast(problem, { tone: 'err' })
    const at = x === undefined || y === undefined ? viewCenter() : { x: Math.round(x), y: Math.round(y) }
    const retry = { label: '다시 시도', run: () => void addPhoto(file, at.x, at.y) }
    setUploading(true)
    showToast('사진을 올리는 중이에요…', { tone: 'info' })
    try {
      const imageKey = await uploadPhoto(boardId, file)
      const preview = URL.createObjectURL(file)
      const item = await board.addCard({ type: 'photo', imageKey, content: '', preview }, at.x, at.y, { quiet: true })
      // 저장된 카드는 서버 주소로 다시 그리므로 미리보기는 잠시 뒤 정리
      setTimeout(() => URL.revokeObjectURL(preview), 30_000)
      if (!item) return showToast('사진 카드를 추가하지 못했어요.', { tone: 'err', action: retry })
      setSelectedId(item.id)
      showToast('사진 카드를 추가했어요. 수정을 눌러 설명을 달 수 있어요.', { tone: 'ok' })
    } catch (error) {
      const message = error instanceof ApiError || error instanceof PhotoUploadError ? error.message : '사진을 올리지 못했어요.'
      showToast(message, { tone: 'err', action: retry })
    } finally {
      setUploading(false)
    }
  }

  // ---------- 메모 (카드 안에서 편집, B9) ----------
  const addMemo = () => {
    if (locked || memoEdit?.saving) return
    const c = viewCenter()
    setDraftAt(c)
    setSelectedId(DRAFT_MEMO_ID)
    setTool('select')
    setMemoEdit({ id: DRAFT_MEMO_ID, text: '', saving: false, error: null, session: ++memoSession.current })
  }
  const editMemo = (id: string) => {
    if (locked || memoEdit?.saving) return
    const item = board.items.find((i) => i.id === id)
    setDraftAt(null)
    setMemoEdit({ id, text: item?.content ?? '', saving: false, error: null, session: ++memoSession.current })
  }
  const cancelMemo = () => {
    if (memoEdit?.saving) return // 저장 중에는 취소·다른 편집으로 넘어가지 않는다 (입력도 잠금)
    if (memoEdit?.id === DRAFT_MEMO_ID) setSelectedId(null)
    setMemoEdit(null)
    setDraftAt(null)
  }
  const saveMemo = async () => {
    if (!memoEdit || memoEdit.saving) return
    const text = memoEdit.text.trim()
    // 사진 설명은 비워도 된다 (메모는 내용이 있어야 함)
    const isPhoto = board.items.find((i) => i.id === memoEdit.id)?.type === 'photo'
    if (!text && !isPhoto) return setMemoEdit({ ...memoEdit, error: 'empty' })
    const session = memoEdit.session
    setMemoEdit({ ...memoEdit, saving: true, error: null })
    // 결과는 시작한 편집 세션에만 적용한다
    const settle = (ok: boolean) =>
      setMemoEdit((m) => (m?.session !== session ? m : ok ? null : { ...m, saving: false, error: 'fail' }))
    if (memoEdit.id === DRAFT_MEMO_ID && draftAt) {
      const item = await board.addCard({ type: 'memo', content: text }, draftAt.x, draftAt.y)
      settle(Boolean(item))
      if (item) {
        setDraftAt(null)
        setSelectedId(item.id)
      }
      return
    }
    settle(await board.updateMemo(memoEdit.id, text))
  }

  const deleteCard = async (id: string) => {
    if (memoEdit?.id === id) setMemoEdit(null)
    const ok = await board.deleteCard(id)
    if (ok) {
      setSelectedId((s) => (s === id ? null : s))
      showToast('카드를 삭제했어요.', { tone: 'ok' })
    }
  }

  // ---------- 연결선 (F-10, A1) ----------
  const toggleConnectMode = () => {
    setConnectMode((on) => !on)
    setConnectFrom(null)
    setSelectedId(null)
    setSelectedConnectionId(null)
  }
  /** 첫 카드를 고르고, 두 번째 카드를 누르면 잇는다 (같은 카드를 다시 누르면 고르기 취소) */
  const pickCard = (id: string) => {
    if (!connectFrom) return setConnectFrom(id)
    if (connectFrom === id) return setConnectFrom(null)
    const from = connectFrom
    setConnectFrom(null)
    void board.addConnection(from, id).then((ok) => ok && showToast('카드를 연결했어요.', { tone: 'ok' }))
  }

  // ---------- AI로 정리 (F-08, B13) ----------
  const analyze = async () => {
    openRight({ kind: 'ai' })
    if (aiCards.length < 2 || locked) return
    setAiState('analyzing')
    setHighlightId(null)
    try {
      const result = await board.analyze()
      setAnalyzedIds(new Set(aiCards.map((a) => a.id)))
      setClusterRemaining(result.remaining)
      setAiState('idle')
    } catch (error) {
      setAiState('fail')
      if (error instanceof ApiError && error.status === 429) showToast(error.message, { tone: 'err' })
      clusterQuota(boardId)
        .then(setClusterRemaining)
        .catch(() => {})
    }
  }
  const openAi = () => {
    if (right?.kind === 'ai') return setRight(null)
    openRight({ kind: 'ai' })
    if (board.clusters.length === 0 && analyzedIds === null && aiCards.length >= 2) void analyze()
  }
  const arrangeAll = async (action: 'arrange' | 'restore') => {
    setAiBusy(true)
    const byId = new Map(board.items.map((i) => [i.id, i]))
    const results: ArrangeResult[] = []
    for (const cluster of board.clusters) {
      const members = cluster.itemIds.map((id) => byId.get(id)).filter(Boolean) as ViewItem[]
      const need = action === 'arrange' ? members.some((i) => !i.arranged) : members.some((i) => i.arranged)
      if (need) results.push(await board.arrange(cluster.id, action))
    }
    setAiBusy(false)
    const outcome = arrangeOutcome(results, action)
    if (outcome) showToast(outcome.text, { tone: outcome.tone })
    if (outcome?.tone === 'err') setSyncFailed(true)
    if (results.some((r) => r.ok && r.moved > 0)) setTimeout(() => setView(fitView(board.items, heights, size.width, size.height)), 60)
  }
  const dismissAll = async () => {
    for (const cluster of board.clusters) await board.dismiss(cluster.id)
    setHighlightId(null)
    setAnalyzedIds(null)
    setRight(null)
  }
  const onClusterAction = async (clusterId: string, action: ClusterAction) => {
    if (action === 'dismiss') return void board.dismiss(clusterId)
    const outcome = arrangeOutcome([await board.arrange(clusterId, action)], action)
    if (outcome && outcome.tone !== 'ok') showToast(outcome.text, { tone: outcome.tone })
    if (outcome?.tone === 'err') setSyncFailed(true)
  }
  const highlight = useMemo(() => {
    const cluster = highlightId ? board.clusters.find((c) => c.id === highlightId) : null
    return right?.kind === 'ai' && cluster ? new Set(cluster.itemIds) : null
  }, [highlightId, board.clusters, right])

  /** 질의응답 출처 → 그 카드를 선택하고 지금 배율 그대로 화면 가운데로 (F-12) */
  const showCard = (itemId: string) => {
    const item = board.items.find((i) => i.id === itemId)
    if (!item) return false
    setConnectMode(false)
    setConnectFrom(null)
    setSelectedConnectionId(null)
    setSelectedId(item.id)
    setView((v) => centerOn(v, item.x, item.y, size.width, size.height))
    return true
  }

  // ---------- 키보드 ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [role=dialog]')) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedConnectionId) {
        e.preventDefault()
        void board.deleteConnection(selectedConnectionId)
        setSelectedConnectionId(null)
      }
      if (e.key === 'Escape') {
        setSelectedId(null)
        setSelectedConnectionId(null)
        setConnectMode(false)
        setConnectFrom(null)
        setSrcOpen(false)
        setMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedConnectionId, board])

  // 머리글 팝오버는 바깥을 누르면 닫는다
  useEffect(() => {
    if (!srcOpen && !menuOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (srcOpen && srcRef.current && !srcRef.current.contains(t)) setSrcOpen(false)
      if (menuOpen && menuRef.current && !menuRef.current.contains(t)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [srcOpen, menuOpen])

  const items: ViewItem[] = useMemo(() => {
    if (!draftAt || memoEdit?.id !== DRAFT_MEMO_ID) return board.items
    const draft: ViewItem = {
      id: DRAFT_MEMO_ID,
      type: 'memo',
      articleId: null,
      article: null,
      content: '',
      imageKey: null,
      x: draftAt.x,
      y: draftAt.y,
      rotation: 0,
      zIndex: Number.MAX_SAFE_INTEGER - 1,
      createdBy: user?.id ?? null,
      updatedAt: '',
      version: 0,
      arranged: false,
      pending: false,
    }
    return [...board.items, draft]
  }, [board.items, draftAt, memoEdit?.id, user?.id])

  // 보드가 지워졌거나 내보내졌을 때는 화면 위에 잠금 안내를 띄운다 (B11)
  const gone = board.status === 'gone'

  const sync = gone
    ? { text: '보드를 열 수 없어요', tone: 'err' }
    : board.status === 'connecting'
      ? { text: '보드 상태 확인 중', tone: 'wait' }
      : board.status === 'reconnecting'
        ? { text: '연결이 끊겼어요 · 다시 연결 중', tone: 'warn' }
        : board.saving
          ? { text: '변경 저장 중', tone: 'wait' }
          : syncFailed
            ? { text: '변경을 저장하지 못했어요', tone: 'err' }
            : { text: '동기화됨', tone: 'ok' }

  const diversity = useMemo(() => sourceDiversity(board.items), [board.items])
  const detailItem = right?.kind === 'detail' ? board.items.find((i) => i.id === right.itemId) : undefined
  const rightTitle = right?.kind === 'ai' ? 'AI 정리' : right?.kind === 'ask' ? '보드에 질문하기' : '기사 미리보기'

  return (
    <div className="board">
      <header className="board__header">
        <Link to="/" className="icon-btn" aria-label="내 보드로 돌아가기" title="내 보드로 돌아가기">
          <Icon name="back" />
        </Link>
        <div className="board__titles">
          <h1 title={board.title}>{board.title || '보드'}</h1>
          {board.role && <span className={`badge${owner ? '' : ' badge--neutral'}`}>{ROLE_LABEL[board.role]}</span>}
          <span className={`board__sync board__sync--${sync.tone}`} role="status" aria-live="polite">
            <span className="status-dot" aria-hidden="true" />
            {sync.text}
          </span>
        </div>
        <div className="board__actions">
          <DigestLink className="board__digest" />
          <div className="board__pop" ref={srcRef}>
            <button
              type="button"
              className={`board__head-btn${srcOpen ? ' board__head-btn--on' : ''}`}
              onClick={() => setSrcOpen((v) => !v)}
              aria-expanded={srcOpen}
              title="보드 기사들의 언론사 구성"
            >
              <Icon name="bars" />
              출처 분포
            </button>
            {srcOpen && (
              <div className="board__popover" role="dialog" aria-label="출처 분포">
                <div className="board__popover-head">
                  <b>출처 분포</b>
                  <span>기사 {diversity?.total ?? articles.length}건</span>
                </div>
                {!diversity ? (
                  <p className="board__popover-text">기사를 조금 더 모으면 출처 분포를 확인할 수 있어요.</p>
                ) : (
                  <>
                    <ul className="source-rows">
                      {diversity.sources.slice(0, 6).map((s) => (
                        <li key={s.source}>
                          <div>
                            <b>{s.source}</b>
                            <span>
                              {s.count}건 · {Math.round(s.ratio * 100)}%
                            </span>
                          </div>
                          <div className="source-rows__bar" aria-hidden="true">
                            <span style={{ width: `${Math.round(s.ratio * 100)}%` }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                    {diversity.sources.length > 6 && <span className="board__popover-text">그 외 {diversity.sources.length - 6}곳</span>}
                    {diversity.skewedTo && (
                      <p className="notice notice--warn board__popover-warn">
                        {diversity.skewedTo} 기사가 절반 이상이에요. 다른 언론사 시각도 함께 살펴보세요.
                      </p>
                    )}
                    <p className="board__popover-note">보드의 기사 카드 기준이에요. 기사 내용이나 언론사를 평가하지 않아요.</p>
                  </>
                )}
              </div>
            )}
          </div>
          <button type="button" className="board__head-btn" onClick={() => setDialog('members')}>
            <Icon name="users" />
            참여자 {board.members.length}명
          </button>
          {owner && (
            <button type="button" className="btn btn--sm" onClick={() => setDialog('members')}>
              초대
            </button>
          )}
          <div className="board__pop" ref={menuRef}>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="보드 메뉴"
              title="보드 메뉴"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={!board.role}
            >
              <Icon name="more" />
            </button>
            {menuOpen && (
              <div className="menu board__menu" role="menu">
                {owner ? (
                  <>
                    <button type="button" role="menuitem" className="menu__item" onClick={() => (setMenuOpen(false), setDialog('rename'))}>
                      이름 변경
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="menu__item menu__item--danger"
                      onClick={() => (setMenuOpen(false), setDialog('delete'))}
                    >
                      보드 삭제
                    </button>
                  </>
                ) : (
                  <button type="button" role="menuitem" className="menu__item" onClick={() => (setMenuOpen(false), setDialog('leave'))}>
                    보드 나가기
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {vw < MIN_WIDTH ? (
        <div className="board__narrow">
          <h2>보드는 넓은 화면에서 편집할 수 있어요.</h2>
          <p>데스크톱 브라우저에서 열어 주세요.</p>
          <Link className="btn btn--ghost" to="/">
            내 보드로
          </Link>
        </div>
      ) : (
        <div className="board__body">
          {newsOpen && (
            <FeedPanel
              onAdd={(article) => addArticle(article)}
              onOpen={(article) => openRight({ kind: 'feed', article })}
              onCollapse={toggleNews}
              locked={locked}
              now={now}
            />
          )}

          <section className="board__canvas" aria-label="보드 캔버스">
            {board.status === 'connecting' && (
              <div className="board__loading" role="status">
                보드를 불러오는 중…
              </div>
            )}
            <BoardCanvas
              items={items}
              members={members}
              view={view}
              onViewChange={setView}
              onSize={onSize}
              heights={heights}
              onHeight={onHeight}
              tool={tool}
              locked={locked}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id)
                if (memoEdit && id !== memoEdit.id) cancelMemo()
              }}
              onMoveEnd={(id, x, y) => void board.moveCard(id, x, y)}
              onRotateEnd={(id, rotation) => {
                const item = board.items.find((i) => i.id === id)
                if (item) void board.moveCard(id, item.x, item.y, rotation)
              }}
              onDragMove={board.dragCard}
              onDropArticle={(article, x, y) => addArticle(article, x, y)}
              onDropPhoto={(file, x, y) => void addPhoto(file, x, y)}
              photoSrc={(item) => `/api/boards/${boardId}/items/${item.id}/photo`}
              onDetail={(id) => openRight({ kind: 'detail', itemId: id })}
              onEditMemo={editMemo}
              onDeleteCard={(id) => void deleteCard(id)}
              memoEdit={memoEdit}
              onMemoChange={(text) => setMemoEdit((m) => m && { ...m, text, error: null })}
              onMemoSave={() => void saveMemo()}
              onMemoCancel={cancelMemo}
              highlight={highlight}
              clusters={board.clusters}
              onClusterAction={(id, action) => void onClusterAction(id, action)}
              connections={board.connections}
              selectedConnectionId={selectedConnectionId}
              onSelectConnection={(id) => {
                setSelectedConnectionId(id)
                if (id) setSelectedId(null)
              }}
              onDeleteConnection={(id) => {
                setSelectedConnectionId(null)
                void board.deleteConnection(id).then((ok) => ok && showToast('연결선을 지웠어요.', { tone: 'ok' }))
              }}
              connectMode={connectMode}
              connectFrom={connectFrom}
              onPickCard={pickCard}
              now={now}
            />

            {board.status === 'ready' && board.items.length === 0 && !draftAt && (
              <div className="board__empty">
                <div>
                  <h2>아직 자료가 없어요.</h2>
                  <p>왼쪽 뉴스에서 기사를 추가하거나 메모로 생각을 남겨 보세요.</p>
                </div>
              </div>
            )}

            <div className="board__top" data-ui>
              {!newsOpen && (
                <button type="button" className="board__news-btn" onClick={toggleNews}>
                  <Icon name="panel" />
                  뉴스
                </button>
              )}
              <div className="toolbar" role="toolbar" aria-label="보드 도구">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setTool('select')}
                  aria-label="선택"
                  title="선택 (카드 이동)"
                  aria-pressed={tool === 'select'}
                >
                  <Icon name="cursor" />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setTool('pan')}
                  aria-label="화면 이동"
                  title="화면 이동 (빈 곳 드래그로도 이동)"
                  aria-pressed={tool === 'pan'}
                >
                  <Icon name="hand" />
                </button>
                <span className="toolbar__sep" aria-hidden="true" />
                <button type="button" className="toolbar__btn" onClick={addMemo} disabled={locked}>
                  <Icon name="memo" />
                  메모
                </button>
                <button type="button" className="toolbar__btn" onClick={() => setDialog('link')} disabled={locked}>
                  <Icon name="link" />
                  링크
                </button>
                <button
                  type="button"
                  className="toolbar__btn"
                  onClick={() => photoInput.current?.click()}
                  disabled={locked || uploading}
                  aria-busy={uploading}
                  title="jpg·png·webp, 10MB 이하 (보드에 사진 파일을 끌어다 놓아도 돼요)"
                >
                  <Icon name="image" />
                  {uploading ? '올리는 중…' : '사진'}
                </button>
                <input
                  ref={photoInput}
                  type="file"
                  accept={PHOTO_ACCEPT}
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = '' // 같은 파일을 다시 골라도 onChange가 오도록
                    if (file) void addPhoto(file)
                  }}
                />
                <button
                  type="button"
                  className={`toolbar__btn${connectMode ? ' toolbar__btn--on' : ''}`}
                  onClick={toggleConnectMode}
                  disabled={locked}
                  aria-pressed={connectMode}
                  title="두 카드를 차례로 눌러 잇기"
                >
                  <Icon name="connect" />
                  연결선
                </button>
                <span className="toolbar__sep" aria-hidden="true" />
                <button
                  type="button"
                  className={`toolbar__btn toolbar__btn--ai${right?.kind === 'ai' ? ' toolbar__btn--on' : ''}`}
                  onClick={openAi}
                  disabled={locked}
                  aria-pressed={right?.kind === 'ai'}
                >
                  <Icon name="group" />
                  AI로 정리
                </button>
                <button
                  type="button"
                  className={`toolbar__btn toolbar__btn--ai${right?.kind === 'ask' ? ' toolbar__btn--on' : ''}`}
                  onClick={() => (right?.kind === 'ask' ? setRight(null) : openRight({ kind: 'ask' }))}
                  aria-pressed={right?.kind === 'ask'}
                >
                  <Icon name="ask" />
                  질문하기
                </button>
              </div>
            </div>

            {connectMode && (
              <div className="board__mode" role="status" data-ui>
                {connectFrom ? '이을 카드를 누르세요' : '연결할 첫 카드를 누르세요'} · Esc로 그만두기 · 이은 선은 그만둔 뒤 선을 눌러 지울 수 있어요
                <button type="button" className="text-btn" onClick={toggleConnectMode}>
                  그만두기
                </button>
              </div>
            )}

            {board.status === 'reconnecting' && (
              <div className="board__offline" role="alert" data-ui>
                <Icon name="alert" />
                <span>연결이 끊겼어요. 다시 연결하는 동안에는 편집할 수 없어요. 연결되면 저장된 보드 상태로 맞춰요.</span>
                <button type="button" className="btn btn--ghost btn--xs" onClick={board.reconnect}>
                  다시 연결
                </button>
              </div>
            )}

            <div className="board__hint" data-ui>
              빈 곳을 끌어 화면 이동 · Ctrl + 스크롤로 확대
            </div>
            <div className="zoom" role="group" aria-label="확대·축소" data-ui>
              <button type="button" className="icon-btn" onClick={fit} aria-label="화면에 맞추기" title="화면에 맞추기">
                <Icon name="fit" />
              </button>
              <span className="zoom__sep" aria-hidden="true" />
              <button type="button" className="icon-btn" onClick={() => zoomBy(1 / ZOOM_STEP)} aria-label="축소" title="축소">
                <Icon name="minus" />
              </button>
              <span className="zoom__pct" aria-live="polite">
                {Math.round(view.scale * 100)}%
              </span>
              <button type="button" className="icon-btn" onClick={() => zoomBy(ZOOM_STEP)} aria-label="확대" title="확대">
                <Icon name="plus" />
              </button>
            </div>
          </section>

          {right && (
            <SidePanel
              title={rightTitle}
              onClose={() => {
                setRight(null)
                setHighlightId(null)
              }}
            >
              {right.kind === 'detail' &&
                (detailItem && itemDetail(detailItem) ? (
                  <ArticleDetail article={itemDetail(detailItem)!} />
                ) : (
                  <div className="side__body">이미 삭제된 카드예요.</div>
                ))}
              {right.kind === 'feed' && (
                <ArticleDetail article={feedDetail(right.article)} onAdd={() => addArticle(right.article)} locked={locked} />
              )}
              {right.kind === 'ai' && (
                <AiPanel
                  state={aiState}
                  clusters={board.clusters}
                  articles={aiCards}
                  analyzedIds={analyzedIds}
                  highlightId={highlightId}
                  onToggle={(id) => setHighlightId((h) => (h === id ? null : id))}
                  onAnalyze={() => void analyze()}
                  onArrangeAll={() => void arrangeAll('arrange')}
                  onRestoreAll={() => void arrangeAll('restore')}
                  onDismissAll={() => void dismissAll()}
                  busy={aiBusy}
                  locked={locked}
                  remaining={clusterRemaining}
                />
              )}
              {right.kind === 'ask' && <AskPanel boardId={boardId} onShowCard={showCard} hasArticles={articles.length > 0} />}
            </SidePanel>
          )}
        </div>
      )}

      {gone && (
        <div className="modal-backdrop">
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="gone-title">
            <h2 id="gone-title" className="modal__title">
              {board.goneReason ?? '보드를 열 수 없어요.'}
            </h2>
            <p className="dialog-text">
              {board.goneReason?.includes('삭제')
                ? '소유자가 보드를 삭제했어요. 보드의 카드와 자료도 함께 사라졌어요.'
                : board.goneReason?.includes('내보내')
                  ? '이 보드를 더 이상 볼 수 없어요. 다시 참여하려면 소유자에게 초대 링크를 요청해 주세요.'
                  : '삭제되었거나 접근할 수 없는 보드예요. 필요하면 보드 소유자에게 초대 링크를 요청해 주세요.'}
            </p>
            <div className="modal__actions">
              <button type="button" className="btn" data-autofocus onClick={() => navigate('/', { replace: true })}>
                내 보드로 이동
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog === 'rename' && (
        <BoardNameDialog
          mode="rename"
          boardId={boardId}
          initial={board.title}
          onClose={() => setDialog(null)}
          onRenamed={() => {
            setDialog(null)
            showToast('보드 이름을 바꿨어요.', { tone: 'ok' })
          }}
        />
      )}
      {dialog === 'delete' && (
        <DeleteBoardDialog
          boardId={boardId}
          title={board.title}
          cardCount={board.items.length}
          memberCount={board.members.length}
          onClose={() => setDialog(null)}
          onDeleted={() => navigate('/', { replace: true })}
        />
      )}
      {dialog === 'leave' && user && (
        <LeaveBoardDialog
          boardId={boardId}
          userId={user.id}
          title={board.title}
          onClose={() => setDialog(null)}
          onLeft={() => navigate('/', { replace: true })}
        />
      )}
      {dialog === 'members' && board.role && (
        <MembersDialog
          boardId={boardId}
          title={board.title}
          role={board.role}
          members={board.members}
          onClose={() => setDialog(null)}
          onMessage={(text, tone) => showToast(text, { tone })}
        />
      )}
      {dialog === 'link' && (
        <LinkDialog
          boardId={boardId}
          remaining={linkRemaining}
          onClose={() => setDialog(null)}
          onAdd={async (url) => {
            const at = viewCenter()
            try {
              const item = await board.addLink(url, at.x, at.y)
              setSelectedId(item.id)
              showToast('링크 기사를 보드에 추가했어요.', { tone: 'ok' })
              linkQuota(boardId)
                .then(setLinkRemaining)
                .catch(() => {})
              return true
            } catch (e) {
              showToast(e instanceof ApiError ? e.message : '기사를 추가하지 못했어요.', { tone: 'err' })
              return false
            }
          }}
        />
      )}
      {toast.view}
    </div>
  )
}

