import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages } from '../main.mjs';

test('설정집 · 첫 인사가 맨 앞에 한 번만 들어간다', () => {
  const m = buildMessages({ system: 'S', greeting: 'G', messages: [{ role: 'assistant', content: 'G' }, { role: 'user', content: '안녕' }] });
  assert.deepEqual(m.map((x) => x.role), ['system', 'assistant', 'user']);
  assert.equal(m[1].content, 'G');
});

test('내 소개는 설정집 뒤에 붙는다 · 이상한 역할은 버린다', () => {
  const m = buildMessages({ system: 'S', persona: '민준', messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'hi' }] });
  assert.match(m[0].content, /\[사용자에 대해\]\n민준/);
  assert.deepEqual(m.map((x) => x.role), ['system', 'user']);
});

test('긴 대화는 최근 40개만', () => {
  const msgs = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) }));
  const m = buildMessages({ system: 'S', messages: msgs });
  assert.equal(m.length, 41);
  assert.equal(m.at(-1).content, '59');
});

test('마지막 내 말은 now · 그 앞은 history · 잘린 수를 센다', () => {
  const msgs = Array.from({ length: 45 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) }));
  const m = buildMessages({ system: 'S', greeting: 'G', persona: '민준', messages: msgs });
  assert.equal(m.at(-1).part, 'now');
  assert.equal(m[2].part, 'history');
  assert.equal(m.dropped, 5);
  assert.equal(m[0].personaAt, 1);
});
