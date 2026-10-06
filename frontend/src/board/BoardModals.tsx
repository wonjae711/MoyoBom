import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/useAuth'
import { formatDateTime } from '../feed/merge'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { getInvite, inviteUrl, previewLink, reissueInvite, removeMember, type Invite, type LinkPreview } from './api'
import { ROLE_LABEL } from './roles'
import type { BoardMember, BoardRole } from './types'

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

/**
 * 참여자와 초대 (B15, F-07): 소유자는 초대 링크(복사·새 링크 발급)와 참여자 내보내기, 참여자는 목록만.
 * 내보내기·새 링크 발급은 창 안에서 한 번 더 확인한다
 */
export function MembersDialog({
  boardId,
  title,
  role,
  members,
  onClose,
  onMessage,
}: {
  boardId: string
  title: string
  role: BoardRole
  members: BoardMember[]
  onClose: () => void
  onMessage: (text: string, tone?: 'ok' | 'err') => void
}) {
  const { user } = useAuth()
  const owner = role === 'owner'
  const [invite, setInvite] = useState<Invite | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [regenBusy, setRegenBusy] = useState(false)
  const [kick, setKick] = useState<string | null>(null)
  const [kicking, setKicking] = useState<string | null>(null)

  useEffect(() => {
    if (!owner) return
    getInvite(boardId)
      .then(setInvite)
      .catch((e: unknown) => setInviteError(errorText(e, '초대 링크를 불러오지 못했어요.')))
  }, [boardId, owner])

  const copy = async () => {
    if (!invite) return
    try {
      await navigator.clipboard.writeText(inviteUrl(invite.token))
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    } catch {
      onMessage('복사하지 못했어요. 링크를 직접 선택해 복사해 주세요.', 'err')
    }
  }

  const regen = async () => {
    setRegenBusy(true)
    try {
      setInvite(await reissueInvite(boardId))
      setConfirmRegen(false)
      onMessage('새 초대 링크를 만들었어요. 이전 링크는 더 이상 쓸 수 없어요.', 'ok')
    } catch (e) {
      onMessage(errorText(e, '새 링크를 만들지 못했어요.'), 'err')
    } finally {
      setRegenBusy(false)
    }
  }

  const doKick = async (member: BoardMember) => {
    setKicking(member.userId)
    try {
      await removeMember(boardId, member.userId)
      setKick(null)
      onMessage(`${member.nickname}님을 내보냈어요.`, 'ok')
    } catch (e) {
      onMessage(errorText(e, '내보내지 못했어요. 다시 시도해 주세요.'), 'err')
    } finally {
      setKicking(null)
    }
  }

  return (
    <Modal title={owner ? '참여자와 초대' : '참여자'} sub={title} onClose={onClose} wide closeButton>
      {owner && (
        <div className="members__invite">
          <label className="field__label" htmlFor="inv-link">
            초대 링크
          </label>
          {inviteError && (
            <div className="notice notice--err" role="alert">
              {inviteError}
            </div>
          )}
          {!invite && !inviteError && (
            <span className="members__loading">
              <Spinner /> 초대 링크를 불러오는 중…
            </span>
          )}
          {invite && (
            <>
              <div className="members__link">
                <input id="inv-link" className="input input--sm" readOnly value={inviteUrl(invite.token)} onFocus={(e) => e.target.select()} />
                <button type="button" className="btn btn--sm" data-autofocus onClick={() => void copy()}>
                  <Icon name={copied ? 'check' : 'copy'} size={16} />
                  {copied ? '복사했어요' : '복사'}
                </button>
              </div>
              <span className="members__hint" role="status">
                {formatDateTime(invite.expiresAt)}까지 사용 가능 · 만료 전까지 여러 명이 사용할 수 있어요. 참여하면 참여자 권한을 받아요.
              </span>
              {confirmRegen ? (
                <div className="members__confirm" role="alertdialog" aria-label="새 링크 발급 확인">
                  <span>새 링크를 만들면 기존 링크는 사용할 수 없어요.</span>
                  <div>
                    <button type="button" className="btn btn--ghost btn--xs" onClick={() => setConfirmRegen(false)}>
                      취소
                    </button>
                    <button type="button" className="btn btn--xs" onClick={() => void regen()} disabled={regenBusy}>
                      {regenBusy ? '만드는 중…' : '새 링크 발급'}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="text-btn members__regen" onClick={() => setConfirmRegen(true)}>
                  새 링크 발급
                </button>
              )}
            </>
          )}
        </div>
      )}
      {!owner && <p className="members__note">초대 링크와 참여자 관리는 보드 소유자가 할 수 있어요.</p>}
      <div className="members__list-wrap">
        <span className="members__count">참여자 {members.length}명</span>
        <ul className="members__list">
          {members.map((m) => {
            const me = m.userId === user?.id
            const canKick = owner && m.role !== 'owner'
            return (
              <li key={m.userId}>
                <div className="members__row">
                  <span className="members__initial" aria-hidden="true">
                    {Array.from(m.nickname)[0] ?? '?'}
                  </span>
                  <span className="members__name">
                    {m.nickname}
                    {me && <span className="members__me"> (나)</span>}
                  </span>
                  <span className={`badge${m.role === 'owner' ? '' : ' badge--neutral'}`}>{ROLE_LABEL[m.role]}</span>
                  {canKick && kick !== m.userId && (
                    <button type="button" className="text-btn members__kick" onClick={() => setKick(m.userId)}>
                      내보내기
                    </button>
                  )}
                </div>
                {kick === m.userId && (
                  <div className="members__confirm" role="alertdialog" aria-label="내보내기 확인">
                    <span>{m.nickname}님을 내보낼까요? 이 보드를 더 이상 볼 수 없어요.</span>
                    <div>
                      <button type="button" className="btn btn--ghost btn--xs" onClick={() => setKick(null)}>
                        취소
                      </button>
                      <button type="button" className="btn btn--danger btn--xs" onClick={() => void doKick(m)} disabled={kicking === m.userId}>
                        {kicking === m.userId ? '내보내는 중…' : '내보내기'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        <span className="members__hint">참여자 목록이에요. 현재 접속 여부는 표시하지 않아요.</span>
      </div>
    </Modal>
  )
}

type LinkStep =
  | { kind: 'input'; error?: string }
  | { kind: 'working' }
  | { kind: 'preview'; preview: LinkPreview }
  | { kind: 'problem'; title: string; text: string; retry: boolean }

/**
 * 링크로 기사 추가 (F-03, B12): 주소 → "요약 미리보기"(페이지 읽기·요약) → 확인 후 "보드에 추가".
 * 이미 이 보드에 있는 주소면 알리고 멈춘다
 */
export function LinkDialog({
  boardId,
  remaining,
  onClose,
  onAdd,
}: {
  boardId: string
  remaining: number | null
  onClose: () => void
  onAdd: (url: string) => Promise<boolean>
}) {
  const [url, setUrl] = useState('')
  const [step, setStep] = useState<LinkStep>({ kind: 'input' })
  const [adding, setAdding] = useState(false)

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const value = url.trim()
    if (!value) return setStep({ kind: 'input', error: '기사 주소를 입력해 주세요.' })
    if (!/^https?:\/\/[^\s./]+\.[^\s]+$/i.test(value)) return setStep({ kind: 'input', error: '주소 형식을 확인해 주세요. http:// 또는 https://로 시작해야 해요.' })
    setStep({ kind: 'working' })
    try {
      const preview = await previewLink(boardId, value)
      if (preview.onBoard)
        setStep({ kind: 'problem', title: '이미 이 보드에 있는 기사예요.', text: '같은 주소의 기사 카드가 이미 보드에 있어요.', retry: false })
      else setStep({ kind: 'preview', preview })
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0
      const message = err instanceof ApiError ? err.message : '서버에 연결하지 못했어요.'
      if (status === 429) setStep({ kind: 'problem', title: '오늘 요약을 모두 사용했어요.', text: message, retry: false })
      else if (status === 400) setStep({ kind: 'input', error: message })
      else if (status === 422) setStep({ kind: 'problem', title: '이 페이지는 읽을 수 없어요.', text: message, retry: false })
      else setStep({ kind: 'problem', title: '요약하지 못했어요.', text: message, retry: true })
    }
  }

  const add = async () => {
    setAdding(true)
    const ok = await onAdd(url.trim())
    setAdding(false)
    if (ok) onClose()
  }

  return (
    <Modal title="링크로 기사 추가" sub="기사를 요약해 이 보드에 추가해요." onClose={onClose} busy={adding} wide closeButton>
      {step.kind === 'input' && (
        <form className="dialog-form" onSubmit={(e) => void submit(e)} noValidate>
          <div className="field">
            <label className="field__label" htmlFor="link-url">
              기사 주소
            </label>
            <input
              id="link-url"
              data-autofocus
              type="url"
              className={`input${step.error ? ' input--error' : ''}`}
              placeholder="https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            {step.error && <span className="field__error">{step.error}</span>}
            {remaining !== null && <span className="members__hint">오늘 남은 AI 요약 {remaining}회 · 이미 저장된 기사는 횟수를 쓰지 않아요</span>}
          </div>
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="btn">
              요약 미리보기
            </button>
          </div>
        </form>
      )}
      {step.kind === 'working' && (
        <>
          <div className="link__steps" role="status" aria-live="polite">
            <Spinner />
            페이지를 읽고 요약하는 중이에요…
          </div>
          <span className="link__url">{url}</span>
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              취소
            </button>
          </div>
        </>
      )}
      {step.kind === 'preview' && (
        <>
          <div className="link__preview">
            <span className="link__meta">
              {step.preview.article.source} ·{' '}
              {step.preview.article.publishedAt ? formatDateTime(step.preview.article.publishedAt) : '발행 시각 확인 불가'}
            </span>
            <b className="link__title">{step.preview.article.title}</b>
            <div className="detail__desc">
              <span>
                {step.preview.summarized ? '요약' : '페이지 설명'}
                {step.preview.summarized && <span className="card__ai">자동 생성</span>}
              </span>
              <p>{step.preview.article.description}</p>
            </div>
            {!step.preview.summarized && !step.preview.reused && (
              <span className="members__hint">본문을 읽지 못해 페이지에서 제공한 설명을 대신 보여 드려요.</span>
            )}
          </div>
          <span className="members__hint">이 자료는 이 보드에서만 보여요. 공용 뉴스 피드에는 올라가지 않아요.</span>
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={adding}>
              취소
            </button>
            <button type="button" className="btn" data-autofocus onClick={() => void add()} disabled={adding}>
              {adding ? '추가하는 중…' : '보드에 추가'}
            </button>
          </div>
        </>
      )}
      {step.kind === 'problem' && (
        <>
          <div className="notice notice--err link__problem" role="alert">
            <Icon name="alert" />
            <span>
              <b>{step.title}</b>
              <br />
              {step.text}
            </span>
          </div>
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={() => setStep({ kind: 'input' })}>
              다른 주소 입력
            </button>
            {step.retry ? (
              <button type="button" className="btn" data-autofocus onClick={() => void submit()}>
                다시 시도
              </button>
            ) : (
              <button type="button" className="btn" data-autofocus onClick={onClose}>
                닫기
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}
