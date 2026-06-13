/* ==========================================================================
   日本語 千日文 — 앱 로직 (의존성 없는 순수 JS SPA)
   ========================================================================== */
(() => {
'use strict';

const DATA = window.NIHONGO_DATA;
const CHAPTERS = DATA.chapters;
const SENTENCES = DATA.sentences;
const GRAMMAR = window.NIHONGO_GRAMMAR || [];
const TOTAL = SENTENCES.length;

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const app = $('#app');

/* ---------- 유틸 ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad4 = n => String(n).padStart(4, '0');
const pad2 = n => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const shuffle = arr => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const sentence = n => SENTENCES[n - 1];
const chapterOf = id => CHAPTERS[id - 1];

/* ---------- 상태 (localStorage) ---------- */
const STORE_KEY = 'nihongo1000.v1';

const defaultState = () => ({
  learned: {},                 // n -> 1
  bookmarks: {},               // n -> 1
  weak: {},                    // n -> 틀린 횟수
  streak: { last: '', count: 0 },
  today: { date: '', ns: {} }, // 오늘 학습한 문장 번호
  lastChapter: 0,
  settings: {
    theme: 'auto', scale: 1, hideMode: 'all', kanaScript: 'hira',
    auto: { src: 'chapter', ch: 1, readKo: true, repeat: 1, rate: 0.9, gap: 900, loop: false },
  },
});

let S = defaultState();
try {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    S = Object.assign(defaultState(), saved, { settings: Object.assign(defaultState().settings, saved.settings || {}) });
    S.settings.auto = Object.assign(defaultState().settings.auto, S.settings.auto || {});
  }
} catch (e) { /* 손상된 데이터는 무시하고 초기 상태 사용 */ }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* 저장 불가 환경 */ }
  }, 150);
}

function touchActivity(n) {
  const today = todayStr();
  if (S.today.date !== today) S.today = { date: today, ns: {} };
  if (n) S.today.ns[n] = 1;

  if (S.streak.last !== today) {
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yesterday = `${y.getFullYear()}-${pad2(y.getMonth() + 1)}-${pad2(y.getDate())}`;
    S.streak.count = (S.streak.last === yesterday) ? S.streak.count + 1 : 1;
    S.streak.last = today;
  }
  save();
}

const learnedCount = () => Object.keys(S.learned).length;
const todayCount = () => (S.today.date === todayStr() ? Object.keys(S.today.ns).length : 0);
const weakList = () => Object.keys(S.weak).map(Number).sort((a, b) => a - b);
const bookmarkList = () => Object.keys(S.bookmarks).map(Number).sort((a, b) => a - b);

function chapterProgress(ch) {
  let done = 0;
  for (let n = ch.start; n <= ch.end; n++) if (S.learned[n]) done++;
  return { done, total: ch.end - ch.start + 1 };
}

// 이어서 학습할 과: 마지막 방문 과가 미완이면 그곳, 아니면 첫 미완성 과
function resumeChapter() {
  let r = S.lastChapter ? chapterOf(S.lastChapter) : null;
  if (!r || chapterProgress(r).done === chapterProgress(r).total) {
    r = CHAPTERS.find(ch => chapterProgress(ch).done < chapterProgress(ch).total) || CHAPTERS[0];
  }
  return r;
}

/* ---------- 테마 / 폰트 크기 ---------- */
const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = S.settings.theme;
  const dark = t === 'dark' || (t === 'auto' && mqDark.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
mqDark.addEventListener('change', applyTheme);

function applyScale() {
  document.documentElement.style.setProperty('--scale', S.settings.scale);
}

/* ---------- 토스트 ---------- */
function toast(msg) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 1800);
}

/* ---------- TTS ---------- */
const hasTTS = 'speechSynthesis' in window;
let jaVoice = null, koVoice = null;
function pickVoice() {
  if (!hasTTS) return;
  const vs = speechSynthesis.getVoices();
  jaVoice = vs.find(v => /^ja([-_]|$)/i.test(v.lang) && /google/i.test(v.name))
    || vs.find(v => /^ja([-_]|$)/i.test(v.lang)) || null;
  koVoice = vs.find(v => /^ko([-_]|$)/i.test(v.lang) && /google/i.test(v.name))
    || vs.find(v => /^ko([-_]|$)/i.test(v.lang)) || null;
}
if (hasTTS) {
  pickVoice();
  speechSynthesis.addEventListener('voiceschanged', pickVoice);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function speak(text, btn) {
  if (!hasTTS) { toast('이 브라우저는 음성 재생을 지원하지 않아요'); return; }
  speechSynthesis.cancel();
  $$('.speaking').forEach(b => b.classList.remove('speaking'));
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  if (jaVoice) u.voice = jaVoice;
  u.rate = 0.92;
  if (btn) {
    btn.classList.add('speaking');
    u.onend = u.onerror = () => btn.classList.remove('speaking');
  }
  speechSynthesis.speak(u);
}

// 자동 학습용: 한 문장을 끝까지 읽고 끝나면 resolve (취소·오류·안전 타임아웃 포함)
function speakAsync(text, lang, rate) {
  return new Promise(resolve => {
    if (!hasTTS) { setTimeout(resolve, 700); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const v = lang.indexOf('ja') === 0 ? jaVoice : koVoice;
    if (v) u.voice = v;
    u.rate = rate;
    let done = false;
    const fin = () => { if (!done) { done = true; clearTimeout(guard); resolve(); } };
    u.onend = fin;
    u.onerror = fin;
    // 일부 브라우저에서 onend가 누락되는 경우를 대비한 안전 장치
    const guard = setTimeout(fin, 3000 + Math.ceil(text.length * 320 / rate));
    try { speechSynthesis.speak(u); } catch (e) { fin(); }
  });
}

/* ---------- 공용 템플릿 ---------- */
const ICON = {
  play: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>',
  starFill: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  arrowR: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
  playFill: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
};

// 자동 학습 플레이어 전용 아이콘(크게)
const PLY = {
  play: '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 5h2.2v14H6z"/><path d="M20 5v14l-10-7z"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M4 5v14l10-7z"/><path d="M15.8 5H18v14h-2.2z"/></svg>',
  replay: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 4v4h4"/></svg>',
};

const levelChip = lv => `<span class="chip lv-${lv}">${lv}</span>`;
const ptChip = pt => `<span class="chip pt jp" title="${esc(pt)}">${esc(pt)}</span>`;

function ringSvg(pct, size = 132, stroke = 9, label = '달성률') {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct);
  return `
  <div class="ring-wrap" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}">
      <circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
      <circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"
        stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
    </svg>
    <div class="ring-label"><div><b>${Math.round(pct * 100)}<small style="font-size:14px">%</small></b><br><small>${label}</small></div></div>
  </div>`;
}

/* ---------- 뷰: 홈 ---------- */
function viewHome() {
  const total = learnedCount();
  const pct = total / TOTAL;

  const resume = resumeChapter();
  const rp = chapterProgress(resume);
  const fresh = total === 0;
  const allDone = total === TOTAL;

  // 레벨별 진행
  const levels = ['N5', 'N4', 'N3'].map(lv => {
    const chs = CHAPTERS.filter(c => c.level === lv);
    let done = 0, tot = 0;
    chs.forEach(c => { const p = chapterProgress(c); done += p.done; tot += p.total; });
    return { lv, done, tot };
  });

  // 오늘의 문장 (날짜 기반 고정)
  const dayIdx = Math.floor(Date.now() / 86400000) % TOTAL;
  const tod = SENTENCES[dayIdx];
  const todCh = chapterOf(tod.ch);

  const weakN = weakList().length;
  const bookN = bookmarkList().length;

  return `
  <div class="view">
    <section class="card hero">
      <div class="hero-grid">
        <div>
          <span class="hero-kicker">Sentence-first Japanese</span>
          <h1>천 문장이 천 일의 힘이 됩니다</h1>
          <p class="lead">핵심 문형 50과를 따라 하루 20문장씩, 소리 내어 읽고 가리고 바꿔 말하는 천일문 학습법으로 일본어의 뼈대를 세워 보세요.</p>
          <div class="hero-cta">
            <a class="btn btn-primary btn-lg" href="#/study/${resume.id}">
              ${fresh ? '학습 시작하기' : allDone ? '복습 시작하기' : '이어서 학습하기'} ${ICON.arrowR}
            </a>
            ${(!fresh && resume.id !== 1) ? `<a class="btn btn-ghost btn-lg" href="#/study/1">처음부터</a>` : ''}
            ${fresh ? `<a class="btn btn-ghost btn-lg" href="#/kana"><span class="jp" style="margin-right:6px">あ</span>가나부터</a>` : ''}
            <a class="btn btn-ghost btn-lg" href="#/auto">${ICON.playFill}<span style="margin-left:6px">자동 학습</span></a>
          </div>
          <p class="resume-meta">
            ${fresh
              ? `<b>01. ${esc(CHAPTERS[0].title)}</b>부터 시작해요 · 하루 20문장이면 50일 완성`
              : `이어서 학습: <b>${pad2(resume.id)}. ${esc(resume.title)}</b> · ${rp.done}/${rp.total}문장 · 전체 ${total}/${TOTAL}`}
          </p>
        </div>
        ${ringSvg(pct)}
      </div>
    </section>

    <div class="stat-grid">
      <a class="stat is-link" href="#/all"><b>${total}<small>/ ${TOTAL}문장</small></b><span>학습 완료 →</span></a>
      <div class="stat"><b>${todayCount()}<small>문장</small></b><span>오늘 학습</span></div>
      <a class="stat is-link ${weakN ? '' : 'stat-muted'}" href="#/quiz?src=weak"><b>${weakN}<small>문장</small></b><span>복습 대기 ${weakN ? '→' : ''}</span></a>
      <div class="stat"><b>${S.streak.count}<small>일</small></b><span>연속 학습 🔥</span></div>
    </div>

    <div class="section-head"><h2>오늘의 문장</h2><a href="#/study/${tod.ch}?focus=${tod.n}">본문에서 보기</a></div>
    <section class="card today-card">
      <div style="display:flex;gap:8px;align-items:center">
        <span class="s-num jp">${pad4(tod.n)}</span>${levelChip(todCh.level)}
      </div>
      <p class="jp-line jp">${esc(tod.jp)}</p>
      <p class="ko-line">${esc(tod.ko)}</p>
      <div class="meta">
        ${ptChip(tod.pt)}
        <button class="s-btn" data-action="speak" data-n="${tod.n}" style="margin-left:auto">${ICON.play} 듣기</button>
      </div>
    </section>

    <div class="section-head"><h2>레벨별 진행</h2><a href="#/chapters">전체 목차 →</a></div>
    <section class="card level-rows">
      ${levels.map(l => `
        <div class="level-row">
          ${levelChip(l.lv)}
          <div class="bar"><i class="c-${l.lv.toLowerCase()}" style="width:${l.tot ? (l.done / l.tot * 100) : 0}%"></i></div>
          <span class="nums">${l.done} / ${l.tot}</span>
        </div>`).join('')}
    </section>

    <div class="section-head"><h2>바로 가기</h2></div>
    <div class="option-grid">
      <a class="option-card" href="#/kana">
        <b>가나 익히기 — <span class="jp">五十音</span></b><span>히라가나·카타카나 차트와 랜덤 연습</span>
      </a>
      <a class="option-card" href="#/words">
        <b>단어장 — <span class="jp">語彙</span></b><span>숫자·조수사·요일·계절·가족 등 주제별 단어</span>
      </a>
      <a class="option-card" href="#/auto">
        <b>자동 학습 — <span class="jp">自動再生</span></b><span>듣기만 해도 되는 핸즈프리 음성 재생</span>
      </a>
      <a class="option-card" href="#/quiz?src=random">
        <b>랜덤 20문장 암기</b><span>전체 범위에서 무작위로 카드 테스트</span>
      </a>
      <a class="option-card" href="#/quiz?src=book">
        <b>북마크 복습</b><span>따로 모아 둔 ${bookN}개 문장 다시 보기</span>
        ${bookN ? `<span class="count">${bookN}</span>` : ''}
      </a>
      <a class="option-card" href="#/chapters?tab=grammar">
        <b>문법 색인 — <span class="jp">文法</span></b><span>50개 핵심 문형 해설을 한눈에</span>
      </a>
      <a class="option-card" href="#/all">
        <b>천문장 — <span class="jp">全文</span></b><span>1000문장을 한 화면에서 통독</span>
      </a>
      <a class="option-card" href="#/study/${resume.id}">
        <b>오늘의 20문장</b><span>${pad2(resume.id)}과 「${esc(resume.title)}」 이어가기</span>
      </a>
    </div>
  </div>`;
}

/* ---------- 뷰: 목차 / 문법 색인 ---------- */
let chapterFilter = 'ALL';
let chaptersTab = 'list';
function viewChapters() {
  const filters = ['ALL', 'N5', 'N4', 'N3'];
  const list = CHAPTERS.filter(ch => chapterFilter === 'ALL' || ch.level === chapterFilter);
  const resumeId = resumeChapter().id;
  return `
  <div class="view">
    <h1 class="page-title">목차 — 五十課</h1>
    <p class="page-sub">핵심 문형 50과, 과마다 20문장. 순서대로 읽어도 좋고 필요한 문형만 골라도 좋습니다.</p>
    <div class="filter-row">
      <div class="seg" role="group" aria-label="보기 전환" style="margin-right:auto">
        <button class="${chaptersTab === 'list' ? 'active' : ''}" data-action="ch-tab" data-tab="list">과 목록</button>
        <button class="${chaptersTab === 'grammar' ? 'active' : ''}" data-action="ch-tab" data-tab="grammar">문법 색인</button>
      </div>
      ${filters.map(f => `<button class="filter-btn ${chapterFilter === f ? 'active' : ''}" data-action="filter" data-filter="${f}">${f === 'ALL' ? '전체' : f}</button>`).join('')}
    </div>
    ${chaptersTab === 'grammar' ? `
    <div class="chapter-list">
      ${list.map(ch => {
        const g = GRAMMAR.find(x => x.id === ch.id);
        if (!g) return '';
        return `
        <a class="chapter-item gi-item" href="#/grammar/${ch.id}">
          <span class="chapter-num">${pad2(ch.id)}</span>
          <span class="chapter-body">
            <h3 class="jp gi-formula">${esc(g.formula)}</h3>
            <span class="gi-gist">${esc(g.gist)}</span>
          </span>
          <span class="chapter-side">${levelChip(ch.level)}</span>
        </a>`;
      }).join('')}
    </div>` : `
    <div class="chapter-list">
      ${list.map(ch => {
        const p = chapterProgress(ch);
        const pct = Math.round(p.done / p.total * 100);
        const done = p.done === p.total;
        const isResume = !done && ch.id === resumeId && p.done > 0;
        return `
        <a class="chapter-item ${done ? 'done' : ''} ${isResume ? 'resume' : ''}" href="#/study/${ch.id}">
          <span class="chapter-num">${pad2(ch.id)}</span>
          <span class="chapter-body">
            <h3>${esc(ch.title)}${isResume ? '<span class="resume-tag">이어서</span>' : ''}</h3>
            <span class="sub">${levelChip(ch.level)} <span>${pad4(ch.start)}–${pad4(ch.end)}</span></span>
            <span class="bar thin"><i style="width:${pct}%"></i></span>
          </span>
          <span class="chapter-side">
            <span class="pct">${done ? '완료 ✓' : pct + '%'}</span>
          </span>
        </a>`;
      }).join('')}
    </div>`}
  </div>`;
}

/* ---------- 뷰: 문법 상세 (문법만 보기) ---------- */
function viewGrammar(id) {
  const ch = chapterOf(id);
  const g = GRAMMAR.find(x => x.id === id);
  if (!ch || !g) { location.hash = '#/chapters?tab=grammar'; return ''; }
  const prev = id > 1 ? GRAMMAR.find(x => x.id === id - 1) : null;
  const next = id < CHAPTERS.length ? GRAMMAR.find(x => x.id === id + 1) : null;
  return `
  <div class="view">
    <section class="card study-head">
      <div class="crumb"><a href="#/chapters?tab=grammar">문법 색인</a> <span>›</span> <span>제${pad2(id)}과</span></div>
      <h1 class="jp">${pad2(id)}. ${esc(ch.title)}</h1>
      <div class="meta-row">${levelChip(ch.level)}<span class="meta-num">본문 ${pad4(ch.start)}–${pad4(ch.end)}</span></div>
    </section>

    ${lessonHtml(ch)}

    <div class="grammar-cta">
      <a class="btn btn-primary" href="#/study/${id}">이 과 본문 20문장 학습 ${ICON.arrowR}</a>
      <button class="btn btn-ghost" data-action="auto-quick" data-ch="${id}">${ICON.playFill}<span style="margin-left:5px">자동 재생</span></button>
    </div>

    <div class="study-footer">
      ${prev ? `<a class="btn btn-ghost jp" href="#/grammar/${id - 1}">← ${esc(prev.formula)}</a>` : '<span></span>'}
      ${next ? `<a class="btn btn-ghost jp" href="#/grammar/${id + 1}">${esc(next.formula)} →</a>` : '<span></span>'}
    </div>
  </div>`;
}

/* ---------- 문법 해설 (교재 본문) ---------- */
function lessonHtml(ch) {
  const g = GRAMMAR.find(x => x.id === ch.id);
  if (!g) return '';
  return `
  <section class="card lesson">
    <header class="lesson-head">
      <span class="lesson-label jp">文法</span>
      <div class="lesson-title">
        <h2 class="lesson-formula jp">${esc(g.formula)}</h2>
        <p class="lesson-gist">${esc(g.gist)}</p>
      </div>
    </header>
    <p class="lesson-intro">${esc(g.intro)}</p>
    <div class="lesson-grid">
      <div class="lesson-sec">
        <h3><i class="jp">接続</i>접속 · 활용</h3>
        <table class="lesson-table">
          ${g.forms.map(f => `
          <tr>
            <th>${esc(f[0])}</th>
            <td><span class="jp">${esc(f[1])}</span>${f[2] ? `<small>${esc(f[2])}</small>` : ''}</td>
          </tr>`).join('')}
        </table>
      </div>
      <div class="lesson-sec">
        <h3><i class="jp">要点</i>학습 포인트</h3>
        <ul class="lesson-points">
          ${g.point.map(p => `<li>${esc(p)}</li>`).join('')}
        </ul>
      </div>
    </div>
    ${g.vocab && g.vocab.length ? `
    <div class="lesson-sec lesson-vocab-sec">
      <h3><i class="jp">語彙</i>주요 어휘 <small class="vocab-hint">· 단어를 누르면 발음을 들려줘요</small></h3>
      <div class="vocab-grid">
        ${g.vocab.map(v => `
        <button class="vocab-item" data-action="say" data-ch="${esc(v[1])}" title="${esc(v[1])} 발음 듣기">
          <span class="vocab-spk">${ICON.play}</span>
          <ruby class="jp">${esc(v[0])}<rt>${esc(v[1])}</rt></ruby>
          <span class="vocab-ko">${esc(v[2])}</span>
        </button>`).join('')}
      </div>
    </div>` : ''}
  </section>`;
}

/* ---------- 뷰: 학습 ---------- */
function maskWrap(inner, masked) {
  return masked
    ? `<span class="masked" data-action="reveal"><span class="mask-text">${inner}</span></span>`
    : inner;
}

function sentenceCard(s) {
  const mode = S.settings.hideMode; // all | hideKo | hideJp
  const learned = !!S.learned[s.n];
  const booked = !!S.bookmarks[s.n];
  return `
  <article class="s-card ${learned ? 'is-learned' : ''}" id="s-${s.n}" data-n="${s.n}">
    <div class="s-top">
      <span class="s-num jp">${pad4(s.n)}</span>
      ${ptChip(s.pt)}
    </div>
    <p class="s-jp jp">${maskWrap(esc(s.jp), mode === 'hideJp')}</p>
    <p class="s-ko">${maskWrap(esc(s.ko), mode === 'hideKo')}</p>
    <div class="s-actions">
      <button class="s-btn" data-action="speak" data-n="${s.n}" title="발음 듣기">${ICON.play} 듣기</button>
      <button class="s-btn ${learned ? 'on-learn' : ''}" data-action="learn" data-n="${s.n}" title="학습 완료 표시">${ICON.check} <span>${learned ? '완료' : '외웠어요'}</span></button>
      <button class="s-btn ${booked ? 'on-book' : ''}" data-action="book" data-n="${s.n}" title="북마크">${booked ? ICON.starFill : ICON.star} <span>북마크</span></button>
    </div>
  </article>`;
}

function viewStudy(id) {
  const ch = chapterOf(id);
  if (!ch) { location.hash = '#/chapters'; return ''; }
  S.lastChapter = id; save();

  const p = chapterProgress(ch);
  const pct = Math.round(p.done / p.total * 100);
  const items = SENTENCES.slice(ch.start - 1, ch.end);
  const mode = S.settings.hideMode;
  const prev = id > 1 ? chapterOf(id - 1) : null;
  const next = id < CHAPTERS.length ? chapterOf(id + 1) : null;

  return `
  <div class="view">
    <section class="card study-head">
      <div class="crumb"><a href="#/chapters">목차</a> <span>›</span> <span>제${pad2(ch.id)}과</span></div>
      <h1 class="jp">${pad2(ch.id)}. ${esc(ch.title)}</h1>
      <div class="meta-row">
        ${levelChip(ch.level)}
        <span class="meta-num">${pad4(ch.start)}–${pad4(ch.end)}</span>
        <span class="bar"><i id="ch-bar" style="width:${pct}%"></i></span>
        <span class="meta-num"><b id="ch-done">${p.done}</b>/${p.total}</span>
      </div>
    </section>

    ${lessonHtml(ch)}

    <div class="section-head"><h2>본문 — 例文 ${p.total}</h2></div>

    <div class="study-tools">
      <div class="seg" role="group" aria-label="표시 모드">
        <button class="${mode === 'all' ? 'active' : ''}" data-action="hide-mode" data-mode="all">모두 보기</button>
        <button class="${mode === 'hideKo' ? 'active' : ''}" data-action="hide-mode" data-mode="hideKo">한국어 가리기</button>
        <button class="${mode === 'hideJp' ? 'active' : ''}" data-action="hide-mode" data-mode="hideJp">일본어 가리기</button>
      </div>
      <div class="right">
        <button class="btn btn-sm btn-ghost" data-action="auto-quick" data-ch="${ch.id}">${ICON.playFill}<span style="margin-left:5px">자동 재생</span></button>
        <a class="btn btn-sm btn-ghost" href="#/quiz?src=chapter&ch=${ch.id}">이 과 암기 →</a>
      </div>
    </div>

    <div class="sentence-list">${items.map(sentenceCard).join('')}</div>

    <div class="chapter-done-cta">
      <button class="btn btn-ghost" data-action="mark-all" data-ch="${ch.id}">이 과 전체를 완료로 표시</button>
    </div>

    <div class="study-footer">
      ${prev ? `<a class="btn btn-ghost" href="#/study/${prev.id}">← ${pad2(prev.id)}. ${esc(prev.title)}</a>` : '<span></span>'}
      ${next ? `<a class="btn btn-primary" href="#/study/${next.id}">${pad2(next.id)}. ${esc(next.title)} →</a>` : `<a class="btn btn-primary" href="#/quiz">암기 모드로 →</a>`}
    </div>
  </div>`;
}

/* ---------- 뷰: 천문장 (전체 1000문장 통독) ---------- */
let allFilter = 'ALL';

function allRow(s) {
  const mode = S.settings.hideMode;
  const learned = !!S.learned[s.n];
  return `
  <div class="all-row" data-n="${s.n}">
    <a class="ar-num jp ${learned ? 'done' : ''}" href="#/study/${s.ch}?focus=${s.n}" title="${learned ? '학습 완료 · ' : ''}본문에서 보기">${pad4(s.n)}</a>
    <div class="ar-body">
      <p class="ar-jp jp">${maskWrap(esc(s.jp), mode === 'hideJp')}</p>
      <p class="ar-ko">${maskWrap(esc(s.ko), mode === 'hideKo')}</p>
    </div>
    <button class="s-btn icon-only" data-action="speak" data-n="${s.n}" title="듣기" aria-label="듣기">${ICON.play}</button>
  </div>`;
}

function viewAll() {
  const mode = S.settings.hideMode;
  const chs = CHAPTERS.filter(c => allFilter === 'ALL' || c.level === allFilter);
  const totalShown = chs.reduce((a, c) => a + (c.end - c.start + 1), 0);
  return `
  <div class="view">
    <h1 class="page-title">천문장 — 全文 1000</h1>
    <p class="page-sub">1000문장을 한 화면에서 통독하세요. 가리기로 암송 연습을, 번호를 누르면 해당 과 본문으로 이동합니다.</p>

    <div class="filter-row">
      ${['ALL', 'N5', 'N4', 'N3'].map(f => `<button class="filter-btn ${allFilter === f ? 'active' : ''}" data-action="all-filter" data-filter="${f}">${f === 'ALL' ? '전체' : f}</button>`).join('')}
      <span class="filter-meta">${chs.length}과 · ${totalShown}문장</span>
    </div>

    <div class="study-tools">
      <div class="seg" role="group" aria-label="표시 모드">
        <button class="${mode === 'all' ? 'active' : ''}" data-action="hide-mode" data-mode="all">모두 보기</button>
        <button class="${mode === 'hideKo' ? 'active' : ''}" data-action="hide-mode" data-mode="hideKo">한국어 가리기</button>
        <button class="${mode === 'hideJp' ? 'active' : ''}" data-action="hide-mode" data-mode="hideJp">일본어 가리기</button>
      </div>
      <div class="right">
        <div class="select-wrap select-sm">
          <select data-action="all-jump" aria-label="과로 이동">
            <option value="">과로 이동…</option>
            ${chs.map(c => `<option value="${c.id}">${pad2(c.id)}. ${esc(c.title)}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>

    ${chs.map(c => `
    <section class="all-sec" id="all-ch-${c.id}">
      <div class="all-sec-head">
        <span class="chapter-num">${pad2(c.id)}</span>
        <h2 class="jp">${esc(c.title)}</h2>
        ${levelChip(c.level)}
        <a class="s-btn" href="#/study/${c.id}">학습 →</a>
      </div>
      <div class="card all-list">
        ${SENTENCES.slice(c.start - 1, c.end).map(allRow).join('')}
      </div>
    </section>`).join('')}
  </div>`;
}

/* ---------- 뷰: 암기 설정 ---------- */
let quizSetup = { src: 'random', ch: 1, dir: 'jp2ko', shuffle: true };
let quizSession = null;

function poolFor(src, ch) {
  if (src === 'chapter') { const c = chapterOf(ch); return SENTENCES.slice(c.start - 1, c.end).map(s => s.n); }
  if (src === 'book') return bookmarkList();
  if (src === 'weak') return weakList();
  return shuffle(SENTENCES.map(s => s.n)).slice(0, 20); // random
}

function viewQuizSetup() {
  const bookN = bookmarkList().length;
  const weakN = weakList().length;
  const q = quizSetup;
  const srcCard = (key, title, sub, count, disabled) => `
    <button class="option-card ${q.src === key ? 'active' : ''}" data-action="q-src" data-src="${key}" ${disabled ? 'disabled' : ''}>
      <b>${title}</b><span>${sub}</span>${count != null ? `<span class="count">${count}</span>` : ''}
    </button>`;

  return `
  <div class="view quiz-setup">
    <h1 class="page-title">암기 모드 — 暗記</h1>
    <p class="page-sub">카드를 뒤집어 답을 확인하고, 스스로 채점하세요. ‘몰라요’한 문장은 복습 대기로 모입니다.</p>

    <div class="setup-row"><label>범위 선택</label>
      <div class="option-grid">
        ${srcCard('random', '랜덤 20문장', '전체 1000문장에서 무작위 출제')}
        ${srcCard('chapter', '챕터 선택', '특정 과의 20문장으로 연습')}
        ${srcCard('weak', '복습 대기', '암기에서 틀렸던 문장만 다시', weakN, weakN === 0)}
        ${srcCard('book', '북마크', '북마크한 문장만 모아서', bookN, bookN === 0)}
      </div>
    </div>

    ${q.src === 'chapter' ? `
    <div class="setup-row"><label>챕터</label>
      <div class="select-wrap">
        <select data-action="q-ch">
          ${CHAPTERS.map(c => {
            const p = chapterProgress(c);
            return `<option value="${c.id}" ${q.ch === c.id ? 'selected' : ''}>${pad2(c.id)}. ${esc(c.title)} (${c.level}) — ${p.done}/${p.total}</option>`;
          }).join('')}
        </select>
      </div>
    </div>` : ''}

    <div class="setup-row"><label>방향</label>
      <div class="option-grid">
        <button class="option-card ${q.dir === 'jp2ko' ? 'active' : ''}" data-action="q-dir" data-dir="jp2ko"><b class="jp">日本語 → 한국어</b><span>일본어를 보고 뜻을 말하기 (읽기 중심)</span></button>
        <button class="option-card ${q.dir === 'ko2jp' ? 'active' : ''}" data-action="q-dir" data-dir="ko2jp"><b>한국어 → <span class="jp">日本語</span></b><span>뜻을 보고 일본어로 말하기 (작문 중심)</span></button>
      </div>
    </div>

    <div class="quiz-start-row">
      <button class="btn btn-primary btn-lg" data-action="q-start">시작하기 ${ICON.arrowR}</button>
      <span class="quiz-hint">카드 탭 = 뒤집기 · <b>O</b> 알아요 / <b>X</b> 몰라요</span>
    </div>
  </div>`;
}

/* ---------- 뷰: 암기 실행 ---------- */
function startQuiz() {
  let pool = poolFor(quizSetup.src, quizSetup.ch);
  if (!pool.length) { toast('출제할 문장이 없어요'); return; }
  if (quizSetup.shuffle && quizSetup.src !== 'random') pool = shuffle(pool);
  if (pool.length > 50) pool = pool.slice(0, 50); // 한 세션 상한
  quizSession = { items: pool, idx: 0, dir: quizSetup.dir, flipped: false, wrong: [], right: 0 };
  if (location.hash === '#/quiz/run') render();
  else location.hash = '#/quiz/run';
}

function viewQuizRun() {
  const qs = quizSession;
  if (!qs) { location.hash = '#/quiz'; return ''; }
  if (qs.idx >= qs.items.length) return viewQuizResult();

  const s = sentence(qs.items[qs.idx]);
  const jpFront = qs.dir === 'jp2ko';
  const frontMain = jpFront ? `<div class="q-main jp">${esc(s.jp)}</div>` : `<div class="q-main ko-main">${esc(s.ko)}</div>`;
  const pct = qs.idx / qs.items.length * 100;

  return `
  <div class="view quiz-run">
    <div class="quiz-top">
      <button class="icon-btn" data-action="q-exit" aria-label="그만두기" title="그만두기">${ICON.x}</button>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <span class="q-count">${qs.idx + 1} / ${qs.items.length}</span>
    </div>

    <div class="flip-scene">
      <div class="flip-card ${qs.flipped ? 'flipped' : ''}" data-action="q-flip" id="flip-card">
        <div class="flip-face front">
          <span class="q-num jp">${pad4(s.n)}</span>
          <span class="q-label">${jpFront ? '日 → 韓' : '韓 → 日'}</span>
          ${frontMain}
          <span class="tap-hint">카드를 누르면 답이 보여요</span>
        </div>
        <div class="flip-face back">
          <span class="q-num jp">${pad4(s.n)}</span>
          <span class="q-pt">${ptChip(s.pt)}</span>
          <div class="q-main jp">${esc(s.jp)}</div>
          <div class="q-sub">${esc(s.ko)}</div>
          <button class="s-btn" data-action="speak" data-n="${s.n}">${ICON.play} 듣기</button>
        </div>
      </div>
    </div>

    <div class="quiz-actions" style="visibility:${qs.flipped ? 'visible' : 'hidden'}">
      <button class="btn btn-no" data-action="q-no">✕ 몰라요</button>
      <button class="btn btn-ok" data-action="q-ok">◯ 알아요</button>
    </div>
    <p class="quiz-kbd"><kbd>Space</kbd> 뒤집기 · <kbd>←</kbd>/<kbd>X</kbd> 몰라요 · <kbd>→</kbd>/<kbd>O</kbd> 알아요</p>
  </div>`;
}

function viewQuizResult() {
  const qs = quizSession;
  const total = qs.items.length;
  const right = qs.right;
  const pct = total ? right / total : 0;
  const wrongs = qs.wrong.map(sentence);
  const cheer = pct === 1 ? '完璧！ 완벽해요' : pct >= 0.8 ? 'よくできました — 잘했어요' : pct >= 0.5 ? 'もう一歩 — 조금만 더' : '大丈夫、반복이 답입니다';

  return `
  <div class="view quiz-run">
    <section class="card quiz-result">
      ${ringSvg(pct, 120, 8, '정답률')}
      <h2>${cheer}</h2>
      <p class="sub">${total}문장 중 <b>${right}문장</b>을 알고 있었어요${wrongs.length ? ` · ${wrongs.length}문장은 복습 대기에 담았어요` : ''}</p>
      <div class="result-actions">
        ${wrongs.length ? `<button class="btn btn-primary" data-action="q-retry-wrong">틀린 ${wrongs.length}문장 다시</button>` : ''}
        <button class="btn btn-ghost" data-action="q-retry-same">한 번 더</button>
        <a class="btn btn-ghost" href="#/quiz">설정으로</a>
      </div>
      ${wrongs.length ? `
      <div class="wrong-list">
        ${wrongs.map(s => `
          <div class="wrong-item">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px"><span class="s-num jp">${pad4(s.n)}</span>${ptChip(s.pt)}</div>
            <div class="jp">${esc(s.jp)}</div>
            <div class="ko">${esc(s.ko)}</div>
          </div>`).join('')}
      </div>` : ''}
    </section>
  </div>`;
}

function answerQuiz(ok) {
  const qs = quizSession;
  if (!qs || !qs.flipped) return;
  const n = qs.items[qs.idx];
  if (ok) {
    qs.right++;
    S.learned[n] = 1;
    delete S.weak[n];
  } else {
    qs.wrong.push(n);
    S.weak[n] = (S.weak[n] || 0) + 1;
  }
  touchActivity(n);
  qs.idx++;
  qs.flipped = false;
  render();
}

/* ---------- 자동 학습(핸즈프리 음성 재생) ---------- */
let autoPlayer = null;   // { items, idx, playing, finished, started, readKo, repeat, rate, gap, loop }
let autoToken = 0;       // 실행 중인 루프 식별 토큰(취소/점프 시 증가)

function autoPool(src, ch) {
  if (src === 'all') return SENTENCES.map(s => s.n);
  if (src === 'chapter') { const c = chapterOf(ch); return c ? SENTENCES.slice(c.start - 1, c.end).map(s => s.n) : []; }
  if (src === 'book') return bookmarkList();
  if (src === 'weak') return weakList();
  return [];
}

function viewAutoSetup() {
  const a = S.settings.auto;
  const bookN = bookmarkList().length, weakN = weakList().length;
  const srcCard = (key, title, sub, count, disabled) => `
    <button class="option-card ${a.src === key ? 'active' : ''}" data-action="auto-src" data-src="${key}" ${disabled ? 'disabled' : ''}>
      <b>${title}</b><span>${sub}</span>${count != null ? `<span class="count">${count}</span>` : ''}
    </button>`;
  const seg = (key, opts) => `<div class="seg seg-wide">${opts.map(([v, l]) =>
    `<button class="${String(a[key]) === String(v) ? 'active' : ''}" data-action="auto-set" data-key="${key}" data-val="${v}">${l}</button>`).join('')}</div>`;

  return `
  <div class="view quiz-setup">
    <h1 class="page-title">자동 학습 — 自動再生</h1>
    <p class="page-sub">손대지 않아도 카드가 저절로 넘어가며 일본어와 한국어를 차례로 읽어 줍니다. 출퇴근·설거지·잠들기 전 듣기 연습에 좋아요.</p>

    <div class="setup-row"><label>재생 범위</label>
      <div class="option-grid">
        ${srcCard('chapter', '챕터', '한 과(20문장)를 순서대로')}
        ${srcCard('all', '전체 1000', '1과부터 끝까지 이어 듣기')}
        ${srcCard('book', '북마크', '북마크한 문장만', bookN, bookN === 0)}
        ${srcCard('weak', '복습 대기', '틀렸던 문장만', weakN, weakN === 0)}
      </div>
    </div>

    ${a.src === 'chapter' ? `
    <div class="setup-row"><label>챕터</label>
      <div class="select-wrap"><select data-action="auto-ch">
        ${CHAPTERS.map(c => `<option value="${c.id}" ${a.ch === c.id ? 'selected' : ''}>${pad2(c.id)}. ${esc(c.title)} (${c.level})</option>`).join('')}
      </select></div>
    </div>` : ''}

    <div class="setup-row"><label>한국어 음성</label>${seg('readKo', [[true, '일본어 + 한국어'], [false, '일본어만']])}</div>

    <div class="setup-grid">
      <div><label>일본어 반복</label>${seg('repeat', [[1, '1회'], [2, '2회'], [3, '3회']])}</div>
      <div><label>재생 속도</label>${seg('rate', [[0.7, '느리게'], [0.9, '보통'], [1.1, '빠르게']])}</div>
      <div><label>문장 간격</label>${seg('gap', [[400, '짧게'], [900, '보통'], [1600, '길게']])}</div>
      <div><label>Loop</label>${seg('loop', [[false, '끄기'], [true, '켜기']])}</div>
    </div>

    <div class="quiz-start-row">
      <button class="btn btn-primary btn-lg" data-action="auto-start">${PLY.play}<span style="margin-left:6px">재생 시작</span></button>
      <span class="quiz-hint">${hasTTS ? '<kbd>Space</kbd> 재생/정지 · <kbd>←</kbd>/<kbd>→</kbd> 이동' : '⚠ 이 브라우저는 음성 재생을 지원하지 않습니다'}</span>
    </div>
  </div>`;
}

function autoCardBody(s) {
  const ch = chapterOf(s.ch);
  return `
    <div class="auto-card-top">
      <span class="s-num jp">${pad4(s.n)}</span>${levelChip(ch.level)}${ptChip(s.pt)}
      <span class="auto-chapter">${pad2(ch.id)}. ${esc(ch.title)}</span>
    </div>
    <p class="auto-jp jp" id="auto-jp">${esc(s.jp)}</p>
    <p class="auto-ko" id="auto-ko">${esc(s.ko)}</p>`;
}

function viewAutoRun() {
  const A = autoPlayer;
  const s = sentence(A.items[A.idx]);
  return `
  <div class="view auto-run">
    <div class="quiz-top">
      <button class="icon-btn" data-action="auto-exit" aria-label="닫기" title="닫기">${ICON.x}</button>
      <div class="bar"><i id="auto-bar" style="width:0%"></i></div>
      <span class="q-count" id="auto-count">1 / ${A.items.length}</span>
    </div>

    <section class="card auto-card" id="auto-card-body">${autoCardBody(s)}</section>

    <div class="auto-controls">
      <button class="auto-ctrl" data-action="auto-prev" aria-label="이전 문장">${PLY.prev}</button>
      <button class="auto-ctrl auto-main" id="auto-play-btn" data-action="auto-toggle" aria-label="재생/정지">${PLY.play}</button>
      <button class="auto-ctrl" data-action="auto-next" aria-label="다음 문장">${PLY.next}</button>
    </div>

    <div class="auto-live">
      <button id="auto-rate-btn" data-action="auto-live" data-key="rate">${A.rate}×</button>
      <button id="auto-ko-btn" class="${A.readKo ? 'on' : ''}" data-action="auto-live" data-key="readKo">한국어 음성</button>
      <button id="auto-loop-btn" class="${A.loop ? 'on' : ''}" data-action="auto-live" data-key="loop">Loop</button>
    </div>
    <p class="quiz-kbd"><kbd>Space</kbd> 재생/정지 · <kbd>←</kbd> 이전 · <kbd>→</kbd> 다음</p>
  </div>`;
}

function setAutoSpeaking(which) {
  const jp = $('#auto-jp'), ko = $('#auto-ko');
  if (jp) jp.classList.toggle('now', which === 'jp');
  if (ko) ko.classList.toggle('now', which === 'ko');
}

function updateAutoControls() {
  const A = autoPlayer; if (!A) return;
  const rb = $('#auto-rate-btn'); if (rb) rb.textContent = A.rate + '×';
  const kb = $('#auto-ko-btn'); if (kb) kb.classList.toggle('on', A.readKo);
  const lb = $('#auto-loop-btn'); if (lb) lb.classList.toggle('on', A.loop);
}

function updateAutoUI() {
  const A = autoPlayer; if (!A) return;
  const s = sentence(A.items[A.idx]);
  const body = $('#auto-card-body'); if (body) body.innerHTML = autoCardBody(s);
  const bar = $('#auto-bar'); if (bar) bar.style.width = ((A.idx + (A.finished ? 1 : 0)) / A.items.length * 100) + '%';
  const cnt = $('#auto-count'); if (cnt) cnt.textContent = A.finished ? `${A.items.length} / ${A.items.length} · 완료` : `${A.idx + 1} / ${A.items.length}`;
  const pb = $('#auto-play-btn'); if (pb) pb.innerHTML = A.finished ? PLY.replay : (A.playing ? PLY.pause : PLY.play);
  updateAutoControls();
}

async function autoRun() {
  const A = autoPlayer; if (!A) return;
  const myToken = ++autoToken;
  A.playing = true; A.finished = false;
  updateAutoUI();
  const alive = () => A === autoPlayer && A.playing && myToken === autoToken;
  while (alive() && A.idx < A.items.length) {
    const n = A.items[A.idx], s = sentence(n);
    for (let r = 0; r < A.repeat; r++) {
      if (!alive()) return;
      setAutoSpeaking('jp');
      await speakAsync(s.jp, 'ja-JP', A.rate);
      if (!alive()) return;
      if (r < A.repeat - 1) await sleep(260);
    }
    if (A.readKo) {
      if (!alive()) return;
      await sleep(300);
      if (!alive()) return;
      setAutoSpeaking('ko');
      await speakAsync(s.ko, 'ko-KR', A.rate);
    }
    if (!alive()) return;
    setAutoSpeaking(null);
    if (!S.learned[n]) S.learned[n] = 1;
    touchActivity(n); save();
    await sleep(A.gap);
    if (!alive()) return;
    if (A.idx + 1 >= A.items.length) {
      if (A.loop) { A.idx = 0; updateAutoUI(); }
      else { A.playing = false; A.finished = true; updateAutoUI(); toast('자동 학습을 마쳤어요'); return; }
    } else {
      A.idx++; updateAutoUI();
    }
  }
}

function autoToggle() {
  const A = autoPlayer; if (!A) return;
  if (!hasTTS) { toast('이 브라우저는 음성 재생을 지원하지 않아요'); return; }
  if (A.finished) { A.idx = 0; autoRun(); return; }
  if (A.playing) autoPause(); else autoRun();
}
function autoPause() {
  const A = autoPlayer; if (!A) return;
  A.playing = false; autoToken++;
  if (hasTTS) speechSynthesis.cancel();
  setAutoSpeaking(null); updateAutoUI();
}
function autoJump(d) {
  const A = autoPlayer; if (!A) return;
  A.idx = Math.min(Math.max(A.idx + d, 0), A.items.length - 1);
  A.finished = false; autoToken++;
  if (hasTTS) speechSynthesis.cancel();
  if (A.playing) autoRun(); else updateAutoUI();
}
function autoStop() {
  if (!autoPlayer) return;
  autoPlayer.playing = false; autoToken++;
  if (hasTTS) speechSynthesis.cancel();
  autoPlayer = null;
}
function startAuto() {
  const cfg = S.settings.auto;
  const items = autoPool(cfg.src, cfg.ch);
  if (!items.length) { toast('재생할 문장이 없어요'); return; }
  autoPlayer = {
    items, idx: 0, playing: false, finished: false, started: false,
    readKo: cfg.readKo, repeat: cfg.repeat, rate: cfg.rate, gap: cfg.gap, loop: cfg.loop,
  };
  if (location.hash === '#/auto/run') render(); else location.hash = '#/auto/run';
}
function autoLive(key) {
  const A = autoPlayer, cfg = S.settings.auto; if (!A) return;
  if (key === 'rate') { const seq = [0.7, 0.9, 1.1]; A.rate = cfg.rate = seq[(seq.indexOf(A.rate) + 1) % seq.length]; }
  else if (key === 'readKo') { A.readKo = cfg.readKo = !A.readKo; }
  else if (key === 'loop') { A.loop = cfg.loop = !A.loop; }
  save(); updateAutoControls();
}

/* ---------- 가나(五十音) 익히기 ---------- */
const KANA = window.NIHONGO_KANA || { seion: [], dakuon: [], yoon: [] };
let kanaMode = 'chart'; // chart | practice
let kanaPractice = { range: 'seion', items: [], revealed: {}, flips: [] };

function reshuffleKana() {
  kanaPractice.items = shuffle(kanaPool(kanaPractice.range));
  kanaPractice.revealed = {};
  // '함께 보기'일 때 셀마다 히라/카타 중 어느 쪽을 낼지 미리 결정
  kanaPractice.flips = kanaPractice.items.map(() => Math.random() < 0.5);
}

const KANA_SECTIONS = [
  { key: 'seion', title: '청음 — 五十音', intro: '일본어의 기본 46자입니다. 세로 단(あ・い・う・え・お)과 가로 행(あ행, か행…)으로 외워 두면 나중에 동사 활용이 훨씬 쉬워집니다. し는 [시], つ는 [츠]에 가깝고, 조사로 쓰일 때 は는 [와], へ는 [에]로 읽습니다.' },
  { key: 'dakuon', title: '탁음·반탁음 — 濁音・半濁音', intro: '오른쪽 위에 점 두 개(゛탁점)를 붙이면 흐린 소리가 됩니다(か→が). ぱ행은 동그라미(゜반탁점)를 붙인 파열음입니다. ぢ・づ는 じ・ず와 발음이 같고 현대어에서는 거의 쓰이지 않습니다.' },
  { key: 'yoon', title: '요음 — 拗音', intro: 'い단 글자 뒤에 작게 쓴 ゃ・ゅ・ょ를 붙여 한 박자로 읽습니다(き+ゃ=きゃ[캬]). 글자 크기에 주의하세요: きや는 2박자, きゃ는 1박자입니다.' },
];

function kanaPool(range) {
  const secs = range === 'all' ? ['seion', 'dakuon', 'yoon'] : [range];
  const out = [];
  secs.forEach(k => (KANA[k] || []).forEach(row => row.cells.forEach(c => { if (c) out.push(c); })));
  return out;
}

function kanaCellHtml(c) {
  if (!c) return '<span class="kana-cell empty" aria-hidden="true"></span>';
  const sc = S.settings.kanaScript;
  const main = sc === 'kata' ? c.k : c.h;
  const alt = sc === 'both' ? `<i>${esc(c.k)}</i>` : '';
  return `
  <button class="kana-cell" data-action="kana-speak" data-ch="${esc(main)}" title="${esc(c.r)} · ${esc(c.ko)}">
    <span class="kc-char jp">${esc(main)}${alt}</span>
    <span class="kc-sub">${esc(c.r)} · ${esc(c.ko)}</span>
  </button>`;
}

function kanaScriptSeg() {
  const sc = S.settings.kanaScript;
  return `
      <div class="seg" role="group" aria-label="문자 선택">
        <button class="${sc === 'hira' ? 'active' : ''} jp" data-action="kana-script" data-sc="hira">ひらがな</button>
        <button class="${sc === 'kata' ? 'active' : ''} jp" data-action="kana-script" data-sc="kata">カタカナ</button>
        <button class="${sc === 'both' ? 'active' : ''}" data-action="kana-script" data-sc="both">함께 보기</button>
      </div>`;
}

function practiceCellHtml(c, i) {
  // 연습 모드: 답이 새지 않도록 짝 문자는 공개 전까지 숨김(CSS).
  // '함께 보기'면 셀마다 히라/카타를 무작위로 출제.
  const sc = S.settings.kanaScript;
  const useKata = sc === 'kata' || (sc === 'both' && kanaPractice.flips[i]);
  const main = useKata ? c.k : c.h;
  const counter = useKata ? c.h : c.k;
  const rev = !!kanaPractice.revealed[i];
  return `
  <button class="kana-cell quiz ${rev ? 'revealed' : ''}" data-action="kana-reveal" data-i="${i}" data-ch="${esc(c.h)}" title="눌러서 발음 확인">
    <span class="kc-char jp">${esc(main)}<i>${esc(counter)}</i></span>
    <span class="kc-sub">${rev ? `${esc(c.r)} · ${esc(c.ko)}` : '?'}</span>
  </button>`;
}

function viewKanaPractice() {
  if (!kanaPractice.items.length) reshuffleKana();
  const revN = Object.keys(kanaPractice.revealed).length;
  const ranges = [['all', '전체'], ['seion', '청음'], ['dakuon', '탁음·반탁음'], ['yoon', '요음']];
  return `
    <div class="study-tools">
      ${kanaScriptSeg()}
      <span class="filter-meta" id="kana-progress">${revN} / ${kanaPractice.items.length} 확인</span>
    </div>
    <div class="filter-row">
      ${ranges.map(([v, l]) => `<button class="filter-btn ${kanaPractice.range === v ? 'active' : ''}" data-action="kana-range" data-range="${v}">${l}</button>`).join('')}
      <button class="btn btn-sm btn-ghost" data-action="kana-shuffle" style="margin-left:auto">⟳ 다시 섞기</button>
    </div>
    <p class="kana-intro">발음이 가려진 채 무작위로 섞여 있어요. 글자를 누르면 발음이 들리고 표기가 나타납니다. 막히는 글자는 차트에서 다시 확인하세요.</p>
    <div class="kana-grid-free">
      ${kanaPractice.items.map((c, i) => practiceCellHtml(c, i)).join('')}
    </div>`;
}

function viewKana() {
  return `
  <div class="view">
    <h1 class="page-title">가나 익히기 — 五十音</h1>
    <p class="page-sub">문장 학습 전 첫걸음. 차트로 눈에 익힌 뒤, 랜덤 연습에서 발음을 가리고 떠올려 보세요.</p>

    <div class="filter-row">
      <div class="seg" role="group" aria-label="모드 전환" style="margin-right:auto">
        <button class="${kanaMode === 'chart' ? 'active' : ''}" data-action="kana-mode" data-mode="chart">차트 보기</button>
        <button class="${kanaMode === 'practice' ? 'active' : ''}" data-action="kana-mode" data-mode="practice">랜덤 연습</button>
      </div>
      ${kanaMode === 'chart' ? '<span class="filter-meta">청음 46 · 탁음 25 · 요음 33</span>' : ''}
    </div>

    ${kanaMode === 'practice' ? viewKanaPractice() : viewKanaChart()}
  </div>`;
}

function viewKanaChart() {
  return `
    <div class="study-tools">${kanaScriptSeg()}</div>

    ${KANA_SECTIONS.map(sec => `
    <div class="section-head"><h2>${sec.title}</h2></div>
    <p class="kana-intro">${sec.intro}</p>
    <div class="kana-table">
      ${(KANA[sec.key] || []).map(row => `
      <div class="kana-row ${row.cells.length === 3 ? 'cols3' : ''}">
        <span class="kana-row-label jp">${esc(row.row)}</span>
        ${row.cells.map(kanaCellHtml).join('')}
      </div>`).join('')}
    </div>`).join('')}

    <div class="section-head"><h2>특수음 메모 — 特殊音</h2></div>
    <section class="card kana-note">
      <p><b class="jp">っ / ッ</b> <span>촉음 — 작은 つ. 받침처럼 소리를 한 박자 막습니다. <span class="jp">きって</span>[킷테], <span class="jp">ざっし</span>[잣시]</span></p>
      <p><b class="jp">ん / ン</b> <span>발음(撥音) — 뒤 소리에 따라 ㄴ·ㅁ·ㅇ 받침으로 들립니다. <span class="jp">さんぽ</span>[삼포], <span class="jp">てんき</span>[텡키]</span></p>
      <p><b class="jp">ー</b> <span>장음 — 앞 모음을 한 박자 길게. 히라가나는 모음을 겹쳐 쓰고(<span class="jp">おかあさん</span>), 카타카나는 ー를 씁니다(<span class="jp">コーヒー</span>)</span></p>
    </section>`;
}

/* ---------- 단어장(語彙) ---------- */
const WORDS = window.NIHONGO_WORDS || [];
let wordsHideKo = false;

function wordGridItem(it) {
  const [disp, read, ko] = it;
  const ruby = disp === read ? `<span class="jp">${esc(disp)}</span>` : `<ruby class="jp">${esc(disp)}<rt>${esc(read)}</rt></ruby>`;
  return `
  <button class="word-item" data-action="word-say" data-ch="${esc(read)}" title="${esc(read)} 발음 듣기">
    <span class="wi-spk">${ICON.play}</span>
    ${ruby}
    <span class="word-ko">${esc(ko)}</span>
  </button>`;
}

function wordTable(cat) {
  return `
  <div class="word-table-wrap">
    <table class="word-table">
      <thead><tr><th></th>${cat.cols.map(c => `<th><span class="jp">${esc(c.jp)}</span><small>${esc(c.ko)}</small></th>`).join('')}</tr></thead>
      <tbody>
        ${cat.rows.map(r => `<tr>
          <th class="wt-num">${esc(r.num)}</th>
          ${r.cells.map(cell => cell
            ? `<td><button class="wt-cell jp" data-action="say" data-ch="${esc(cell)}" title="${esc(cell)} 발음 듣기">${esc(cell)}</button></td>`
            : '<td class="wt-empty"></td>').join('')}
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

function viewWords() {
  return `
  <div class="view ${wordsHideKo ? 'words-hide' : ''}" id="words-root">
    <h1 class="page-title">단어장 — 語彙</h1>
    <p class="page-sub">주제별 핵심 단어를 모았어요. 단어를 누르면 발음을 들려줍니다. 숫자·조수사·날짜·요일·계절·가족까지 한자리에서.</p>

    <div class="study-tools words-tools">
      <div class="word-jump">
        ${WORDS.map(c => `<button class="word-chip" data-action="words-jump" data-id="${c.id}">${esc(c.title)}</button>`).join('')}
      </div>
      <button class="btn btn-sm btn-ghost ${wordsHideKo ? 'on' : ''}" data-action="words-hide">${wordsHideKo ? '뜻 보이기' : '뜻 가리기'}</button>
    </div>

    ${WORDS.map(cat => `
    <section class="word-sec" id="words-sec-${cat.id}">
      <div class="section-head"><h2>${esc(cat.title)} <span class="jp ws-jp">${esc(cat.jp)}</span></h2></div>
      ${cat.note ? `<p class="kana-intro">${esc(cat.note)}</p>` : ''}
      ${cat.type === 'table' ? wordTable(cat) : `<div class="word-grid">${cat.items.map(wordGridItem).join('')}</div>`}
    </section>`).join('')}
  </div>`;
}

/* ---------- 뷰: 검색 ---------- */
let searchQuery = '';
function searchResults(q) {
  const query = q.trim();
  if (!query) return [];
  const num = /^\d{1,4}$/.test(query) ? Number(query) : 0;
  const lower = query.toLowerCase();
  const out = [];
  for (const s of SENTENCES) {
    if (num ? s.n === num : (s.jp.includes(query) || s.ko.toLowerCase().includes(lower) || s.pt.toLowerCase().includes(lower))) {
      out.push(s);
      if (out.length >= 50) break;
    }
  }
  return out;
}
function hl(text, q) {
  if (!q) return esc(text);
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
}

const SEARCH_CHIPS = ['学校', '友だち', 'たら', 'てください', '0617'];

function searchListInner(q, res) {
  if (!q.trim()) {
    return `<div class="empty">
      <span class="jp">探</span>찾고 싶은 단어나 문형을 입력해 보세요
      <div class="search-chips">
        ${SEARCH_CHIPS.map(x => `<button class="search-chip ${/[぀-ヿ一-龯]/.test(x) ? 'jp' : ''}" data-action="search-fill" data-q="${esc(x)}">${esc(x)}</button>`).join('')}
      </div>
    </div>`;
  }
  if (res.length === 0) return `<div class="empty"><span class="jp">無</span>일치하는 문장이 없어요</div>`;
  return res.map(s => `
    <a class="result-item" href="#/study/${s.ch}?focus=${s.n}">
      <div class="r-top"><span class="s-num jp">${pad4(s.n)}</span>${levelChip(chapterOf(s.ch).level)}<span>${pad2(s.ch)}. ${esc(chapterOf(s.ch).title)}</span></div>
      <div class="jp">${hl(s.jp, q)}</div>
      <div class="ko">${hl(s.ko, q)}</div>
    </a>`).join('');
}

function searchMetaHtml(q, res) {
  return q.trim() ? `<p class="search-meta">“${esc(q)}” 검색 결과 ${res.length}건${res.length >= 50 ? ' (상위 50건만 표시)' : ''}</p>` : '';
}

function renderSearchResults() {
  const list = $('.result-list'); if (!list) return;
  const oldMeta = $('.search-meta'); if (oldMeta) oldMeta.remove();
  const res = searchResults(searchQuery);
  list.insertAdjacentHTML('beforebegin', searchMetaHtml(searchQuery, res));
  list.innerHTML = searchListInner(searchQuery, res);
  const clr = $('.search-clear'); if (clr) clr.classList.toggle('show', !!searchQuery.trim());
}

function viewSearch() {
  const q = searchQuery;
  const res = searchResults(q);
  return `
  <div class="view">
    <h1 class="page-title">검색 — 探す</h1>
    <p class="page-sub">일본어 · 한국어 뜻 · 문형 · 문장 번호로 1000문장을 바로 찾습니다.</p>
    <div class="search-box">
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input type="search" id="search-input" placeholder="예: 学校 / 학교 / たら / 0432" value="${esc(q)}" autocomplete="off" enterkeyhint="search">
      <button class="search-clear ${q.trim() ? 'show' : ''}" data-action="search-clear" aria-label="지우기" title="지우기">${ICON.x}</button>
    </div>
    ${searchMetaHtml(q, res)}
    <div class="result-list">${searchListInner(q, res)}</div>
  </div>`;
}

/* ---------- 설정 모달 ---------- */
function openSettings() {
  const t = S.settings.theme;
  $('#modal-root').innerHTML = `
  <div class="modal-overlay" data-action="close-modal">
    <div class="modal" role="dialog" aria-modal="true" aria-label="설정">
      <h2>설정 <button class="icon-btn" data-action="close-modal" aria-label="닫기">${ICON.x}</button></h2>
      <div class="set-row">
        <div class="lbl"><b>테마</b><span>화면 색상 모드</span></div>
        <div class="seg">
          ${[['auto', '시스템'], ['light', '라이트'], ['dark', '다크']].map(([v, l]) =>
            `<button class="${t === v ? 'active' : ''}" data-action="set-theme" data-theme="${v}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="set-row">
        <div class="lbl"><b>글자 크기</b><span>본문 문장 크기 조절</span></div>
        <div class="stepper">
          <button data-action="font-dec" aria-label="작게">−</button>
          <b>${Math.round(S.settings.scale * 100)}%</b>
          <button data-action="font-inc" aria-label="크게">＋</button>
        </div>
      </div>
      <div class="danger-zone">
        <button class="btn btn-danger" data-action="reset-data">학습 기록 전체 초기화</button>
      </div>
    </div>
  </div>`;
}
function closeModal() { $('#modal-root').innerHTML = ''; }

/* ---------- 라우터 ---------- */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = h.split('?');
  const seg = pathPart.split('/').filter(Boolean);
  const params = new URLSearchParams(queryPart || '');
  return { seg, params };
}

function render() {
  const { seg, params } = parseHash();
  const page = seg[0] || 'home';
  let html = '';
  let nav = 'home';

  // 자동 학습 재생 화면을 벗어나면 재생 중지
  if (autoPlayer && !(page === 'auto' && seg[1] === 'run')) autoStop();

  if (page === 'home') { html = viewHome(); nav = 'home'; }
  else if (page === 'chapters') {
    if (params.get('tab')) chaptersTab = params.get('tab') === 'grammar' ? 'grammar' : 'list';
    html = viewChapters(); nav = 'chapters';
  }
  else if (page === 'study') {
    const id = Number(seg[1]) || 1;
    html = viewStudy(Math.min(Math.max(id, 1), CHAPTERS.length));
    nav = 'chapters';
  }
  else if (page === 'grammar') {
    const gid = Math.min(Math.max(Number(seg[1]) || 1, 1), CHAPTERS.length);
    html = viewGrammar(gid);
    nav = 'chapters';
  }
  else if (page === 'all') { html = viewAll(); nav = 'all'; }
  else if (page === 'quiz' && seg[1] === 'run') { html = viewQuizRun(); nav = 'quiz'; }
  else if (page === 'quiz') {
    // 홈/학습에서 진입 시 소스 사전 선택
    const src = params.get('src');
    if (src && ['random', 'chapter', 'weak', 'book'].includes(src)) {
      const pool = poolFor(src, Number(params.get('ch')) || quizSetup.ch);
      if ((src === 'weak' || src === 'book') && !pool.length) { /* 비어 있으면 유지 */ }
      else {
        quizSetup.src = src;
        if (params.get('ch')) quizSetup.ch = Number(params.get('ch'));
      }
    }
    html = viewQuizSetup(); nav = 'quiz';
  }
  else if (page === 'auto' && seg[1] === 'run') {
    if (!autoPlayer) { location.hash = '#/auto'; return; }
    html = viewAutoRun(); nav = 'auto';
  }
  else if (page === 'auto') {
    const asrc = params.get('src');
    if (asrc && ['chapter', 'all', 'book', 'weak'].includes(asrc)) {
      S.settings.auto.src = asrc;
      if (params.get('ch')) S.settings.auto.ch = Number(params.get('ch'));
    }
    html = viewAutoSetup(); nav = 'auto';
  }
  else if (page === 'kana') { html = viewKana(); nav = 'kana'; }
  else if (page === 'words') { html = viewWords(); nav = 'words'; }
  else if (page === 'search') { html = viewSearch(); nav = 'search'; }
  else { html = viewHome(); }

  if ('speechSynthesis' in window) speechSynthesis.cancel();
  app.innerHTML = html;

  // 활성 내비게이션 표시
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));

  // 자동 학습 재생 시작(진입 시 1회)
  if (page === 'auto' && seg[1] === 'run' && autoPlayer) {
    updateAutoUI();
    if (!autoPlayer.started) { autoPlayer.started = true; autoRun(); }
  }

  // 학습 뷰 focus 처리
  if (page === 'study' && params.get('focus')) {
    const el = $('#s-' + params.get('focus'));
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ block: 'center', behavior: 'auto' });
        el.classList.add('flash');
      });
    }
  } else if (!(page === 'quiz' && seg[1] === 'run')) {
    window.scrollTo(0, 0);
  }

  // 검색 입력 바인딩 (입력 포커스 유지한 채 결과만 갱신)
  const si = $('#search-input');
  if (si) {
    si.addEventListener('input', () => { searchQuery = si.value; renderSearchResults(); });
    if (!('ontouchstart' in window)) { si.focus(); si.setSelectionRange(si.value.length, si.value.length); }
  }
}

/* ---------- 학습 뷰 부분 갱신 ---------- */
function refreshStudyProgress() {
  const { seg } = parseHash();
  if (seg[0] !== 'study') return;
  const ch = chapterOf(Number(seg[1]) || 1);
  if (!ch) return;
  const p = chapterProgress(ch);
  const bar = $('#ch-bar'); const done = $('#ch-done');
  if (bar) bar.style.width = Math.round(p.done / p.total * 100) + '%';
  if (done) done.textContent = p.done;
}

function toggleLearn(n, btn) {
  const on = !S.learned[n];
  if (on) { S.learned[n] = 1; touchActivity(n); } else { delete S.learned[n]; save(); }
  const card = $('#s-' + n);
  if (card) card.classList.toggle('is-learned', on);
  if (btn) {
    btn.classList.toggle('on-learn', on);
    const label = btn.querySelector('span'); if (label) label.textContent = on ? '완료' : '외웠어요';
  }
  refreshStudyProgress();
}

function toggleBook(n, btn) {
  const on = !S.bookmarks[n];
  if (on) S.bookmarks[n] = 1; else delete S.bookmarks[n];
  save();
  if (btn) {
    btn.classList.toggle('on-book', on);
    btn.innerHTML = `${on ? ICON.starFill : ICON.star} <span>북마크</span>`;
  }
  toast(on ? '북마크에 추가했어요' : '북마크를 해제했어요');
}

/* ---------- 전역 이벤트 ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const act = t.dataset.action;

  switch (act) {
    case 'toggle-theme': {
      const dark = document.documentElement.dataset.theme === 'dark';
      S.settings.theme = dark ? 'light' : 'dark';
      save(); applyTheme();
      break;
    }
    case 'open-settings': openSettings(); break;
    case 'close-modal': if (t === e.target || t.closest('.icon-btn')) closeModal(); break;
    case 'set-theme': S.settings.theme = t.dataset.theme; save(); applyTheme(); openSettings(); break;
    case 'font-inc': S.settings.scale = Math.min(1.25, Math.round((S.settings.scale + 0.05) * 100) / 100); save(); applyScale(); openSettings(); break;
    case 'font-dec': S.settings.scale = Math.max(0.85, Math.round((S.settings.scale - 0.05) * 100) / 100); save(); applyScale(); openSettings(); break;
    case 'reset-data':
      if (confirm('학습 완료·북마크·복습 기록을 모두 지웁니다. 계속할까요?')) {
        const theme = S.settings.theme, scale = S.settings.scale;
        S = defaultState();
        S.settings.theme = theme; S.settings.scale = scale;
        save(); closeModal(); render(); toast('학습 기록을 초기화했어요');
      }
      break;

    case 'speak': {
      e.stopPropagation();
      const s = sentence(Number(t.dataset.n));
      if (s) speak(s.jp, t);
      break;
    }
    case 'learn': toggleLearn(Number(t.dataset.n), t); break;
    case 'book': toggleBook(Number(t.dataset.n), t); break;
    case 'reveal': t.classList.add('revealed'); break;
    case 'hide-mode': {
      const m = t.dataset.mode;
      S.settings.hideMode = m; save();
      // 전체 재렌더 없이 마스크만 갱신 (학습 뷰 + 천문장 뷰 공용)
      $$('[data-action="hide-mode"]').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
      $$('.s-card').forEach(card => {
        const s = sentence(Number(card.dataset.n));
        card.querySelector('.s-jp').innerHTML = maskWrap(esc(s.jp), m === 'hideJp');
        card.querySelector('.s-ko').innerHTML = maskWrap(esc(s.ko), m === 'hideKo');
      });
      $$('.all-row').forEach(row => {
        const s = sentence(Number(row.dataset.n));
        row.querySelector('.ar-jp').innerHTML = maskWrap(esc(s.jp), m === 'hideJp');
        row.querySelector('.ar-ko').innerHTML = maskWrap(esc(s.ko), m === 'hideKo');
      });
      break;
    }
    case 'mark-all': {
      const ch = chapterOf(Number(t.dataset.ch));
      for (let n = ch.start; n <= ch.end; n++) { S.learned[n] = 1; touchActivity(n); }
      save(); render(); toast(`${pad2(ch.id)}과 ${ch.end - ch.start + 1}문장을 완료로 표시했어요`);
      break;
    }
    case 'filter': chapterFilter = t.dataset.filter; render(); break;
    case 'ch-tab': chaptersTab = t.dataset.tab; render(); break;
    case 'all-filter': allFilter = t.dataset.filter; render(); break;
    case 'to-top': window.scrollTo({ top: 0, behavior: 'smooth' }); break;
    case 'search-clear': {
      searchQuery = '';
      const si = $('#search-input'); if (si) { si.value = ''; si.focus(); }
      renderSearchResults();
      break;
    }
    case 'search-fill': {
      searchQuery = t.dataset.q;
      const si = $('#search-input'); if (si) si.value = searchQuery;
      renderSearchResults();
      break;
    }

    case 'q-src': quizSetup.src = t.dataset.src; render(); break;
    case 'q-dir': quizSetup.dir = t.dataset.dir; render(); break;
    case 'q-start': startQuiz(); break;
    case 'q-flip':
      if (e.target.closest('[data-action="speak"]')) break;
      if (quizSession && !quizSession.flipped) {
        quizSession.flipped = true;
        $('#flip-card').classList.add('flipped');
        const acts = $('.quiz-actions'); if (acts) acts.style.visibility = 'visible';
      }
      break;
    case 'q-ok': answerQuiz(true); break;
    case 'q-no': answerQuiz(false); break;
    case 'q-exit':
      if (confirm('암기를 중단할까요? 지금까지의 채점은 저장됩니다.')) { quizSession = null; location.hash = '#/quiz'; }
      break;
    case 'q-retry-wrong': {
      const wrong = quizSession.wrong.slice();
      quizSession = { items: shuffle(wrong), idx: 0, dir: quizSession.dir, flipped: false, wrong: [], right: 0 };
      render();
      break;
    }
    case 'q-retry-same': startQuiz(); break;

    case 'auto-src': S.settings.auto.src = t.dataset.src; save(); render(); break;
    case 'auto-set': {
      let v = t.dataset.val;
      v = v === 'true' ? true : v === 'false' ? false : Number(v);
      S.settings.auto[t.dataset.key] = v; save(); render();
      break;
    }
    case 'auto-start': startAuto(); break;
    case 'auto-quick': S.settings.auto.src = 'chapter'; S.settings.auto.ch = Number(t.dataset.ch); save(); startAuto(); break;
    case 'say': { e.stopPropagation(); speak(t.dataset.ch, t); break; }
    case 'word-say': { e.stopPropagation(); speak(t.dataset.ch, t); t.classList.add('revealed'); touchActivity(); break; }
    case 'words-hide': {
      wordsHideKo = !wordsHideKo;
      const root = $('#words-root'); if (root) root.classList.toggle('words-hide', wordsHideKo);
      t.classList.toggle('on', wordsHideKo);
      t.textContent = wordsHideKo ? '뜻 보이기' : '뜻 가리기';
      // 토글할 때마다 공개 상태 초기화 (켜면 전부 가려지고, 끄면 깔끔하게)
      $$('.word-item.revealed').forEach(el => el.classList.remove('revealed'));
      break;
    }
    case 'words-jump': {
      const el = $('#words-sec-' + t.dataset.id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    }
    case 'kana-script': S.settings.kanaScript = t.dataset.sc; save(); render(); break;
    case 'kana-speak': { e.stopPropagation(); speak(t.dataset.ch, t); break; }
    case 'kana-mode': kanaMode = t.dataset.mode; render(); break;
    case 'kana-range': kanaPractice.range = t.dataset.range; reshuffleKana(); render(); break;
    case 'kana-shuffle': reshuffleKana(); render(); toast('새로 섞었어요'); break;
    case 'kana-reveal': {
      const i = Number(t.dataset.i);
      const c = kanaPractice.items[i];
      if (!c) break;
      speak(t.dataset.ch, t);
      if (!kanaPractice.revealed[i]) {
        kanaPractice.revealed[i] = 1;
        t.classList.add('revealed');
        const sub = t.querySelector('.kc-sub'); if (sub) sub.textContent = `${c.r} · ${c.ko}`;
        const n = Object.keys(kanaPractice.revealed).length;
        const pg = $('#kana-progress'); if (pg) pg.textContent = `${n} / ${kanaPractice.items.length} 확인`;
        if (n === kanaPractice.items.length) toast('전부 확인했어요! ⟳ 다시 섞기로 한 번 더');
        touchActivity();
      }
      break;
    }

    case 'auto-toggle': autoToggle(); break;
    case 'auto-prev': autoJump(-1); break;
    case 'auto-next': autoJump(1); break;
    case 'auto-exit': location.hash = '#/auto'; break;
    case 'auto-live': autoLive(t.dataset.key); break;
  }
});

document.addEventListener('change', e => {
  const t = e.target.closest('[data-action="q-ch"]');
  if (t) { quizSetup.ch = Number(t.value); }
  const a = e.target.closest('[data-action="auto-ch"]');
  if (a) { S.settings.auto.ch = Number(a.value); save(); }
  const j = e.target.closest('[data-action="all-jump"]');
  if (j && j.value) {
    const el = $('#all-ch-' + j.value);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

document.addEventListener('keydown', e => {
  const { seg } = parseHash();
  if (!(seg[0] === 'auto' && seg[1] === 'run') || !autoPlayer) return;
  if (e.target.matches('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); autoToggle(); }
  else if (e.code === 'ArrowRight') { e.preventDefault(); autoJump(1); }
  else if (e.code === 'ArrowLeft') { e.preventDefault(); autoJump(-1); }
});

document.addEventListener('keydown', e => {
  const { seg } = parseHash();
  if (!(seg[0] === 'quiz' && seg[1] === 'run') || !quizSession) return;
  if (e.target.matches('input, select, textarea')) return;
  if (quizSession.idx >= quizSession.items.length) return; // 결과 화면

  if ((e.code === 'Space' || e.code === 'Enter') && !quizSession.flipped) {
    e.preventDefault();
    quizSession.flipped = true;
    $('#flip-card').classList.add('flipped');
    const acts = $('.quiz-actions'); if (acts) acts.style.visibility = 'visible';
  } else if (quizSession.flipped) {
    if (e.code === 'ArrowRight' || e.key.toLowerCase() === 'o') { e.preventDefault(); answerQuiz(true); }
    if (e.code === 'ArrowLeft' || e.key.toLowerCase() === 'x') { e.preventDefault(); answerQuiz(false); }
  }
});

document.addEventListener('keydown', e => {
  if (e.code === 'Escape') closeModal();
});

window.addEventListener('hashchange', render);

/* ---------- 맨 위로 버튼 ---------- */
const toTopBtn = $('#to-top');
let toTopShown = false;
window.addEventListener('scroll', () => {
  const show = window.scrollY > 700;
  if (show !== toTopShown) { toTopShown = show; toTopBtn.classList.toggle('show', show); }
}, { passive: true });

/* ---------- 시작 ---------- */
applyTheme();
applyScale();
if (!location.hash) location.hash = '#/';
render();

})();
