import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError } from '../api/client'
import { formatRelativeTime } from '../feed/merge'
import { AppHeader } from '../ui/AppHeader'
import { useNow } from '../ui/hooks'
import { createBoard, listBoards } from './api'
import type { BoardSummary } from './types'
import './BoardListPage.css'

/** 썸네일 속 카드 조각 위치 (목업 보드 목록의 chips) */
function thumbChips(count: number) {
  return Array.from({ length: Math.min(count, 9) }, (_, i) => ({
    left: `${8 + (i % 4) * 26 + (i % 2) * 5}%`,
    top: `${10 + Math.floor(i / 4) * 28}%`,
    background: i % 5 === 0 ? 'var(--color-black)' : 'rgba(255,255,255,.88)',
    transform: `rotate(${((i % 3) - 1) * 3}deg)`,
  }))
}

/** 보드 목록 (F-06). 디자인 목업 "보드 목록" 화면 */
export function BoardListPage() {
  const navigate = useNavigate()
  const now = useNow()
  const [boards, setBoards] = useState<BoardSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = () =>
    listBoards()
      .then((list) => {
        setBoards(list)
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : '보드 목록을 불러오지 못했습니다'))
  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="dash">
      <AppHeader />
      <div className="dash__body">
        <div className="dash__head">
          <div>
            <h1 className="dash__title serif">참여 중인 보드</h1>
            <p className="dash__sub">
              {boards === null
                ? '불러오는 중…'
                : boards.length === 0
                  ? '보드를 만들고 팀원을 초대해 함께 기사를 모아 보세요'
                  : `${boards.length}개의 보드에 참여하고 있습니다`}
            </p>
          </div>
          <button type="button" className="btn dash__new" onClick={() => setCreating(true)}>
            + 새 보드 만들기
          </button>
        </div>

        {error && (
          <div className="dash__error" role="alert">
            <span>{error}</span>
            <button type="button" className="btn btn--ghost" onClick={() => void load()}>
              다시 시도
            </button>
          </div>
        )}

        <div className="dash__grid">
          {boards?.map((board) => (
            <Link key={board.id} to={`/boards/${board.id}`} className="board-card">
              <div className="board-card__thumb" aria-hidden="true">
                {thumbChips(board.itemCount).map((style, i) => (
                  <span key={i} className="board-card__chip" style={style} />
                ))}
              </div>
              <div className="board-card__body">
                <div className="board-card__title serif">{board.title}</div>
                <div className="board-card__meta">
                  <span>
                    {board.role === 'owner' ? '내 보드' : '참여'} · 멤버 {board.memberCount}명 · 카드 {board.itemCount}개
                  </span>
                  <span>{formatRelativeTime(board.updatedAt, now)} 수정</span>
                </div>
              </div>
            </Link>
          ))}
          {boards !== null && (
            <button type="button" className="board-card board-card--new" onClick={() => setCreating(true)}>
              <span className="board-card__plus">+</span>
              <span>새 보드 만들기</span>
            </button>
          )}
        </div>
      </div>

      {creating && (
        <CreateBoardDialog
          onClose={() => setCreating(false)}
          onCreated={(board) => navigate(`/boards/${board.id}`)}
        />
      )}
    </div>
  )
}

function CreateBoardDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (board: BoardSummary) => void }) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('보드 이름을 입력해 주세요')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      onCreated(await createBoard(title.trim()))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '보드를 만들지 못했습니다')
      setSubmitting(false)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={onSubmit} role="dialog" aria-label="새 보드 만들기">
        <h2 className="dialog__title serif">새 보드 만들기</h2>
        <p className="dialog__desc">함께 정리할 이슈나 주제를 이름으로 적어 주세요.</p>
        <input
          autoFocus
          maxLength={50}
          value={title}
          placeholder="예: 반도체 수출 규제 · 이란-미국 정세"
          onChange={(e) => setTitle(e.target.value)}
          aria-label="보드 이름"
        />
        {error && <p className="dialog__error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? '만드는 중…' : '만들기'}
          </button>
        </div>
      </form>
    </div>
  )
}
