import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { askBoard, askQuota, type AskResult } from './api'

interface Props {
  boardId: string
  open: boolean
  onClose: () => void
  /** 출처 카드를 보드에서 선택하고 화면 가운데로 옮긴다. 이미 지워진 카드면 false */
  onShowCard: (itemId: string) => boolean
  /** 보드에 기사 카드가 있는지 (없으면 물을 수 없다) */
  hasArticles: boolean
}

/**
 * 보드 질의응답 (F-12): 보드에 모은 기사만 근거로 답하고 출처를 번호로 보여 준다.
 * 답변은 묻는 사람에게만 보이고 저장하지 않는다 (창을 닫아도 마지막 답변은 남겨 둔다)
 */
export function AskPanel({ boardId, open, onClose, onShowCard, hasArticles }: Props) {
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState('')
  const [result, setResult] = useState<AskResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [missing, setMissing] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    askQuota(boardId)
      .then(setRemaining)
      .catch(() => setRemaining(null))
  }, [boardId, open])

  const submit = async () => {
    const q = question.trim()
    if (q.length < 2 || loading) return
    setLoading(true)
    setError(null)
    setMissing(null)
    try {
      const answer = await askBoard(boardId, q)
      setResult(answer)
      setAsked(q)
      setRemaining(answer.remaining)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '답변을 받지 못했습니다. 잠시 후 다시 시도해 주세요')
      askQuota(boardId).then(setRemaining).catch(() => {})
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null
  const cited = new Set(result?.citations)

  return (
    <section className="ask" aria-label="보드에 질문하기">
      <div className="ask__head">
        <span className="ask__title">보드에 질문하기</span>
        <button type="button" className="ask__close" onClick={onClose} aria-label="질문 창 닫기">
          ×
        </button>
      </div>
      <p className="ask__desc">이 보드에 모은 기사만 근거로 답합니다. 답변은 나에게만 보입니다.</p>
      <form
        className="ask__form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <textarea
          value={question}
          maxLength={300}
          rows={2}
          placeholder={hasArticles ? '예: 이번 반도체 규제의 핵심 쟁점은?' : '기사 카드를 먼저 보드에 올려 주세요'}
          disabled={!hasArticles}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
          aria-label="질문"
        />
        <div className="ask__row">
          <span className="ask__quota">{remaining !== null && `오늘 남은 질문 ${remaining}회`}</span>
          <button type="submit" className="btn" disabled={!hasArticles || loading || question.trim().length < 2}>
            {loading ? '답변 찾는 중…' : '묻기'}
          </button>
        </div>
      </form>

      {error && <p className="ask__error">{error}</p>}

      {result && (
        <div className="ask__result">
          <div className="ask__q">Q. {asked}</div>
          <p className={`ask__answer${result.found ? '' : ' ask__answer--empty'}`}>{result.answer}</p>
          {result.sources.length > 0 && (
            <>
              <div className="ask__sources-title">출처 · 보드의 기사</div>
              <ol className="ask__sources">
                {result.sources.map((s) => (
                  <li key={s.n} className={cited.has(s.n) ? 'is-cited' : ''}>
                    <span className="ask__n">[{s.n}]</span>
                    <div className="ask__source">
                      <div className="ask__source-title" title={s.title}>
                        {s.title}
                      </div>
                      <div className="ask__source-meta">
                        {s.source}
                        {!cited.has(s.n) && ' · 답변에 쓰지 않음'}
                      </div>
                      <div className="ask__source-actions">
                        <button
                          type="button"
                          onClick={() => setMissing(onShowCard(s.itemId) ? null : s.itemId)}
                          disabled={missing === s.itemId}
                        >
                          {missing === s.itemId ? '보드에서 지워진 카드' : '보드에서 보기'}
                        </button>
                        <a href={s.originalLink} target="_blank" rel="noopener noreferrer">
                          원문
                        </a>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  )
}
