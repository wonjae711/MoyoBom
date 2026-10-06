import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError } from '../api/client'
import { Icon, Spinner } from '../ui/Icon'
import { Logo } from '../ui/Logo'
import { acceptInvite, previewInvite } from './api'
import './InvitePage.css'

type Flow =
  | { kind: 'checking' }
  | { kind: 'joining'; title: string }
  | { kind: 'joined'; title: string }
  | { kind: 'already'; title: string; boardId: string }
  | { kind: 'bad' }
  | { kind: 'fail'; title: string }

/**
 * 초대 링크 (F-07, C-12, 인계 문서 "초대 수락"): 별도 "참여하기" 확인 없이 유효성 확인 → 참여 → 보드로 이동.
 * 로그인하지 않았으면 RequireAuth가 로그인 화면으로 보내고, 로그인·가입이 끝나면 이 화면으로 돌아온다
 */
export function InvitePage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [flow, setFlow] = useState<Flow>({ kind: 'checking' })
  const started = useRef(false)

  const join = useCallback(
    async (title: string) => {
      setFlow({ kind: 'joining', title })
      try {
        const { boardId, joined } = await acceptInvite(token)
        if (!joined) return setFlow({ kind: 'already', title, boardId })
        setFlow({ kind: 'joined', title })
        setTimeout(() => navigate(`/boards/${boardId}`, { replace: true }), 900)
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) setFlow({ kind: 'bad' })
        else setFlow({ kind: 'fail', title })
      }
    },
    [token, navigate],
  )

  useEffect(() => {
    if (started.current) return
    started.current = true
    previewInvite(token)
      .then((preview) => join(preview.title))
      .catch((e: unknown) => setFlow(e instanceof ApiError && e.status === 404 ? { kind: 'bad' } : { kind: 'fail', title: '' }))
  }, [token, join])

  return (
    <main className="invite-page">
      <Logo size={32} />
      <div className="invite-page__card">
        {flow.kind === 'checking' && (
          <div className="invite-page__status" role="status">
            <Spinner /> 초대를 확인하고 있어요…
          </div>
        )}
        {flow.kind === 'joining' && (
          <div className="invite-page__status" role="status">
            <span>
              <Spinner /> 보드에 참여하는 중…
            </span>
            <b>{flow.title}</b>
          </div>
        )}
        {flow.kind === 'joined' && (
          <div className="invite-page__status invite-page__status--ok" role="status">
            <span>
              <Icon name="check" /> 참여했어요
            </span>
            <span>‘{flow.title}’ 보드에 참여자로 들어왔어요.</span>
            <span className="invite-page__sub">보드로 이동하는 중…</span>
          </div>
        )}
        {flow.kind === 'already' && (
          <>
            <h1>이미 참여 중인 보드예요.</h1>
            <p>‘{flow.title}’ 보드를 바로 열 수 있어요.</p>
            <button type="button" className="btn" onClick={() => navigate(`/boards/${flow.boardId}`, { replace: true })}>
              보드 열기
            </button>
          </>
        )}
        {flow.kind === 'bad' && (
          <>
            <h1>초대 링크가 만료되었거나 사용할 수 없어요.</h1>
            <p>보드 소유자에게 새 링크를 요청해 주세요.</p>
            <Link className="btn btn--ghost" to="/">
              내 보드로
            </Link>
          </>
        )}
        {flow.kind === 'fail' && (
          <>
            <div role="alert">
              <h1>보드에 참여하지 못했어요.</h1>
              <p>잠시 후 다시 시도해 주세요.</p>
            </div>
            <div className="invite-page__actions">
              <button type="button" className="btn" onClick={() => void (flow.title ? join(flow.title) : window.location.reload())}>
                다시 시도
              </button>
              <Link className="btn btn--ghost" to="/">
                내 보드로
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
