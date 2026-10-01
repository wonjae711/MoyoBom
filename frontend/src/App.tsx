import { useEffect, useState } from 'react'

type Health = { status: 'ok' | 'degraded'; db: boolean }

// 프로젝트 세팅 확인용 임시 화면. F-02 단계에서 뉴스 피드 화면으로 교체한다.
function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setError(true))
  }, [])

  return (
    <main style={{ padding: 32 }}>
      <h1>모여봄</h1>
      <p>흩어진 뉴스를, 팀이 실시간으로 함께 모으고 정리하는 공동 리서치 브리핑 툴</p>
      <p>
        백엔드 상태:{' '}
        {error ? '연결 실패' : health ? `${health.status} (DB ${health.db ? '연결됨' : '끊김'})` : '확인 중…'}
      </p>
    </main>
  )
}

export default App
