import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

/**
 * 모달 (인계 문서 "모달"): 열 때 첫 입력(또는 data-autofocus)으로 포커스, Esc·배경 클릭으로 닫기(처리 중엔 잠금),
 * 닫으면 연 버튼으로 포커스 복귀
 */
export function Modal({
  title,
  sub,
  onClose,
  busy = false,
  wide = false,
  closeButton = false,
  children,
}: {
  title: ReactNode
  sub?: ReactNode
  onClose: () => void
  busy?: boolean
  wide?: boolean
  /** 오른쪽 위 닫기 버튼 */
  closeButton?: boolean
  children: ReactNode
}) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const busyRef = useRef(busy)
  const closeRef = useRef(onClose)
  useEffect(() => {
    busyRef.current = busy
    closeRef.current = onClose
  })

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]), textarea, select, button')
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div ref={ref} className={`modal${wide ? ' modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal__head">
          <div>
            <h2 id={titleId} className="modal__title">
              {title}
            </h2>
            {sub && <span className="modal__sub">{sub}</span>}
          </div>
          {closeButton && (
            <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="닫기" title="닫기">
              <Icon name="close" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}
