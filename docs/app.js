(() => {
  'use strict';
  const C = window.AFFIX_CONFIG;
  const $ = (s, r = document) => r.querySelector(s);
  const TYPE_KO = { prefix: '접두사', root: '어근', suffix: '접미사' };
  const DIFF_KO = { easy: '하', medium: '중', hard: '상' };
  const RATE_KO = { right: '맞았어요', close: '비슷해요', off: '달랐어요' };

  let token = null;
  let me = null;
  let current = null; // current lookup result

  // ---------- tiny DOM helper (always textContent => safe against injected text) ----------
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
    return n;
  }
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };

  // ---------- session ----------
  function parseJwt(t) {
    try { return JSON.parse(decodeURIComponent(escape(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); }
    catch { return null; }
  }
  const store = {
    get() { try { return sessionStorage.getItem('affix_token'); } catch { return null; } },
    set(v) { try { v ? sessionStorage.setItem('affix_token', v) : sessionStorage.removeItem('affix_token'); } catch { /* ignore */ } },
  };

  function showLogin(message) {
    token = null; me = null; store.set(null);
    $('#view-login').hidden = false; $('#view-app').hidden = true; $('#userbox').hidden = true;
    $('#login-msg').textContent = message || '';
  }

  async function api(path, opts = {}) {
    const res = await fetch(C.API_BASE + path, {
      ...opts,
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    });
    if (res.status === 401) {
      showLogin('로그인이 만료됐어요. 다시 로그인해 주세요.');
      throw new Error('unauthorized');
    }
    return res;
  }

  async function onCredential(resp) {
    const p = parseJwt(resp.credential);
    if (!p) return showLogin('로그인 정보를 읽지 못했어요. 다시 시도해 주세요.');
    // The server decides who may sign in (school domain + listed instructors); a refusal shows the login message again.
    token = resp.credential; store.set(token);
    await boot();
  }

  async function boot() {
    const p = parseJwt(token);
    let res;
    try { res = await api('/api/me'); } catch { return; }
    if (!res.ok) return showLogin('로그인할 수 없는 계정이거나 서버에 연결하지 못했어요. 학교 계정(@' + C.ALLOWED_DOMAIN + ')으로 다시 시도해 주세요.');
    me = await res.json();
    $('#view-login').hidden = true; $('#view-app').hidden = false; $('#userbox').hidden = false;
    $('#email').textContent = p && p.email ? p.email : '';
    $('#tab-admin').hidden = !me.isAdmin;
    updateCounter(me.remaining, me.limit);
    $('#word').focus();
  }

  function updateCounter(remaining, limit) {
    const c = $('#counter');
    c.textContent = `오늘 ${remaining}/${limit}회 남음`;
    c.classList.toggle('low', remaining <= 3);
    if (me) me.remaining = remaining;
  }

  // ---------- tabs ----------
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $('#tab-lookup').hidden = name !== 'lookup';
    $('#tab-history').hidden = name !== 'history';
    $('#tab-admin-panel').hidden = name !== 'admin';
    if (name === 'history') loadHistory();
    if (name === 'admin') loadStats();
  }

  // ---------- lookup ----------
  function setMsg(text, info) {
    const m = $('#lookup-msg'); m.textContent = text || ''; m.classList.toggle('info', !!info);
  }

  async function lookup(word) {
    word = String(word || '').trim().toLowerCase();
    setMsg('');
    if (!/^[a-z][a-z'-]{0,39}$/.test(word)) return setMsg('영어 단어 한 개만 입력해 주세요. (알파벳, - , \' 만 가능)');
    const btn = $('#lookup-btn'); btn.disabled = true; btn.textContent = '분석 중…';
    try {
      const res = await api('/api/lookup', { method: 'POST', body: JSON.stringify({ word }) });
      const data = await res.json();
      if (!res.ok) { setMsg(data.message || '문제가 생겼어요.'); return; }
      if (data.remaining != null) updateCounter(data.remaining, me.limit);
      current = data;
      renderResult(data);
    } catch (e) {
      if (e.message !== 'unauthorized') setMsg('네트워크 오류가 발생했어요. 다시 시도해 주세요.');
    } finally {
      btn.disabled = false; btn.textContent = '분해하기';
    }
  }

  function renderResult(d) {
    const box = $('#result'); clear(box);
    if (d.status !== 'ok') {
      const card = el('div', { class: 'card' },
        el('h2', { text: `'${d.word}' 는 영어 단어가 아닌 것 같아요` }));
      if (d.suggestion) {
        card.append(el('p', {}, '혹시 ', el('b', { text: d.suggestion }), ' 를 찾으셨나요? ',
          el('button', { class: 'ghost small', onclick: () => { $('#word').value = d.suggestion; lookup(d.suggestion); } }, '이 단어로 조회')));
      }
      card.append(el('p', { class: 'muted small-text', text: '오타일 수 있어요. 철자를 확인해 주세요.' }));
      box.append(card); return;
    }

    const split = el('div', { class: 'split' },
      d.parts.map((p) => el('div', { class: 'piece ' + p.type },
        el('span', { class: 'txt', text: p.text }), el('span', { class: 'lbl', text: TYPE_KO[p.type] }))));
    const list = el('ul', { class: 'parts' },
      d.parts.map((p) => el('li', {},
        el('span', { class: 't ' + p.type, text: p.text }),
        el('span', { text: p.meaning_ko }),
        el('span', { class: 'en', text: p.meaning_en }))));

    const guess = el('textarea', { id: 'guess', placeholder: '접사를 보고 뜻을 추측해서 적어 보세요', maxlength: '200' });
    const revealBtn = el('button', { class: 'primary', type: 'button' }, '정답 보기');
    const hint = el('span', { class: 'muted small-text', text: '추측을 한 줄 적으면 정답을 볼 수 있어요.' });
    const revealBox = el('div', { id: 'reveal' });

    revealBtn.addEventListener('click', async () => {
      const g = guess.value.trim();
      if (!g) { hint.textContent = '먼저 뜻을 추측해서 적어 주세요!'; guess.focus(); return; }
      revealBtn.disabled = true;
      try {
        const res = await api('/api/reveal', { method: 'POST', body: JSON.stringify({ lookup_id: d.lookup_id, guess: g }) });
        const r = await res.json();
        if (!res.ok) { hint.textContent = r.message || '문제가 생겼어요.'; revealBtn.disabled = false; return; }
        guess.disabled = true; revealBtn.hidden = true; hint.hidden = true;
        renderReveal(revealBox, d, r);
      } catch { revealBtn.disabled = false; }
    });

    box.append(el('div', { class: 'card' },
      el('h2', { text: d.word }),
      split, list,
      el('div', { class: 'guess' },
        el('label', { for: 'guess', text: '이 단어는 무슨 뜻일까요?' }), guess,
        el('div', { class: 'actions' }, revealBtn, hint)),
      revealBox));
    guess.focus();
  }

  function renderReveal(box, d, r) {
    clear(box);
    const rateRow = el('div', { class: 'rate' }, el('span', { text: '내 추측은?' }),
      Object.entries(RATE_KO).map(([k, label]) => el('button', {
        class: 'ghost small', type: 'button',
        onclick: async (ev) => {
          rateRow.querySelectorAll('button').forEach((b) => (b.disabled = true));
          ev.target.classList.add('primary');
          try { await api('/api/rate', { method: 'POST', body: JSON.stringify({ lookup_id: d.lookup_id, rating: k }) }); } catch { /* ignore */ }
          rateRow.append(el('span', { class: 'muted', text: ' 기록했어요!' }));
        },
      }, label)));
    box.append(el('div', { class: 'reveal' },
      el('div', { class: 'mean' }, r.meaning_ko,
        d.difficulty ? el('span', { class: 'badge ' + d.difficulty, text: '난이도 ' + DIFF_KO[d.difficulty] }) : null),
      el('div', { text: r.meaning_en }),
      r.example ? el('div', { class: 'ex', text: r.example }) : null,
      rateRow,
      el('div', { style: 'margin-top:12px' },
        el('button', { class: 'ghost small', type: 'button', onclick: () => { $('#word').value = ''; $('#word').focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, '다음 단어'))));
  }

  // ---------- history ----------
  async function loadHistory() {
    const ul = $('#history-list'); clear(ul);
    try {
      const res = await api('/api/history'); const data = await res.json();
      if (!data.items.length) { ul.append(el('li', { class: 'muted', text: '아직 조회한 단어가 없어요.' })); return; }
      data.items.forEach((i) => ul.append(el('li', {},
        el('span', { class: 'w', text: i.word }),
        i.difficulty ? el('span', { class: 'badge ' + i.difficulty, text: DIFF_KO[i.difficulty] }) : null,
        el('span', { class: 'g', text: i.guess ? '내 추측: ' + i.guess : '추측 안 함' }),
        i.rating ? el('span', { class: 'muted', text: RATE_KO[i.rating] }) : null)));
    } catch { /* handled by api() */ }
  }

  // ---------- admin ----------
  const fmtUsd = (n) => '$' + Number(n).toFixed(n < 1 ? 4 : 2);
  const pct = (n) => Math.round(n * 100) + '%';
  const stat = (n, k) => el('div', { class: 'stat' }, el('div', { class: 'n', text: String(n) }), el('div', { class: 'k', text: k }));

  async function loadStats() {
    const box = $('#stats'); clear(box); box.append(el('p', { class: 'muted', text: '불러오는 중…' }));
    try {
      const res = await api('/api/admin/stats');
      if (!res.ok) { clear(box); box.append(el('p', { class: 'msg', text: '불러오지 못했어요.' })); return; }
      const s = await res.json(); clear(box);
      const used = s.budget_usd ? s.spent_usd / s.budget_usd : 0;
      const maxDay = Math.max(1, ...s.daily.map((d) => d.n));
      box.append(
        el('div', { class: 'grid' },
          stat(s.lookups_total, '전체 조회'), stat(s.lookups_today, '오늘 조회'), stat(s.students, '이용 학생(익명)'),
          stat(pct(s.cache_hit_rate), '캐시 재사용률'), stat(s.words_saved, '저장된 단어'), stat(s.api_calls, 'Claude 호출')),
        el('div', { class: 'subhead', text: `예산: ${fmtUsd(s.spent_usd)} 사용 / ${fmtUsd(s.budget_usd)}  (남은 ${fmtUsd(s.remaining_usd)})` }),
        el('div', { class: 'bar ' + (used > 0.9 ? 'danger' : used > 0.7 ? 'warn' : '') }, el('i', { style: `width:${Math.min(100, used * 100)}%` })),
        el('div', { class: 'subhead', text: '최근 14일 조회 수' }),
        el('div', { class: 'chart' }, s.daily.map((d) => el('div', { class: 'col', title: `${d.day}: ${d.n}` },
          el('span', { text: String(d.n) }), el('i', { style: `height:${(d.n / maxDay) * 70}px` }), el('span', { text: d.day.slice(5) })))),
        el('div', { class: 'grid' },
          stat((s.difficulty.easy || 0) + ' / ' + (s.difficulty.medium || 0) + ' / ' + (s.difficulty.hard || 0), '난이도 하 / 중 / 상 (단어 수)'),
          stat((s.guess_ratings.right || 0) + ' / ' + (s.guess_ratings.close || 0) + ' / ' + (s.guess_ratings.off || 0), '추측 맞음 / 비슷 / 달랐음'),
          stat((s.reviews.ok || 0) + ' / ' + (s.reviews.wrong || 0) + ' / ' + (s.reviews.unreviewed || 0), '점검 맞음 / 오류 / 미점검')),
        el('div', { class: 'subhead', text: '많이 조회된 단어 TOP 10' }),
        el('table', { class: 't' }, s.top_words.map((w) => el('tr', {},
          el('td', { text: w.word }), el('td', { text: w.difficulty ? DIFF_KO[w.difficulty] : '-' }), el('td', { text: w.n + '회' })))),
        el('div', { class: 'subhead', text: '학생별 조회 수 (익명 ID, 상위 30)' }),
        el('table', { class: 't' }, s.per_student.map((p) => el('tr', {}, el('td', { text: p.student }), el('td', { text: p.n + '회' })))));
    } catch { /* handled */ }
  }

  async function loadSample() {
    const box = $('#sample'); clear(box); box.append(el('p', { class: 'muted', text: '불러오는 중…' }));
    try {
      const res = await api('/api/admin/sample?n=30'); const data = await res.json(); clear(box);
      if (!data.items.length) { box.append(el('p', { class: 'muted', text: '점검할 새 단어가 없어요.' })); return; }
      data.items.forEach((it) => {
        const card = el('div', { class: 'sample-item' });
        const verdict = (v) => async (ev) => {
          card.querySelectorAll('button').forEach((b) => (b.disabled = true));
          try {
            await api('/api/admin/review', { method: 'POST', body: JSON.stringify({ word: it.word, verdict: v }) });
            card.classList.add('done');
          } catch { card.querySelectorAll('button').forEach((b) => (b.disabled = false)); }
        };
        card.append(
          el('div', { class: 'head' },
            el('b', { text: it.word }),
            it.parts_match ? null : el('span', { class: 'flag', text: '⚠ 조각을 이어도 단어와 다름' }),
            el('span', { class: 'row gap' },
              el('button', { class: 'ok small', type: 'button', onclick: verdict('ok') }, '맞음'),
              el('button', { class: 'bad small', type: 'button', onclick: verdict('wrong') }, '오류'))),
          el('div', { class: 'split', style: 'margin:6px 0' },
            it.parts.map((p) => el('div', { class: 'piece ' + p.type }, el('span', { class: 'txt', style: 'font-size:1.2rem', text: p.text }), el('span', { class: 'lbl', text: p.meaning_ko })))),
          el('div', { class: 'muted small-text', text: `${it.meaning_ko} · 난이도 ${DIFF_KO[it.difficulty] || '-'}` }));
        box.append(card);
      });
    } catch { /* handled */ }
  }

  async function download(format) {
    try {
      const res = await api('/api/admin/export?format=' + format);
      if (!res.ok) return;
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'affix_words.' + format; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch { /* handled */ }
  }

  // ---------- init ----------
  function initGoogle() {
    if (!(window.google && google.accounts && google.accounts.id)) return setTimeout(initGoogle, 200);
    google.accounts.id.initialize({ client_id: C.GOOGLE_CLIENT_ID, callback: onCredential, auto_select: false });
    google.accounts.id.renderButton($('#g_btn'), { theme: 'outline', size: 'large', text: 'signin_with', locale: 'ko', width: 280 });
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#lookup-form').addEventListener('submit', (e) => { e.preventDefault(); lookup($('#word').value); });
    document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    $('#signout').addEventListener('click', () => { try { google.accounts.id.disableAutoSelect(); } catch { /* ignore */ } showLogin(''); });
    $('#refresh-stats').addEventListener('click', loadStats);
    $('#load-sample').addEventListener('click', loadSample);
    $('#export-csv').addEventListener('click', () => download('csv'));
    $('#export-json').addEventListener('click', () => download('json'));

    initGoogle();
    const saved = store.get();
    const p = saved && parseJwt(saved);
    if (p && p.exp * 1000 > Date.now() + 60e3) { token = saved; boot(); }
  });
})();
