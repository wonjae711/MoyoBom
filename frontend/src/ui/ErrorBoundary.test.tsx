// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

let broken = true
function Flaky({ name }: { name: string }) {
  if (broken) throw new Error('그리기 실패')
  return <span>{name} 정상</span>
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    cleanup()
    broken = true
    vi.restoreAllMocks()
  })

  it('오류가 난 부분만 대체하고 옆의 화면은 그대로 둔다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <div>
        <ErrorBoundary fallback={() => <span>카드 오류</span>}>
          <Flaky name="A" />
        </ErrorBoundary>
        <span>다른 카드</span>
      </div>,
    )
    expect(screen.getByText('카드 오류')).toBeTruthy()
    expect(screen.getByText('다른 카드')).toBeTruthy()
  })

  it('다시 시도를 누르면 다시 그려 본다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary fallback={(retry) => <button onClick={retry}>다시 시도</button>}>
        <Flaky name="A" />
      </ErrorBoundary>,
    )
    broken = false
    fireEvent.click(screen.getByText('다시 시도'))
    expect(screen.getByText('A 정상')).toBeTruthy()
  })

  it('resetKey가 바뀌면 오류 상태를 풀고 다시 그린다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(
      <ErrorBoundary resetKey={1} fallback={() => <span>오류</span>}>
        <Flaky name="B" />
      </ErrorBoundary>,
    )
    expect(screen.getByText('오류')).toBeTruthy()
    broken = false
    rerender(
      <ErrorBoundary resetKey={2} fallback={() => <span>오류</span>}>
        <Flaky name="B" />
      </ErrorBoundary>,
    )
    expect(screen.getByText('B 정상')).toBeTruthy()
  })
})
