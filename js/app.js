/* ==========================================================================
   日本語 千日文 — 앱 로직 (의존성 없는 순수 JS SPA)
   ========================================================================== */
(() => {
'use strict';

const DATA = window.NIHONGO_DATA;
const CHAPTERS = DATA.chapters;
const SENTENCES = DATA.sentences;
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
  settings: { theme: 'auto', scale: 1, hideMode: 'all' },
});

let S = defaultState();
try {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    S = Object.assign(defaultState(), saved, { settings: Object.assign(defaultState().settings, saved.settings || {}) });
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
let jaVoice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices();
  jaVoice = vs.find(v => /^ja([-_]|$)/i.test(v.lang) && /google/i.test(v.name))
    || vs.find(v => /^ja([-_]|$)/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener('voiceschanged', pickVoice);
}

function speak(text, btn) {
  if (!('speechSynthesis' in window)) { toast('이 브라우저는 음성 재생을 지원하지 않아요'); return; }
  speechSynthesis.cancel();
  $$('.s-btn.speaking').forEach(b => b.classList.remove('speaking'));
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

/* ---------- 공용 템플릿 ---------- */
const ICON = {
  play: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>',
  starFill: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  arrowR: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
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

  // 이어서 학습할 챕터: 마지막 방문 챕터가 미완이면 그곳, 아니면 첫 미완성 챕터
  let resume = S.lastChapter ? chapterOf(S.lastChapter) : null;
  if (!resume || chapterProgress(resume).done === chapterProgress(resume).total) {
    resume = CHAPTERS.find(ch => chapterProgress(ch).done < chapterProgress(ch).total) || CHAPTERS[0];
  }
  const rp = chapterProgress(resume);

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
              ${total === 0 ? '학습 시작하기' : '이어서 학습하기'} ${ICON.arrowR}
            </a>
            <span class="resume-meta"><b>${pad2(resume.id)}. ${esc(resume.title)}</b> · ${rp.done}/${rp.total} 문장</span>
          </div>
        </div>
        ${ringSvg(pct)}
      </div>
    </section>

    <div class="stat-grid">
      <div class="stat"><b>${total}<small>/ ${TOTAL}문장</small></b><span>학습 완료</span></div>
      <div class="stat"><b>${todayCount()}<small>문장</small></b><span>오늘 학습</span></div>
      <a class="stat is-link" href="#/quiz?src=weak"><b>${weakN}<small>문장</small></b><span>복습 대기 →</span></a>
      <div class="stat"><b>${S.streak.count}<small>일</small></b><span>연속 학습</span></div>
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
      <a class="option-card" href="#/quiz?src=random">
        <b>랜덤 20문장 암기</b><span>전체 범위에서 무작위로 카드 테스트</span>
      </a>
      <a class="option-card" href="#/quiz?src=book">
        <b>북마크 복습</b><span>따로 모아 둔 ${bookN}개 문장 다시 보기</span>
        ${bookN ? `<span class="count">${bookN}</span>` : ''}
      </a>
    </div>
  </div>`;
}

/* ---------- 뷰: 목차 ---------- */
let chapterFilter = 'ALL';
function viewChapters() {
  const filters = ['ALL', 'N5', 'N4', 'N3'];
  const list = CHAPTERS.filter(ch => chapterFilter === 'ALL' || ch.level === chapterFilter);
  return `
  <div class="view">
    <h1 class="page-title">목차 — 五十課</h1>
    <p class="page-sub">핵심 문형 50과, 과마다 20문장. 순서대로 읽어도 좋고 필요한 문형만 골라도 좋습니다.</p>
    <div class="filter-row">
      ${filters.map(f => `<button class="filter-btn ${chapterFilter === f ? 'active' : ''}" data-action="filter" data-filter="${f}">${f === 'ALL' ? '전체' : f}</button>`).join('')}
    </div>
    <div class="chapter-list">
      ${list.map(ch => {
        const p = chapterProgress(ch);
        const pct = Math.round(p.done / p.total * 100);
        return `
        <a class="chapter-item ${p.done === p.total ? 'done' : ''}" href="#/study/${ch.id}">
          <span class="chapter-num">${pad2(ch.id)}</span>
          <span class="chapter-body">
            <h3>${esc(ch.title)}</h3>
            <span class="sub">${levelChip(ch.level)} <span>${pad4(ch.start)}–${pad4(ch.end)}</span></span>
            <span class="bar thin"><i style="width:${pct}%"></i></span>
          </span>
          <span class="chapter-side">
            <span class="pct">${p.done === p.total ? '완료 ✓' : pct + '%'}</span>
          </span>
        </a>`;
      }).join('')}
    </div>
  </div>`;
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

    <div class="study-tools">
      <div class="seg" role="group" aria-label="표시 모드">
        <button class="${mode === 'all' ? 'active' : ''}" data-action="hide-mode" data-mode="all">모두 보기</button>
        <button class="${mode === 'hideKo' ? 'active' : ''}" data-action="hide-mode" data-mode="hideKo">한국어 가리기</button>
        <button class="${mode === 'hideJp' ? 'active' : ''}" data-action="hide-mode" data-mode="hideJp">일본어 가리기</button>
      </div>
      <div class="right">
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

function viewSearch() {
  const q = searchQuery;
  const res = searchResults(q);
  return `
  <div class="view">
    <h1 class="page-title">검색 — 探す</h1>
    <p class="page-sub">일본어 · 한국어 뜻 · 문형 · 문장 번호로 1000문장을 바로 찾습니다.</p>
    <div class="search-box">
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input type="search" id="search-input" placeholder="예: 学校 / 학교 / たら / 0432" value="${esc(q)}" autocomplete="off">
    </div>
    ${q.trim() ? `<p class="search-meta">“${esc(q)}” 검색 결과 ${res.length}건${res.length >= 50 ? ' (상위 50건만 표시)' : ''}</p>` : ''}
    <div class="result-list">
      ${!q.trim()
        ? `<div class="empty"><span class="jp">探</span>찾고 싶은 단어나 문형을 입력해 보세요</div>`
        : res.length === 0
          ? `<div class="empty"><span class="jp">無</span>일치하는 문장이 없어요</div>`
          : res.map(s => `
            <a class="result-item" href="#/study/${s.ch}?focus=${s.n}">
              <div class="r-top"><span class="s-num jp">${pad4(s.n)}</span>${levelChip(chapterOf(s.ch).level)}<span>${pad2(s.ch)}. ${esc(chapterOf(s.ch).title)}</span></div>
              <div class="jp">${hl(s.jp, q)}</div>
              <div class="ko">${hl(s.ko, q)}</div>
            </a>`).join('')}
    </div>
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

  if (page === 'home') { html = viewHome(); nav = 'home'; }
  else if (page === 'chapters') { html = viewChapters(); nav = 'chapters'; }
  else if (page === 'study') {
    const id = Number(seg[1]) || 1;
    html = viewStudy(Math.min(Math.max(id, 1), CHAPTERS.length));
    nav = 'chapters';
  }
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
  else if (page === 'search') { html = viewSearch(); nav = 'search'; }
  else { html = viewHome(); }

  if ('speechSynthesis' in window) speechSynthesis.cancel();
  app.innerHTML = html;

  // 활성 내비게이션 표시
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));

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

  // 검색 입력 바인딩
  const si = $('#search-input');
  if (si) {
    si.addEventListener('input', () => {
      searchQuery = si.value;
      // 입력 유지한 채 결과만 갱신
      const list = $('.result-list'); const meta = $('.search-meta');
      if (meta) meta.remove();
      const res = searchResults(searchQuery);
      const metaHtml = searchQuery.trim() ? `<p class="search-meta">“${esc(searchQuery)}” 검색 결과 ${res.length}건${res.length >= 50 ? ' (상위 50건만 표시)' : ''}</p>` : '';
      list.insertAdjacentHTML('beforebegin', metaHtml);
      list.innerHTML = !searchQuery.trim()
        ? `<div class="empty"><span class="jp">探</span>찾고 싶은 단어나 문형을 입력해 보세요</div>`
        : res.length === 0
          ? `<div class="empty"><span class="jp">無</span>일치하는 문장이 없어요</div>`
          : res.map(s => `
            <a class="result-item" href="#/study/${s.ch}?focus=${s.n}">
              <div class="r-top"><span class="s-num jp">${pad4(s.n)}</span>${levelChip(chapterOf(s.ch).level)}<span>${pad2(s.ch)}. ${esc(chapterOf(s.ch).title)}</span></div>
              <div class="jp">${hl(s.jp, searchQuery)}</div>
              <div class="ko">${hl(s.ko, searchQuery)}</div>
            </a>`).join('');
    });
    if (!('ontouchstart' in window)) si.focus();
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
      S.settings.hideMode = t.dataset.mode; save();
      // 전체 재렌더 없이 마스크만 갱신
      $$('.study-tools .seg button').forEach(b => b.classList.toggle('active', b === t));
      $$('.s-card').forEach(card => {
        const n = Number(card.dataset.n); const s = sentence(n);
        card.querySelector('.s-jp').innerHTML = maskWrap(esc(s.jp), t.dataset.mode === 'hideJp');
        card.querySelector('.s-ko').innerHTML = maskWrap(esc(s.ko), t.dataset.mode === 'hideKo');
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
  }
});

document.addEventListener('change', e => {
  const t = e.target.closest('[data-action="q-ch"]');
  if (t) { quizSetup.ch = Number(t.value); }
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

/* ---------- 시작 ---------- */
applyTheme();
applyScale();
if (!location.hash) location.hash = '#/';
render();

})();
