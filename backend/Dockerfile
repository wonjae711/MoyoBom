# 배포용 백엔드 이미지 (docker-compose.prod.yml)
# build 단계는 마이그레이션 실행(migrate 서비스)에도 쓴다 — node-pg-migrate가 devDependency라서
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
