import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { formatRelativeTime } from '../feed/merge'
import { AppHeader } from '../ui/AppHeader'
import { useNow, useToast } from '../ui/hooks'
import { Icon } from '../ui/Icon'
import { listBoards } from './api'
import { BoardNameDialog, DeleteBoardDialog, LeaveBoardDialog } from './BoardDialogs'
import { ROLE_LABEL } from './roles'
import type { BoardSummary } from './types'
import './BoardListPage.css'

type Dialog = { kind: 'new' } | { kind: 'rename' | 'delete' | 'leave'; board: BoardSummary }

/** 카드 배치를 썸네일 안 비율 좌표로 (프로토타입 보드 목록의 미리보기) */
function thumbLayout(items: BoardSummary['thumb']) {
  if (items.length === 0) return []
  const xs = items.map((i) => i.x)
  const ys = items.map((i) => i.y)
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  const spanX = Math.max(Math.max(...xs) - x0, 1)
  const spanY = Math.max(Math.max(...ys) - y0, 1)
  return items.map((i) => ({
    left: `${(5 + ((i.x - x0) / spanX) * 76).toFixed(1)}%`,
    top: `${(8 + ((i.y - y0) / spanY) * 62).toFixed(1)}%`,
    memo: i.type === 'memo',
  }))
}

/** 내 보드 (F-06·F-07): 최근 수정순 목록, 이름 검색, 소유자는 이름 변경·삭제 / 참여자는 나가기 */
export function BoardListPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const now = useNow()
  const toast = useToast()
  const [boards, setBoards] = useState<BoardSummary[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [query, setQuery] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const load = () => {
    setRetrying(true)
    return listBoards()
      .then((list) => {
        setBoards(list)
        setLoadFailed(false)
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setRetrying(false))
  }
  useEffect(() => {
    let cancelled = false
    listBoards()
      .then((list) => !cancelled && setBoards(list))
      .catch(() => !cancelled && setLoadFailed(true))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!menuFor) return
    const onDown = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenuFor(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuFor(null)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuFor])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (boards ?? []).filter((b) => !q || b.title.toLowerCase().includes(q))
  }, [boards, query])

  const has = (boards?.length ?? 0) > 0
  const retryLabel = retrying ? '불러오는 중…' : '다시 시도'

  return (
    <div className="dash">
      <AppHeader />
      <main className="dash__body">
        <div className="dash__head">
          <div className="dash__heading">
            <h1>내 보드</h1>
            <p>함께 모은 자료를 이어서 정리해 보세요.</p>
          </div>
          {has && (
            <div className="search dash__search">
              <Icon name="search" />
              <input
                className="input input--sm"
                aria-label="보드 이름 검색"
                placeholder="보드 이름 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          <button type="button" className="btn" onClick={() => setDialog({ kind: 'new' })}>
            <Icon name="plus" />새 보드 만들기
          </button>
        </div>

        {/* 이미 목록이 있는데 새로 불러오기만 실패하면 마지막 목록을 보여 주며 알린다 */}
        {loadFailed && boards !== null && (
          <div className="dash__banner" role="alert">
            <Icon name="alert" />
            <span>목록을 새로 불러오지 못했어요. 마지막으로 불러온 목록을 보여 드리고 있어요.</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void load()} disabled={retrying}>
              {retryLabel}
            </button>
          </div>
        )}

        {boards === null && !loadFailed && (
          <div className="dash__grid" aria-busy="true" aria-label="보드 목록을 불러오는 중">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="board-card board-card--skeleton">
                <div className="board-card__thumb skeleton" />
                <div className="board-card__body">
                  <div className="skeleton" style={{ height: 16, width: '70%' }} />
                  <div className="skeleton" style={{ height: 12, width: '45%' }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {boards === null && loadFailed && (
          <div className="empty-state" role="alert">
            <span className="dash__error-icon">
              <Icon name="alert" />
            </span>
            <h2>보드 목록을 불러오지 못했어요.</h2>
            <p>잠시 후 다시 시도해 주세요.</p>
            <button type="button" className="btn btn--ghost" onClick={() => void load()} disabled={retrying}>
              {retryLabel}
            </button>
          </div>
        )}

        {boards?.length === 0 && (
          <div className="empty-state dash__empty">
            <div className="dash__empty-art" aria-hidden="true">
              <div />
              <div />
              <div />
            </div>
            <h2>첫 리서치 보드를 만들어 보세요.</h2>
            <p>뉴스와 메모를 모아 팀의 생각을 정리할 수 있어요.</p>
            <div className="dash__empty-actions">
              <button type="button" className="btn" onClick={() => setDialog({ kind: 'new' })}>
                새 보드 만들기
              </button>
              <Link className="text-btn" to="/feed">
                뉴스 둘러보기
              </Link>
            </div>
          </div>
        )}

        {has && (
          <>
            <div className="dash__count">
              <span>{query.trim() ? `${shown.length}개 찾음` : `보드 ${boards!.length}개`}</span>
              <span>최근 수정순</span>
            </div>
            {shown.length === 0 && <div className="dash__nomatch">이름이 일치하는 보드가 없어요.</div>}
            <div className="dash__grid">
              {shown.map((board) => {
                const thumbs = thumbLayout(board.thumb)
                const owner = board.role === 'owner'
                return (
                  <div key={board.id} className="board-card">
                    <Link to={`/boards/${board.id}`} className="board-card__open">
                      <div className="board-card__thumb" aria-hidden="true">
                        {thumbs.map((t, i) => (
                          <span
                            key={i}
                            className={`board-card__chip${t.memo ? ' board-card__chip--memo' : ''}`}
                            style={{ left: t.left, top: t.top }}
                          />
                        ))}
                        {thumbs.length === 0 && <span className="board-card__empty">아직 자료가 없어요</span>}
                      </div>
                      <div className="board-card__body">
                        <span className="board-card__title" title={board.title}>
                          {board.title}
                        </span>
                        <div className="board-card__meta">
                          <span className={`badge${owner ? '' : ' badge--neutral'}`}>{ROLE_LABEL[board.role]}</span>
                          <span>
                            카드 {board.itemCount}개 · 참여자 {board.memberCount}명
                          </span>
                        </div>
                        <span className="board-card__updated">{formatRelativeTime(board.updatedAt, now)} 수정</span>
                      </div>
                    </Link>
                    <div ref={menuFor === board.id ? menuRef : undefined}>
                      <button
                        type="button"
                        className="icon-btn board-card__more"
                        onClick={() => setMenuFor(menuFor === board.id ? null : board.id)}
                        aria-label="보드 메뉴"
                        title="보드 메뉴"
                        aria-haspopup="menu"
                        aria-expanded={menuFor === board.id}
                      >
                        <Icon name="more" />
                      </button>
                      {menuFor === board.id && (
                        <div className="menu board-card__menu" role="menu">
                          {owner ? (
                            <>
                              <button
                                type="button"
                                role="menuitem"
                                className="menu__item"
                                onClick={() => {
                                  setMenuFor(null)
                                  setDialog({ kind: 'rename', board })
                                }}
                              >
                                이름 변경
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="menu__item menu__item--danger"
                                onClick={() => {
                                  setMenuFor(null)
                                  setDialog({ kind: 'delete', board })
                                }}
                              >
                                보드 삭제
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              role="menuitem"
                              className="menu__item"
                              onClick={() => {
                                setMenuFor(null)
                                setDialog({ kind: 'leave', board })
                              }}
                            >
                              보드 나가기
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </main>

      {dialog?.kind === 'new' && (
        <BoardNameDialog
          mode="new"
          onClose={() => setDialog(null)}
          onCreated={(board) => {
            toast.show('새 보드를 만들었어요.', { tone: 'ok' })
            navigate(`/boards/${board.id}`)
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <BoardNameDialog
          mode="rename"
          boardId={dialog.board.id}
          initial={dialog.board.title}
          onClose={() => setDialog(null)}
          onRenamed={(title) => {
            setBoards((list) => (list ?? []).map((b) => (b.id === dialog.board.id ? { ...b, title } : b)))
            setDialog(null)
            toast.show('보드 이름을 바꿨어요.', { tone: 'ok' })
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteBoardDialog
          boardId={dialog.board.id}
          title={dialog.board.title}
          cardCount={dialog.board.itemCount}
          memberCount={dialog.board.memberCount}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setBoards((list) => (list ?? []).filter((b) => b.id !== dialog.board.id))
            setDialog(null)
            toast.show('보드를 삭제했어요.', { tone: 'ok' })
          }}
        />
      )}
      {dialog?.kind === 'leave' && user && (
        <LeaveBoardDialog
          boardId={dialog.board.id}
          userId={user.id}
          title={dialog.board.title}
          onClose={() => setDialog(null)}
          onLeft={() => {
            setBoards((list) => (list ?? []).filter((b) => b.id !== dialog.board.id))
            setDialog(null)
            toast.show('보드에서 나갔어요.', { tone: 'ok' })
          }}
        />
      )}
      {toast.view}
    </div>
  )
}
