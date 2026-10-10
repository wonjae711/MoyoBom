# 서버 배포 (AWS EC2)

구성: EC2 한 대 + Elastic IP + Docker Compose(`docker-compose.prod.yml`).
주소는 도메인을 사지 않고 [sslip.io](https://sslip.io)를 쓴다 — `13-125-1-2.sslip.io`가 IP `13.125.1.2`로 연결되는 무료 주소라서, Caddy가 이 주소로 Let's Encrypt HTTPS 인증서를 자동으로 받는다. (2026-10-10 결정: HTTP는 secure 쿠키·클립보드·Web Locks가 동작하지 않아 쓰지 않음)

```
브라우저 ──HTTPS──▶ web (Caddy: 화면 파일 + 인증서) ──▶ backend :4000 ──▶ db (PostgreSQL + pgvector)
                     80·443만 밖에 열림                   밖에 안 열림       밖에 안 열림
```

- `migrate` 서비스가 시작할 때마다 DB 마이그레이션을 적용하고 끝난 뒤 backend가 뜬다.
- 개발용 `docker-compose.yml`과 프로젝트 이름이 달라서(`moyobom-prod`) 같은 PC에서 돌려도 개발 DB를 건드리지 않는다.

## 1. EC2 만들기 (AWS 콘솔)

1. 리전: 서울(ap-northeast-2)
2. **EC2 → 인스턴스 시작**
   - 이미지: Ubuntu Server 24.04 LTS
   - 유형: **t3.small(메모리 2GB) 이상**. t3.micro(1GB)는 이미지 빌드 중 메모리가 부족하다
   - 키 페어: 새로 만들고 `.pem` 파일을 잘 보관
   - 저장소: 20GB gp3
   - 보안 그룹 인바운드: SSH 22(**내 IP만**), HTTP 80(어디서나), HTTPS 443(어디서나)
3. **EC2 → 탄력적 IP → 할당 → 작업: 연결**로 위 인스턴스에 붙인다
4. 서버 주소 정하기: IP의 점을 하이픈으로 바꾸고 `.sslip.io`를 붙인다
   - 예: `13.125.1.2` → `13-125-1-2.sslip.io` (이하 `<DOMAIN>`)

## 2. 서버 준비 (SSH 접속 후 한 번만)

```bash
ssh -i moyobom.pem ubuntu@<탄력적 IP>

# Docker 설치
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit   # 다시 접속해야 docker 그룹이 적용됨

# 스왑 2GB (빌드 중 메모리 부족 방지)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 3. 코드 받기 (private 저장소)

서버에서 읽기 전용 배포 키를 만들어 GitHub에 등록한다.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/moyobom_deploy -N ""
cat ~/.ssh/moyobom_deploy.pub   # 이 내용을 GitHub 저장소 → Settings → Deploy keys → Add (쓰기 권한 체크 안 함)

cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/moyobom_deploy
EOF

git clone git@github.com:wonjae711/MoyoBom.git && cd MoyoBom
```

## 4. 서버용 .env

저장소 루트(`~/MoyoBom/.env`)에 만든다. **채팅·Git에 붙여넣지 말 것.** 로컬 `.env`를 `scp`로 올린 뒤 고쳐도 된다:
`scp -i moyobom.pem .env ubuntu@<탄력적 IP>:~/MoyoBom/.env`

로컬 `.env`에서 바꾸거나 추가할 것:

```bash
# 서버 주소 (https:// 없이)
DOMAIN=13-125-1-2.sslip.io
# DB 비밀번호 — 영문·숫자만 (주소에 그대로 들어감). 예: openssl rand -hex 24
POSTGRES_PASSWORD=
# 로그인 토큰 서명 키 — 로컬과 다른 새 값. 예: openssl rand -base64 48
JWT_SECRET=
```

`DATABASE_URL`·`APP_ORIGIN`·`PORT`·`NODE_ENV`·`TRUST_PROXY`는 `docker-compose.prod.yml`이 정하므로 `.env`에 있어도 무시된다. `TEST_DATABASE_URL`은 서버에서 쓰지 않는다.

## 5. 소셜 로그인 주소 등록

| 곳 | 등록할 값 |
|---|---|
| 카카오 developers → 앱 → 플랫폼 → Web 사이트 도메인 | `https://<DOMAIN>` |
| 카카오 → 카카오 로그인 → Redirect URI | `https://<DOMAIN>/api/auth/kakao/callback` |
| 네이버 개발자센터 → 네이버 로그인 앱 → API 설정 → 서비스 URL | `https://<DOMAIN>` |
| 네이버 → Callback URL | `https://<DOMAIN>/api/auth/naver/callback` |

로컬(`http://localhost:5173`) 주소는 지우지 말고 함께 둔다.

## 6. 실행

```bash
cd ~/MoyoBom
docker compose -f docker-compose.prod.yml up -d --build   # 첫 빌드는 몇 분 걸림
docker compose -f docker-compose.prod.yml ps               # migrate는 Exited (0), 나머지는 Up
curl https://<DOMAIN>/api/health                           # {"status":"ok","db":true}
```

브라우저에서 `https://<DOMAIN>`으로 들어가 카카오·네이버 로그인을 확인한다.
서버 DB는 비어 있는 상태로 시작한다 — 기사는 자동 수집으로 채워지고, 계정·보드는 새로 만든다.

## 운영

```bash
# 새 버전 반영
git pull && docker compose -f docker-compose.prod.yml up -d --build

# 로그
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs web      # 인증서 발급 문제는 여기

# DB 백업
docker compose -f docker-compose.prod.yml exec db pg_dump -U moyobom moyobom > backup-$(date +%F).sql
```

- `docker compose down -v`는 **DB와 인증서 볼륨까지 지운다.** 멈출 때는 `down`(볼륨 유지)만 쓴다.
- 인증서가 발급되지 않으면: 보안 그룹 80·443이 열려 있는지, `DOMAIN`이 탄력적 IP와 맞는지 확인한다. 같은 주소로 짧은 시간에 여러 번 다시 발급받으면 Let's Encrypt 횟수 제한에 걸린다.
- 탄력적 IP를 바꾸면 `DOMAIN`과 5번의 소셜 로그인 주소도 모두 바꿔야 한다.
