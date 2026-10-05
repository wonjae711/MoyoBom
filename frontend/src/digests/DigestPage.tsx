import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { CATEGORY_LABELS, type CategoryCode } from '../feed/types'
import { useToast } from '../ui/hooks'
import {
  MAX_SUBSCRIPTIONS,
  createSubscription,
  deleteSubscription,
  hourLabel,
  listDigests,
  listSubscriptions,
  markAllRead,
  markRead,
  runNow,
  topicName,
  updateSubscription,
  type Digest,
  type Subscription,
  type SubscriptionInput,
} from './api'
import { adjustUnread, onDigestArrived, setUnread } from './unread'
import './DigestPage.css'

const CATEGORY_CODES = Object.keys(CATEGORY_LABELS) as CategoryCode[]
const MAX_KEYWORDS = 5

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

/** 뉴스 다이제스트 (F-09): 구독 관리와 알림함 */
export function DigestPage() {
  const toast = useToast()
  const [subs, setSubs] = useState<Subscription[] | null>(null)
  const [digests, setDigests] = useState<Digest[]>([])
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  /** 구독 만들기·고치기 폼: null이면 닫힘, 'new'면 새 구독 */
  const [editing, setEditing] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)

  const load = useCallback(
    () =>
      Promise.all([listSubscriptions(), listDigests()])
        .then(([subscriptions, page]) => {
          setSubs(subscriptions)
          setDigests(page.digests)
          setNextBefore(page.nextBefore)
          setUnread(page.unread)
        })
        .catch((e: unknown) => setError(errorText(e, '알림함을 불러오지 못했습니다'))),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  // 예약 다이제스트가 화면을 보는 중에 도착하면 맨 위에 넣는다
  const showToast = toast.show
  useEffect(
    () =>
      onDigestArrived((digest) => {
        setDigests((list) => (list.some((d) => d.id === digest.id) ? list : [digest, ...list]))
        // "지금 받아보기"는 누른 사람이 결과 안내를 따로 받는다
        if (digest.kind === 'scheduled') showToast('새 다이제스트가 도착했습니다')
      }),
    [showToast],
  )

  const loadMore = async () => {
    if (!nextBefore) return
    setLoadingMore(true)
    try {
      const page = await listDigests({ before: nextBefore })
      setDigests((list) => [...list, ...page.digests])
      setNextBefore(page.nextBefore)
    } catch (e) {
      toast.show(errorText(e, '더 불러오지 못했습니다'))
    } finally {
      setLoadingMore(false)
    }
  }

  const save = async (input: SubscriptionInput, id: string | null) => {
    const saved = id ? await updateSubscription(id, input) : await createSubscription(input)
    setSubs((list) => (id ? (list ?? []).map((s) => (s.id === id ? saved : s)) : [...(list ?? []), saved]))
    setEditing(null)
    toast.show(id ? '구독을 고쳤습니다' : `매일 ${hourLabel(saved.sendHour)}에 다이제스트를 보내 드립니다`)
  }

  const toggle = async (sub: Subscription) => {
    try {
      const saved = await updateSubscription(sub.id, { active: !sub.active })
      setSubs((list) => (list ?? []).map((s) => (s.id === sub.id ? saved : s)))
    } catch (e) {
      toast.show(errorText(e, '바꾸지 못했습니다'))
    }
  }

  const remove = async (sub: Subscription) => {
    if (!window.confirm(`"${topicName(sub)}" 구독을 지울까요? 이미 받은 다이제스트는 알림함에 남습니다.`)) return
    try {
      await deleteSubscription(sub.id)
      setSubs((list) => (list ?? []).filter((s) => s.id !== sub.id))
    } catch (e) {
      toast.show(errorText(e, '지우지 못했습니다'))
    }
  }

  const run = async (sub: Subscription) => {
    setRunning(sub.id)
    try {
      const digest = await runNow(sub.id)
      setDigests((list) => (list.some((d) => d.id === digest.id) ? list : [digest, ...list]))
      // 화면에서 바로 보이므로 안 읽은 개수에 넣지 않는다 (소켓 알림으로 하나 늘어난 것은 읽음으로 처리)
      await markRead(digest.id).catch(() => {})
      setDigests((list) => list.map((d) => (d.id === digest.id ? { ...d, readAt: new Date().toISOString() } : d)))
      listDigests({ limit: 1 })
        .then((page) => setUnread(page.unread))
        .catch(() => {})
      toast.show(digest.status === 'empty' ? '최근 24시간에 새 소식이 없습니다' : '다이제스트를 만들었습니다')
    } catch (e) {
      toast.show(errorText(e, '다이제스트를 만들지 못했습니다'))
    } finally {
      setRunning(null)
    }
  }

  const read = async (digest: Digest) => {
    if (digest.readAt) return
    setDigests((list) => list.map((d) => (d.id === digest.id ? { ...d, readAt: new Date().toISOString() } : d)))
    adjustUnread(-1)
    await markRead(digest.id).catch(() => {})
  }

  const readAll = async () => {
    try {
      await markAllRead()
      const now = new Date().toISOString()
      setDigests((list) => list.map((d) => ({ ...d, readAt: d.readAt ?? now })))
      setUnread(0)
    } catch (e) {
      toast.show(errorText(e, '읽음으로 바꾸지 못했습니다'))
    }
  }

  const hasUnread = digests.some((d) => !d.readAt)

  return (
    <div className="digests">
      <div className="digests__body">
        <div className="digests__head">
          <div>
            <h1 className="digests__title serif">뉴스 다이제스트</h1>
            <p className="digests__sub">관심 분야의 새 기사를 정한 시각에 AI가 한 번에 정리해 알림함으로 보내 드립니다.</p>
          </div>
        </div>
        {error && (
          <div className="digests__error" role="alert">
            {error}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setError(null)
                void load()
              }}
            >
              다시 시도
            </button>
          </div>
        )}

        <div className="digests__grid">
          <section className="digests__subs" aria-label="내 구독">
            <div className="digests__section-head">
              <h2>내 구독</h2>
              <span>
                {subs?.length ?? 0}/{MAX_SUBSCRIPTIONS}
              </span>
            </div>
            {subs?.length === 0 && editing !== 'new' && (
              <p className="digests__empty">아직 구독이 없습니다. 관심 분야와 받을 시각을 정해 보세요.</p>
            )}
            {subs?.map((sub) =>
              editing === sub.id ? (
                <SubscriptionForm key={sub.id} initial={sub} onSave={(input) => save(input, sub.id)} onCancel={() => setEditing(null)} />
              ) : (
                <div key={sub.id} className={`sub-card${sub.active ? '' : ' sub-card--off'}`}>
                  <div className="sub-card__topic">{topicName(sub)}</div>
                  <div className="sub-card__when">
                    매일 {hourLabel(sub.sendHour)}
                    {!sub.active && ' · 꺼짐'}
                  </div>
                  <div className="sub-card__actions">
                    <button type="button" className="btn" onClick={() => void run(sub)} disabled={running !== null}>
                      {running === sub.id ? '만드는 중…' : '지금 받아보기'}
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => void toggle(sub)}>
                      {sub.active ? '끄기' : '켜기'}
                    </button>
                    <button type="button" className="sub-card__link" onClick={() => setEditing(sub.id)}>
                      고치기
                    </button>
                    <button type="button" className="sub-card__link" onClick={() => void remove(sub)}>
                      지우기
                    </button>
                  </div>
                </div>
              ),
            )}
            {editing === 'new' ? (
              <SubscriptionForm onSave={(input) => save(input, null)} onCancel={() => setEditing(null)} />
            ) : (
              subs &&
              subs.length < MAX_SUBSCRIPTIONS &&
              editing === null && (
                <button type="button" className="btn btn--ghost digests__add" onClick={() => setEditing('new')}>
                  + 구독 추가
                </button>
              )
            )}
          </section>

          <section className="digests__inbox" aria-label="알림함">
            <div className="digests__section-head">
              <h2>알림함</h2>
              {hasUnread && (
                <button type="button" className="sub-card__link" onClick={() => void readAll()}>
                  모두 읽음
                </button>
              )}
            </div>
            {subs && digests.length === 0 && <p className="digests__empty">받은 다이제스트가 없습니다.</p>}
            {digests.map((d) => (
              <DigestCard key={d.id} digest={d} onRead={() => void read(d)} />
            ))}
            {nextBefore && (
              <button type="button" className="btn btn--ghost digests__more" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? '불러오는 중…' : '더 보기'}
              </button>
            )}
          </section>
        </div>
      </div>
      {toast.view}
    </div>
  )
}

function SubscriptionForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Subscription
  onSave: (input: SubscriptionInput) => Promise<void>
  onCancel: () => void
}) {
  const [categories, setCategories] = useState<CategoryCode[]>(initial?.categories ?? [])
  const [keywords, setKeywords] = useState<string[]>(initial?.keywords ?? [])
  const [draft, setDraft] = useState('')
  const [sendHour, setSendHour] = useState(initial?.sendHour ?? 8)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const addKeyword = () => {
    const word = draft.trim()
    if (!word) return
    if (keywords.length >= MAX_KEYWORDS) return setError(`키워드는 ${MAX_KEYWORDS}개까지 넣을 수 있습니다`)
    if (!keywords.includes(word)) setKeywords([...keywords, word])
    setDraft('')
    setError(null)
  }

  const submit = async () => {
    if (categories.length === 0 && keywords.length === 0) return setError('카테고리나 키워드를 하나 이상 골라 주세요')
    setSaving(true)
    setError(null)
    try {
      await onSave({ categories, keywords, sendHour })
    } catch (e) {
      setError(errorText(e, '저장하지 못했습니다'))
      setSaving(false)
    }
  }

  return (
    <form
      className="sub-form"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="sub-form__label">카테고리</div>
      <div className="sub-form__chips">
        {CATEGORY_CODES.map((code) => (
          <button
            key={code}
            type="button"
            className={`chip${categories.includes(code) ? ' chip--on' : ''}`}
            aria-pressed={categories.includes(code)}
            onClick={() =>
              setCategories((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]))
            }
          >
            {CATEGORY_LABELS[code]}
          </button>
        ))}
      </div>
      <div className="sub-form__label">키워드 (선택, {MAX_KEYWORDS}개까지)</div>
      <div className="sub-form__keywords">
        {keywords.map((k) => (
          <button key={k} type="button" className="chip chip--on" onClick={() => setKeywords(keywords.filter((w) => w !== k))} aria-label={`${k} 빼기`}>
            {k} ×
          </button>
        ))}
        <input
          value={draft}
          maxLength={20}
          placeholder="예: 반도체"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ',') && !e.nativeEvent.isComposing) {
              e.preventDefault()
              addKeyword()
            }
          }}
          onBlur={addKeyword}
          aria-label="키워드"
        />
      </div>
      <label className="sub-form__label" htmlFor="sub-hour">
        받을 시각 (매일, 한국 시간)
      </label>
      <select id="sub-hour" value={sendHour} onChange={(e) => setSendHour(Number(e.target.value))}>
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={h}>
            {hourLabel(h)}
          </option>
        ))}
      </select>
      {error && <p className="sub-form__error">{error}</p>}
      <div className="sub-form__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          취소
        </button>
        <button type="submit" className="btn" disabled={saving}>
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>
    </form>
  )
}

const dateText = (iso: string, withMinutes: boolean) =>
  new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    ...(withMinutes ? { minute: '2-digit' } : {}),
  })

const ARTICLES_SHOWN = 5

function DigestCard({ digest, onRead }: { digest: Digest; onRead: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const when = digest.slot ? `${dateText(digest.slot, false)} 브리핑` : `${dateText(digest.createdAt, true)} · 지금 받아보기`
  const shown = expanded ? digest.articles : digest.articles.slice(0, ARTICLES_SHOWN)
  return (
    <article className={`digest-card${digest.readAt ? '' : ' digest-card--unread'}`} onClick={onRead}>
      <div className="digest-card__when">
        {!digest.readAt && <span className="digest-card__dot" aria-label="안 읽음" />}
        {when}
      </div>
      <h3 className="digest-card__title serif">{digest.title}</h3>
      {digest.status === 'ok' && <p className="digest-card__summary">{digest.summary}</p>}
      {digest.status === 'empty' && <p className="digest-card__note">새 소식이 없어요. 구독한 분야에 그동안 새로 들어온 기사가 없습니다.</p>}
      {digest.status === 'failed' && <p className="digest-card__note">요약을 만들지 못했어요. 대신 기사 목록을 보내 드립니다.</p>}
      {digest.articles.length > 0 && (
        <ol className="digest-card__articles">
          {shown.map((a) => (
            <li key={a.id}>
              <a href={a.link} target="_blank" rel="noopener noreferrer">
                {a.title}
              </a>
              <span>{a.source}</span>
            </li>
          ))}
        </ol>
      )}
      {digest.articles.length > ARTICLES_SHOWN && (
        <button type="button" className="sub-card__link" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '접기' : `기사 ${digest.articles.length - ARTICLES_SHOWN}건 더 보기`}
        </button>
      )}
    </article>
  )
}
