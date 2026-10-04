import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/useAuth'
import { Avatars } from '../ui/Avatars'
import { deleteBoard, removeMember, renameBoard } from './api'
import type { BoardMember, BoardRole } from './types'

/** 바깥을 누르거나 Esc를 누르면 닫히는 작은 창 */
function Popover({
  label,
  trigger,
  children,
  className = '',
}: {
  label: string
  trigger: (open: boolean, toggle: () => void) => ReactNode
  children: (close: () => void) => ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="invite" ref={ref}>
      {trigger(open, () => setOpen((v) => !v))}
      {open && (
        <div className={`invite__panel ${className}`} role="dialog" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

/**
 * 참여자 목록 (F-07 권한): owner는 편집자를 내보낼 수 있고, 편집자는 스스로 나갈 수 있다. owner는 나갈 수 없다(보드 삭제만).
 */
export function MembersButton({
  boardId,
  members,
  role,
  onMessage,
}: {
  boardId: string
  members: BoardMember[]
  role: BoardRole
  onMessage: (text: string) => void
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<string | null>(null)

  const remove = async (member: BoardMember) => {
    const self = member.userId === user?.id
    const question = self ? '이 보드에서 나갈까요? 다시 들어오려면 초대 링크가 필요합니다.' : `${member.nickname}님을 보드에서 내보낼까요?`
    if (!window.confirm(question)) return
    setBusy(member.userId)
    try {
      await removeMember(boardId, member.userId)
      if (self) navigate('/', { replace: true })
      else onMessage(`${member.nickname}님을 내보냈습니다`)
    } catch (e) {
      onMessage(errorText(e, '처리하지 못했습니다'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Popover
      label="참여자"
      className="members"
      trigger={(open, toggle) => (
        <button type="button" className="members__trigger" onClick={toggle} aria-expanded={open} title="참여자 보기">
          <Avatars names={members.map((m) => m.nickname)} />
        </button>
      )}
    >
      {() => (
        <>
          <div className="invite__title">참여자 {members.length}명</div>
          <ul className="members__list">
            {members.map((m) => {
              const self = m.userId === user?.id
              const canRemove = m.role !== 'owner' && (self || role === 'owner')
              return (
                <li key={m.userId}>
                  <Avatars names={[m.nickname]} size={24} />
                  <span className="members__name">
                    {m.nickname}
                    {self && ' (나)'}
                  </span>
                  <span className="members__role">{m.role === 'owner' ? '주인' : '편집자'}</span>
                  {canRemove && (
                    <button type="button" className="invite__reissue" disabled={busy === m.userId} onClick={() => void remove(m)}>
                      {self ? '나가기' : '내보내기'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Popover>
  )
}

/** owner만: 보드 이름 바꾸기·삭제 (F-06) */
export function BoardMenu({ boardId, title, onMessage }: { boardId: string; title: string; onMessage: (text: string) => void }) {
  const navigate = useNavigate()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submitRename = async (e: FormEvent, close: () => void) => {
    e.preventDefault()
    if (renaming === null) return
    try {
      await renameBoard(boardId, renaming.trim())
      setRenaming(null)
      close()
      onMessage('보드 이름을 바꿨습니다')
    } catch (err) {
      setError(errorText(err, '이름을 바꾸지 못했습니다'))
    }
  }

  const remove = async () => {
    if (!window.confirm(`"${title}" 보드를 삭제할까요? 카드와 참여자 정보가 모두 지워지고 되돌릴 수 없습니다.`)) return
    try {
      await deleteBoard(boardId)
      navigate('/', { replace: true })
    } catch (err) {
      setError(errorText(err, '보드를 삭제하지 못했습니다'))
    }
  }

  return (
    <Popover
      label="보드 설정"
      className="board-menu"
      trigger={(open, toggle) => (
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            setError(null)
            setRenaming(null)
            toggle()
          }}
          aria-expanded={open}
        >
          설정
        </button>
      )}
    >
      {(close) =>
        renaming !== null ? (
          <form onSubmit={(e) => void submitRename(e, close)}>
            <div className="invite__title">보드 이름 바꾸기</div>
            <div className="invite__row" style={{ marginTop: 10 }}>
              <input autoFocus maxLength={50} value={renaming} onChange={(e) => setRenaming(e.target.value)} aria-label="새 보드 이름" />
              <button type="submit" className="btn" disabled={!renaming.trim()}>
                저장
              </button>
            </div>
            {error && <p className="invite__error">{error}</p>}
          </form>
        ) : (
          <div className="board-menu__items">
            <button type="button" onClick={() => setRenaming(title)}>
              보드 이름 바꾸기
            </button>
            <button type="button" className="board-menu__danger" onClick={() => void remove()}>
              보드 삭제
            </button>
            {error && <p className="invite__error">{error}</p>}
          </div>
        )
      }
    </Popover>
  )
}
