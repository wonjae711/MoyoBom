import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router";
import { AuthProvider } from "./auth/AuthContext";
import { AuthPage } from "./auth/AuthPage";
import { RequireAuth } from "./auth/RequireAuth";
import { BoardListPage } from "./board/BoardListPage";
import { BoardPage } from "./board/BoardPage";
import { InvitePage } from "./board/InvitePage";
import { DigestPage } from "./digests/DigestPage";
import { NewsFeed } from "./feed/NewsFeed";
import { AppHeader } from "./ui/AppHeader";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { PageError } from "./ui/PageError";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <PageBoundary>
          <Routes>
            <Route path="/login" element={<AuthPage />} />
            {/* 이메일 가입은 없앴다 (2026-10-06) — 예전 주소로 오면 로그인 화면으로 */}
            <Route path="/signup" element={<Navigate to="/login" replace />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <BoardListPage />
                </RequireAuth>
              }
            />
            <Route
              path="/boards/:boardId"
              element={
                <RequireAuth>
                  <BoardPage />
                </RequireAuth>
              }
            />
            {/* 초대 링크: 로그인 전이면 로그인 후 이 화면으로 돌아온다 (C-12) */}
            <Route
              path="/invite/:token"
              element={
                <RequireAuth>
                  <InvitePage />
                </RequireAuth>
              }
            />
            <Route
              path="/feed"
              element={
                <RequireAuth>
                  <div className="page">
                    <AppHeader />
                    <NewsFeed />
                  </div>
                </RequireAuth>
              }
            />
            <Route
              path="/digests"
              element={
                <RequireAuth>
                  <div className="page">
                    <AppHeader />
                    <DigestPage />
                  </div>
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </PageBoundary>
      </AuthProvider>
    </BrowserRouter>
  );
}

function PageBoundary({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary
      resetKey={pathname}
      fallback={(retry) => <PageError onRetry={retry} />}
    >
      {children}
    </ErrorBoundary>
  );
}

export default App;
