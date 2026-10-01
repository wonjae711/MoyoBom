-- Up Migration
-- docs/erd.md ARTICLES (ver.1.2)
-- submitted_by의 users FK는 users 테이블을 만드는 F-07 마이그레이션에서 추가한다.
CREATE TABLE articles (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title         TEXT        NOT NULL,
  description   TEXT        NOT NULL DEFAULT '',
  source        TEXT        NOT NULL,
  category      TEXT,
  original_link TEXT        NOT NULL UNIQUE,
  source_type   TEXT        NOT NULL CHECK (source_type IN ('api_collected', 'user_submitted')),
  submitted_by  BIGINT,
  published_at  TIMESTAMPTZ,
  embedding     vector(1536),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- API 수집 기사는 카테고리와 발행 시각이 반드시 있어야 한다 (null 허용은 user_submitted만)
  CONSTRAINT articles_api_collected_required
    CHECK (source_type <> 'api_collected' OR (category IS NOT NULL AND published_at IS NOT NULL))
);

-- 카테고리별 피드·필터 (F-02, F-04)
CREATE INDEX articles_category_published_at_idx ON articles (category, published_at DESC);
-- 전체 최신순 피드 (F-02)
CREATE INDEX articles_published_at_idx ON articles (published_at DESC);

-- Down Migration
DROP TABLE IF EXISTS articles;
