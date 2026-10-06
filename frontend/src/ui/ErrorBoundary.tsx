import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  fallback: (retry: () => void) => ReactNode
  resetKey?: unknown
  children: ReactNode
}

/**
 * 화면 일부에서 오류가 나도 그 부분만 대체 화면으로 바꾸고 나머지는 계속 쓰게 한다.
 * (오류 하나로 보드 전체가 까맣게 꺼졌던 일 — 2026-10-06). resetKey가 바뀌면 다시 그려 본다
 */
export class ErrorBoundary extends Component<Props, { failed: boolean; key: unknown }> {
  state = { failed: false, key: this.props.resetKey }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: Props, state: { failed: boolean; key: unknown }) {
    return props.resetKey === state.key ? null : { failed: false, key: props.resetKey }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[화면 오류]', error, info.componentStack)
  }

  retry = () => this.setState({ failed: false })

  render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children
  }
}
