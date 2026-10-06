import { useEffect, useRef } from 'react'
import { Icon } from '../ui/Icon'
import { formatDateTime } from './merge'
import { CATEGORY_LABELS, type FeedArticle } from './types'
import { Thumb } from '../ui/Thumb'

/**
 * 기사 미리보기 옆 패널 (B6): 제목·출처·발행·수집 시각과 기사 설명. 전체 내용은 원문에서.
 * Esc·바깥 클릭으로 닫고, 닫으면 연 버튼으로 포커스가 돌아간다
 */
export function ArticlePreview({ article, onClose, onAdd }: { article: FeedArticle; onClose: () => void; onAdd: () => void }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('button')?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [onClose])

  return (
    <>
      <div className="preview__dim" onClick={onClose} />
      <aside ref={ref} className="preview" role="dialog" aria-label="기사 미리보기">
        <div className="preview__head">
          <span>기사 미리보기</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기" title="닫기">
            <Icon name="close" />
          </button>
        </div>
        <div className="preview__body">
          <Thumb src={article.imageUrl} className="preview__image" />
          <span className="preview__category">{CATEGORY_LABELS[article.category] ?? article.category}</span>
          <h2 className="preview__title">{article.title}</h2>
          <dl className="preview__meta">
            <dt>출처</dt>
            <dd>
              <b>{article.source}</b>
            </dd>
            <dt>발행</dt>
            <dd>{formatDateTime(article.publishedAt)}</dd>
            <dt>수집</dt>
            <dd>{formatDateTime(article.collectedAt)}</dd>
          </dl>
          <div className="preview__desc">
            <span>기사 설명</span>
            <p>{article.description || '제공된 설명이 없어요.'}</p>
          </div>
          <p className="preview__note">전체 내용은 원문에서 확인해 주세요.</p>
        </div>
        <div className="preview__foot">
          <a className="btn btn--ghost" href={article.originalLink} target="_blank" rel="noopener noreferrer">
            원문 보기 (새 탭) <Icon name="ext" size={15} />
          </a>
          <button type="button" className="btn" onClick={onAdd}>
            보드에 추가
          </button>
        </div>
      </aside>
    </>
  )
}
