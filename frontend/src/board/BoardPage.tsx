import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ApiError } from '../api/client'
import type { FeedArticle } from '../feed/types'
import { useNow, useToast } from '../ui/hooks'
import { clusterQuota, getInvite, inviteUrl, linkQuota, reissueInvite, type Invite } from './api'
import { BoardCanvas, type ClusterAction } from './BoardCanvas'
import { BoardMenu, MembersButton } from './BoardManage'
import { MEMO, MEMO_FONT, clearMeasureCache, fitView, toBoard, zoomAtCenter, type View } from './cardLayout'
import { FeedPanel } from './FeedPanel'
import { useBoardSync, type BoardStatus } from './useBoardSync'
import './BoardPage.css'

type ZoomMode = 'fit' | 0.8 | 1 | 'custom'

const STATUS_TEXT: Record<Exclude<BoardStatus, 'gone'>, string> = {
  connecting: '불러오는 중…',
  ready: '자동 저장됨',
  reconnecting: '연결 끊김 — 다시 연결하는 중',
}

/** 협업 보드 화면 (F-05). 디자인 목업의 협업 보드 · 캔버스 variant A(여유) */
export function BoardPage() {
  const { boardId = '' } = useParams()
  const toast = useToast()
  const board = useBoardSync(boardId, { onError: toast.show })
  const now = useNow(30_000)

  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit')
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [fontsVersion, setFontsVersion] = useState(0)
  const [linkRemaining, setLinkRemaining] = useState<number | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [clusterRemaining, setClusterRemaining] = useState<number | null>(null)

  useEffect(() => {
    clusterQuota(boardId)
      .then(setClusterRemaining)
      .catch(() => setClusterRemaining(null))
  }, [boardId])

  useEffect(() => {
    linkQuota(boardId)
      .then(setLinkRemaining)
      .catch(() => setLinkRemaining(null))
  }, [boardId])

  const members = useMemo(() => new Map(board.members.map((m) => [m.userId, m])), [board.members])

  // 글꼴이 로드되면 글자 크기를 다시 잰다 (Konva는 캔버스에 직접 그려서 글꼴 로드를 스스로 알지 못함)
  useEffect(() => {
    let cancelled = false
    void document.fonts?.ready.then(() => {
      if (cancelled) return
      clearMeasureCache()
      setFontsVersion((v) => v + 1)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 처음 들어왔을 때와 "맞춤"일 때 카드가 모두 보이게 맞춘다
  const fittedOnce = useRef(false)
  useEffect(() => {
    if (board.status !== 'ready' || !canvasSize.width) return
    if (zoomMode === 'fit' && (!fittedOnce.current || fontsVersion)) {
      fittedOnce.current = true
      setView(fitView(board.items, canvasSize.width, canvasSize.height))
    }
    // 카드가 바뀔 때마다 다시 맞추지는 않는다 (보고 있던 화면이 움직이지 않도록)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.status, canvasSize, fontsVersion])

  const onSize = useCallback((width: number, height: number) => setCanvasSize({ width, height }), [])

  const setZoom = (mode: ZoomMode) => {
    setZoomMode(mode)
    if (mode === 'fit') setView(fitView(board.items, canvasSize.width, canvasSize.height))
    else if (mode !== 'custom') setView((v) => zoomAtCenter(v, mode, canvasSize.width, canvasSize.height))
  }

  /** 지금 보고 있는 화면 가운데 근처 (겹치지 않게 조금씩 흩뜨림) */
  const viewCenter = () => {
    const c = toBoard(view, canvasSize.width / 2, canvasSize.height / 2)
    return { x: Math.round(c.x + (Math.random() - 0.5) * 120), y: Math.round(c.y + (Math.random() - 0.5) * 90) }
  }

  const addArticle = (article: FeedArticle, x?: number, y?: number) => {
    const at = x === undefined || y === undefined ? viewCenter() : { x: Math.round(x), y: Math.round(y) }
    void board.addCard({ type: 'article', article }, at.x, at.y).then((item) => {
      if (item) {
        setSelectedId(item.id)
        toast.show('보드에 카드가 추가되었습니다')
      }
    })
  }

  /** 링크 요약 카드는 지금 보는 화면 가운데에 놓는다 */
  const submitLink = async (url: string) => {
    const at = viewCenter()
    try {
      const result = await board.addLink(url, at.x, at.y)
      setLinkRemaining(result.remaining)
      setSelectedId(result.item.id)
      toast.show(
        result.reused
          ? '이미 저장된 기사를 카드로 추가했습니다'
          : result.summarized
            ? 'AI 요약 카드를 추가했습니다'
            : '본문을 읽지 못해 페이지 설명으로 카드를 만들었습니다',
      )
    } catch (error) {
      linkQuota(boardId).then(setLinkRemaining).catch(() => {})
      throw error
    }
  }

  /** AI 이슈 묶기 (F-08) */
  const analyze = async () => {
    setAnalyzing(true)
    try {
      const result = await board.analyze()
      setClusterRemaining(result.remaining)
      toast.show(
        result.clusters.length === 0
          ? '아직 같은 이슈로 묶을 만한 기사가 없습니다'
          : `이슈 ${result.clusters.length}개로 묶었습니다${result.excluded ? ` (분석 못 한 기사 ${result.excluded}개)` : ''}`,
      )
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'AI 분석에 실패했습니다')
      clusterQuota(boardId).then(setClusterRemaining).catch(() => {})
    } finally {
      setAnalyzing(false)
    }
  }

  const onClusterAction = (clusterId: string, action: ClusterAction) => {
    if (action === 'dismiss') {
      void board.dismiss(clusterId).then(() => toast.show('AI 제안을 무시했습니다'))
      return
    }
    void board.arrange(clusterId, action).then((count) => {
      if (action === 'restore' && count === 0) toast.show('되돌릴 카드가 없습니다 (직접 옮긴 카드는 그 자리에 둡니다)')
    })
  }

  const articleCount = board.items.filter((i) => i.type === 'article' && !i.id.startsWith('tmp-')).length

  const addMemo = () => {
    const at = viewCenter()
    void board.addCard({ type: 'memo', content: '' }, at.x, at.y).then((item) => {
      if (item) {
        setSelectedId(item.id)
        setEditing({ id: item.id, text: '' })
      }
    })
  }

  const removeSelected = useCallback(() => {
    if (!selectedId || selectedId.startsWith('tmp-')) return
    void board.deleteCard(selectedId)
    setSelectedId(null)
  }, [selectedId, board])

  // Delete·Backspace로 선택한 카드 삭제 (입력 중일 때는 제외)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        removeSelected()
      }
      if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, removeSelected])

  const editingItem = editing ? board.items.find((i) => i.id === editing.id) : undefined
  const saveMemo = () => {
    if (!editing) return
    const current = board.items.find((i) => i.id === editing.id)
    if (current && (current.content ?? '') !== editing.text) void board.updateMemo(editing.id, editing.text)
    setEditing(null)
  }

  if (board.status === 'gone') {
    return (
      <div className="board-gone">
        <p className="serif board-gone__title">{board.goneReason ?? '보드를 열 수 없습니다'}</p>
        <Link className="btn" to="/">
          보드 목록으로
        </Link>
      </div>
    )
  }

  const statusText = board.status === 'ready' && board.saving ? '저장 중…' : STATUS_TEXT[board.status]

  return (
    <div className="board-page">
      <header className="board-header">
        <Link to="/" className="board-header__brand serif">
          모여봄
        </Link>
        <div className="board-header__divider" />
        <div className="board-header__titles">
          <h1 className="board-header__title serif">{board.title || '보드'}</h1>
          <div className={`board-header__sub${board.status === 'reconnecting' ? ' board-header__sub--warn' : ''}`}>
            공동 리서치 보드 · {statusText}
          </div>
        </div>
        <div className="board-header__spacer" />
        <MembersButton boardId={boardId} members={board.members} role={board.role} onMessage={toast.show} />
        {board.role === 'owner' && <BoardMenu boardId={boardId} title={board.title} onMessage={toast.show} />}
        {board.role === 'owner' && <InviteButton boardId={boardId} onMessage={toast.show} />}
      </header>

      <div className="board-body">
        <FeedPanel
          onAdd={(article) => addArticle(article)}
          onSubmitLink={submitLink}
          linkRemaining={linkRemaining}
          now={now}
        />

        <main className="board-main">
          <BoardCanvas
            items={board.items}
            clusters={board.clusters}
            onClusterAction={onClusterAction}
            members={members}
            view={view}
            onViewChange={(v) => {
              // 사용자가 직접 옮기거나 확대하면 "맞춤"이 풀린다 (재연결 때 화면이 다시 맞춰지며 튀지 않도록)
              setView(v)
              setZoomMode('custom')
            }}
            onSize={onSize}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMoveEnd={(id, x, y) => void board.moveCard(id, x, y)}
            onDragMove={board.dragCard}
            onDropArticle={(article, x, y) => addArticle(article, x, y)}
            onEditMemo={(id) => {
              const item = board.items.find((i) => i.id === id)
              setEditing({ id, text: item?.content ?? '' })
            }}
            fontsVersion={fontsVersion}
            now={now}
          />

          <div className="board-toolbar board-toolbar--left">
            <button type="button" onClick={addMemo} disabled={board.status !== 'ready'}>
              + 메모
            </button>
            <button type="button" onClick={removeSelected} disabled={!selectedId || selectedId.startsWith('tmp-')}>
              선택 삭제
            </button>
            <button
              type="button"
              onClick={() => void analyze()}
              disabled={board.status !== 'ready' || analyzing || articleCount < 2}
              title={
                articleCount < 2
                  ? '기사 카드가 2개 이상 있어야 합니다'
                  : clusterRemaining !== null
                    ? `오늘 남은 분석 ${clusterRemaining}회`
                    : undefined
              }
            >
              {analyzing ? 'AI 분석 중…' : 'AI 이슈 묶기'}
            </button>
          </div>
          <div className="board-toolbar board-toolbar--right">
            {(['fit', 0.8, 1] as const).map((mode) => (
              <button key={mode} type="button" className={zoomMode === mode ? 'is-on' : ''} onClick={() => setZoom(mode)}>
                {mode === 'fit' ? '맞춤' : `${mode * 100}%`}
              </button>
            ))}
          </div>
          <div className="board-hint">
            {board.status === 'connecting'
              ? '보드를 불러오는 중…'
              : board.items.length === 0
                ? '왼쪽 피드에서 기사를 끌어다 놓거나 "+ 메모"로 시작하세요'
                : '카드 드래그로 이동 · 빈 곳 드래그로 캔버스 이동 · 메모 더블클릭으로 편집'}
          </div>

          {editing && editingItem && (
            <textarea
              className="memo-editor"
              autoFocus
              maxLength={2000}
              value={editing.text}
              placeholder="메모를 입력하세요"
              style={{
                left: view.x + (editingItem.x - MEMO.width / 2) * view.scale,
                top: view.y + (editingItem.y - MEMO.height / 2) * view.scale,
                width: MEMO.width * view.scale,
                height: MEMO.height * view.scale,
                fontSize: MEMO_FONT.size * view.scale,
              }}
              onChange={(e) => setEditing({ id: editing.id, text: e.target.value })}
              onBlur={saveMemo}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(null)
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveMemo()
              }}
            />
          )}
        </main>
      </div>
      {toast.view}
    </div>
  )
}

/** owner만: 초대 링크 보기·복사·새로 발급 (F-07) */
function InviteButton({ boardId, onMessage }: { boardId: string; onMessage: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [invite, setInvite] = useState<Invite | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    getInvite(boardId)
      .then(setInvite)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : '초대 링크를 불러오지 못했습니다'))
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, boardId])

  const copy = async () => {
    if (!invite) return
    try {
      await navigator.clipboard.writeText(inviteUrl(invite.token))
      onMessage('초대 링크를 복사했습니다')
    } catch {
      onMessage('복사하지 못했습니다. 링크를 직접 선택해 복사해 주세요')
    }
  }

  const reissue = async () => {
    if (!window.confirm('새 링크를 만들면 지금 링크로는 더 이상 참여할 수 없습니다. 계속할까요?')) return
    try {
      setInvite(await reissueInvite(boardId))
      onMessage('새 초대 링크를 만들었습니다')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '새 링크를 만들지 못했습니다')
    }
  }

  return (
    <div className="invite" ref={ref}>
      <button
        type="button"
        className="btn"
        onClick={() => {
          setError(null)
          setOpen((v) => !v)
        }}
        aria-expanded={open}
      >
        + 초대
      </button>
      {open && (
        <div className="invite__panel" role="dialog" aria-label="초대 링크">
          <div className="invite__title">초대 링크</div>
          <p className="invite__desc">링크를 받은 사람은 로그인 후 이 보드에 편집자로 참여합니다.</p>
          {error && <p className="invite__error">{error}</p>}
          {invite && (
            <>
              <div className="invite__row">
                <input readOnly value={inviteUrl(invite.token)} onFocus={(e) => e.target.select()} aria-label="초대 링크 주소" />
                <button type="button" className="btn" onClick={() => void copy()}>
                  복사
                </button>
              </div>
              <div className="invite__foot">
                <span>{new Date(invite.expiresAt).toLocaleDateString('ko-KR')}까지 사용 가능</span>
                <button type="button" className="invite__reissue" onClick={() => void reissue()}>
                  새 링크 발급
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
