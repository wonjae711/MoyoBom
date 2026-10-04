-- Up Migration
-- F-03(2026-10-04 확정 B): 비용이 드는 AI 호출의 하루 사용량. 계정·IP·서비스 전체를 따로 센다.
-- day는 한국 시간 기준 날짜(자정에 새로 셈), scope는 'user' | 'ip' | 'total', subject는 사용자 id·IP·'all'

CREATE TABLE ai_usage (
  day      date    NOT NULL,
  feature  text    NOT NULL,
  scope    text    NOT NULL CHECK (scope IN ('user', 'ip', 'total')),
  subject  text    NOT NULL,
  count    integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (day, feature, scope, subject)
);

-- Down Migration
DROP TABLE IF EXISTS ai_usage;
