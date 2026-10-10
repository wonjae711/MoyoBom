# 배포용 웹 이미지: 화면을 빌드해 Caddy에 넣는다 (HTTPS 자동 발급 + /api·/socket.io를 백엔드로 전달)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
