#!/usr/bin/env bash
# 서버(EC2)에서 실행하는 배포 스크립트. CD(GitHub Actions → SSM)가 코드를 받은 뒤 호출하고, 손으로 돌려도 된다.
#   sudo bash scripts/deploy.sh
# 새 이미지를 빌드하는 동안 기존 컨테이너는 계속 돌고, 바뀐 컨테이너만 교체된다.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml"
DOMAIN=$(sed -n 's/^DOMAIN=//p' .env | tr -d '\r')

echo "[deploy] $(git log --oneline -1)"
$COMPOSE up -d --build --remove-orphans
# 예전 이미지·빌드 캐시가 쌓이면 디스크(20GB)가 찬다
docker image prune -f >/dev/null
docker builder prune -f --filter until=168h >/dev/null

# Caddy를 거쳐 실제 HTTPS 주소로 확인 (서버 안에서 자기 자신으로 연결)
for i in $(seq 1 30); do
  if curl -fsS --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health"; then
    echo
    echo "[deploy] 완료"
    exit 0
  fi
  sleep 2
done
echo "[deploy] health 확인 실패" >&2
$COMPOSE ps -a >&2
$COMPOSE logs --tail 30 backend >&2
exit 1
