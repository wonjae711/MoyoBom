import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError } from '../api/client'
import { AppHeader } from '../ui/AppHeader'
import { acceptInvite, previewInvite, type InvitePreview } from './api'
import './BoardListPage.css'

/**
 * 초대 링크 화면 (F-07, C-12). 로그인하지 않았으면 RequireAuth가 로그인 화면으로 보내고,
 * 로그인(이메일·카카오)이 끝나면 이 화면으로 돌아온다.
 */
export function InvitePage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    previewInvite(token)
      .then(setPreview)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : '초대 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요'),
      )
  }, [token])

  const join = async () => {
    setJoining(true)
    try {
      const { boardId } = await acceptInvite(token)
      navigate(`/boards/${boardId}`, { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '참여하지 못했습니다. 잠시 후 다시 시도해 주세요')
      setJoining(false)
    }
  }

  return (
    <div className="dash">
      <AppHeader />
      <div className="dash__body">
        <div className="dialog" style={{ margin: '40px auto' }}>
          {error ? (
            <>
              <h1 className="dialog__title serif">초대 링크를 열 수 없습니다</h1>
              <p className="dialog__desc">{error}</p>
              <div className="dialog__actions">
                <Link to="/" className="btn" style={{ textDecoration: 'none' }}>
                  보드 목록으로
                </Link>
              </div>
            </>
          ) : !preview ? (
            <p className="dialog__desc">초대 정보를 확인하는 중…</p>
          ) : (
            <>
              <p className="dialog__desc" style={{ marginTop: 0 }}>
                보드에 초대받았습니다
              </p>
              <h1 className="dialog__title serif">{preview.title}</h1>
              <p className="dialog__desc">현재 멤버 {preview.memberCount}명 · 참여하면 카드를 함께 추가하고 정리할 수 있습니다.</p>
              <div className="dialog__actions">
                <Link to="/" className="btn btn--ghost" style={{ textDecoration: 'none' }}>
                  나중에
                </Link>
                <button type="button" className="btn" onClick={() => void join()} disabled={joining}>
                  {joining ? '참여하는 중…' : '보드에 참여하기'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
