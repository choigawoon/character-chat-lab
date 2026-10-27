import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, matchLore, scenarioSections, worlds, memoryPrompt } from '../main.mjs';

test('직접 만든 캐릭터 — 설정집 · 첫 인사가 맨 앞에 한 번만', () => {
  const m = buildMessages({ system: 'S', greeting: 'G', messages: [{ role: 'assistant', content: 'G' }, { role: 'user', content: '안녕' }] });
  assert.deepEqual(m.map((x) => x.part), ['system', 'greeting', 'now']);
});

test('내 소개는 system 안 따로 구획 · 이상한 역할은 버린다', () => {
  const m = buildMessages({ system: 'S', persona: '민준', messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'hi' }] });
  assert.match(m[0].content, /\[사용자에 대해\]\n민준/);
  assert.deepEqual(m[0].sections.map((x) => x.part), ['system', 'persona']);
  assert.deepEqual(m.map((x) => x.role), ['system', 'user']);
});

test('긴 대화는 최근 40개만 · 뺀 수를 센다', () => {
  const msgs = Array.from({ length: 45 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) }));
  const m = buildMessages({ system: 'S', messages: msgs });
  assert.equal(m.length, 41);
  assert.equal(m.dropped, 5);
  assert.equal(m.at(-1).part, 'now');
});

test('연출 지시는 장면 지시로 바뀌어 들어간다', () => {
  const m = buildMessages({ system: 'S', messages: [{ role: 'user', content: '비가 쏟아진다', direct: true }] });
  assert.equal(m.at(-1).part, 'direct');
  assert.match(m.at(-1).content, /^\[연출 지시\] 비가 쏟아진다/);
});

const orig = worlds.find((w) => w.id === 'originals');

test('로어북은 최근 대화에 낱말이 나온 항목만', () => {
  const hit = matchLore(orig.lore, [{ role: 'user', content: '츄르 줄게' }]);
  assert.ok(hit.length >= 1 && hit.every((l) => l.keys.some((k) => '츄르 줄게'.includes(k))));
  assert.equal(matchLore(orig.lore, [{ role: 'user', content: '안녕' }]).length, 0);
});

test('상황극 system 구획 순서 · 기억 · 끝에 다시 한 번', () => {
  const sc = orig.scenarios[1];
  const secs = scenarioSections({ world: orig, sc, notes: '지우 이름을 안다', summary: '', messages: [{ role: 'user', content: '단서가 뭐야?' }] });
  assert.deepEqual(secs.map((x) => x.part), ['rules', 'world', 'cast', 'scene', 'director', 'memory', 'lore', 'reminder']);
  assert.match(secs.find((x) => x.part === 'memory').text, /지우 이름을 안다/);
});

test('모든 세계 — 상황극의 인물이 시트에 있고 첫 장면이 비지 않았다', () => {
  for (const w of worlds) for (const sc of w.scenarios) {
    assert.ok(w.chars.get(sc.lead), `${sc.id} lead`);
    assert.ok(sc.opening?.length > 50, `${sc.id} opening`);
    assert.ok(sc.director?.length >= 2, `${sc.id} director`);
  }
});

test('기억 접기 프롬프트에 지난 줄거리와 접을 대화가 들어간다', () => {
  const m = memoryPrompt({ title: 'T', summary: '옛 줄거리', fold: [{ role: 'user', content: '가자' }, { role: 'assistant', content: '*간다*' }], you: '나' });
  assert.match(m[1].content, /옛 줄거리[\s\S]*사용자\(나\): 가자/);
});
