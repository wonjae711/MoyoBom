import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { askBoard, askQuota, type AskResult } from './api'

interface Props {
  boardId: string
  /** 출처 카드를 보드에서 선택하고 화면 가운데로 옮긴다. 이미 지워진 카드면 false */
  onShowCard: (itemId: string) => boolean
  /** 보드에 기사 카드가 있는지 (없으면 물을 수 없다) */
  hasArticles: boolean
}

/**
 * 보드 질의응답 (F-12, A2): 오른쪽 패널 "질문하기". 보드에 모은 기사만 근거로 답하고 출처를 번호로 보여 준다.
 * 답변은 묻는 사람에게만 보이고 저장하지 않는다
 */
export function AskPanel({ boardId, onShowCard, hasArticles }: Props) {
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState('')
  const [result, setResult] = useState<AskResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [missing, setMissing] = useState<string | null>(null)

  useEffect(() => {
    askQuota(boardId)
      .then(setRemaining)
      .catch(() => setRemaining(null))
  }, [boardId])

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
      setError(e instanceof ApiError ? e.message : '답변을 받지 못했어요. 잠시 후 다시 시도해 주세요.')
      askQuota(boardId)
        .then(setRemaining)
        .catch(() => {})
    } finally {
      setLoading(false)
    }
  }

  const cited = new Set(result?.citations)

  return (
    <div className="side__body ask">
      <p className="ask__desc">이 보드에 모은 기사만 근거로 답해요. 답변은 나에게만 보여요.</p>
      <form
        className="ask__form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label htmlFor="ask-question" className="visually-hidden">
          질문
        </label>
        <textarea
          id="ask-question"
          className="input ask__input"
          value={question}
          maxLength={300}
          rows={3}
          placeholder={hasArticles ? '예: 이번 반도체 규제의 핵심 쟁점은?' : '기사 카드를 먼저 보드에 올려 주세요'}
          disabled={!hasArticles}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <div className="ask__row">
          <span className="ask__quota">{remaining !== null && `오늘 남은 질문 ${remaining}회`}</span>
          <button type="submit" className="btn btn--sm" disabled={!hasArticles || loading || question.trim().length < 2}>
            {loading ? '답변 찾는 중…' : '묻기'}
          </button>
        </div>
      </form>

      {error && (
        <div className="notice notice--err" role="alert">
          {error}
        </div>
      )}

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
                          className="text-btn"
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
    </div>
  )
}
