import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ApiError } from '../api/client'
import { addArticleToBoard, listBoards } from '../board/api'
import { ROLE_LABEL } from '../board/roles'
import type { BoardSummary } from '../board/types'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import type { FeedArticle } from './types'

/**
 * 뉴스 화면 "보드에 추가" (B7): 참여 중인 보드를 골라 기사 카드를 그 보드 맨 아래에 추가한다.
 * 추가 뒤에는 "보드에서 확인" / "계속 둘러보기"
 */
export function BoardPickerDialog({ article, onClose }: { article: FeedArticle; onClose: () => void }) {
  const navigate = useNavigate()
  const [boards, setBoards] = useState<BoardSummary[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [failedBoard, setFailedBoard] = useState<string | null>(null)
  const [failMessage, setFailMessage] = useState('')
  const [done, setDone] = useState<{ board: BoardSummary; itemId: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    listBoards()
      .then((list) => !cancelled && setBoards(list))
      .catch(() => !cancelled && setLoadError(true))
    return () => {
      cancelled = true
    }
  }, [])

  const pick = async (board: BoardSummary) => {
    setAdding(board.id)
    setFailedBoard(null)
    try {
      const item = await addArticleToBoard(board.id, article.id)
      setDone({ board, itemId: item.id })
    } catch (e) {
      setFailedBoard(board.id)
      setFailMessage(e instanceof ApiError && e.status !== 500 ? e.message : '기사를 추가하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setAdding(null)
    }
  }

  return (
    <Modal title="보드에 추가" sub={article.title} onClose={onClose} busy={adding !== null} closeButton>
      {done ? (
        <div className="picker__done" role="status">
          <span className="picker__done-text">
            <Icon name="check" />‘{done.board.title}’에 추가했어요.
          </span>
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              계속 둘러보기
            </button>
            <button type="button" className="btn" data-autofocus onClick={() => navigate(`/boards/${done.board.id}`, { state: { select: done.itemId } })}>
              보드에서 확인
            </button>
          </div>
        </div>
      ) : boards === null && !loadError ? (
        <div className="picker__loading" role="status">
          <Spinner />
          보드 목록을 불러오는 중…
        </div>
      ) : loadError ? (
        <div className="notice notice--err" role="alert">
          <Icon name="alert" />
          <span>보드 목록을 불러오지 못했어요. 창을 닫고 다시 시도해 주세요.</span>
        </div>
      ) : boards!.length === 0 ? (
        <div className="picker__none">
          <b>참여 중인 보드가 없어요.</b>
          <span>새 보드를 만들고 이 기사를 모아 보세요.</span>
          <button type="button" className="btn" onClick={() => navigate('/')}>
            새 보드 만들기
          </button>
        </div>
      ) : (
        <div className="picker">
          <span className="picker__label">참여 중인 보드</span>
          {failedBoard && (
            <div className="notice notice--err" role="alert">
              <Icon name="alert" />
              <span>{failMessage}</span>
            </div>
          )}
          <ul className="picker__list">
            {boards!.map((b) => (
              <li key={b.id}>
                <button type="button" className="picker__item" onClick={() => void pick(b)} disabled={adding !== null}>
                  <span className="picker__item-main">
                    <span className="picker__item-title">{b.title}</span>
                    <span className="picker__item-meta">
                      {ROLE_LABEL[b.role]} · 카드 {b.itemCount}개
                    </span>
                  </span>
                  <span className="picker__item-status">
                    {adding === b.id ? '추가 중…' : failedBoard === b.id ? '다시 시도' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  )
}
