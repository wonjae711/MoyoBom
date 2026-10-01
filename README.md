# 모여봄 (MoyoBom)

흩어진 뉴스를, 팀이 실시간으로 함께 모으고 정리하며 맥락을 파악하는 공동 리서치 브리핑 툴.

기획·설계 문서는 [`docs/`](docs) 참고.

## 구조

```
backend/   Node.js(Express) + TypeScript API 서버  — http://localhost:4000
frontend/  React + TypeScript (Vite)               — http://localhost:5173
docker-compose.yml  로컬 개발용 PostgreSQL + pgvector — localhost:5433
```

## 로컬 실행

사전 준비: Node.js 22+, Docker Desktop, 저장소 루트의 `.env` (아래 키 필요)

```
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=
GUARDIAN_API_KEY=
OPENAI_API_KEY=
DATABASE_URL=postgres://moyobom:moyobom@localhost:5433/moyobom
PORT=4000
```

```bash
docker compose up -d          # DB 실행

cd backend
npm install
npm run migrate -- up         # DB 마이그레이션
npm run dev                   # API 서버

cd ../frontend
npm install
npm run dev                   # 화면 (/api 요청은 백엔드로 프록시)
```

## 검사

| 위치 | 명령 |
|---|---|
| backend | `npm run lint` · `npm run typecheck` · `npm test` · `npm run build` |
| frontend | `npm run lint` · `npm run build` |

GitHub Actions(`.github/workflows/ci.yml`)가 push·PR마다 위 검사와 마이그레이션 적용을 자동으로 실행한다.
