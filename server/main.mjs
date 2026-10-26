// character-chat-lab — 캐릭터 챗 연구용 웹앱. 화면(web/)과 /api 를 내는 node 하나. 의존성 없음.
//
//   GET  /api/healthz
//   GET  /api/characters          기본 캐릭터 목록(characters.json — 카드엔 소개 · 첫 인사만) + 고를 수 있는 모델
//   POST /api/chat                { characterId | custom:{name, system, greeting}, messages:[{role,content}], model, persona? }
//                                 → 모델 서버(LLM_API) · 답에 trace(이 턴에 보낸 것의 요약)
//   POST /api/preview             /api/chat 과 같은 몸 → 보낼 맥락 그대로(messages · 설정값 · 구성) — 모델은 부르지 않는다(맥락 보기)
//   GET  /assets/<이름.해시.확장자>  화면 파일(server/build.mjs 로 구웠을 때)
//
// 대화 · 직접 만든 캐릭터는 브라우저(localStorage)에만 있다. 서버는 아무것도 저장하지 않는다.
// 모델 서버는 환경 변수로 고른다 — README '모델 연결'.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const env = process.env;
const VERSION = env.APP_VERSION || 'dev';
// 모델 서버 — ollama(기본 · 로컬 Ollama 고유 API) | openai(OpenAI 호환 /chat/completions) | textgen({model, messages} → {text, usage} 를 주고받는 관문)
const LLM_API = env.LLM_API || 'ollama';
const LLM_BASE_URL = (env.LLM_BASE_URL || (LLM_API === 'ollama' ? 'http://localhost:11434' : '')).replace(/\/$/, '');
const LLM_HEADERS = env.LLM_HEADERS ? JSON.parse(env.LLM_HEADERS) : {};   // 관문이 요구하는 머리글(호출자 이름 등)
const LLM_USER_HEADER = env.LLM_USER_HEADER || '';                        // 사용자 구분 머리글 이름(관문이 사용자별 한도를 셀 때) — 값은 브라우저 id 의 해시
// 화면의 모델 고르기 — [{key, label, id}] · id 는 모델 서버가 아는 이름
const MODEL_LIST = env.MODELS ? JSON.parse(env.MODELS) : [
  { key: 'e2b', label: 'E2B', id: 'gemma4:e2b' },
  { key: 'e4b', label: 'E4B', id: 'gemma4:e4b' },
];
const MODELS = Object.fromEntries(MODEL_LIST.map((m) => [m.key, m.id]));
const DEFAULT_MODEL = env.DEFAULT_MODEL || MODEL_LIST.at(-1).key;
const REASONING_EFFORT = env.REASONING_EFFORT ?? 'none';                 // openai 갈래에서만 쓴다
const MAX_TURNS = 40;          // 보내는 대화 길이 — 오래된 것부터 뺀다(설정집 + 첫 인사는 늘 남긴다)
const MAX_TEXT = 4000;         // 메시지 하나 · 직접 만든 설정집 길이 한도
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const ASSET = /^\/assets\/[\w-]+\.[0-9a-f]{10}\.(js|css|svg)$/;

const characters = JSON.parse(await readFile(join(ROOT, 'characters.json'), 'utf8'));
const byId = new Map(characters.map((c) => [c.id, c]));
// 화면에 내는 것 — 소개 · 첫 인사(설정집 원문은 맥락 보기 /api/preview 로만)
const publicList = characters.map(({ system, ...c }) => c);
const PARAMS = { temperature: Number(env.TEMPERATURE || 0.8), max_tokens: Number(env.MAX_TOKENS || 600), reasoning: 'off' };

function send(res, status, body, type = 'application/json; charset=utf-8', cache = 'no-store') {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { 'content-type': type, 'cache-control': cache, 'x-content-type-options': 'nosniff' });
  res.end(buf);
}

async function readJson(req) {
  let size = 0; const parts = [];
  for await (const c of req) { size += c.length; if (size > 200_000) throw new Error('too large'); parts.push(c); }
  return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
}

const clip = (s, n = MAX_TEXT) => String(s ?? '').slice(0, n);

// 설정집 + 내 소개 + 첫 인사 + 대화 → 모델에 보낼 messages
export function buildMessages({ system, greeting, persona, messages }) {
  let sys = clip(system, 8000);
  const personaAt = persona?.trim() ? sys.length : null;   // 맥락 보기가 '내 소개' 부분을 따로 칠한다
  if (personaAt != null) sys += `\n\n[사용자에 대해]\n${clip(persona, 600)}`;
  const kept = (messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
    .map((m) => ({ role: m.role, content: clip(m.content) }));
  const valid = kept.length;
  const turns = kept.slice(-MAX_TURNS);
  const head = [{ role: 'system', content: sys, part: 'system', personaAt }];
  if (greeting) head.push({ role: 'assistant', content: clip(greeting), part: 'greeting' });
  // 첫 인사를 따로 넣었으니 화면이 보낸 대화 맨 앞의 같은 인사는 뺀다
  if (greeting && turns[0]?.role === 'assistant' && turns[0].content === clip(greeting)) turns.shift();
  const all = [...head, ...turns.map((t, i) => ({ ...t, part: i === turns.length - 1 && t.role === 'user' ? 'now' : 'history' }))];
  all.dropped = Math.max(0, valid - MAX_TURNS);
  return all;
}

// 한 턴의 요청 — 대화와 맥락 보기가 같은 함수를 쓴다(보이는 것 = 보낸 것)
function buildRequest(body) {
  const model = MODELS[body.model] || MODELS[DEFAULT_MODEL];
  let system, greeting;
  if (body.characterId) {
    const c = byId.get(body.characterId);
    if (!c) return { error: [404, '없는 캐릭터예요.'] };
    ({ system, greeting } = c);
  } else if (body.custom?.system?.trim()) {
    system = `너는 지금부터 롤플레잉 캐릭터 '${clip(body.custom.name || '이름 없는 캐릭터', 40)}'다. 아래 설정집을 지키며 한국어로만 대답한다.\n\n${clip(body.custom.system)}\n\n[대답 규칙]\n- 사용자의 대사나 행동을 대신 쓰지 않는다.\n- 대사는 그대로, 행동 · 표정은 *별표* 안에 쓴다.\n- 한 번에 3~6문장. 캐릭터에서 벗어나 설명하지 않는다.\n- 전연령 수위를 지킨다.`;
    greeting = clip(body.custom.greeting, 1000);
  } else return { error: [400, '캐릭터가 없어요.'] };
  const parts = buildMessages({ system, greeting, persona: body.persona, messages: body.messages });
  const sections = {};
  for (const m of parts) sections[m.part] = (sections[m.part] || 0) + m.content.length;
  if (parts[0].personaAt != null) { sections.persona = parts[0].content.length - parts[0].personaAt; sections.system -= sections.persona; }
  return {
    model, params: PARAMS, dropped: parts.dropped, sections,
    parts: parts.map(({ role, content, part, personaAt }) => ({ role, part, content, ...(personaAt != null ? { personaAt } : {}) })),
    messages: parts.map(({ role, content }) => ({ role, content })),
  };
}

async function chat(body, actor) {
  const req = buildRequest(body);
  if (req.error) return [req.error[0], { error: req.error[1] }];
  const { model, messages } = req;
  if (messages.at(-1).role !== 'user') return [400, { error: '보낼 말이 없어요.' }];
  const t0 = Date.now();
  let out;
  try { out = await callModel(model, messages, actor); } catch (e) {
    console.error(new Date().toISOString(), 'model', e.status || '', String(e.detail || e.message).slice(0, 300));
    const why = { 403: '이 모델은 쓸 수 없어요.', 404: '모델 서버가 이 모델을 모른대요(이름 확인 · ollama pull).', 429: '쓸 수 있는 횟수를 다 썼거나 줄이 길어요. 잠시 뒤 다시 해 주세요.', 503: '모델 서버가 바빠요. 10초쯤 뒤 다시 해 주세요.' }[e.status];
    return [502, { error: why || '모델 서버가 답하지 않았어요. 연결 설정(LLM_API · LLM_BASE_URL)을 확인해 주세요.' }];
  }
  return [200, {
    text: out.text.trim(),
    model: out.model || model,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    tokens: out.tokens,
    promptTokens: out.promptTokens,
    // 이 턴에 보낸 것의 요약 — 원문은 같은 대화로 /api/preview 를 다시 부르면 그대로 나온다
    trace: { model, api: LLM_API, params: PARAMS, sent: messages.length, dropped: req.dropped, sections: req.sections, finish: out.finish },
  }];
}

// 모델 서버 세 갈래 — 모두 {text, tokens, promptTokens, finish, model} 로 맞춘다
async function callModel(model, messages, actor) {
  const headers = { 'content-type': 'application/json', ...LLM_HEADERS };
  if (LLM_USER_HEADER) headers[LLM_USER_HEADER] = actor;
  if (LLM_API === 'openai' && env.LLM_API_KEY) headers.authorization = `Bearer ${env.LLM_API_KEY}`;
  const req = {
    ollama: [`${LLM_BASE_URL}/api/chat`, { model, messages, stream: false, think: false, options: { temperature: PARAMS.temperature, num_predict: PARAMS.max_tokens } }],
    // 생각 모드 끄기 — Ollama 의 OpenAI 호환 길은 'none' 을 안다. 모르는 관문이면 .env REASONING_EFFORT= (빈 값)으로 빼거나 그 관문의 값을 넣는다
    openai: [`${LLM_BASE_URL}/chat/completions`, { model, messages, temperature: PARAMS.temperature, max_tokens: PARAMS.max_tokens, ...(REASONING_EFFORT ? { reasoning_effort: REASONING_EFFORT } : {}) }],
    textgen: [LLM_BASE_URL, { model, messages, ...PARAMS, priority: 'interactive' }],
  }[LLM_API];
  if (!req) throw Object.assign(new Error(`LLM_API 는 ollama · openai · textgen 중 하나 — 지금 '${LLM_API}'`), { status: 0 });
  const r = await fetch(req[0], { method: 'POST', headers, body: JSON.stringify(req[1]), signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status, detail: await r.text().catch(() => '') });
  const d = await r.json();
  if (LLM_API === 'ollama') return { text: d.message?.content || '', tokens: d.eval_count ?? null, promptTokens: d.prompt_eval_count ?? null, finish: d.done_reason ?? null, model: d.model };
  if (LLM_API === 'openai') return { text: d.choices?.[0]?.message?.content || '', tokens: d.usage?.completion_tokens ?? null, promptTokens: d.usage?.prompt_tokens ?? null, finish: d.choices?.[0]?.finish_reason ?? null, model: d.model };
  return { text: d.text || '', tokens: d.usage?.completion_tokens ?? null, promptTokens: d.usage?.prompt_tokens ?? null, finish: d.finish_reason ?? null, model: d.model };
}

async function handle(req, res) {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (path === '/api/healthz') return send(res, 200, { ok: true, version: VERSION });
    if (path === '/api/characters' && req.method === 'GET') return send(res, 200, { characters: publicList, models: MODEL_LIST.map(({ key, label }) => ({ key, label })), defaultModel: DEFAULT_MODEL, api: LLM_API, version: VERSION });
    if (path === '/api/chat' && req.method === 'POST') {
      const body = await readJson(req).catch(() => null);
      if (!body) return send(res, 400, { error: '요청을 읽지 못했어요.' });
      // 사용자 구분 — 브라우저가 만든 임의 id 의 해시(LLM_USER_HEADER 가 있을 때만 보낸다). 이름 · 기기 정보는 보내지 않는다
      const actor = createHash('sha256').update(String(req.headers['x-client-id'] || req.socket.remoteAddress)).digest('hex').slice(0, 16);
      const [status, out] = await chat(body, actor);
      return send(res, status, out);
    }
    if (path === '/api/preview' && req.method === 'POST') {
      const body = await readJson(req).catch(() => null);
      if (!body) return send(res, 400, { error: '요청을 읽지 못했어요.' });
      const r = buildRequest(body);
      if (r.error) return send(res, r.error[0], { error: r.error[1] });
      const { messages, ...out } = r;
      return send(res, 200, out);
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'method' });
    if (ASSET.test(path)) {
      const local = await readFile(join(WEB, path)).catch(() => null);
      const body = local;
      if (!body) return send(res, 404, 'not found', 'text/plain');
      return send(res, 200, body, TYPES[extname(path)], 'public, max-age=31536000, immutable');
    }
    // 굽기 전(로컬 npm run dev)엔 /app.js 처럼 원래 이름으로 부른다
    const f = path === '/' || !extname(path) ? '/index.html' : path;
    if (!/^\/[\w.-]+$/.test(f)) return send(res, 404, 'not found', 'text/plain');
    let body = await readFile(join(WEB, f)).catch(() => null);
    if (!body) return send(res, 404, 'not found', 'text/plain');
    if (f === '/index.html') body = Buffer.from(body.toString('utf8').replaceAll('__APP_VERSION__', VERSION));
    return send(res, 200, body, TYPES[extname(f)] || 'application/octet-stream');
  } catch (e) {
    console.error(new Date().toISOString(), path, e);
    return send(res, 500, { error: '서버에서 문제가 생겼어요.' });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(env.PORT || 8080);
  createServer(handle).listen(port, () => console.error(new Date().toISOString(), `character-chat-lab ${VERSION} :${port} · 캐릭터 ${characters.length} · 모델 서버 ${LLM_API} ${LLM_BASE_URL || '(LLM_BASE_URL 없음)'} · 모델 ${MODEL_LIST.map((m) => m.id).join(', ')}`));
}
