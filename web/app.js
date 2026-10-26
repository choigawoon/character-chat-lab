// 캐릭터 챗 데모 — 화면 하나(#/ 홈 · #/chat/<id> 대화 · #/new 만들기). 대화 · 직접 만든 캐릭터 · 내 소개는 이 브라우저(localStorage)에만.
const $app = document.getElementById('app');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const cid = store.get('cc.cid') || (() => { const v = crypto.randomUUID(); store.set('cc.cid', v); return v; })();
let base = [];          // 서버 캐릭터(소개만)
let busy = false;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// *행동* → 기울인 회색 · 나머지는 그대로(줄바꿈은 CSS pre-wrap)
const render = (s) => esc(s).replace(/\*([^*\n]+)\*/g, '<span class="act">*$1*</span>');
const customs = () => store.get('cc.custom', []);
const find = (id) => base.find((c) => c.id === id) || customs().find((c) => c.id === id);
let LABEL = {}, DEFAULT = '';
const model = () => { const m = store.get('cc.model', DEFAULT); return LABEL[m] ? m : DEFAULT; };
const chatKey = (id) => `cc.chat.${id}`;
const art = (c) => `background: linear-gradient(135deg, ${c.color?.[0] || '#5a4a7a'}, ${c.color?.[1] || '#c9bde6'})`;

function history(c) {
  const h = store.get(chatKey(c.id), null);
  if (h?.length) return h;
  return c.greeting ? [{ role: 'assistant', content: c.greeting }] : [];
}

function home() {
  const all = [...base, ...customs()];
  $app.innerHTML = `
    <div class="top"><h1><b>캐릭터 챗</b> 실험실</h1></div>
    <p class="lead">설정집을 넣은 캐릭터와 한국어로 대화하며 모델(${Object.values(LABEL).map(esc).join(' · ')})의 롤플레잉을 시험하는 곳이에요.
      대화는 이 브라우저에만 남고, 대화 화면 '🔍 맥락'에서 모델에 보내는 것을 그대로 볼 수 있어요.</p>
    <details class="persona"><summary>나는 누구? (선택 — 모든 캐릭터에게 알려 줄 내 소개)</summary>
      <textarea id="persona" rows="2" placeholder="예) 이름은 민준, 스무 살 대학생. 말수가 적다.">${esc(store.get('cc.persona', ''))}</textarea></details>
    <div class="grid">
      ${all.map((c) => `
        <button class="card" data-id="${esc(c.id)}">
          <div class="art" style="${art(c)}">${esc(c.avatar || '✨')}</div>
          <div class="body">
            <div class="world">${esc(c.world || '직접 만든 캐릭터')}</div>
            <div class="name">${esc(c.name)}</div>
            <div class="tag">${esc(c.tagline || '')}</div>
            <div class="chips">${(c.tags || []).map((t) => `<span class="chip">#${esc(t)}</span>`).join('')}${c.you ? `<span class="chip">나: ${esc(c.you)}</span>` : ''}</div>
            ${c.custom ? `<span class="del" data-del="${esc(c.id)}">지우기</span>` : ''}
          </div>
        </button>`).join('')}
      <button class="card new" data-new><span class="plus">＋</span>캐릭터 만들기</button>
    </div>`;
  $app.querySelector('#persona').addEventListener('input', (e) => store.set('cc.persona', e.target.value));
  $app.querySelectorAll('.card[data-id]').forEach((b) => b.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      if (confirm('이 캐릭터와 대화를 지울까요?')) { store.set('cc.custom', customs().filter((c) => c.id !== del.dataset.del)); localStorage.removeItem(chatKey(del.dataset.del)); home(); }
      return;
    }
    location.hash = `#/chat/${b.dataset.id}`;
  }));
  $app.querySelector('[data-new]').addEventListener('click', () => { location.hash = '#/new'; });
}

function chat(c) {
  let msgs = history(c);
  $app.innerHTML = `
    <div class="chat">
      <div class="bar">
        <button class="back" aria-label="목록으로">‹</button>
        <div class="ava" style="${art(c)}">${esc(c.avatar || '✨')}</div>
        <div class="who"><b>${esc(c.name)}</b><span>${esc(c.you ? `나는 ${c.you} · ` : '')}${esc(c.tagline || '')}</span></div>
        <div class="seg" role="group" aria-label="모델">${Object.keys(LABEL).map((m) => `<button data-m="${m}" class="${model() === m ? 'on' : ''}">${LABEL[m]}</button>`).join('')}</div>
        <button class="ghost" data-debug title="모델에 보내는 맥락 · 턴 기록">🔍 맥락</button>
        <button class="ghost" data-reset>처음부터</button>
      </div>
      <div class="msgs"></div>
      <form class="compose">
        <textarea rows="1" placeholder="${esc(c.you ? `${c.you}(으)로 말하기 — *행동*은 별표 안에` : '말하기 — *행동*은 별표 안에')}"></textarea>
        <button class="send" type="submit">보내기</button>
      </form>
    </div>`;
  const $msgs = $app.querySelector('.msgs');
  const $ta = $app.querySelector('textarea');
  const $send = $app.querySelector('.send');

  const draw = (pending, error) => {
    const lastBot = msgs.map((m) => m.role).lastIndexOf('assistant');
    $msgs.innerHTML = msgs.map((m, i) => m.role === 'user'
      ? `<div class="msg me"><div class="bubble">${render(m.content)}</div></div>`
      : `<div class="msg"><div class="ava" style="${art(c)}">${esc(c.avatar || '✨')}</div><div><div class="bubble">${render(m.content)}</div>
          ${m.meta || (i === lastBot && i > 0) ? `<div class="meta">${m.meta ? `<span>${esc(m.meta)}</span>` : ''}${i === lastBot && i > 0 && !pending ? '<button data-regen>다시 생성</button>' : ''}</div>` : ''}</div></div>`).join('')
      + (pending ? `<div class="msg"><div class="ava" style="${art(c)}">${esc(c.avatar || '✨')}</div><div class="bubble typing"><span></span><span></span><span></span></div></div>` : '')
      + (error ? `<div class="err">${esc(error)} <button class="ghost" data-retry>다시 시도</button></div>` : '');
    $msgs.querySelector('[data-regen]')?.addEventListener('click', regen);
    $msgs.querySelector('[data-retry]')?.addEventListener('click', ask);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  async function ask() {
    if (busy) return;
    busy = true; $send.disabled = true; draw(true);
    const body = { messages: msgs.map(({ role, content }) => ({ role, content })), model: model(), persona: store.get('cc.persona', '') };
    if (c.custom) body.custom = { name: c.name, system: c.system, greeting: c.greeting }; else body.characterId = c.id;
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-id': cid }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.text) throw new Error(d.error || '답을 받지 못했어요.');
      msgs.push({ role: 'assistant', content: d.text, meta: `${LABEL[model()]} · ${d.seconds}초${d.tokens ? ` · ${d.tokens}토큰` : ''}`,
        trace: { ...d.trace, label: LABEL[model()], seconds: d.seconds, tokens: d.tokens, promptTokens: d.promptTokens, at: new Date().toISOString() } });
      if (dbgOpen) debugPanel(c, msgs, $ta.value);
      store.set(chatKey(c.id), msgs);
      draw(false);
    } catch (e) {
      draw(false, e.message);
    } finally { busy = false; $send.disabled = false; }
  }
  function regen() {
    if (busy || msgs.at(-1)?.role !== 'assistant' || msgs.length < 2) return;
    msgs.pop(); store.set(chatKey(c.id), msgs); ask();
  }

  $app.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $ta.value.trim();
    if (!text || busy) return;
    msgs.push({ role: 'user', content: text });
    store.set(chatKey(c.id), msgs);
    $ta.value = ''; $ta.style.height = '';
    ask();
  });
  $ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $app.querySelector('form').requestSubmit(); } });
  $ta.addEventListener('input', () => { $ta.style.height = 'auto'; $ta.style.height = `${Math.min($ta.scrollHeight, 160)}px`; });
  $app.querySelector('.back').addEventListener('click', () => { location.hash = '#/'; });
  $app.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    store.set('cc.model', b.dataset.m);
    $app.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $app.querySelector('[data-debug]').addEventListener('click', () => debugPanel(c, msgs, $ta.value));
  $app.querySelector('[data-reset]').addEventListener('click', () => {
    if (!confirm('대화를 지우고 처음부터 할까요?')) return;
    localStorage.removeItem(chatKey(c.id)); msgs = history(c); draw(false);
  });
  draw(false);
  $ta.focus();
}

function make() {
  $app.innerHTML = `
    <div class="bar"><button class="back" aria-label="목록으로">‹</button><div class="who"><b>캐릭터 만들기</b><span>이 브라우저에만 저장돼요</span></div></div>
    <form class="form">
      <label>이름<input name="name" required maxlength="40" placeholder="예) 서윤"></label>
      <label>한 줄 소개<input name="tagline" maxlength="80" placeholder="예) 말 없는 편의점 야간 알바생"></label>
      <label>나는 누구로 대화하나<input name="you" maxlength="40" placeholder="예) 매일 밤 오는 단골 손님"></label>
      <label>설정집 — 세계관 · 성격 · 말투 · 비밀을 자유롭게<textarea name="system" rows="9" required maxlength="4000" placeholder="[세계관]&#10;- …&#10;[캐릭터]&#10;- 성격 …&#10;- 말투: … 예) &quot;…&quot;"></textarea></label>
      <label>첫 인사 — 대화가 시작되는 장면<textarea name="greeting" rows="3" maxlength="1000" placeholder="*편의점 문이 열리자 …* 어서 오세요."></textarea></label>
      <label>얼굴(이모지 하나)<input name="avatar" maxlength="4" value="✨"></label>
      <div class="row"><button class="ghost" type="button" data-cancel>취소</button><button class="primary" type="submit">만들고 대화하기</button></div>
    </form>`;
  const back = () => { location.hash = '#/'; };
  $app.querySelector('.back').addEventListener('click', back);
  $app.querySelector('[data-cancel]').addEventListener('click', back);
  $app.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const c = { id: `my-${Date.now().toString(36)}`, custom: true, world: '직접 만든 캐릭터', tags: [], color: ['#6b4a8a', '#e6d9f2'], ...f };
    store.set('cc.custom', [...customs(), c]);
    location.hash = `#/chat/${c.id}`;
  });
}

// ── 맥락 보기(디버그) — 모델에 보내는 것 그대로 · 턴 기록
let dbgOpen = false;
const PART = {
  system: ['설정집', '#8b6fd6'], persona: ['내 소개', '#c58af0'], greeting: ['첫 인사', '#ffb36b'],
  history: ['지난 대화', '#5a8fc4'], now: ['이번 말', '#ff7a9c'],
};
const ROLE = { system: 'system', assistant: 'assistant(캐릭터)', user: 'user(나)' };
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

function stackBar(sections) {
  const keys = Object.keys(PART).filter((k) => sections?.[k]);
  const total = keys.reduce((a, k) => a + sections[k], 0) || 1;
  return `<div class="stack">${keys.map((k) => `<span style="flex:${sections[k]};background:${PART[k][1]}" title="${PART[k][0]} ${num(sections[k])}자"></span>`).join('')}</div>
    <div class="legend">${keys.map((k) => `<span><i style="background:${PART[k][1]}"></i>${PART[k][0]} ${num(sections[k])}자 · ${Math.round((sections[k] / total) * 100)}%</span>`).join('')}</div>`;
}

function tokenChart(turns) {
  if (!turns.length) return '';
  const W = 560, H = 120, pad = 22, max = Math.max(...turns.map((t) => (t.promptTokens || 0) + (t.tokens || 0)), 1);
  const bw = Math.min(28, (W - pad * 2) / turns.length - 4);
  const bars = turns.map((t, i) => {
    const x = pad + i * ((W - pad * 2) / turns.length) + 2;
    const hi = ((t.promptTokens || 0) / max) * (H - 34), ho = ((t.tokens || 0) / max) * (H - 34);
    return `<rect x="${x}" y="${H - 18 - hi - ho}" width="${bw}" height="${ho}" fill="#ff7a9c"><title>턴 ${i + 1} 출력 ${num(t.tokens)}토큰</title></rect>
      <rect x="${x}" y="${H - 18 - hi}" width="${bw}" height="${hi}" fill="#5a8fc4"><title>턴 ${i + 1} 입력 ${num(t.promptTokens)}토큰</title></rect>
      <text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle">${i + 1}</text>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="턴마다 입력 · 출력 토큰">
    <text x="${pad}" y="11" class="hd">턴마다 토큰 — 파랑 입력(보낸 맥락) · 분홍 출력(답) · 최대 ${num(max)}</text>${bars}</svg>`;
}

function partsHtml(parts) {
  return parts.map((m, i) => {
    const [name, color] = PART[m.part] || [m.part, '#888'];
    let body = esc(m.content);
    if (m.personaAt != null) body = esc(m.content.slice(0, m.personaAt)) + `<mark style="background:${PART.persona[1]}33;color:inherit">${esc(m.content.slice(m.personaAt))}</mark>`;
    return `<details class="pm" ${m.part === 'now' || m.part === 'system' ? 'open' : ''} style="border-left-color:${color}">
      <summary><b>#${i + 1}</b> <span class="role">${ROLE[m.role] || m.role}</span> <span class="part" style="background:${color}">${name}</span> <span class="len">${num(m.content.length)}자</span></summary>
      <pre>${body}</pre></details>`;
  }).join('');
}

async function debugPanel(c, msgs, draft, turnIdx) {
  dbgOpen = true;
  let $p = document.getElementById('dbg');
  if (!$p) { $p = document.createElement('aside'); $p.id = 'dbg'; document.body.appendChild($p); }
  $p.className = 'dbg open';
  const turns = msgs.map((m, i) => ({ ...m, i })).filter((m) => m.role === 'assistant' && m.trace);
  const pickedTurn = turnIdx != null ? msgs[turnIdx] : null;
  // 무엇을 미리 볼까: 고른 턴이면 그 답 직전까지 + 그 턴의 모델, 아니면 지금 대화 + 입력칸(없으면 자리표시)
  const history = pickedTurn ? msgs.slice(0, turnIdx) : [...msgs, { role: 'user', content: draft?.trim() || '(여기에 다음에 보낼 말이 들어간다)' }];
  const mdl = pickedTurn ? Object.entries(LABEL).find(([, v]) => v === pickedTurn.trace.label)?.[0] || model() : model();
  const body = { messages: history.map(({ role, content }) => ({ role, content })), model: mdl, persona: store.get('cc.persona', '') };
  if (c.custom) body.custom = { name: c.name, system: c.system, greeting: c.greeting }; else body.characterId = c.id;
  $p.innerHTML = `<div class="dbg-head"><b>🔍 맥락 보기</b><span>${esc(c.name)}</span><button class="ghost" data-close>닫기</button></div><div class="dbg-body"><p class="hint">불러오는 중…</p></div>`;
  $p.querySelector('[data-close]').onclick = () => { dbgOpen = false; $p.className = 'dbg'; };
  const r = await fetch('/api/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ error: '불러오지 못했어요.' }));
  if (r.error) { $p.querySelector('.dbg-body').innerHTML = `<p class="err">${esc(r.error)}</p>`; return; }
  const title = pickedTurn ? `턴 ${turns.findIndex((t) => t.i === turnIdx) + 1} 에 보낸 것` : '다음에 보낼 것';
  const t = pickedTurn?.trace;
  $p.querySelector('.dbg-body').innerHTML = `
    <section>
      <h3>${title}</h3>
      ${pickedTurn ? `<p class="hint">답: ${esc(pickedTurn.content.slice(0, 80))}${pickedTurn.content.length > 80 ? '…' : ''}</p>` : '<p class="hint">입력칸에 쓴 말이 있으면 그 말로, 없으면 자리표시로 보여 줘요. 보내지는 않아요.</p>'}
      <div class="kv">
        <span>모델 <b>${esc(r.model)}</b></span><span>temperature <b>${r.params.temperature}</b></span><span>max_tokens <b>${r.params.max_tokens}</b></span>
        <span>생각 모드 <b>${r.params.reasoning}</b></span><span>보내는 메시지 <b>${r.parts.length}개</b></span><span>오래돼서 뺀 메시지 <b>${r.dropped}개</b></span>
        ${t ? `<span>입력 <b>${num(t.promptTokens)}토큰</b></span><span>출력 <b>${num(t.tokens)}토큰</b></span><span>걸린 시간 <b>${t.seconds}초</b></span><span>끝난 이유 <b>${esc(t.finish || '—')}</b></span>` : ''}
      </div>
      ${stackBar(r.sections)}
      <div class="parts">${partsHtml(r.parts)}</div>
    </section>
    <section>
      <h3>턴 기록 <small>${turns.length}턴</small></h3>
      ${turns.length ? tokenChart(turns.map((x) => x.trace)) : '<p class="hint">아직 받은 답이 없어요. 이 기능을 넣은 뒤에 받은 답부터 기록돼요.</p>'}
      <ol class="turns">${turns.map((x, n) => `<li class="${x.i === turnIdx ? 'on' : ''}">
        <div><b>턴 ${n + 1}</b> · ${esc(x.trace.label)} · 입력 ${num(x.trace.promptTokens)} → 출력 ${num(x.trace.tokens)}토큰 · ${x.trace.seconds}초 · 메시지 ${x.trace.sent}개${x.trace.dropped ? ` · 뺀 것 ${x.trace.dropped}` : ''}</div>
        <div class="mini">${stackBar(x.trace.sections)}</div>
        <div class="said">${esc(x.content.slice(0, 60))}${x.content.length > 60 ? '…' : ''}</div>
        <button class="ghost" data-turn="${x.i}">이 턴에 보낸 것 보기</button></li>`).join('')}</ol>
      ${pickedTurn ? '<button class="ghost" data-next>← 다음에 보낼 것으로</button>' : ''}
    </section>`;
  $p.querySelectorAll('[data-turn]').forEach((b) => (b.onclick = () => debugPanel(c, msgs, draft, Number(b.dataset.turn))));
  $p.querySelector('[data-next]')?.addEventListener('click', () => debugPanel(c, msgs, draft));
}

function route() {
  if (!location.hash.startsWith('#/chat/')) { dbgOpen = false; document.getElementById('dbg')?.classList.remove('open'); }
  const [, view, id] = location.hash.split('/');
  if (view === 'chat' && find(id)) return chat(find(id));
  if (view === 'new') return make();
  return home();
}

const d = await fetch('/api/characters').then((r) => r.json()).catch(() => ({ characters: [] }));
base = d.characters || [];
LABEL = Object.fromEntries((d.models || []).map((m) => [m.key, m.label]));
DEFAULT = d.defaultModel || Object.keys(LABEL).at(-1) || '';
window.addEventListener('hashchange', route);
route();
