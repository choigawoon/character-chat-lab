// character-chat-lab — 캐릭터 챗 연구용 웹앱. 화면(web/)과 /api 를 내는 node 하나. 의존성 없음.
//
//   GET  /api/healthz
//   GET  /api/worlds              세계 · 상황극 목록(content/worlds — 소개 · 장면 · 첫 장면만) + 고를 수 있는 모델
//   POST /api/chat                { scenarioId, you?, notes?, summary?, messages:[{role,content,direct?}], model } | { custom:{name, system, greeting}, persona?, … }
//                                 → 모델 서버(LLM_API) · 답에 trace(이 턴에 보낸 것의 요약)
//   POST /api/preview             /api/chat 과 같은 몸 → 보낼 맥락 그대로(messages · 설정값 · 구성) — 모델은 부르지 않는다(맥락 보기)
//   POST /api/memory              { scenarioId, you?, summary?, fold:[messages] } → { summary } — 오래된 대화를 줄거리로 접는다(MEMORY_MODEL)
//   GET  /assets/<이름.해시.확장자>  화면 파일(server/build.mjs 로 구웠을 때)
//
// 대화 · 직접 만든 캐릭터는 브라우저(localStorage)에만 있다. 서버는 아무것도 저장하지 않는다.
// 모델 서버는 환경 변수로 고른다 — README '모델 연결'.
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
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

// ── 세계 · 상황극 — content/worlds/*.json (규약 content/SCHEMA.md). 최상위 모델이 미리 쓴 세계관 · 인물 · 상황 · 숨은 전개 · 기억 · 로어북
const WORLDS_DIR = join(ROOT, 'content', 'worlds');
export const worlds = [];
for (const f of (await readdir(WORLDS_DIR)).filter((f) => f.endsWith('.json')).sort()) {
  const w = JSON.parse(await readFile(join(WORLDS_DIR, f), 'utf8'));
  const chars = new Map(w.characters.map((c) => [c.id, c]));
  for (const sc of w.scenarios) for (const id of [sc.lead, ...sc.cast]) if (!chars.has(id)) throw new Error(`${f}: ${sc.id} 의 인물 ${id} 가 없다`);
  worlds.push({ ...w, chars });
}
worlds.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
const scenarioById = new Map(worlds.flatMap((w) => w.scenarios.map((sc) => [sc.id, { world: w, sc }])));
// 화면에 내는 것 — 소개 · 상황 · 첫 장면 · 등장인물 이름(숨은 전개 · 시트 원문은 맥락 보기 /api/preview 로만)
const worldList = worlds.map((w) => ({
  id: w.id, title: w.title, source: w.source, genre: w.genre, cover: w.cover, summary: w.summary,
  scenarios: w.scenarios.map((sc) => ({
    id: sc.id, title: sc.title, hook: sc.hook, you: sc.you, goal: sc.goal, setting: sc.setting, opening: sc.opening,
    lead: { name: w.chars.get(sc.lead).name, emoji: w.chars.get(sc.lead).emoji, color: w.chars.get(sc.lead).color },
    cast: sc.cast.map((id) => ({ name: w.chars.get(id).name, emoji: w.chars.get(id).emoji })),
  })),
}));
const PARAMS = { temperature: Number(env.TEMPERATURE || 0.8), max_tokens: Number(env.MAX_TOKENS || 600), reasoning: 'off' };
const LORE_LOOKBACK = 6;       // 로어북 낱말을 찾는 최근 메시지 수(+ 이번 말)
const LORE_MAX = 6;            // 한 턴에 넣는 로어북 항목 수 한도

function send(res, status, body, type = 'application/json; charset=utf-8', cache = 'no-store') {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { 'content-type': type, 'cache-control': cache, 'x-content-type-options': 'nosniff' });
  res.end(buf);
}

async function readJson(req) {
  let size = 0; const parts = [];
  for await (const c of req) { size += c.length; if (size > 400_000) throw new Error('too large'); parts.push(c); }
  return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
}

const clip = (s, n = MAX_TEXT) => String(s ?? '').slice(0, n);

// 화면이 보낸 대화 → 모델 메시지. 연출 지시(direct)는 사용자 대사가 아니라 장면 지시로 바꿔 넣는다
function turnContent(m) {
  if (m.role === 'user' && m.direct) return `[연출 지시] ${clip(m.content, 600)}\n(위 지시를 이야기에 반영해 다음 장면을 이어 써라. 사용자의 대사 · 행동은 쓰지 않는다.)`;
  return clip(m.content);
}

// system(구획들) + 첫 장면 + 대화 → 모델에 보낼 messages. sections 는 맥락 보기가 구획마다 칠하는 표
export function buildMessages({ system, sections, greeting, persona, messages }) {
  const secs = sections ? [...sections] : [{ part: 'system', title: '설정집', text: clip(system, 8000) }];
  if (persona?.trim()) secs.splice(secs.length - (sections ? 1 : 0), 0, { part: 'persona', title: '사용자에 대해', text: clip(persona, 600) });
  const sys = secs.map((x) => (x.title && sections ? `[${x.title}]\n${x.text}` : x.title === '사용자에 대해' ? `[사용자에 대해]\n${x.text}` : x.text)).join('\n\n');
  const kept = (messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
    .map((m) => ({ role: m.role, content: turnContent(m), direct: !!m.direct }));
  const valid = kept.length;
  const turns = kept.slice(-MAX_TURNS);
  const head = [{ role: 'system', content: sys, part: 'system', sections: secs }];
  if (greeting) head.push({ role: 'assistant', content: clip(greeting), part: sections ? 'opening' : 'greeting' });
  // 첫 장면을 따로 넣었으니 화면이 보낸 대화 맨 앞의 같은 장면은 뺀다
  if (greeting && turns[0]?.role === 'assistant' && turns[0].content === clip(greeting)) turns.shift();
  const all = [...head, ...turns.map((t, i) => ({ role: t.role, content: t.content, part: i === turns.length - 1 && t.role === 'user' ? (t.direct ? 'direct' : 'now') : 'history' }))];
  all.dropped = Math.max(0, valid - MAX_TURNS);
  return all;
}

// 로어북 — 최근 대화 · 이번 말에 keys 중 하나가 나온 항목만
export function matchLore(lore, messages) {
  const text = (messages || []).slice(-(LORE_LOOKBACK + 1)).map((m) => m.content || '').join('\n').toLowerCase();
  return (lore || []).filter((l) => l.keys.some((k) => k && text.includes(String(k).toLowerCase()))).slice(0, LORE_MAX);
}

// 상황극의 system 구획 — 순서가 곧 중요도(규칙 → 세계 → 인물 → 장면 → 숨은 전개 → 기억 → 로어북 → 다시 한 번)
export function scenarioSections({ world, sc, you, notes, summary, messages }) {
  const lead = world.chars.get(sc.lead);
  const cast = [lead, ...sc.cast.filter((id) => id !== sc.lead).map((id) => world.chars.get(id))];
  const youName = clip(you || sc.you, 200);
  const rules = [
    `너는 이 상황극의 진행자이자 '${lead.name}'(을)를 중심으로 등장인물을 연기한다. 사용자는 ${youName}(이)다.`,
    '- 한국어로만 쓴다. 사용자의 대사 · 행동 · 속마음은 대신 쓰지 않는다 — 사용자의 차례를 남기고 멈춘다.',
    '- 대사는 그대로, 행동 · 표정 · 장면 묘사는 *별표* 안에 쓴다. 다른 인물이 말할 때는 「이름: 대사」로 쓴다.',
    `- 한 번에 3~6문장. 인물은 아래 시트의 말투 · 호칭을 지킨다. 세계관에 없는 큰 설정을 지어내지 않는다.`,
    '- [진행 메모]는 사용자에게 말하지 않는다. 사용자가 이끄는 쪽을 먼저 따르고, 이야기가 멈추면 메모의 다음 사건을 꺼낸다.',
    '- 사용자가 [연출 지시]를 주면 그대로 장면에 반영한다. 전연령 수위를 지킨다.',
  ].join('\n');
  const sheets = cast.map((c) => `■ ${c.name}${c.id === sc.lead ? ' (중심 인물)' : ''}\n${c.sheet}\n말투 예: ${(c.speech || []).map((x) => `"${x}"`).join(' / ')}`).join('\n\n');
  const memory = [
    `· 처음부터 기억할 것\n${(sc.pinned || []).map((x) => `- ${x}`).join('\n')}`,
    notes?.trim() ? `· 사용자가 적어 둔 것\n${clip(notes, 1200)}` : '',
    summary?.trim() ? `· 지난 줄거리(앞 대화를 접은 것)\n${clip(summary, 2000)}` : '',
  ].filter(Boolean).join('\n\n');
  const lore = matchLore(world.lore, messages);
  const secs = [
    { part: 'rules', title: '대답 규칙', text: rules },
    { part: 'world', title: `세계관 — ${world.title}`, text: world.bible },
    { part: 'cast', title: '등장인물', text: sheets },
    { part: 'scene', title: `지금 장면 — ${sc.title}`, text: sc.setting },
    { part: 'director', title: '진행 메모 — 사용자에게 말하지 않는다', text: (sc.director || []).join('\n') },
    { part: 'memory', title: '기억', text: memory },
  ];
  if (lore.length) secs.push({ part: 'lore', title: '참고 — 대화에 나온 것', text: lore.map((l) => `- ${l.text}`).join('\n'), keys: lore.map((l) => l.keys[0]) });
  secs.push({ part: 'reminder', title: '다시 한 번', text: `${lead.name}의 말투로, 3~6문장, 사용자(${youName.split(/[ —-]/)[0]})의 대사는 쓰지 않는다.` });
  return secs;
}

// 한 턴의 요청 — 대화와 맥락 보기가 같은 함수를 쓴다(보이는 것 = 보낸 것)
function buildRequest(body) {
  const model = MODELS[body.model] || MODELS[DEFAULT_MODEL];
  let built;
  if (body.scenarioId) {
    const hit = scenarioById.get(body.scenarioId);
    if (!hit) return { error: [404, '없는 상황극이에요.'] };
    const sections = scenarioSections({ world: hit.world, sc: hit.sc, you: body.you, notes: body.notes, summary: body.summary, messages: body.messages });
    // 앞 대화를 줄거리로 접었으면 첫 장면은 줄거리 안에 있다 — 다시 넣지 않는다
    built = buildMessages({ sections, greeting: body.summary?.trim() ? '' : hit.sc.opening, messages: body.messages });
  } else if (body.custom?.system?.trim()) {
    const system = `너는 지금부터 롤플레잉 캐릭터 '${clip(body.custom.name || '이름 없는 캐릭터', 40)}'다. 아래 설정집을 지키며 한국어로만 대답한다.\n\n${clip(body.custom.system)}\n\n[대답 규칙]\n- 사용자의 대사나 행동을 대신 쓰지 않는다.\n- 대사는 그대로, 행동 · 표정은 *별표* 안에 쓴다.\n- 한 번에 3~6문장. 캐릭터에서 벗어나 설명하지 않는다.\n- 전연령 수위를 지킨다.`;
    built = buildMessages({ system, greeting: clip(body.custom.greeting, 1000), persona: body.persona, messages: body.messages });
  } else return { error: [400, '상황극이나 캐릭터가 없어요.'] };
  const sections = {};
  for (const m of built) {
    if (m.part === 'system') for (const x of m.sections) sections[x.part] = (sections[x.part] || 0) + x.text.length;
    else sections[m.part] = (sections[m.part] || 0) + m.content.length;
  }
  return {
    model, params: PARAMS, dropped: built.dropped, sections,
    parts: built.map(({ role, content, part, sections: secs }) => ({ role, part, content, ...(secs ? { sections: secs } : {}) })),
    messages: built.map(({ role, content }) => ({ role, content })),
  };
}

// ── 기억 접기 — 오래된 대화를 줄거리로. 작은 모델이 놓치는 앞 이야기를 붙드는 일이라 MEMORY_MODEL(더 큰 모델)에 맡긴다
const MEMORY_MODEL = env.MEMORY_MODEL || MODELS[DEFAULT_MODEL];
export function memoryPrompt({ title, summary, fold, you }) {
  const lines = fold.map((m) => (m.role === 'user' ? (m.direct ? `[연출 지시] ${m.content}` : `사용자(${you}): ${m.content}`) : `진행 · 인물: ${m.content}`)).join('\n');
  return [
    { role: 'system', content: '너는 롤플레잉 기록 담당이다. 다음 장면을 이어 쓸 사람이 꼭 알아야 할 것만 한국어로 정리한다. 대화에 없는 일은 지어내지 않는다.\n형식(전체 700자 이내):\n[줄거리] 일어난 일을 순서대로 5~10줄\n[관계 · 감정] 인물 사이가 어떻게 바뀌었나\n[약속 · 비밀 · 물건] 앞으로 이어질 것\n[지금] 마지막 장면의 장소 · 상황 한두 줄' },
    { role: 'user', content: `상황극: ${title}\n\n지금까지 줄거리:\n${summary?.trim() || '(없음 — 처음 접는다)'}\n\n새로 접을 대화:\n${lines}\n\n위 둘을 합쳐 새 기록을 형식대로 써라.` },
  ];
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
    trace: { model, api: LLM_API, params: PARAMS, sent: messages.length, dropped: req.dropped, sections: req.sections, finish: out.finish, lore: req.parts[0].sections?.find((x) => x.part === 'lore')?.keys || [] },
  }];
}

// 모델 서버 세 갈래 — 모두 {text, tokens, promptTokens, finish, model} 로 맞춘다
// 연결 — 대화(CHAT)와 기억 접기(MEMORY)가 서로 다른 모델 서버를 쓸 수 있다(기억은 더 큰 · 클라우드 모델에)
const CHAT = { api: LLM_API, base: LLM_BASE_URL, key: env.LLM_API_KEY || '', headers: LLM_HEADERS, userHeader: LLM_USER_HEADER };
const MEMORY = env.MEMORY_LLM_API ? {
  api: env.MEMORY_LLM_API, base: (env.MEMORY_LLM_BASE_URL || '').replace(/\/$/, ''), key: env.MEMORY_LLM_API_KEY || '',
  headers: env.MEMORY_LLM_HEADERS ? JSON.parse(env.MEMORY_LLM_HEADERS) : {}, userHeader: '',
} : CHAT;

async function callModel(model, messages, actor, P = PARAMS, C = CHAT) {
  const LLM_API = C.api, LLM_BASE_URL = C.base;
  const headers = { 'content-type': 'application/json', ...C.headers };
  if (C.userHeader) headers[C.userHeader] = actor;
  if (LLM_API === 'openai' && C.key) headers.authorization = `Bearer ${C.key}`;
  const req = {
    ollama: [`${LLM_BASE_URL}/api/chat`, { model, messages, stream: false, think: false, options: { temperature: P.temperature, num_predict: P.max_tokens } }],
    // 생각 모드 끄기 — Ollama 의 OpenAI 호환 길은 'none' 을 안다. 모르는 관문이면 .env REASONING_EFFORT= (빈 값)으로 빼거나 그 관문의 값을 넣는다
    openai: [`${LLM_BASE_URL}/chat/completions`, { model, messages, temperature: P.temperature, max_tokens: P.max_tokens, ...(REASONING_EFFORT ? { reasoning_effort: REASONING_EFFORT } : {}) }],
    textgen: [LLM_BASE_URL, { model, messages, ...P, priority: 'interactive' }],
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
    if (path === '/api/worlds' && req.method === 'GET') return send(res, 200, { worlds: worldList, models: MODEL_LIST.map(({ key, label }) => ({ key, label })), defaultModel: DEFAULT_MODEL, memoryModel: MEMORY_MODEL, api: LLM_API, version: VERSION });
    if (path === '/api/memory' && req.method === 'POST') {
      const body = await readJson(req).catch(() => null);
      const hit = body && scenarioById.get(body.scenarioId);
      if (!hit || !Array.isArray(body.fold) || !body.fold.length) return send(res, 400, { error: '접을 대화가 없어요.' });
      const msgs = memoryPrompt({ title: `${hit.world.title} · ${hit.sc.title}`, summary: body.summary, fold: body.fold.map((m) => ({ role: m.role, direct: !!m.direct, content: clip(m.content) })), you: clip(body.you || hit.sc.you, 60) });
      const t0 = Date.now();
      try {
        const out = await callModel(MEMORY_MODEL, msgs, 'memory', { temperature: 0.2, max_tokens: 900, reasoning: 'off' }, MEMORY);
        return send(res, 200, { summary: out.text.trim(), model: out.model || MEMORY_MODEL, seconds: Math.round((Date.now() - t0) / 100) / 10, tokens: out.tokens, promptTokens: out.promptTokens });
      } catch (e) {
        console.error(new Date().toISOString(), 'memory', e.status || '', String(e.detail || e.message).slice(0, 300));
        return send(res, 502, { error: '기억 정리 모델이 답하지 않았어요(MEMORY_MODEL 확인).' });
      }
    }
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
  createServer(handle).listen(port, () => console.error(new Date().toISOString(), `character-chat-lab ${VERSION} :${port} · 세계 ${worlds.length} · 상황극 ${scenarioById.size} · 모델 서버 ${LLM_API} ${LLM_BASE_URL || '(LLM_BASE_URL 없음)'} · 모델 ${MODEL_LIST.map((m) => m.id).join(', ')} · 기억 ${MEMORY.api === CHAT.api && MEMORY.base === CHAT.base ? '' : `${MEMORY.api} ${MEMORY.base} `}${MEMORY_MODEL}`));
}
