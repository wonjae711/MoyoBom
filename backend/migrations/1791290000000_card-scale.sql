-- Up Migration
-- 카드 크기 (2026-10-10, 사용자 요청): 카드를 통째로 확대·축소하는 배율. 1 = 기본 크기
ALTER TABLE board_items ADD COLUMN scale DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (scale >= 0.6 AND scale <= 2.5);

-- Down Migration
ALTER TABLE board_items DROP COLUMN scale;
