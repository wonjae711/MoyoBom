import { Icon } from './Icon'

/** 화면 전체를 그리지 못했을 때 (마지막 안전망) — 까만 빈 화면 대신 안내와 돌아갈 길을 보여 준다 */
export function PageError({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="page-error">
      <div className="empty-state" role="alert">
        <span className="page-error__icon">
          <Icon name="alert" />
        </span>
        <h2>화면을 표시하지 못했어요.</h2>
        <p>저장된 내용은 그대로예요. 다시 시도하거나 새로고침해 주세요.</p>
        <div className="page-error__actions">
          <button type="button" className="btn btn--ghost" onClick={onRetry}>
            다시 시도
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => window.location.reload()}>
            새로고침
          </button>
          <a className="btn btn--ghost" href="/">
            내 보드로
          </a>
        </div>
      </div>
    </main>
  )
}
