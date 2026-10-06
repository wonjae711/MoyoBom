import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { createBoard, deleteBoard, removeMember, renameBoard } from './api'
import type { BoardSummary } from './types'

/** 보드 이름 길이 (사용자 결정 2026-10-06) — 서버 routes/boards.ts와 같게 */
export const MAX_BOARD_TITLE = 40

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

/** 새 보드 만들기·이름 변경 (F-06). 이름은 필수, 40자 이내 */
export function BoardNameDialog({
  mode,
  boardId,
  initial = '',
  onClose,
  onCreated,
  onRenamed,
}: {
  mode: 'new' | 'rename'
  boardId?: string
  initial?: string
  onClose: () => void
  onCreated?: (board: BoardSummary) => void
  onRenamed?: (title: string) => void
}) {
  const [title, setTitle] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const value = title.trim()
    if (!value) return setError('보드 이름을 입력해 주세요.')
    if (value.length > MAX_BOARD_TITLE) return setError(`보드 이름은 ${MAX_BOARD_TITLE}자 이내로 입력해 주세요.`)
    setError(null)
    setFailed(null)
    setBusy(true)
    try {
      if (mode === 'new') onCreated?.(await createBoard(value))
      else {
        await renameBoard(boardId!, value)
        onRenamed?.(value)
      }
    } catch (err) {
      setFailed(errorText(err, mode === 'new' ? '보드를 만들지 못했어요. 다시 시도해 주세요.' : '이름을 바꾸지 못했어요. 다시 시도해 주세요.'))
      setBusy(false)
    }
  }

  const length = title.trim().length
  return (
    <Modal title={mode === 'new' ? '새 보드 만들기' : '보드 이름 변경'} onClose={onClose} busy={busy}>
      <form className="dialog-form" onSubmit={submit} noValidate>
        {failed && (
          <div className="notice notice--err" role="alert">
            <Icon name="alert" />
            <span>{failed}</span>
          </div>
        )}
        <div className="field">
          <label className="field__label" htmlFor="board-name">
            보드 이름 <span className="dialog-form__required">(필수)</span>
          </label>
          <input
            id="board-name"
            data-autofocus
            className={`input${error ? ' input--error' : ''}`}
            value={title}
            maxLength={60}
            placeholder="예: AI 산업과 규제"
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="dialog-form__hint">
            <span className="field__error">{error}</span>
            <span className={length > MAX_BOARD_TITLE ? 'field__error' : undefined}>
              {length}/{MAX_BOARD_TITLE}
            </span>
          </div>
        </div>
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? (mode === 'new' ? '만드는 중…' : '저장 중…') : mode === 'new' ? '만들기' : '저장'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** 소유자만: 보드 삭제 확인 */
export function DeleteBoardDialog({
  boardId,
  title,
  cardCount,
  memberCount,
  onClose,
  onDeleted,
}: {
  boardId: string
  title: string
  cardCount: number
  memberCount: number
  onClose: () => void
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const run = async () => {
    setBusy(true)
    setFailed(null)
    try {
      await deleteBoard(boardId)
      onDeleted()
    } catch (e) {
      setFailed(errorText(e, '보드를 삭제하지 못했어요. 다시 시도해 주세요.'))
      setBusy(false)
    }
  }
  return (
    <Modal title="보드를 삭제할까요?" onClose={onClose} busy={busy}>
      <p className="dialog-text">
        ‘<b>{title}</b>’ 보드와 카드 {cardCount}개가 참여자 {memberCount}명 모두에게서 삭제돼요. 삭제한 보드는 되돌릴 수 없어요.
      </p>
      {failed && (
        <div className="notice notice--err" role="alert">
          <Icon name="alert" />
          <span>{failed}</span>
        </div>
      )}
      <div className="modal__actions">
        <button type="button" className="btn btn--ghost" data-autofocus onClick={onClose} disabled={busy}>
          취소
        </button>
        <button type="button" className="btn btn--danger" onClick={() => void run()} disabled={busy}>
          {busy ? '삭제하는 중…' : '보드 삭제'}
        </button>
      </div>
    </Modal>
  )
}

/** 참여자: 보드 나가기 확인 */
export function LeaveBoardDialog({
  boardId,
  userId,
  title,
  onClose,
  onLeft,
}: {
  boardId: string
  userId: string
  title: string
  onClose: () => void
  onLeft: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const run = async () => {
    setBusy(true)
    setFailed(null)
    try {
      await removeMember(boardId, userId)
      onLeft()
    } catch (e) {
      setFailed(errorText(e, '보드에서 나가지 못했어요. 다시 시도해 주세요.'))
      setBusy(false)
    }
  }
  return (
    <Modal title="보드에서 나갈까요?" onClose={onClose} busy={busy}>
      <p className="dialog-text">
        ‘<b>{title}</b>’ 보드가 내 보드 목록에서 사라져요. 보드와 자료는 다른 참여자에게 그대로 남아요. 다시 참여하려면 소유자의 초대 링크가
        필요해요.
      </p>
      {failed && (
        <div className="notice notice--err" role="alert">
          <Icon name="alert" />
          <span>{failed}</span>
        </div>
      )}
      <div className="modal__actions">
        <button type="button" className="btn btn--ghost" data-autofocus onClick={onClose} disabled={busy}>
          취소
        </button>
        <button type="button" className="btn btn--danger" onClick={() => void run()} disabled={busy}>
          {busy ? '나가는 중…' : '보드 나가기'}
        </button>
      </div>
    </Modal>
  )
}
