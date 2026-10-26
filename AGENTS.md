# character-chat-lab — 에이전트 지침

캐릭터 챗 연구용 웹앱. 사람이 읽는 개요 · 실행 · 설정은 [README.md](README.md).

- **의존성 없음** — node 표준 라이브러리만. 서버 [server/main.mjs](server/main.mjs) · 화면 [web/](web/) · 캐릭터 [characters.json](characters.json).
- **보이는 것 = 보낸 것** — 대화(`/api/chat`)와 맥락 보기(`/api/preview`)는 같은 `buildRequest` 로 맥락을 만든다. 보내는 모양을 바꾸면 둘이 같이 바뀐다.
- **저장하지 않는다** — 대화 · 만든 캐릭터는 브라우저에만. 서버 로그에 대화 내용을 남기지 않는다(오류 머리 300자만).
- **모델 서버는 .env 로만** — 주소 · 키 · 머리글을 코드에 적지 않는다. 새 연결 방식은 `callModel` 한 곳에 한 갈래.
- **올리기 전 `./check-traces.sh`** — 실패하면 올리지 않는다.
- 테스트 `npm test`.
