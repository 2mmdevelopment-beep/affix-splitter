import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

function makeDB() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql) => {
    let args = [];
    const o = {
      bind: (...a) => { args = a; return o; },
      first: async () => db.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...args) }),
      run: async () => { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
      _run: () => db.prepare(sql).run(...args),
    };
    return o;
  };
  return { prepare: stmt, batch: async (ss) => { for (const s of ss) s._run(); return []; } };
}

const env = (over = {}) => ({
  DB: makeDB(), GOOGLE_CLIENT_ID: 'cid', ALLOWED_DOMAIN: 'school.ac.kr', ALLOWED_ORIGIN: 'https://x.github.io',
  ADMIN_EMAILS: 'prof@school.ac.kr, boss@gmail.com', DAILY_LIMIT: '3', BUDGET_USD: '9.5', MODEL: 'claude-haiku-5-5',
  INPUT_USD_PER_MTOK: '0.10', OUTPUT_USD_PER_MTOK: '0.50', MAX_OUTPUT_TOKENS: '500',
  ANTHROPIC_API_KEY: 'sk-test', ID_SALT: 'salt', ...over,
});

let claudeCalls = 0;
const users = { 'tok-a': 'a@school.ac.kr', 'tok-b': 'b@school.ac.kr', 'tok-prof': 'prof@school.ac.kr', 'tok-out': 'x@gmail.com', 'tok-boss': 'boss@gmail.com' };
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
    const t = new URL(url).searchParams.get('id_token');
    if (!users[t]) return new Response('{}', { status: 400 });
    return Response.json({ aud: 'cid', email: users[t], email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 3600) });
  }
  if (url === 'https://api.anthropic.com/v1/messages') {
    claudeCalls++;
    const body = JSON.parse(init.body);
    assert.equal(init.headers['x-api-key'], 'sk-test');
    const w = body.messages[0].content;
    const out = w === 'incorect'
      ? { status: 'not_a_word', suggestion: 'incorrect', parts: [], meaning_ko: '', meaning_en: '', example: '', difficulty: null }
      : { status: 'ok', suggestion: null, parts: [
          { type: 'prefix', text: 'in', meaning_ko: '부정', meaning_en: 'not' },
          { type: 'root', text: w.slice(2), meaning_ko: '바른', meaning_en: 'right' }],
          meaning_ko: '부정확한', meaning_en: 'not correct', example: 'That is incorrect.', difficulty: 'medium' };
    return Response.json({ content: [{ type: 'text', text: '```json\n' + JSON.stringify(out) + '\n```' }], usage: { input_tokens: 700, output_tokens: 140 } });
  }
  throw new Error('unexpected fetch ' + url);
};

const call = (e, method, path, tok, body) => worker.fetch(new Request('https://api.test' + path, {
  method, headers: { ...(tok ? { authorization: 'Bearer ' + tok } : {}), 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined }), e);
const j = (r) => r.json();

const e = env();
// auth
assert.equal((await call(e, 'GET', '/api/me')).status, 401);
assert.equal((await call(e, 'GET', '/api/me', 'tok-out')).status, 401, 'wrong domain rejected');
assert.equal((await call(e, 'OPTIONS', '/api/me')).status, 204);
const boss = await j(await call(e, 'GET', '/api/me', 'tok-boss'));
assert.equal(boss.isAdmin, true, 'listed gmail instructor can sign in as admin');

// lookup + guess-first
let r = await call(e, 'POST', '/api/lookup', 'tok-a', { word: 'Incorrect ' });
let d = await j(r);
assert.equal(r.status, 200); assert.equal(d.word, 'incorrect'); assert.equal(d.parts.length, 2);
assert.equal(d.meaning_ko, undefined, 'meaning withheld before reveal'); assert.equal(d.remaining, 2);
assert.equal(claudeCalls, 1);
r = await call(e, 'POST', '/api/reveal', 'tok-a', { lookup_id: d.lookup_id, guess: '틀린' });
assert.equal((await j(r)).meaning_ko, '부정확한');
r = await call(e, 'POST', '/api/reveal', 'tok-b', { lookup_id: d.lookup_id, guess: 'x' });
assert.equal(r.status, 404, 'other student cannot reveal');
assert.equal((await call(e, 'POST', '/api/rate', 'tok-a', { lookup_id: d.lookup_id, rating: 'close' })).status, 200);

// cache reuse by another student -> no new Claude call
r = await call(e, 'POST', '/api/lookup', 'tok-b', { word: 'incorrect' });
assert.equal(r.status, 200); assert.equal(claudeCalls, 1, 'cache hit');

// invalid input is free
d = await j(await call(e, 'POST', '/api/lookup', 'tok-a', { word: 'drop table; --' }));
assert.equal(d.status, 'not_a_word'); assert.equal(claudeCalls, 1);
assert.equal((await j(await call(e, 'GET', '/api/me', 'tok-a'))).used, 1, 'invalid not counted');

// typo -> not_a_word + suggestion
d = await j(await call(e, 'POST', '/api/lookup', 'tok-a', { word: 'incorect' }));
assert.equal(d.status, 'not_a_word'); assert.equal(d.suggestion, 'incorrect');

// daily limit (3)
await call(e, 'POST', '/api/lookup', 'tok-a', { word: 'incorrect' });
r = await call(e, 'POST', '/api/lookup', 'tok-a', { word: 'incorrect' });
assert.equal(r.status, 429, 'daily limit');

// history
assert.equal((await j(await call(e, 'GET', '/api/history', 'tok-a'))).items.length, 3);

// admin
assert.equal((await call(e, 'GET', '/api/admin/stats', 'tok-a')).status, 403);
const s = await j(await call(e, 'GET', '/api/admin/stats', 'tok-prof'));
assert.equal(s.students, 2); assert.equal(s.api_calls, 2);
assert.ok(Math.abs(s.spent_usd - 2 * (700 * 0.1 + 140 * 0.5) / 1e6) < 1e-12);
assert.equal(s.words_saved, 2);
const sample = await j(await call(e, 'GET', '/api/admin/sample?n=30', 'tok-prof'));
assert.equal(sample.items.length, 1); assert.equal(sample.items[0].parts_match, true);
const buf = new Uint8Array(await (await call(e, 'GET', '/api/admin/export?format=csv', 'tok-prof')).arrayBuffer());
assert.deepEqual([...buf.slice(0,3)], [0xEF,0xBB,0xBF], 'UTF-8 BOM');
assert.ok(new TextDecoder().decode(buf).includes('incorrect'));
// wrong review -> regenerate next time
await call(e, 'POST', '/api/admin/review', 'tok-prof', { word: 'incorrect', verdict: 'wrong', note: 'x' });
const before = claudeCalls;
await call(e, 'POST', '/api/lookup', 'tok-b', { word: 'incorrect' });
assert.equal(claudeCalls, before + 1, 'wrong-reviewed word is re-analysed');

// budget guard: new words blocked, cached still served
const e2 = env({ BUDGET_USD: '0.00001', DAILY_LIMIT: '20' });
await call(e2, 'POST', '/api/lookup', 'tok-a', { word: 'unhappy' });   // first call allowed (spent=0)
r = await call(e2, 'POST', '/api/lookup', 'tok-a', { word: 'impolite' });
assert.equal(r.status, 503, 'budget guard');
r = await call(e2, 'POST', '/api/lookup', 'tok-a', { word: 'unhappy' });
assert.equal(r.status, 200, 'cached word still served after budget exhausted');
console.log('ALL BACKEND TESTS PASSED');
