-- Up Migration
-- 기사 대표 사진 (2026-10-06 사용자 요청): 사진 파일은 저장하지 않고 언론사가 밝힌 대표 사진 주소(og:image)만 둔다
-- (저작권 원칙 — 본문·이미지 사본을 보관하지 않음). image_checked_at: 주소 찾기를 한 번 시도한 시각(찾지 못해도 기록해 다시 가져오지 않음)
ALTER TABLE articles ADD COLUMN image_url TEXT;
ALTER TABLE articles ADD COLUMN image_checked_at TIMESTAMPTZ;
CREATE INDEX articles_image_pending_idx ON articles (created_at DESC)
  WHERE image_checked_at IS NULL AND source_type = 'api_collected';

-- Down Migration
DROP INDEX IF EXISTS articles_image_pending_idx;
ALTER TABLE articles DROP COLUMN IF EXISTS image_checked_at;
ALTER TABLE articles DROP COLUMN IF EXISTS image_url;
