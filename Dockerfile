# character-chat-lab — 표준 http 하나(의존성 없음). 화면(web/)도 같은 프로세스가 낸다. 모델 서버는 환경 변수로(README).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY server/*.mjs ./server/
COPY web/ ./web/
# 화면 파일을 내용 해시 이름으로 web/assets/ 에
RUN node server/build.mjs
# 세계 · 상황극 — git 정본을 구워 읽기만 한다(고치면 다시 빌드)
COPY content/worlds/ ./content/worlds/
USER node
EXPOSE 8080
CMD ["node", "server/main.mjs"]
