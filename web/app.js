// 캐릭터 챗 실험실 — 화면 하나.
//   #/              세계 · 상황극 목록 + 직접 만든 캐릭터
//   #/s/<id>        상황극 소개(장면 · 내 역할 · 등장인물) → 시작
//   #/play/<id>     상황극 플레이(연출 지시 · 기억 접기 · 맥락 보기)
//   #/chat/<id>     직접 만든 캐릭터와 대화 · #/new 만들기
// 대화 · 기억 · 만든 캐릭터는 이 브라우저(localStorage)에만.
const $app = document.getElementById('app');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const cid = store.get('cc.cid') || (() => { const v = crypto.randomUUID(); store.set('cc.cid', v); return v; })();
let WORLDS = [], LABEL = {}, DEFAULT = '', MEMORY_MODEL = '';
let busy = false;
const FOLD_AT = 24;   // 접지 않은 메시지가 이만큼 넘으면
const KEEP = 10;      // 최근 이만큼은 남기고 앞을 줄거리로 접는다

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// *행동* → 기울인 회색 · 「이름: 대사」 → 이름 굵게
const render = (s) => esc(s).replace(/\*([^*\n]+)\*/g, '<span class="act">*$1*</span>').replace(/「([^:：」]{1,12})[:：]/g, '「<b>$1</b>:');
const model = () => { const m = store.get('cc.model', DEFAULT); return LABEL[m] ? m : DEFAULT; };
const art = (color) => `background: linear-gradient(135deg, ${color?.[0] || '#5a4a7a'}, ${color?.[1] || '#c9bde6'})`;
const customs = () => store.get('cc.custom', []);
const findScenario = (id) => { for (const w of WORLDS) { const sc = w.scenarios.find((s) => s.id === id); if (sc) return { w, sc }; } return null; };
const playKey = (id) => `cc.play.${id}`;
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

// ── 첫 화면
function home() {
  const cs = customs();
  $app.innerHTML = `
    <div class="top"><h1><b>캐릭터 챗</b> 실험실</h1></div>
    <p class="lead">미리 짜 둔 세계 · 상황극에 들어가 마음대로 개입해 보세요. 대사는 작은 모델(${Object.values(LABEL).map(esc).join(' · ')})이 연기하고,
      세계관 · 인물 · 숨은 전개 · 기억은 미리 써 두었어요. 🎬 연출로 장면을 바꾸고, 🔍 맥락에서 모델이 받는 것을 그대로 볼 수 있어요.</p>
    ${WORLDS.map((w) => `
      <section class="world">
        <div class="w-head">
          <div class="w-cover" style="${art(w.cover?.color)}">${esc(w.cover?.emoji || '✨')}</div>
          <div><h2>${esc(w.title)}</h2><div class="w-src">${esc(w.source || '')}</div><p>${esc(w.summary || '')}</p>
            <div class="chips">${(w.genre || []).map((g) => `<span class="chip">#${esc(g)}</span>`).join('')}</div></div>
        </div>
        <div class="grid">${w.scenarios.map((sc) => {
          const saved = store.get(playKey(sc.id), null);
          return `<button class="card sc" data-sc="${esc(sc.id)}">
            <div class="body">
              <div class="who-row"><span class="mini-ava" style="${art(sc.lead.color)}">${esc(sc.lead.emoji)}</span><span>${esc(sc.lead.name)}</span>${saved ? '<span class="chip on">이어 하기</span>' : ''}</div>
              <div class="name">${esc(sc.title)}</div>
              <div class="tag">${esc(sc.hook)}</div>
              <div class="you">나: ${esc((saved?.you || sc.you).split(/ — | - /)[0])}</div>
            </div></button>`;
        }).join('')}</div>
      </section>`).join('')}
    <section class="world">
      <div class="w-head"><div class="w-cover" style="${art(['#6b4a8a', '#e6d9f2'])}">🛠️</div>
        <div><h2>직접 만든 캐릭터</h2><p>설정집 · 첫 인사를 적어 일대일 대화 캐릭터를 만들어요.</p></div></div>
      <details class="persona"><summary>나는 누구? (직접 만든 캐릭터에게 알려 줄 내 소개)</summary>
        <textarea id="persona" rows="2" placeholder="예) 이름은 민준, 스무 살 대학생. 말수가 적다.">${esc(store.get('cc.persona', ''))}</textarea></details>
      <div class="grid">
        ${cs.map((c) => `<button class="card" data-chat="${esc(c.id)}"><div class="art" style="${art(c.color)}">${esc(c.avatar || '✨')}</div>
          <div class="body"><div class="name">${esc(c.name)}</div><div class="tag">${esc(c.tagline || '')}</div><span class="del" data-del="${esc(c.id)}">지우기</span></div></button>`).join('')}
        <button class="card new" data-new><span class="plus">＋</span>캐릭터 만들기</button>
      </div>
    </section>`;
  $app.querySelector('#persona').addEventListener('input', (e) => store.set('cc.persona', e.target.value));
  $app.querySelectorAll('[data-sc]').forEach((b) => (b.onclick = () => { location.hash = `#/s/${b.dataset.sc}`; }));
  $app.querySelectorAll('[data-chat]').forEach((b) => b.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      if (confirm('이 캐릭터와 대화를 지울까요?')) { store.set('cc.custom', customs().filter((c) => c.id !== del.dataset.del)); store.del(`cc.chat.${del.dataset.del}`); home(); }
      return;
    }
    location.hash = `#/chat/${b.dataset.chat}`;
  }));
  $app.querySelector('[data-new]').onclick = () => { location.hash = '#/new'; };
}

// ── 상황극 소개
function intro({ w, sc }) {
  const saved = store.get(playKey(sc.id), null);
  $app.innerHTML = `
    <div class="bar"><button class="back" aria-label="목록으로">‹</button><div class="who"><b>${esc(w.title)}</b><span>${esc(w.source || '')}</span></div></div>
    <div class="intro">
      <div class="i-cover" style="${art(w.cover?.color)}"><span>${esc(w.cover?.emoji || '✨')}</span></div>
      <h2>${esc(sc.title)}</h2>
      <p class="hook">${esc(sc.hook)}</p>
      <h3>지금 장면</h3><p>${esc(sc.setting)}</p>
      <h3>등장인물</h3><div class="chips">${sc.cast.map((c) => `<span class="chip big">${esc(c.emoji)} ${esc(c.name)}</span>`).join('')}</div>
      <h3>해 볼 수 있는 것</h3><p>${esc(sc.goal)}</p>
      <label class="you-in">내 역할 — 바꿔도 돼요(이름 · 한 줄 소개)<input id="you" maxlength="120" value="${esc(saved?.you || sc.you)}"></label>
      <div class="row">
        ${saved ? `<button class="ghost" data-restart>처음부터 다시</button><button class="primary" data-go>이어 하기 (${saved.msgs.length - 1}턴)</button>` : '<button class="primary" data-go>시작하기</button>'}
      </div>
      <p class="hint">🎬 연출 — 입력칸 왼쪽 버튼을 켜면 대사 대신 "갑자기 비가 쏟아진다"처럼 장면 자체를 바꾸는 지시를 보낼 수 있어요.</p>
    </div>`;
  const youVal = () => $app.querySelector('#you').value.trim() || sc.you;
  $app.querySelector('.back').onclick = () => { location.hash = '#/'; };
  $app.querySelector('[data-go]').onclick = () => {
    const st = saved || { msgs: [{ role: 'assistant', content: sc.opening, kind: 'opening' }], notes: '', summary: '', cut: 0, folds: [] };
    st.you = youVal(); store.set(playKey(sc.id), st);
    location.hash = `#/play/${sc.id}`;
  };
  $app.querySelector('[data-restart]')?.addEventListener('click', () => {
    if (!confirm('이 상황극의 대화 · 기억을 지우고 처음부터 할까요?')) return;
    store.del(playKey(sc.id)); intro({ w, sc });
  });
}

// ── 대화방 — 상황극(play)과 직접 만든 캐릭터(custom)가 같이 쓴다
function room(cfg) {
  const st = cfg.load();
  let direct = false;
  $app.innerHTML = `
    <div class="chat">
      <div class="bar">
        <button class="back" aria-label="목록으로">‹</button>
        <div class="ava" style="${art(cfg.color)}">${esc(cfg.emoji)}</div>
        <div class="who"><b>${esc(cfg.title)}</b><span>${esc(cfg.sub)}</span></div>
        <div class="seg" role="group" aria-label="모델">${Object.keys(LABEL).map((m) => `<button data-m="${m}" class="${model() === m ? 'on' : ''}">${esc(LABEL[m])}</button>`).join('')}</div>
        ${cfg.play ? '<button class="ghost" data-mem title="내 메모 · 지난 줄거리">🧠 기억</button>' : ''}
        <button class="ghost" data-debug title="모델에 보내는 맥락 · 턴 기록">🔍 맥락</button>
        <button class="ghost" data-reset>처음부터</button>
      </div>
      <div class="msgs"></div>
      <form class="compose">
        ${cfg.play ? '<button type="button" class="dir" data-dir title="연출 지시 — 장면 · 사건을 바꾼다">🎬</button>' : ''}
        <textarea rows="1"></textarea>
        <button class="send" type="submit">보내기</button>
      </form>
    </div>`;
  const $msgs = $app.querySelector('.msgs'), $ta = $app.querySelector('textarea'), $send = $app.querySelector('.send');
  const setPh = () => { $ta.placeholder = direct ? '🎬 연출 지시 — 예) 갑자기 비가 쏟아진다 · 황용이 문을 박차고 들어온다' : cfg.placeholder; $ta.classList.toggle('dir-on', direct); };
  setPh();

  const draw = (pending, error, note) => {
    const msgs = st.msgs; const lastBot = msgs.map((m) => m.role).lastIndexOf('assistant');
    $msgs.innerHTML = msgs.map((m, i) => {
      const fold = cfg.play && i === st.cut && st.cut > 0 ? `<div class="divider">🧠 여기까지 ${st.cut}개 메시지를 줄거리로 접었어요 — 모델은 이제 줄거리 + 이후 대화를 받아요</div>` : '';
      if (m.role === 'user' && m.direct) return `${fold}<div class="msg direct"><span>🎬 ${esc(m.content)}</span></div>`;
      if (m.role === 'user') return `${fold}<div class="msg me"><div class="bubble">${render(m.content)}</div></div>`;
      return `${fold}<div class="msg"><div class="ava" style="${art(cfg.color)}">${esc(cfg.emoji)}</div><div><div class="bubble">${render(m.content)}</div>
        ${m.meta || (i === lastBot && i > 0) ? `<div class="meta">${m.meta ? `<span>${esc(m.meta)}</span>` : ''}${i === lastBot && i > 0 && !pending ? '<button data-regen>다시 생성</button>' : ''}</div>` : ''}</div></div>`;
    }).join('')
      + (pending ? `<div class="msg"><div class="ava" style="${art(cfg.color)}">${esc(cfg.emoji)}</div><div class="bubble typing"><span></span><span></span><span></span></div></div>` : '')
      + (note ? `<div class="divider">${esc(note)}</div>` : '')
      + (error ? `<div class="err">${esc(error)} <button class="ghost" data-retry>다시 시도</button></div>` : '');
    $msgs.querySelector('[data-regen]')?.addEventListener('click', regen);
    $msgs.querySelector('[data-retry]')?.addEventListener('click', ask);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  async function ask() {
    if (busy) return;
    busy = true; $send.disabled = true; draw(true);
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-id': cid }, body: JSON.stringify(cfg.body(st, null)) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.text) throw new Error(d.error || '답을 받지 못했어요.');
      st.msgs.push({ role: 'assistant', content: d.text, meta: `${LABEL[model()]} · ${d.seconds}초${d.tokens ? ` · ${d.tokens}토큰` : ''}`,
        trace: { ...d.trace, label: LABEL[model()], seconds: d.seconds, tokens: d.tokens, promptTokens: d.promptTokens, at: new Date().toISOString() } });
      cfg.save(st); draw(false);
      if (cfg.play && st.msgs.length - st.cut > FOLD_AT) await fold(st.msgs.length - KEEP, '자동');
      if (dbgOpen) debugPanel(cfg, st, $ta.value);
    } catch (e) { draw(false, e.message); } finally { busy = false; $send.disabled = false; }
  }
  // 기억 접기 — [cut, upto) 를 지난 줄거리에 합친다
  async function fold(upto, why) {
    const part = st.msgs.slice(st.cut, upto).filter((m) => m.content?.trim());
    if (!part.length) return;
    draw(false, null, `🧠 앞 대화 ${part.length}개를 줄거리로 접는 중… (${why} · ${MEMORY_MODEL})`);
    const r = await fetch('/api/memory', { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-id': cid },
      body: JSON.stringify({ scenarioId: cfg.id, you: st.you, summary: st.summary, fold: part.map(({ role, content, direct: d }) => ({ role, content, direct: !!d })) }) })
      .then((x) => x.json()).catch(() => ({ error: '기억 정리에 실패했어요.' }));
    if (r.error || !r.summary) { draw(false, `기억 접기 실패 — ${r.error || '빈 답'} (대화는 그대로 이어져요)`); return; }
    st.summary = r.summary; st.cut = upto;
    st.folds = [...(st.folds || []), { at: new Date().toISOString(), count: part.length, model: r.model, seconds: r.seconds, why }];
    cfg.save(st); draw(false);
  }
  cfg.fold = fold;
  function regen() {
    if (busy || st.msgs.at(-1)?.role !== 'assistant' || st.msgs.length < 2) return;
    st.msgs.pop(); cfg.save(st); ask();
  }

  $app.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $ta.value.trim();
    if (!text || busy) return;
    st.msgs.push(direct ? { role: 'user', content: text, direct: true } : { role: 'user', content: text });
    cfg.save(st);
    $ta.value = ''; $ta.style.height = '';
    ask();
  });
  $ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $app.querySelector('form').requestSubmit(); } });
  $ta.addEventListener('input', () => { $ta.style.height = 'auto'; $ta.style.height = `${Math.min($ta.scrollHeight, 160)}px`; });
  $app.querySelector('[data-dir]')?.addEventListener('click', (e) => { direct = !direct; e.currentTarget.classList.toggle('on', direct); setPh(); $ta.focus(); });
  $app.querySelector('.back').onclick = () => { location.hash = cfg.play ? `#/s/${cfg.id}` : '#/'; };
  $app.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => {
    store.set('cc.model', b.dataset.m);
    $app.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $app.querySelector('[data-debug]').onclick = () => debugPanel(cfg, st, $ta.value);
  $app.querySelector('[data-mem]')?.addEventListener('click', () => debugPanel(cfg, st, $ta.value, null, 'memory'));
  $app.querySelector('[data-reset]').onclick = () => {
    if (!confirm('대화와 기억을 지우고 처음부터 할까요?')) return;
    Object.assign(st, cfg.fresh(st)); cfg.save(st); draw(false);
  };
  draw(false);
  $ta.focus();
}

function play({ w, sc }) {
  const key = playKey(sc.id);
  room({
    play: true, id: sc.id, title: sc.title, sub: `${sc.lead.name} · 나는 ${(store.get(key, {})?.you || sc.you).split(/ — | - /)[0]}`,
    emoji: sc.lead.emoji, color: sc.lead.color, placeholder: '말하거나 행동하기 — *행동*은 별표 안에',
    load: () => store.get(key, null) || { you: sc.you, msgs: [{ role: 'assistant', content: sc.opening, kind: 'opening' }], notes: '', summary: '', cut: 0, folds: [] },
    save: (st) => store.set(key, st),
    fresh: (st) => ({ msgs: [{ role: 'assistant', content: sc.opening, kind: 'opening' }], notes: st.notes, summary: '', cut: 0, folds: [] }),
    // 접은 앞부분은 줄거리로 가므로 cut 이후만 보낸다
    body: (st, extra) => ({ scenarioId: sc.id, you: st.you, notes: st.notes, summary: st.summary,
      messages: [...st.msgs.slice(st.cut), ...(extra ? [extra] : [])].map(({ role, content, direct }) => ({ role, content, ...(direct ? { direct: true } : {}) })), model: model() }),
  });
}

function chatCustom(c) {
  const key = `cc.chat.${c.id}`;
  const first = () => (c.greeting ? [{ role: 'assistant', content: c.greeting }] : []);
  room({
    play: false, id: c.id, title: c.name, sub: c.tagline || '', emoji: c.avatar || '✨', color: c.color,
    placeholder: c.you ? `${c.you}(으)로 말하기 — *행동*은 별표 안에` : '말하기 — *행동*은 별표 안에',
    load: () => { const v = store.get(key, null); return Array.isArray(v) ? { msgs: v.length ? v : first() } : v || { msgs: first() }; },
    save: (st) => store.set(key, st), fresh: () => ({ msgs: first() }),
    body: (st, extra) => ({ custom: { name: c.name, system: c.system, greeting: c.greeting }, persona: store.get('cc.persona', ''),
      messages: [...st.msgs, ...(extra ? [extra] : [])].map(({ role, content }) => ({ role, content })), model: model() }),
  });
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
  $app.querySelector('.back').onclick = back;
  $app.querySelector('[data-cancel]').onclick = back;
  $app.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const c = { id: `my-${Date.now().toString(36)}`, custom: true, color: ['#6b4a8a', '#e6d9f2'], ...f };
    store.set('cc.custom', [...customs(), c]);
    location.hash = `#/chat/${c.id}`;
  });
}

// ── 🧠 기억 · 🔍 맥락(디버그) — 모델에 보내는 것 그대로 · 턴 기록
let dbgOpen = false;
const PART = {
  rules: ['대답 규칙', '#9a8fb3'], world: ['세계관', '#8b6fd6'], cast: ['등장인물', '#c58af0'], scene: ['지금 장면', '#6fb3d6'],
  director: ['진행 메모', '#e0a64a'], memory: ['기억', '#58b98a'], lore: ['로어북', '#d6d06f'], reminder: ['다시 한 번', '#7d7690'],
  system: ['설정집', '#8b6fd6'], persona: ['내 소개', '#c58af0'], opening: ['첫 장면', '#ffb36b'], greeting: ['첫 인사', '#ffb36b'],
  history: ['지난 대화', '#5a8fc4'], now: ['이번 말', '#ff7a9c'], direct: ['연출 지시', '#ff9a5a'],
};
const ROLE = { system: 'system', assistant: 'assistant(진행 · 인물)', user: 'user(나)' };

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
    const inner = m.sections
      ? m.sections.map((x) => `<details class="sec" ${['scene', 'director', 'memory', 'lore'].includes(x.part) ? 'open' : ''} style="border-left-color:${(PART[x.part] || [0, '#888'])[1]}">
          <summary><span class="part" style="background:${(PART[x.part] || [0, '#888'])[1]}">${esc((PART[x.part] || [x.part])[0])}</span> ${esc(x.title || '')} <span class="len">${num(x.text.length)}자</span></summary><pre>${esc(x.text)}</pre></details>`).join('')
      : `<pre>${esc(m.content)}</pre>`;
    return `<details class="pm" ${['system', 'now', 'direct'].includes(m.part) ? 'open' : ''} style="border-left-color:${color}">
      <summary><b>#${i + 1}</b> <span class="role">${ROLE[m.role] || m.role}</span> <span class="part" style="background:${color}">${name}</span> <span class="len">${num(m.content.length)}자</span></summary>
      ${inner}</details>`;
  }).join('');
}

async function debugPanel(cfg, st, draft, turnIdx, focus) {
  dbgOpen = true;
  let $p = document.getElementById('dbg');
  if (!$p) { $p = document.createElement('aside'); $p.id = 'dbg'; document.body.appendChild($p); }
  $p.className = 'dbg open';
  const msgs = st.msgs;
  const turns = msgs.map((m, i) => ({ ...m, i })).filter((m) => m.role === 'assistant' && m.trace);
  const picked = turnIdx != null ? msgs[turnIdx] : null;
  // 무엇을 미리 볼까: 고른 턴이면 그 답 직전까지 + 그 턴의 모델, 아니면 지금 대화 + 입력칸(없으면 자리표시)
  const stView = picked ? { ...st, msgs: msgs.slice(0, turnIdx), cut: Math.min(st.cut || 0, turnIdx) } : st;
  const extra = picked ? null : { role: 'user', content: draft?.trim() || '(여기에 다음에 보낼 말이 들어간다)' };
  const body = cfg.body(stView, extra);
  if (picked) body.model = Object.entries(LABEL).find(([, v]) => v === picked.trace.label)?.[0] || model();
  $p.innerHTML = `<div class="dbg-head"><b>${focus === 'memory' ? '🧠 기억' : '🔍 맥락 보기'}</b><span>${esc(cfg.title)}</span><button class="ghost" data-close>닫기</button></div><div class="dbg-body"><p class="hint">불러오는 중…</p></div>`;
  $p.querySelector('[data-close]').onclick = () => { dbgOpen = false; $p.className = 'dbg'; };
  const r = await fetch('/api/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ error: '불러오지 못했어요.' }));
  if (r.error) { $p.querySelector('.dbg-body').innerHTML = `<p class="err">${esc(r.error)}</p>`; return; }
  const t = picked?.trace;
  const memHtml = cfg.play ? `
    <section class="mem">
      <h3>🧠 기억 <small>모델이 매 턴 받는 기억 — 고정 사실 · 내 메모 · 지난 줄거리</small></h3>
      <label>내 메모 — 모델이 꼭 기억했으면 하는 것(예: "말포이는 내가 비밀을 지켜 주기로 한 걸 안다")<textarea data-notes rows="3">${esc(st.notes || '')}</textarea></label>
      <label>지난 줄거리 — 앞 대화를 접은 것. 고쳐도 된다${st.folds?.length ? ` · 접은 횟수 ${st.folds.length} · 마지막 ${esc(st.folds.at(-1).model || '')} ${st.folds.at(-1).seconds ?? ''}초` : ''}<textarea data-summary rows="7" placeholder="아직 접지 않았어요 — 대화가 ${FOLD_AT}개를 넘으면 자동으로 접혀요">${esc(st.summary || '')}</textarea></label>
      <div class="row"><span class="hint">접을 메시지 ${Math.max(0, msgs.length - (st.cut || 0) - 4)}개 · 기억 모델 ${esc(MEMORY_MODEL)}</span><button class="ghost" data-foldnow>지금 접기(최근 4개만 남김)</button></div>
    </section>` : '';
  const title = picked ? `턴 ${turns.findIndex((x) => x.i === turnIdx) + 1} 에 보낸 것` : '다음에 보낼 것';
  $p.querySelector('.dbg-body').innerHTML = `
    ${memHtml}
    <section>
      <h3>${title}</h3>
      ${picked ? `<p class="hint">답: ${esc(picked.content.slice(0, 80))}${picked.content.length > 80 ? '…' : ''}</p>` : '<p class="hint">입력칸에 쓴 말이 있으면 그 말로, 없으면 자리표시로 보여 줘요. 보내지는 않아요.</p>'}
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
      ${turns.length ? tokenChart(turns.map((x) => x.trace)) : '<p class="hint">아직 받은 답이 없어요.</p>'}
      <ol class="turns">${turns.map((x, n) => `<li class="${x.i === turnIdx ? 'on' : ''}">
        <div><b>턴 ${n + 1}</b> · ${esc(x.trace.label)} · 입력 ${num(x.trace.promptTokens)} → 출력 ${num(x.trace.tokens)}토큰 · ${x.trace.seconds}초 · 메시지 ${x.trace.sent}개${x.trace.dropped ? ` · 뺀 것 ${x.trace.dropped}` : ''}</div>
        <div class="mini">${stackBar(x.trace.sections)}</div>
        ${x.trace.lore?.length ? `<div class="chips">${x.trace.lore.map((k) => `<span class="chip lore">📖 ${esc(k)}</span>`).join('')}</div>` : ''}
        <div class="said">${esc(x.content.slice(0, 60))}${x.content.length > 60 ? '…' : ''}</div>
        <button class="ghost" data-turn="${x.i}">이 턴에 보낸 것 보기</button></li>`).join('')}</ol>
      ${picked ? '<button class="ghost" data-next>← 다음에 보낼 것으로</button>' : ''}
    </section>`;
  const $b = $p.querySelector('.dbg-body');
  $b.querySelector('[data-notes]')?.addEventListener('input', (e) => { st.notes = e.target.value; cfg.save(st); });
  $b.querySelector('[data-summary]')?.addEventListener('input', (e) => { st.summary = e.target.value; cfg.save(st); });
  $b.querySelector('[data-foldnow]')?.addEventListener('click', async () => { if (busy) return; busy = true; try { await cfg.fold(Math.max(st.cut, msgs.length - 4), '직접'); } finally { busy = false; } debugPanel(cfg, st, draft, null, 'memory'); });
  $b.querySelectorAll('[data-turn]').forEach((b) => (b.onclick = () => debugPanel(cfg, st, draft, Number(b.dataset.turn))));
  $b.querySelector('[data-next]')?.addEventListener('click', () => debugPanel(cfg, st, draft));
}

function route() {
  if (!/^#\/(play|chat)\//.test(location.hash)) { dbgOpen = false; document.getElementById('dbg')?.classList.remove('open'); }
  const [, view, id] = location.hash.split('/');
  if (view === 's' && findScenario(id)) return intro(findScenario(id));
  if (view === 'play' && findScenario(id)) return play(findScenario(id));
  if (view === 'chat') { const c = customs().find((x) => x.id === id); if (c) return chatCustom(c); }
  if (view === 'new') return make();
  return home();
}

const d = await fetch('/api/worlds').then((r) => r.json()).catch(() => ({ worlds: [] }));
WORLDS = d.worlds || [];
LABEL = Object.fromEntries((d.models || []).map((m) => [m.key, m.label]));
DEFAULT = d.defaultModel || Object.keys(LABEL).at(-1) || '';
MEMORY_MODEL = d.memoryModel || '';
window.addEventListener('hashchange', route);
route();
