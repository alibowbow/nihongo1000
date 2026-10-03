/* ==========================================================================
   日本語 千日文 — 앱 로직 (의존성 없는 순수 JS SPA)
   구성: 코어(상태·유틸·TTS) → UI 프리미티브(시트·세그먼트) → 화면 → 라우터·이벤트
   ========================================================================== */
(() => {
'use strict';

const DATA = window.NIHONGO_DATA;
const COURSES = DATA.courses;                 // [{id,label,sub,chapters,sentences}]
const GRAMMAR_ALL = window.NIHONGO_GRAMMAR || {};
// 현재 코스 뷰 — setCourse()로 교체됨
let CHAPTERS = [];
let SENTENCES = [];
let GRAMMAR = [];
let TOTAL = 0;
const courseMeta = id => COURSES.find(c => c.id === id) || COURSES[0];
const courseLevels = () => [...new Set(CHAPTERS.map(c => c.level))]; // 코스에 등장하는 레벨(등장 순서)

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const app = $('#app');
const root = document.documentElement;

/* ---------- 유틸 ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad4 = n => String(n).padStart(4, '0');
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = () => ymd(new Date());
const dayStr = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return ymd(d); };
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
// 주소·저장값에서 온 과 번호 검증: 1..과 수의 정수만 인정(아니면 0), 화면용은 범위로 맞춘다(NaN·소수·범위 밖 → 1~끝)
const chapterNo = v => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= CHAPTERS.length ? n : 0; };
const clampChapter = v => Math.min(Math.max(Math.floor(Number(v)) || 1, 1), CHAPTERS.length);
const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduceMotion = () => mqReduce.matches;
const scrollBehavior = () => reduceMotion() ? 'instant' : 'smooth';   // '동작 줄이기'면 부드러운 스크롤도 끈다

/* ---------- 상태 (localStorage) ---------- */
const STORE_KEY = 'nihongo1000.v1';

// 코스별 진도 버킷 (문장 번호는 코스 안에서만 의미가 있음)
const emptyProgress = () => ({
  learned: {},                 // n -> 1
  bookmarks: {},               // n -> 1
  weak: {},                    // n -> 틀린 횟수
  today: { date: '', ns: {} }, // 오늘 학습한 문장 번호
  lastChapter: 0,
});

const defaultState = () => ({
  courses: {},                 // courseId -> 진도
  currentCourse: COURSES[0].id,
  streak: { last: '', count: 0 }, // 연속 학습일은 코스 공통
  goalDone: '',                // 오늘 목표 달성 안내를 마친 날짜
  wordLearned: {},             // 단어 암기: key(표기|읽기) -> 1  (코스 공통)
  wordWeak: {},                // 단어 복습 대기: key -> 틀린 횟수 (코스 공통)
  settings: {
    theme: 'auto', scale: 1, hideMode: 'all', kanaScript: 'hira', voiceJa: '', pitch: 1,
    goal: 20, haptics: true, lessonOpen: true,
    auto: { kind: 'sentence', src: 'chapter', ch: 1, readKo: true, repeat: 1, rate: 0.9, gap: 900, loop: false,
            wsrc: 'random', wlevel: 'N5', wcat: '' },
  },
});

let S = defaultState();
try {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    // 구버전(단일 코스, 진도 필드가 최상위) → 기초 코스로 이관
    if (saved && !saved.courses && (saved.learned || saved.bookmarks || saved.today || saved.lastChapter)) {
      saved.courses = { basic: {
        learned: saved.learned || {}, bookmarks: saved.bookmarks || {}, weak: saved.weak || {},
        today: saved.today || { date: '', ns: {} }, lastChapter: saved.lastChapter || 0,
      } };
    }
    S = Object.assign(defaultState(), saved, { settings: Object.assign(defaultState().settings, saved.settings || {}) });
    S.settings.auto = Object.assign(defaultState().settings.auto, S.settings.auto || {});
    S.courses = saved.courses || {};
    S.streak = Object.assign({ last: '', count: 0 }, saved.streak || {});
  }
} catch (e) { /* 손상된 데이터는 무시하고 초기 상태 사용 */ }

// 사용 가능한 모든 코스에 진도 버킷을 보장
COURSES.forEach(c => { if (!S.courses[c.id]) S.courses[c.id] = emptyProgress(); });
if (!COURSES.some(c => c.id === S.currentCourse)) S.currentCourse = COURSES[0].id;
if (!S.wordLearned) S.wordLearned = {};
if (!S.wordWeak) S.wordWeak = {};

let P; // 현재 코스의 진도 (learned/bookmarks/weak/today/lastChapter)
function setCourse(id) {
  const meta = courseMeta(id);
  S.currentCourse = meta.id;
  if (!S.courses[meta.id]) S.courses[meta.id] = emptyProgress();
  P = S.courses[meta.id];
  CHAPTERS = meta.chapters;
  SENTENCES = meta.sentences;
  GRAMMAR = GRAMMAR_ALL[meta.id] || [];
  TOTAL = SENTENCES.length;
  root.dataset.course = meta.id;       // 코스별 포인트색(CSS가 data-course로 전환)
}
setCourse(S.currentCourse);
// 손상됐거나 직접 고친 저장값이 있어도 화면이 깨지지 않게
if (!chapterNo(S.settings.auto.ch)) S.settings.auto.ch = 1;

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* 저장 불가 환경 */ }
  }, 150);
}

/* ---------- 진행 계산 ---------- */
const learnedCount = () => Object.keys(P.learned).length;
const weakList = () => Object.keys(P.weak).map(Number).sort((a, b) => a - b);
const bookmarkList = () => Object.keys(P.bookmarks).map(Number).sort((a, b) => a - b);

// 오늘 학습한 문장 수 — 모든 코스 합산(하루 목표는 코스와 무관하게 센다)
function todayTotal() {
  const t = todayStr();
  let n = 0;
  for (const c of COURSES) {
    const p = S.courses[c.id];
    if (p && p.today && p.today.date === t) n += Object.keys(p.today.ns).length;
  }
  return n;
}
const dailyGoal = () => Math.max(1, Number(S.settings.goal) || 20);

// 연속 학습일: 마지막 학습이 오늘/어제면 이어지는 중, 그 전이면 끊김
function streakInfo() {
  const { last, count } = S.streak;
  const doneToday = last === todayStr();
  const alive = doneToday || last === dayStr(-1);
  return { n: alive ? count : 0, doneToday, alive };
}
// 최근 7일(오늘 포함) 중 연속 학습 구간에 속하는 날 표시
function weekDots() {
  const { alive } = streakInfo();
  const { last, count } = S.streak;
  const names = ['일', '월', '화', '수', '목', '금', '토'];
  const out = [];
  for (let i = -6; i <= 0; i++) {
    const key = dayStr(i);
    let on = false;
    if (alive && last) {
      const lastD = new Date(last + 'T00:00:00'), d = new Date(key + 'T00:00:00');
      const diff = Math.round((lastD - d) / 86400000);   // last 기준 며칠 전인가
      on = diff >= 0 && diff < count;
    }
    out.push({ key, on, today: i === 0, name: names[new Date(key + 'T00:00:00').getDay()] });
  }
  return out;
}

function touchActivity(n) {
  const today = todayStr();
  if (P.today.date !== today) P.today = { date: today, ns: {} };
  const before = todayTotal();
  if (n) P.today.ns[n] = 1;

  if (S.streak.last !== today) {
    S.streak.count = (S.streak.last === dayStr(-1)) ? S.streak.count + 1 : 1;
    S.streak.last = today;
  }
  save();
  if (n) checkGoal(before);
  if (typeof updateRailStatus === 'function') updateRailStatus();
}
function checkGoal(before) {
  const goal = dailyGoal(), now = todayTotal();
  if (before < goal && now >= goal && S.goalDone !== todayStr()) {
    S.goalDone = todayStr(); save();
    toast('오늘 목표를 달성했어요!', 'target');
    haptic([14, 50, 22]);
  }
}

function chapterProgress(ch) {
  let done = 0;
  for (let n = ch.start; n <= ch.end; n++) if (P.learned[n]) done++;
  return { done, total: ch.end - ch.start + 1 };
}

// 이어서 학습할 과: 마지막 방문 과가 미완이면 그곳, 아니면 첫 미완성 과
function resumeChapter() {
  let r = P.lastChapter ? chapterOf(P.lastChapter) : null;
  if (!r || chapterProgress(r).done === chapterProgress(r).total) {
    r = CHAPTERS.find(ch => chapterProgress(ch).done < chapterProgress(ch).total) || CHAPTERS[0];
  }
  return r;
}

// 레벨별 진도(현재 코스) — 챕터의 level 기준으로 문장 수를 합산
function levelProgress() {
  return courseLevels().map(lv => {
    let done = 0, total = 0;
    for (const ch of CHAPTERS) {
      if (ch.level !== lv) continue;
      const p = chapterProgress(ch);
      done += p.done; total += p.total;
    }
    return { lv, done, total };
  });
}
function courseProgress(id) {
  const c = courseMeta(id), p = S.courses[c.id] || emptyProgress();
  const done = Object.keys(p.learned).length;
  return { done, total: c.sentences.length, pct: c.sentences.length ? Math.round(done / c.sentences.length * 100) : 0 };
}

/* ---------- 테마 / 글자 크기 ---------- */
const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
const THEME_COLOR = { dark: '#0b0907', light: '#f5f3ef' };
function applyTheme() {
  const t = S.settings.theme;
  const dark = t === 'dark' || (t === 'auto' && mqDark.matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  const next = dark ? '라이트 모드로 전환' : '다크 모드로 전환';
  $$('[data-action="toggle-theme"]').forEach(b => { b.setAttribute('aria-label', next); b.title = next; });
  // 브라우저 UI 색(주소창·상태바)도 현재 테마에 맞춘다 — media 지정 메타를 하나로 정리
  const metas = $$('meta[name="theme-color"]');
  metas.forEach((m, i) => { if (i) m.remove(); });
  if (metas[0]) { metas[0].removeAttribute('media'); metas[0].content = THEME_COLOR[dark ? 'dark' : 'light']; }
}
mqDark.addEventListener('change', applyTheme);

function applyScale() {
  root.style.setProperty('--scale', S.settings.scale);
}

/* ---------- 아이콘 · 햅틱 · 토스트 ---------- */
const ic = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

function haptic(pattern = 10) {
  if (!S.settings.haptics || reduceMotion()) return;
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* 미지원 */ }
}

function toast(msg, icon = 'check') {
  const rootEl = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `${ic(icon)}<span>${esc(msg)}</span>`;
  rootEl.appendChild(el);
  while (rootEl.children.length > 3) rootEl.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 2000);
}

/* ---------- TTS ---------- */
const hasTTS = 'speechSynthesis' in window;
const UA = navigator.userAgent || '';
// 카카오톡·인스타·페북·라인·네이버·다음 등 인앱 브라우저(WebView) 감지 — TTS가 막히는 환경
const isInAppBrowser = /KAKAOTALK|FBAN|FBAV|FB_IAB|Instagram|Line\/|NAVER\(inapp|DaumApps|; wv\)/i.test(UA);
const STORE_INAPP = 'nihongo1000.inapp-hidden';
let ttsBlocked = false, ttsToastShown = false, speakGuard = 0;

let sheetKind = '';            // 열려 있는 시트 종류(settings | course)
let jaVoice = null, koVoice = null;
function jaVoiceList() { return hasTTS ? speechSynthesis.getVoices().filter(v => /^ja([-_]|$)/i.test(v.lang)) : []; }
const ttsPitch = () => Number(S.settings.pitch) || 1;
// 음성 이름으로 성별 추정(알려진 일본어 음성만) — 목록 라벨용
const VOICE_GENDER = [
  [/kyoko|o-?ren|haruka|sayaka|nanami|ayumi|mizuki|ichika|google 日本語|女性|female|woman/i, '여성'],
  [/otoya|ichiro|hattori|daichi|keita|naoki|男性|male|\bman\b/i, '남성'],
];
function voiceGender(name) { for (const [re, g] of VOICE_GENDER) if (re.test(name || '')) return g; return ''; }
function pickVoice() {
  if (!hasTTS) return;
  const vs = speechSynthesis.getVoices();
  const ja = vs.filter(v => /^ja([-_]|$)/i.test(v.lang));
  const saved = S.settings.voiceJa;
  jaVoice = (saved && ja.find(v => v.voiceURI === saved))   // 사용자가 고른 음성 우선
    || ja.find(v => /google/i.test(v.name)) || ja[0] || null;
  koVoice = vs.find(v => /^ko([-_]|$)/i.test(v.lang) && /google/i.test(v.name))
    || vs.find(v => /^ko([-_]|$)/i.test(v.lang)) || null;
}
if (hasTTS) {
  pickVoice();
  speechSynthesis.addEventListener('voiceschanged', () => {
    pickVoice();
    if (sheetKind === 'settings') renderSettings(); // 설정이 열려 있으면 음성 목록 갱신
  });
}

/* 인앱 브라우저 음성 차단 안내 배너 */
function inAppNoticeOn() {
  try { if (localStorage.getItem(STORE_INAPP)) return false; } catch (e) {}
  return isInAppBrowser || ttsBlocked;
}
function mountInAppBanner() {
  if (!inAppNoticeOn() || document.getElementById('inapp-banner')) return;
  const d = document.createElement('div');
  d.id = 'inapp-banner'; d.className = 'inapp-banner'; d.setAttribute('role', 'status');
  d.innerHTML = `<span class="iab-ico" aria-hidden="true">${ic('volume')}</span>`
    + `<span class="iab-txt">카카오톡 등 <b>인앱 브라우저</b>에서는 음성이 안 나올 수 있어요. 우측 메뉴(⋮ 또는 공유) → <b>다른 브라우저로 열기</b>로 열어 주세요.</span>`
    + `<button class="iab-x" type="button" data-action="inapp-dismiss" aria-label="닫기">${ic('close')}</button>`;
  app.parentNode.insertBefore(d, app);   // 본문 위에 흐름대로 — 하단 독·시작 바를 가리지 않는다
}
function noticeTTSFail(unsupported) {
  ttsBlocked = true;
  mountInAppBanner();
  if (!ttsToastShown) {
    ttsToastShown = true;
    toast(unsupported ? '이 브라우저는 음성 재생을 지원하지 않아요. 다른 브라우저로 열어 주세요.'
                      : '음성이 재생되지 않아요. 크롬·사파리 등 다른 브라우저로 열어 주세요.', 'volume');
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function speak(text, btn) {
  if (!hasTTS) { noticeTTSFail(true); return; }
  speechSynthesis.cancel();
  $$('.speaking').forEach(b => b.classList.remove('speaking'));
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  if (jaVoice) u.voice = jaVoice;
  u.rate = 0.92;
  u.pitch = ttsPitch();
  let started = false;
  u.onstart = () => { started = true; };
  if (btn) {
    btn.classList.add('speaking');
    u.onend = u.onerror = () => btn.classList.remove('speaking');
  }
  speechSynthesis.speak(u);
  // 인앱 등에서 소리 없이 실패하는 경우 감지 → 안내
  clearTimeout(speakGuard);
  speakGuard = setTimeout(() => {
    if (!started && !speechSynthesis.speaking) { if (btn) btn.classList.remove('speaking'); noticeTTSFail(false); }
  }, 1500);
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
    u.pitch = ttsPitch();
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
const lvChip = lv => `<span class="lv lv-${esc(lv)}">${esc(lv)}</span>`;
const ptChip = pt => `<span class="pt-chip" title="${esc(pt)}">${esc(pt)}</span>`;

// 한·일 혼합 텍스트에서 '일본어 런'(가나·한자 포함)만 골라낸다
//   ぀-ヿ 가나 · 一-鿿 한자 · 「-』 「」『』 · 〜 〜 · ！（）？ 전각 기호
const JP_RUN_RE = /[A-Za-z0-9→、。々「-』぀-ヿ一-鿿〜！（）？]+/g;
const JP_HAS_RE = /[぀-ヿ一-鿿々]/;

// 제목·요약처럼 한·일이 섞인 문자열: 일본어 구간만 명조(.jp)로 — 한글은 UI 서체 그대로
function mixJp(text) {
  const s = String(text == null ? '' : text);
  let out = '', last = 0, m;
  JP_RUN_RE.lastIndex = 0;
  while ((m = JP_RUN_RE.exec(s)) !== null) {
    if (!JP_HAS_RE.test(m[0])) continue;
    out += esc(s.slice(last, m.index)) + `<span class="jp">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(s.slice(last));
}

// 세그먼트 컨트롤 — 스프링 썸. href가 있으면 링크(허브 탭), 없으면 버튼
function seg({ id, label, items, active, action, key, cls = '', attrs = '' }) {
  const n = items.length;
  const i = Math.max(0, items.findIndex(it => String(it.v) === String(active)));
  return `
  <div class="seg ${cls}" role="group" aria-label="${esc(label)}" data-seg="${esc(id)}" style="--n:${n};--i:${i}">
    <i class="seg-thumb" aria-hidden="true"></i>
    ${items.map((it, k) => {
      const on = k === i;
      const inner = `${it.icon ? ic(it.icon) : ''}${it.html != null ? it.html : esc(it.label)}`;
      return it.href
        ? `<a href="${it.href}"${on ? ' aria-current="page"' : ''}>${inner}</a>`
        : `<button type="button" class="${on ? 'active' : ''}" aria-pressed="${on}" data-action="${action}"${key ? ` data-${key}="${esc(it.v)}"` : ''}${attrs ? ' ' + attrs : ''}>${inner}</button>`;
    }).join('')}
  </div>`;
}

// 진행 링 (SVG, 코스 색 그라디언트)
function ring({ pct, size = 96, stroke = 9, label = '', sub = '', done = false }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, pct)));
  return `
  <div class="ring ${done ? 'done' : ''}" style="--size:${size}px;--c:${c.toFixed(1)}">
    <svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
      <circle class="ring-bar" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
    </svg>
    <div class="ring-label"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</div>
  </div>`;
}

/* ---------- 메뉴 체계: 5개 허브 + 서브탭 ---------- */
// 홈 · 학습 · 어휘 · 연습 · 검색 — 모바일은 하단 독, 데스크톱은 그룹형 사이드바
const HUB_ORDER = ['home', 'learn', 'vocab', 'practice', 'search'];
const HUB_ROOT = { home: '#/', learn: '#/chapters', vocab: '#/words', practice: '#/quiz', search: '#/search' };
const HUBS = {
  learn: {
    title: '학습', mark: '学', kicker: '学習 · 五十課',
    sub: '핵심 문형 50과, 과마다 20문장. 순서대로 읽어도 좋고 필요한 문형만 골라도 좋아요.',
    tabs: [
      { leaf: 'learn-list', label: '과별', href: '#/chapters' },
      { leaf: 'learn-grammar', label: '문법 색인', href: '#/chapters?tab=grammar' },
      { leaf: 'learn-all', label: '전체 문장', href: '#/all' },
    ],
  },
  vocab: {
    title: '어휘', mark: '語', kicker: '語彙 · 五十音',
    sub: '단어와 가나를 소리 내어 익혀요. 누르면 발음이 들려요.',
    tabs: [
      { leaf: 'vocab-words', label: '단어장', href: '#/words' },
      { leaf: 'vocab-kana', label: '가나', href: '#/kana' },
    ],
  },
  practice: {
    title: '연습', mark: '練', kicker: '練習',
    sub: '카드를 뒤집어 암기하거나, 귀로 흘려 들으며 익혀요. 틀린 건 복습함에 모여요.',
    tabs: [
      { leaf: 'practice-quiz', label: '암기 카드', href: '#/quiz' },
      { leaf: 'practice-auto', label: '자동 듣기', href: '#/auto' },
      { leaf: 'practice-review', label: '복습함', href: '#/review' },
    ],
  },
};
function hubHead(hub, leaf, sub) {
  const h = HUBS[hub];
  return `
  <header class="page-head" data-mark="${h.mark}">
    <span class="kicker">${h.kicker}</span>
    <h1 class="page-title">${h.title}</h1>
    <p class="page-sub">${sub || h.sub}</p>
  </header>
  ${seg({ id: 'hub-' + hub, label: h.title + ' 메뉴', cls: 'hub-tabs', active: leaf,
          items: h.tabs.map(t => ({ v: t.leaf, label: t.label, href: t.href })) })}`;
}

/* ---------- 시트(설정·코스) · 확인 다이얼로그 — 네이티브 <dialog> ---------- */
const sheetEl = $('#sheet'), sheetBody = $('#sheet-body'), sheetTitleEl = $('#sheet-title');

function snapSegs(scope) {
  const m = {};
  $$('.seg[data-seg]', scope).forEach(s => { m[s.dataset.seg] = s.style.getPropertyValue('--i'); });
  return m;
}
// 다시 그린 세그먼트의 썸이 '이전 위치 → 새 위치'로 미끄러지게(FLIP)
function flipSegs(scope, snap) {
  const changed = [];
  $$('.seg[data-seg]', scope).forEach(s => {
    const old = snap[s.dataset.seg], cur = s.style.getPropertyValue('--i');
    if (old !== undefined && old !== '' && old !== cur) { s.style.setProperty('--i', old); changed.push([s, cur]); }
  });
  if (changed.length) {
    void scope.offsetWidth;
    requestAnimationFrame(() => requestAnimationFrame(() => changed.forEach(([s, cur]) => s.style.setProperty('--i', cur))));
  }
}

function openSheet(kind, title, html) {
  sheetKind = kind;
  sheetTitleEl.textContent = title;
  sheetBody.innerHTML = html;
  sheetBody.scrollTop = 0;
  sheetEl.classList.remove('closing');
  if (!sheetEl.open) sheetEl.showModal();
}
function setSheetBody(html) {
  const y = sheetBody.scrollTop, snap = snapSegs(sheetBody);
  const fk = focusKeyOf(document.activeElement, sheetBody);     // 눌렀던 컨트롤로 키보드 포커스를 되돌린다
  sheetBody.innerHTML = html;
  sheetBody.scrollTop = y;
  flipSegs(sheetBody, snap);
  restoreFocus(fk, sheetBody);
}
function closeSheet() {
  if (!sheetEl.open || sheetEl.classList.contains('closing')) return;
  sheetEl.classList.add('closing');
  const panel = $('.sheet-panel', sheetEl);
  const done = () => {
    if (!sheetEl.classList.contains('closing')) return;       // 그 사이 다시 열렸다면 이전 타이머는 무시
    sheetEl.close(); sheetEl.classList.remove('closing', 'dragged'); sheetKind = '';
    panel.style.transition = panel.style.transform = panel.style.opacity = '';
  };
  if (reduceMotion()) done(); else setTimeout(done, 190);
}
sheetEl.addEventListener('cancel', e => { e.preventDefault(); closeSheet(); });          // Esc
// 바깥(배경) 눌러 닫기 — 눌림이 배경에서 시작했을 때만(시트 안에서 눌러 바깥에서 놓는 경우는 제외)
let sheetDownOnBackdrop = false;
sheetEl.addEventListener('pointerdown', e => { sheetDownOnBackdrop = e.target === sheetEl; });
sheetEl.addEventListener('click', e => { if (e.target === sheetEl && sheetDownOnBackdrop) closeSheet(); sheetDownOnBackdrop = false; });

// 모바일 바텀시트: 손잡이·제목줄을 아래로 끌어 닫기
(() => {
  const panel = $('.sheet-panel', sheetEl);
  let y0 = 0, dy = 0, drag = false;
  const start = e => {
    if (e.pointerType === 'mouse' || !e.target.closest('.sheet-grip, .sheet-head') || e.target.closest('button')) return;
    drag = true; y0 = e.clientY; dy = 0; panel.style.transition = 'none';
    panel.setPointerCapture(e.pointerId);
  };
  const move = e => { if (!drag) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = `translateY(${dy}px)`; };
  const end = () => {
    if (!drag) return; drag = false;
    if (dy > 90) {                                   // 끌던 위치에서 그대로 아래로 내려가며 닫힌다
      sheetEl.classList.add('dragged');
      panel.style.transition = 'transform .18s cubic-bezier(.4, 0, 1, 1), opacity .18s ease-in';
      panel.style.transform = 'translateY(100%)'; panel.style.opacity = '0';
      closeSheet();
    } else { panel.style.transition = ''; panel.style.transform = ''; }
  };
  panel.addEventListener('pointerdown', start);
  panel.addEventListener('pointermove', move);
  panel.addEventListener('pointerup', end);
  panel.addEventListener('pointercancel', end);
})();

const confirmEl = $('#confirm');
let confirmResolve = null;
function confirmDialog({ title, body = '', yes = '확인', danger = false }) {
  return new Promise(resolve => {
    $('#confirm-title').textContent = title;
    $('#confirm-desc').textContent = body;
    const y = $('#confirm-yes');
    y.textContent = yes;
    y.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    confirmResolve = resolve;
    confirmEl.classList.remove('closing');
    confirmEl.showModal();
  });
}
function settleConfirm(v) {
  if (!confirmResolve) return;
  const r = confirmResolve; confirmResolve = null;
  confirmEl.classList.add('closing');
  const done = () => { if (!confirmEl.classList.contains('closing')) return; confirmEl.close(); confirmEl.classList.remove('closing'); };
  if (reduceMotion()) done(); else setTimeout(done, 170);
  r(v);
}
confirmEl.addEventListener('cancel', e => { e.preventDefault(); settleConfirm(false); });
let confirmDownOnBackdrop = false;
confirmEl.addEventListener('pointerdown', e => { confirmDownOnBackdrop = e.target === confirmEl; });
confirmEl.addEventListener('click', e => { if (e.target === confirmEl && confirmDownOnBackdrop) settleConfirm(false); confirmDownOnBackdrop = false; });

/* 설정 시트 */
function settingsHtml() {
  const s = S.settings;
  const jv = jaVoiceList();
  const canVibrate = typeof navigator.vibrate === 'function';
  const voiceRow = (!hasTTS || !jv.length)
    ? `<div class="set-row col"><div class="set-lbl"><b>일본어 음성</b></div><span class="set-note">${isInAppBrowser
        ? '인앱 브라우저에서는 음성을 쓸 수 없어요. ⋮ → 다른 브라우저로 열어 주세요.'
        : '이 브라우저에서 쓸 수 있는 일본어 음성이 없어요.'}</span></div>`
    : `<div class="set-row col">
        <div class="set-lbl"><b>일본어 음성</b><span>기기에 설치된 음성 중에서 골라요. 고르면 미리 들려줘요.</span></div>
        <label class="field"><select data-action="set-voice" aria-label="일본어 음성 선택">
          <option value="">자동 (기기 기본)</option>
          ${jv.map(v => { const g = voiceGender(v.name); return `<option value="${esc(v.voiceURI)}"${s.voiceJa === v.voiceURI ? ' selected' : ''}>${esc(v.name)}${g ? ` (${g})` : ''}</option>`; }).join('')}
        </select></label>
        <span class="set-note">음성이 하나뿐이면 기기 설정에서 추가 설치할 수 있어요 — iOS: 설정 → 손쉬운 사용 → 읽어 주기 콘텐츠 → 음성 → 일본어, Android: 설정 → 음성/TTS에서 음성 데이터 추가.</span>
      </div>`;
  return `
  <h3 class="set-title">화면</h3>
  <div class="set-group">
    <div class="set-row col">
      <div class="set-lbl"><b>테마</b><span>기본은 기기 설정을 따라가요</span></div>
      ${seg({ id: 'set-theme', label: '테마', action: 'set-theme', key: 'theme', active: s.theme, items: [
        { v: 'auto', label: '시스템', icon: 'monitor' }, { v: 'light', label: '라이트', icon: 'sun' }, { v: 'dark', label: '다크', icon: 'moon' }] })}
    </div>
    <div class="set-row">
      <div class="set-lbl"><b>글자 크기</b><span>문장 글자 크기를 조절해요</span></div>
      <div class="stepper">
        <button type="button" data-action="font-dec" aria-label="글자 작게">${ic('minus')}</button>
        <output>${Math.round(s.scale * 100)}%</output>
        <button type="button" data-action="font-inc" aria-label="글자 크게">${ic('plus')}</button>
      </div>
    </div>
  </div>

  <h3 class="set-title">학습</h3>
  <div class="set-group">
    <div class="set-row col">
      <div class="set-lbl"><b>하루 목표</b><span>오늘 학습한 문장 수로 계산해요 · 홈의 링에 반영돼요</span></div>
      ${seg({ id: 'set-goal', label: '하루 목표', action: 'set-goal', key: 'val', active: dailyGoal(),
              items: [10, 20, 30, 50].map(n => ({ v: n, label: n + '문장' })) })}
    </div>
    <div class="set-row">
      <div class="set-lbl"><b>진동 피드백</b><span>${canVibrate ? '채점할 때와 목표 달성 때 가볍게 진동해요' : '이 기기·브라우저는 진동을 지원하지 않아요'}</span></div>
      <button type="button" class="switch" role="switch" aria-checked="${canVibrate && s.haptics}" aria-label="진동 피드백" data-action="set-haptics"${canVibrate ? '' : ' disabled'}></button>
    </div>
  </div>

  <h3 class="set-title">음성</h3>
  <div class="set-group">
    ${voiceRow}
    <div class="set-row col">
      <div class="set-lbl"><b>음성 톤(음높이)</b></div>
      ${seg({ id: 'set-pitch', label: '음높이', action: 'set-pitch', key: 'val', active: String(ttsPitch()),
              items: [{ v: '0.8', label: '낮게' }, { v: '1', label: '기본' }, { v: '1.3', label: '높게' }] })}
    </div>
  </div>

  <div class="only-fine">
    <h3 class="set-title">단축키</h3>
    <div class="set-group shortcut-list">
      <div><span>검색 열기</span><span><kbd>/</kbd></span></div>
      <div><span>암기 카드 뒤집기 · 자동 듣기 재생/정지</span><span><kbd>Space</kbd></span></div>
      <div><span>암기: 알아요 / 몰라요</span><span><kbd>→</kbd><kbd>←</kbd> <kbd>O</kbd><kbd>X</kbd></span></div>
      <div><span>자동 듣기: 이전 / 다음</span><span><kbd>←</kbd><kbd>→</kbd></span></div>
    </div>
  </div>

  <h3 class="set-title">데이터</h3>
  <div class="set-group"><div class="set-row col">
    <button type="button" class="btn btn-danger btn-block" data-action="reset-data">${ic('trash')} 학습 기록 전체 초기화</button>
    <span class="set-note">모든 코스의 완료·북마크·복습 기록을 지워요. 설정(테마·글자 크기·목표)은 그대로 남아요.</span>
  </div></div>`;
}
function openSettings() { openSheet('settings', '설정', settingsHtml()); }
function renderSettings() { if (sheetKind === 'settings') setSheetBody(settingsHtml()); }

/* 코스 선택 시트 */
function courseSheetHtml() {
  return `
  <p class="set-note" style="margin:-4px 2px 14px">코스를 바꾸면 문장·문법·검색 결과가 그 코스로 바뀌고, 앱의 포인트 색도 함께 달라져요.</p>
  <div class="course-list">
    ${COURSES.map(c => {
      const pr = courseProgress(c.id), active = c.id === S.currentCourse;
      return `
      <button type="button" class="course-opt spot" data-action="set-course" data-course="${c.id}"${active ? ' aria-current="true"' : ''}>
        <span class="co-dot" aria-hidden="true"></span>
        <span class="co-main">
          <b>${esc(c.label)} <span class="co-sub">${esc(c.sub)}</span></b>
          <span>${pr.done} / ${pr.total}문장 · ${pr.pct}%</span>
          <span class="co-prog"><span class="bar thin"><i style="width:${pr.pct}%"></i></span></span>
        </span>
        <span class="co-check">${ic('check')}</span>
      </button>`;
    }).join('')}
  </div>`;
}
function openCourseMenu() { openSheet('course', '학습 코스', courseSheetHtml()); }

/* 코스·진행 상태 표시 갱신 (사이드바·상단바) */
function updateCourseControl() {
  const meta = courseMeta(S.currentCourse), pr = courseProgress(meta.id);
  $$('[data-bind="course-label"]').forEach(el => { el.textContent = meta.label; });
  $$('[data-bind="course-sub"]').forEach(el => { el.textContent = meta.sub; });
  $$('[data-bind="course-pct"]').forEach(el => { el.textContent = pr.pct + '%'; });
  const label = `현재 ${meta.label} 코스 · ${pr.pct}% · 코스 선택`;
  $$('.course-btn, .course-chip').forEach(b => { b.setAttribute('aria-label', label); b.title = label; });
}
let railStatusCache = '';
function updateRailStatus() {
  const el = $('[data-bind="status"]');
  if (!el) return;
  const st = streakInfo(), n = todayTotal(), goal = dailyGoal(), pct = Math.min(100, Math.round(n / goal * 100));
  const html = `
    <div class="rail-status-row"><span class="flame">${ic('flame')}${st.n}일 연속</span><b>${n} / ${goal}</b></div>
    <div class="bar thin" role="progressbar" aria-label="오늘 목표" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${Math.min(n, goal)}"><i style="width:${pct}%"></i></div>`;
  if (html !== railStatusCache) { railStatusCache = html; el.innerHTML = html; }
}

/* 화면 전환 효과(View Transitions) — 지원하지 않거나 '동작 줄이기'면 즉시 실행.
   전환 애니메이션이 도는 동안에는 ::view-transition 오버레이가 포인터를 가로채므로,
   (1) 전환은 짧게(화면 전체를 가볍게 교차 — 본문이 떠오르는 움직임은 .enter가 맡는다),
   (2) 새 탭·클릭이 시작되면 진행 중인 전환을 바로 마무리한다. */
let activeVT = null;
function runVT(fn, kind) {
  if (!document.startViewTransition || reduceMotion()) { fn(); return; }
  if (kind) root.dataset.vt = kind;
  const t = document.startViewTransition(fn);
  activeVT = t;
  const done = () => { if (activeVT === t) activeVT = null; if (kind && root.dataset.vt === kind) delete root.dataset.vt; };
  t.ready.catch(() => {});             // 건너뛰거나 중단돼도 콘솔에 거부 오류가 남지 않게
  t.finished.then(done, done);
}
document.addEventListener('pointerdown', () => { if (activeVT) activeVT.skipTransition(); }, true);

function switchCourse(id) {
  if (!COURSES.some(c => c.id === id)) return;
  if (id === S.currentCourse) { closeSheet(); return; }
  if (autoPlayer) autoStop();
  closeSheet();
  runVT(() => {
    setCourse(id);
    chapterFilter = 'ALL'; allFilter = 'ALL'; allState = 'ALL';
    quizSetup.ch = 1; quizSession = null;
    S.settings.auto.ch = 1;
    save();
    updateCourseControl(); updateRailStatus();
    render();
  }, 'course');
  toast(`${courseMeta(id).label} 코스로 전환했어요`, 'sparkle');
}

/* ---------- 뷰: 홈 ---------- */
function greeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return ['おはよう', '좋은 아침이에요'];
  if (h >= 11 && h < 17) return ['こんにちは', '오늘도 한 문장씩, 천천히'];
  if (h >= 17 && h < 22) return ['こんばんは', '오늘 하루도 수고했어요'];
  return ['おつかれさま', '늦은 시간까지 대단해요'];
}

const HOME_QUICK = [
  { href: '#/kana', glyph: 'あ', title: '가나', sub: '五十音 차트·연습' },
  { href: '#/words', icon: 'vocab', title: '단어장', sub: '주제별 단어' },
  { href: '#/chapters?tab=grammar', icon: 'type', title: '문법 색인', sub: '문형 한눈에' },
  { href: '#/auto', icon: 'headphones', title: '자동 듣기', sub: '손대지 않고 귀로' },
];

function viewHome() {
  const total = learnedCount();
  const pct = TOTAL ? Math.round(total / TOTAL * 100) : 0;            // 코스 전체 진도(레벨 타일)
  const resume = resumeChapter();
  const rp = chapterProgress(resume);
  const cpct = rp.total ? Math.round(rp.done / rp.total * 100) : 0;   // 히어로 막대 = 지금 과의 진도
  const fresh = total === 0;
  const allDone = total === TOTAL;
  const course = courseMeta(S.currentCourse);
  const [hello, helloKo] = greeting();

  const n = todayTotal(), goal = dailyGoal();
  const goalDone = n >= goal;
  const st = streakInfo();
  const dots = weekDots();
  const lvs = levelProgress();

  // 날짜가 바뀌기 전까지 같은 문장을 보여 주는 오늘의 문장 (기기 로컬 날짜 기준)
  const dayNo = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
  const tod = SENTENCES[dayNo % TOTAL];
  const todCh = chapterOf(tod.ch);

  const goalNote = goalDone ? '오늘 목표를 달성했어요!'
    : n === 0 ? '첫 문장부터 시작해 볼까요?' : `목표까지 ${goal - n}문장 남았어요`;
  const streakNote = st.doneToday ? '오늘도 이어갔어요'
    : st.alive ? `오늘 학습하면 ${st.n + 1}일째예요` : '오늘부터 새로 시작해요';

  return `
  <div class="page wide home">
    <header class="home-greet">
      <p><span class="jp">${hello}</span><span>${helloKo}</span></p>
    </header>

    <div class="bento">
      <section class="tile hero spot" aria-label="이어서 학습">
        <span class="hero-mark jp" aria-hidden="true">千</span>
        <span class="kicker">${esc(course.label)} 코스 · ${esc(course.sub)}</span>
        <h1 class="hero-title">
          <span class="hero-no jp">${pad2(resume.id)}</span>
          <span class="hero-name">${mixJp(resume.title)}</span>
        </h1>
        <p class="hero-sub">${fresh ? '첫 20문장부터 바로 시작해요.' : `${rp.done}/${rp.total}문장 완료 · 전체 ${total}/${TOTAL}`}</p>
        <div class="bar" role="progressbar" aria-label="현재 과 진도" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${cpct}"><i style="width:${cpct}%"></i></div>
        <div class="hero-actions">
          <a class="btn btn-primary btn-lg" href="#/study/${resume.id}">${fresh ? '학습 시작' : allDone ? '다시 학습하기' : '이어서 학습'} ${ic('arrow-right')}</a>
          <button type="button" class="btn btn-ghost btn-lg" data-action="auto-quick" data-ch="${resume.id}">${ic('headphones')} 듣기</button>
        </div>
      </section>

      <section class="tile goal spot" aria-label="오늘 목표">
        ${ring({ pct: n / goal, size: 112, stroke: 10, done: goalDone,
                 label: goalDone ? ic('check') : String(n), sub: goalDone ? `${n} / ${goal}문장` : `/ ${goal}문장` })}
        <div class="tile-copy">
          <b>오늘의 목표</b>
          <span>${goalNote}</span>
        </div>
      </section>

      <section class="tile streak spot" aria-label="연속 학습일">
        <div class="streak-top">
          <span class="streak-flame ${st.alive ? 'on' : ''}">${ic('flame')}</span>
          <b class="streak-n">${st.n}</b><span class="streak-unit">일 연속</span>
        </div>
        <ol class="week" aria-label="최근 7일">
          ${dots.map(d => `<li class="${d.on ? 'on' : ''} ${d.today ? 'is-today' : ''}"><i></i><span>${d.name}</span></li>`).join('')}
        </ol>
        <p class="tile-note">${streakNote}</p>
      </section>

      <section class="tile today spot" aria-label="오늘의 문장">
        <span class="kicker">${ic('sparkle')} 오늘의 문장</span>
        <p class="today-jp jp" data-action="speak" data-n="${tod.n}" title="눌러서 듣기">${esc(tod.jp)}</p>
        <p class="today-ko">${esc(tod.ko)}</p>
        <div class="today-meta">${lvChip(todCh.level)}${ptChip(tod.pt)}</div>
        <div class="tile-actions">
          <button type="button" class="btn btn-tonal btn-sm" data-action="speak" data-n="${tod.n}" aria-label="오늘의 문장 듣기">${ic('volume')} 듣기</button>
          <a class="btn btn-ghost btn-sm" href="#/study/${tod.ch}?focus=${tod.n}">본문에서 보기 ${ic('arrow-right')}</a>
        </div>
      </section>

      <section class="tile levels spot" aria-label="레벨별 진도">
        <h2 class="tile-h">레벨별 진도</h2>
        <div class="lv-total"><b>${pct}<small>%</small></b><span>전체 ${total} / ${TOTAL}문장</span></div>
        <ul class="lv-rows">
          ${lvs.map(l => `
          <li>
            ${lvChip(l.lv)}
            <span class="bar thin"><i class="c-${l.lv.toLowerCase()}" style="width:${l.total ? Math.round(l.done / l.total * 100) : 0}%"></i></span>
            <b>${l.done}<small>/${l.total}</small></b>
          </li>`).join('')}
        </ul>
      </section>

      <nav class="tile quick" aria-label="바로가기">
        ${HOME_QUICK.map(q => `
        <a class="q-item spot" href="${q.href}">
          <span class="q-ico">${q.glyph ? `<span class="glyph jp" aria-hidden="true">${q.glyph}</span>` : ic(q.icon)}</span>
          <span class="q-copy"><b>${q.title}</b><small>${q.sub}</small></span>
        </a>`).join('')}
      </nav>
    </div>
  </div>`;
}

/* ---------- 뷰: 학습 — 과별 / 문법 색인 ---------- */
let chapterFilter = 'ALL';
let chaptersTab = 'list';

function viewChapters() {
  const filters = ['ALL', ...courseLevels()];
  if (!filters.includes(chapterFilter)) chapterFilter = 'ALL';
  const grammar = chaptersTab === 'grammar';
  const list = CHAPTERS.filter(ch => chapterFilter === 'ALL' || ch.level === chapterFilter);
  const resumeId = resumeChapter().id;
  const blocks = [];                         // 10과 단위 블록 (레벨이 중간에 섞여 있어 번호 기준으로 묶는다)
  for (const ch of list) { const b = Math.floor((ch.id - 1) / 10); (blocks[b] || (blocks[b] = [])).push(ch); }

  const row = ch => {
    if (grammar) {
      const g = GRAMMAR.find(x => x.id === ch.id);
      if (!g) return '';
      return `
      <a class="ch-row spot" data-search="${esc(`${pad2(ch.id)} ${g.formula} ${g.gist} ${ch.level}`.toLowerCase())}" href="#/grammar/${ch.id}">
        <span class="ch-no jp">${pad2(ch.id)}</span>
        <span class="ch-main">
          <b class="ch-title jp">${esc(g.formula)}</b>
          <span class="ch-gist">${mixJp(g.gist)}</span>
        </span>
        <span class="ch-side">${lvChip(ch.level)}</span>
      </a>`;
    }
    const p = chapterProgress(ch), pct = Math.round(p.done / p.total * 100), done = p.done === p.total;
    const isResume = !done && ch.id === resumeId && p.done > 0;
    return `
      <a class="ch-row spot ${done ? 'done' : ''} ${isResume ? 'resume' : ''}" data-search="${esc(`${pad2(ch.id)} ${ch.title} ${ch.level}`.toLowerCase())}" href="#/study/${ch.id}">
        <span class="ch-no jp">${pad2(ch.id)}</span>
        <span class="ch-main">
          <b class="ch-title">${mixJp(ch.title)}${isResume ? '<em class="tag">이어서</em>' : ''}</b>
          <span class="ch-meta">${lvChip(ch.level)}<span>${pad4(ch.start)}–${pad4(ch.end)}</span></span>
        </span>
        <span class="ch-prog ${done ? 'done' : ''}" style="--p:${pct}" aria-label="${done ? '완료' : pct + '%'}">${done ? ic('check') : pct ? `<i>${pct}</i>` : ic('chev-right')}</span>
      </a>`;
  };

  return `
  <div class="page">
    ${hubHead('learn', grammar ? 'learn-grammar' : 'learn-list',
      grammar ? '50개 문형을 한눈에 훑어보고, 눌러서 해설만 모아 읽어요.' : null)}

    <div class="filter-bar">
      <div class="chips" role="group" aria-label="급수 필터">
        ${filters.map(f => `<button type="button" class="chip-btn ${chapterFilter === f ? 'active' : ''}" aria-pressed="${chapterFilter === f}" data-action="filter" data-filter="${f}">${f === 'ALL' ? '전체' : f}</button>`).join('')}
      </div>
    </div>
    <label class="search-field catalog-search" for="chapter-search">
      ${ic('search')}
      <input id="chapter-search" type="search" placeholder="${grammar ? '문형·설명 검색' : '과 번호·문형·설명 검색'}" autocomplete="off" aria-label="과 검색">
      <span class="count" id="chapter-search-count">${list.length}개</span>
    </label>

    <div id="chapter-groups">
      ${blocks.map((chs, b) => {
        if (!chs) return '';
        const first = chs[0], last = chs[chs.length - 1];
        let sub = `${pad4(first.start)}–${pad4(last.end)}`;
        if (!grammar) {
          let d = 0, t = 0; chs.forEach(c => { const p = chapterProgress(c); d += p.done; t += p.total; });
          sub += ` · ${d}/${t}`;
        }
        return `
        <section class="ch-group" aria-label="${first.id}–${last.id}과">
          <h2 class="ch-group-h"><span>${pad2(first.id)}–${pad2(last.id)}과</span><small>${sub}</small></h2>
          <div class="ch-list">${chs.map(row).join('')}</div>
        </section>`;
      }).join('')}
    </div>
    <div id="chapter-no-results" class="empty" hidden><span class="jp">無</span><b>일치하는 과가 없어요</b>다른 번호나 키워드로 찾아보세요.</div>
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
  <div class="page">
    <a class="backlink" href="#/chapters?tab=grammar">${ic('chev-left')} 문법 색인</a>
    <header class="study-head">
      <div class="sh-meta"><span class="kicker">제${pad2(id)}과</span>${lvChip(ch.level)}<span class="range">본문 ${pad4(ch.start)}–${pad4(ch.end)}</span></div>
      <h1 class="study-title">${mixJp(ch.title)}</h1>
    </header>

    ${lessonHtml(ch, false)}

    <div class="grammar-cta">
      <a class="btn btn-primary" href="#/study/${id}">이 과 본문 20문장 학습 ${ic('arrow-right')}</a>
      <button type="button" class="btn btn-ghost" data-action="auto-quick" data-ch="${id}">${ic('headphones')} 자동 듣기</button>
    </div>

    <div class="pager">
      ${prev ? `<a class="pager-btn" href="#/grammar/${id - 1}">${ic('chev-left')}<span><small>이전 문형</small><b class="jp">${esc(prev.formula)}</b></span></a>` : '<span></span>'}
      ${next ? `<a class="pager-btn next" href="#/grammar/${id + 1}"><span><small>다음 문형</small><b class="jp">${esc(next.formula)}</b></span>${ic('chev-right')}</a>` : '<span></span>'}
    </div>
  </div>`;
}

/* ---------- 문법 해설 (교재 본문) ---------- */
// 한·일 혼합 텍스트에서 '일본어 런'만 골라 탭하면 발음되는 버튼으로 감싼다(예문 듣기).
function jpSayify(text) {
  const s = String(text == null ? '' : text);
  let out = '', last = 0, m;
  JP_RUN_RE.lastIndex = 0;
  while ((m = JP_RUN_RE.exec(s)) !== null) {
    const run = m[0];
    if (!JP_HAS_RE.test(run)) continue;          // 가나·한자 없는 런(한국어/숫자)은 그대로 둠
    out += esc(s.slice(last, m.index));           // 앞쪽 비일본어 구간
    const say = run.replace(/[「」『』（）()]/g, '').replace(/→/g, '、').trim();
    out += `<button type="button" class="say-jp jp" data-action="say" data-ch="${esc(say)}" title="발음 듣기">${esc(run)}</button>`;
    last = m.index + run.length;
  }
  out += esc(s.slice(last));
  return out;
}

function lessonBody(g) {
  return `
    <p class="lesson-intro">${jpSayify(g.intro)}</p>
    <div class="lesson-grid">
      <div class="lesson-sec">
        <h3><i class="jp">接続</i>접속 · 활용 <small class="hint">예문을 누르면 발음 ▶</small></h3>
        <table class="lesson-table">
          ${g.forms.map(f => `
          <tr>
            <th>${esc(f[0])}</th>
            <td><span class="jp">${jpSayify(f[1])}</span>${f[2] ? `<small>${esc(f[2])}</small>` : ''}</td>
          </tr>`).join('')}
        </table>
      </div>
      <div class="lesson-sec">
        <h3><i class="jp">要点</i>학습 포인트 <small class="hint">예문을 누르면 발음 ▶</small></h3>
        <ul class="lesson-points">
          ${g.point.map(p => `<li>${jpSayify(p)}</li>`).join('')}
        </ul>
      </div>
    </div>
    ${g.vocab && g.vocab.length ? `
    <div class="lesson-sec lesson-vocab-sec">
      <h3><i class="jp">語彙</i>주요 어휘 <small class="hint">단어를 누르면 발음을 들려줘요</small></h3>
      <div class="vocab-grid">
        ${g.vocab.map(v => `
        <button type="button" class="vocab-item" data-action="say" data-ch="${esc(v[1])}" title="${esc(v[1])} 발음 듣기">
          <span class="vocab-spk">${ic('volume')}</span>
          <ruby class="jp">${esc(v[0])}<rt>${esc(v[1])}</rt></ruby>
          <span class="vocab-ko">${esc(v[2])}</span>
        </button>`).join('')}
      </div>
    </div>` : ''}`;
}

// collapsible=true: 학습 화면에서는 접이식(<details>) — 접어 두면 바로 본문 문장으로 내려갈 수 있다
function lessonHtml(ch, collapsible) {
  const g = GRAMMAR.find(x => x.id === ch.id);
  if (!g) return '';
  if (collapsible) {
    return `
    <details class="lesson card" ${S.settings.lessonOpen ? 'open' : ''}>
      <summary>
        <span class="lesson-badge jp">文法</span>
        <span class="lesson-title">
          <span class="lesson-formula">${mixJp(g.formula)}</span>
          <span class="lesson-gist">${mixJp(g.gist)}</span>
        </span>
        <span class="lesson-chev">${ic('chev-down')}</span>
      </summary>
      <div class="lesson-body">${lessonBody(g)}</div>
    </details>`;
  }
  return `
    <section class="lesson card">
      <header class="lesson-head">
        <span class="lesson-badge jp">文法</span>
        <span class="lesson-title">
          <span class="lesson-formula">${jpSayify(g.formula)}</span>
          <span class="lesson-gist">${jpSayify(g.gist)}</span>
        </span>
      </header>
      <div class="lesson-body">${lessonBody(g)}</div>
    </section>`;
}

/* ---------- 뷰: 학습 (한 과) ---------- */
function maskWrap(inner, masked) {
  return masked
    ? `<span class="masked"><span class="mask-text">${inner}</span><button class="mask-reveal" type="button" data-action="reveal" aria-label="가린 내용 보기">눌러서 보기</button></span>`
    : inner;
}

function hideModeSeg() {
  const mode = S.settings.hideMode;
  return seg({ id: 'hide-mode', label: '표시 모드', action: 'hide-mode', key: 'mode', active: mode,
    items: [{ v: 'all', label: '모두 보기', icon: 'eye' }, { v: 'hideKo', label: '뜻 가리기', icon: 'eye-off' }, { v: 'hideJp', label: '문장 가리기', icon: 'eye-off' }] });
}

function sentenceCard(s) {
  const mode = S.settings.hideMode; // all | hideKo | hideJp
  const learned = !!P.learned[s.n];
  const booked = !!P.bookmarks[s.n];
  return `
  <article class="s-card spot ${learned ? 'is-learned' : ''}" id="s-${s.n}" data-n="${s.n}">
    <header class="s-top">
      <span class="s-num jp">${pad4(s.n)}</span>
      ${ptChip(s.pt)}
    </header>
    <p class="s-jp jp" data-action="speak" data-n="${s.n}" title="눌러서 발음 듣기">${maskWrap(esc(s.jp), mode === 'hideJp')}</p>
    <p class="s-ko">${maskWrap(esc(s.ko), mode === 'hideKo')}</p>
    <footer class="s-actions">
      <button type="button" class="s-btn" data-action="speak" data-n="${s.n}">${ic('volume')}<span>듣기</span></button>
      <button type="button" class="s-btn learn ${learned ? 'on' : ''}" data-action="learn" data-n="${s.n}" aria-pressed="${learned}">${ic('check')}<span>${learned ? '완료' : '외웠어요'}</span></button>
      <button type="button" class="s-btn book ${booked ? 'on' : ''}" data-action="book" data-n="${s.n}" aria-pressed="${booked}">${ic('bookmark', booked ? 'fill' : '')}<span>북마크</span></button>
    </footer>
  </article>`;
}

function viewStudy(id) {
  const ch = chapterOf(id);
  if (!ch) { location.hash = '#/chapters'; return ''; }
  P.lastChapter = id; save();

  const p = chapterProgress(ch);
  const pct = Math.round(p.done / p.total * 100);
  const items = SENTENCES.slice(ch.start - 1, ch.end);
  const prev = id > 1 ? chapterOf(id - 1) : null;
  const next = id < CHAPTERS.length ? chapterOf(id + 1) : null;

  return `
  <div class="page">
    <a class="backlink" href="#/chapters">${ic('chev-left')} 학습</a>

    <header class="study-head">
      <div class="sh-meta"><span class="kicker">제${pad2(ch.id)}과</span>${lvChip(ch.level)}<span class="range">${pad4(ch.start)}–${pad4(ch.end)}</span></div>
      <h1 class="study-title">${mixJp(ch.title)}</h1>
      <div class="sh-progress">
        <div class="bar"><i id="ch-bar" style="width:${pct}%"></i></div>
        <span class="sh-count"><b id="ch-done">${p.done}</b>/${p.total}</span>
      </div>
      <div class="sh-actions">
        <button type="button" class="btn btn-primary" data-action="auto-quick" data-ch="${ch.id}">${ic('headphones')} 자동 듣기</button>
        <a class="btn btn-tonal" href="#/quiz?src=chapter&ch=${ch.id}">${ic('practice')} 이 과 암기</a>
        <div class="ch-nav" role="group" aria-label="과 이동">
          ${prev ? `<a class="icon-btn" href="#/study/${prev.id}" aria-label="이전 과">${ic('chev-left')}</a>` : `<span class="icon-btn disabled" aria-hidden="true">${ic('chev-left')}</span>`}
          <label class="field sm"><select data-action="study-ch-jump" aria-label="학습할 과 선택">
            ${CHAPTERS.map(c => `<option value="${c.id}" ${c.id === ch.id ? 'selected' : ''}>${pad2(c.id)}. ${esc(c.title)}</option>`).join('')}
          </select></label>
          ${next ? `<a class="icon-btn" href="#/study/${next.id}" aria-label="다음 과">${ic('chev-right')}</a>` : `<span class="icon-btn disabled" aria-hidden="true">${ic('chev-right')}</span>`}
        </div>
      </div>
    </header>

    ${lessonHtml(ch, true)}

    <div class="sec-head"><h2>본문 <small>例文 ${p.total}</small></h2></div>
    <div class="stickbar">${hideModeSeg()}</div>

    <div class="sentence-list">${items.map(sentenceCard).join('')}</div>

    <div class="chapter-done-cta">
      <button type="button" class="btn btn-ghost" data-action="mark-all" data-ch="${ch.id}">${ic('check')} 이 과 전체를 완료로 표시</button>
    </div>

    <div class="pager">
      ${prev ? `<a class="pager-btn" href="#/study/${prev.id}">${ic('chev-left')}<span><small>이전 과</small><b>${pad2(prev.id)}. ${mixJp(prev.title)}</b></span></a>` : '<span></span>'}
      ${next ? `<a class="pager-btn next primary" href="#/study/${next.id}"><span><small>다음 과</small><b>${pad2(next.id)}. ${mixJp(next.title)}</b></span>${ic('chev-right')}</a>`
             : `<a class="pager-btn next primary" href="#/quiz"><span><small>마지막 과예요</small><b>암기 카드로</b></span>${ic('chev-right')}</a>`}
    </div>
  </div>`;
}

/* ---------- 뷰: 전체 문장 (통독) ---------- */
let allFilter = 'ALL';    // 레벨
let allState = 'ALL';     // ALL | todo | done | book

const stateMatch = n => allState === 'todo' ? !P.learned[n]
  : allState === 'done' ? !!P.learned[n]
  : allState === 'book' ? !!P.bookmarks[n] : true;

function allRow(s) {
  const mode = S.settings.hideMode;
  const learned = !!P.learned[s.n];
  return `
  <div class="all-row" data-n="${s.n}">
    <a class="ar-num jp ${learned ? 'done' : ''}" href="#/study/${s.ch}?focus=${s.n}" title="${learned ? '학습 완료 · ' : ''}본문에서 보기">${pad4(s.n)}</a>
    <div class="ar-body" data-action="speak" data-n="${s.n}" title="눌러서 발음 듣기">
      <p class="ar-jp jp">${maskWrap(esc(s.jp), mode === 'hideJp')}</p>
      <p class="ar-ko">${maskWrap(esc(s.ko), mode === 'hideKo')}</p>
    </div>
  </div>`;
}

function viewAll() {
  const levels = ['ALL', ...courseLevels()];
  if (!levels.includes(allFilter)) allFilter = 'ALL';
  const chs = CHAPTERS.filter(c => allFilter === 'ALL' || c.level === allFilter);
  const secs = chs.map(c => ({ c, rows: SENTENCES.slice(c.start - 1, c.end).filter(s => stateMatch(s.n)) })).filter(x => x.rows.length);
  const shown = secs.reduce((a, x) => a + x.rows.length, 0);
  const doneN = learnedCount(), bookN = bookmarkList().length;
  const states = [['ALL', '전체', TOTAL], ['todo', '미완료', TOTAL - doneN], ['done', '완료', doneN], ['book', '북마크', bookN]];

  return `
  <div class="page">
    ${hubHead('learn', 'learn-all', `${TOTAL}문장을 한 화면에서 통독해요. 문장을 누르면 발음이 들리고, 번호를 누르면 그 과 본문으로 이동해요.`)}

    <div class="filter-bar">
      <div class="chips" role="group" aria-label="급수 필터">
        ${levels.map(f => `<button type="button" class="chip-btn ${allFilter === f ? 'active' : ''}" aria-pressed="${allFilter === f}" data-action="all-filter" data-filter="${f}">${f === 'ALL' ? '전체 급수' : f}</button>`).join('')}
      </div>
      <div class="chips" role="group" aria-label="학습 상태 필터">
        ${states.map(([v, l, c]) => `<button type="button" class="chip-btn ${allState === v ? 'active' : ''}" aria-pressed="${allState === v}" data-action="all-state" data-state="${v}">${v === 'book' ? ic('bookmark') : ''}${l}<span class="count">${c}</span></button>`).join('')}
      </div>
    </div>

    <label class="field sm all-jump"><select data-action="all-jump" aria-label="과로 이동">
      <option value="">과로 이동…</option>
      ${secs.map(x => `<option value="${x.c.id}">${pad2(x.c.id)}. ${esc(x.c.title)}</option>`).join('')}
    </select></label>
    <div class="stickbar">${hideModeSeg()}</div>
    <p class="list-meta">${secs.length}과 · ${shown}문장</p>

    ${secs.length ? secs.map(({ c, rows }) => `
    <section class="all-sec" id="all-ch-${c.id}">
      <div class="all-sec-head">
        <span class="ch-no jp">${pad2(c.id)}</span>
        <h2>${mixJp(c.title)}</h2>
        ${lvChip(c.level)}
        <a class="s-btn" href="#/study/${c.id}"><span>학습</span>${ic('arrow-right')}</a>
      </div>
      <div class="card all-list">${rows.map(allRow).join('')}</div>
    </section>`).join('') : `
    <div class="empty"><span class="jp">空</span><b>${allState === 'book' ? '북마크한 문장이 아직 없어요' : '해당하는 문장이 없어요'}</b>${allState === 'book' ? '학습 화면에서 문장의 북마크 버튼을 눌러 보세요.' : '다른 필터를 선택해 보세요.'}</div>`}
  </div>`;
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
  { key: 'seion', title: '청음', jp: '五十音', intro: '일본어의 기본 46자입니다. 세로 단(あ・い・う・え・お)과 가로 행(あ행, か행…)으로 외워 두면 나중에 동사 활용이 훨씬 쉬워집니다. し는 [시], つ는 [츠]에 가깝고, 조사로 쓰일 때 は는 [와], へ는 [에]로 읽습니다.' },
  { key: 'dakuon', title: '탁음·반탁음', jp: '濁音・半濁音', intro: '오른쪽 위에 점 두 개(゛탁점)를 붙이면 흐린 소리가 됩니다(か→が). ぱ행은 동그라미(゜반탁점)를 붙인 파열음입니다. ぢ・づ는 じ・ず와 발음이 같고 현대어에서는 거의 쓰이지 않습니다.' },
  { key: 'yoon', title: '요음', jp: '拗音', intro: 'い단 글자 뒤에 작게 쓴 ゃ・ゅ・ょ를 붙여 한 박자로 읽습니다(き+ゃ=きゃ[캬]). 글자 크기에 주의하세요: きや는 2박자, きゃ는 1박자입니다.' },
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
  <button type="button" class="kana-cell" data-action="kana-speak" data-ch="${esc(main)}" title="${esc(c.r)} · ${esc(c.ko)}">
    <span class="kc-char jp">${esc(main)}${alt}</span>
    <span class="kc-sub">${esc(c.r)} · ${esc(c.ko)}</span>
  </button>`;
}

function kanaScriptSeg() {
  return seg({ id: 'kana-script', label: '문자 선택', action: 'kana-script', key: 'sc', active: S.settings.kanaScript, cls: 'kana-script',
    items: [{ v: 'hira', html: '<span class="jp">ひらがな</span>' }, { v: 'kata', html: '<span class="jp">カタカナ</span>' }, { v: 'both', label: '함께 보기' }] });
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
  <button type="button" class="kana-cell quiz ${rev ? 'revealed' : ''}" data-action="kana-reveal" data-i="${i}" data-ch="${esc(c.h)}" title="눌러서 발음 확인">
    <span class="kc-char jp">${esc(main)}<i>${esc(counter)}</i></span>
    <span class="kc-sub">${rev ? `${esc(c.r)} · ${esc(c.ko)}` : '?'}</span>
  </button>`;
}

function viewKanaPractice() {
  if (!kanaPractice.items.length) reshuffleKana();
  const revN = Object.keys(kanaPractice.revealed).length;
  const ranges = [['all', '전체'], ['seion', '청음'], ['dakuon', '탁음·반탁음'], ['yoon', '요음']];
  return `
    <div class="stickbar">
      ${kanaScriptSeg()}
      <span class="meta" id="kana-progress">${revN} / ${kanaPractice.items.length} 확인</span>
    </div>
    <div class="filter-bar">
      <div class="chips" role="group" aria-label="연습 범위">
        ${ranges.map(([v, l]) => `<button type="button" class="chip-btn ${kanaPractice.range === v ? 'active' : ''}" aria-pressed="${kanaPractice.range === v}" data-action="kana-range" data-range="${v}">${l}</button>`).join('')}
        <button type="button" class="chip-btn" data-action="kana-shuffle">${ic('shuffle')} 다시 섞기</button>
      </div>
    </div>
    <p class="note">발음이 가려진 채 무작위로 섞여 있어요. 글자를 누르면 발음이 들리고 표기가 나타납니다. 막히는 글자는 차트에서 다시 확인하세요.</p>
    <div class="kana-grid-free">
      ${kanaPractice.items.map((c, i) => practiceCellHtml(c, i)).join('')}
    </div>`;
}

function viewKana() {
  return `
  <div class="page">
    ${hubHead('vocab', 'vocab-kana', '차트로 눈에 익힌 뒤, 랜덤 연습에서 발음을 가리고 떠올려 보세요.')}
    ${seg({ id: 'kana-mode', label: '보기 방식', action: 'kana-mode', key: 'mode', active: kanaMode, cls: 'sm kana-mode',
            items: [{ v: 'chart', label: '차트 보기' }, { v: 'practice', label: '랜덤 연습' }] })}
    ${kanaMode === 'practice' ? viewKanaPractice() : viewKanaChart()}
  </div>`;
}

function viewKanaChart() {
  return `
    <div class="stickbar">${kanaScriptSeg()}<span class="meta">청음 46 · 탁음 25 · 요음 33</span></div>

    ${KANA_SECTIONS.map(sec => `
    <div class="sec-head"><h2>${sec.title} <small class="jp">${sec.jp}</small></h2></div>
    <p class="note">${sec.intro}</p>
    <div class="kana-table">
      ${(KANA[sec.key] || []).map(row => `
      <div class="kana-row ${row.cells.length === 3 ? 'cols3' : ''}">
        <span class="kana-row-label jp">${esc(row.row)}</span>
        ${row.cells.map(kanaCellHtml).join('')}
      </div>`).join('')}
    </div>`).join('')}

    <div class="sec-head"><h2>특수음 메모 <small class="jp">特殊音</small></h2></div>
    <section class="card kana-note">
      <p><b class="jp">っ / ッ</b> <span>촉음 — 작은 つ. 받침처럼 소리를 한 박자 막습니다. <span class="jp">きって</span>[킷테], <span class="jp">ざっし</span>[잣시]</span></p>
      <p><b class="jp">ん / ン</b> <span>발음(撥音) — 뒤 소리에 따라 ㄴ·ㅁ·ㅇ 받침으로 들립니다. <span class="jp">さんぽ</span>[삼포], <span class="jp">てんき</span>[텡키]</span></p>
      <p><b class="jp">ー</b> <span>장음 — 앞 모음을 한 박자 길게. 히라가나는 모음을 겹쳐 쓰고(<span class="jp">おかあさん</span>), 카타카나는 ー를 씁니다(<span class="jp">コーヒー</span>)</span></p>
    </section>`;
}

/* ---------- 단어장(語彙) ---------- */
const WORDS = window.NIHONGO_WORDS || [];

/* 단어 암기용 평탄 색인 — 그리드(뜻 있는) 분류만 사용, 활용표 등 table형 제외 */
const WORD_LEVELS_ALL = ['기초', 'N5', 'N4', 'N3', 'N2', 'N1'];
const GRID_CATS = WORDS.filter(c => c.type !== 'table' && Array.isArray(c.items) && c.items.length);
const ALL_WORDS = [];
const WORD_INDEX = new Map();          // key -> 단어 객체
for (const c of GRID_CATS) {
  const lv = c.level || '기초';
  for (const it of c.items) {
    const w = { key: it[0] + '|' + it[1], disp: it[0], read: it[1], ko: it[2], level: lv, cat: c.title, catId: c.id };
    ALL_WORDS.push(w);
    if (!WORD_INDEX.has(w.key)) WORD_INDEX.set(w.key, w);
  }
}
const WORD_LEVELS = WORD_LEVELS_ALL.filter(lv => ALL_WORDS.some(w => w.level === lv));
const levelWordCount = lv => ALL_WORDS.reduce((n, w) => n + (w.level === lv ? 1 : 0), 0);

let wordsHideKo = false;
let wordsShowRead = false; // 발음(읽기) 기본 숨김 — 누르면 표시
let wordsLevel = '기초';   // 단어장 레벨 필터: 전체 / 기초 / N5 / N4 / N3 / N2 / N1

function wordGridItem(it) {
  const [disp, read, ko] = it;
  // 한자어는 후리가나(rt)를 기본 숨김(CSS), 가나 단독 단어는 그대로 표시
  const ruby = disp === read
    ? `<span class="jp wi-kana">${esc(disp)}</span>`
    : `<ruby class="jp">${esc(disp)}<rt>${esc(read)}</rt></ruby>`;
  return `<button type="button" class="word-item" data-action="word-say" data-ch="${esc(read)}" data-word-key="${esc(disp + '|' + read)}" title="발음 듣기">${ruby}<span class="word-ko">${esc(ko)}</span></button>`;
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
            ? `<td><button type="button" class="wt-cell jp" data-action="word-say" data-ch="${esc(cell)}" title="발음 듣기" data-read="${esc(cell)}">${esc(cell)}</button></td>`
            : '<td class="wt-empty"></td>').join('')}
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

const wordLevel = c => c.level || '기초';
const wordCount = c => c.items ? c.items.length : (c.rows ? c.rows.length : 0);
function viewWords() {
  const levels = ['전체', '기초', 'N5', 'N4', 'N3', 'N2', 'N1'];
  if (!levels.includes(wordsLevel)) wordsLevel = '기초';
  const list = WORDS.filter(c => wordsLevel === '전체' || wordLevel(c) === wordsLevel);
  const total = list.reduce((a, c) => a + wordCount(c), 0);
  return `
  <div class="page ${wordsShowRead ? '' : 'read-hidden'} ${wordsHideKo ? 'words-hide' : ''}" id="words-root">
    ${hubHead('vocab', 'vocab-words', '단어를 누르면 발음이 들려요. 발음과 뜻은 각각 가려서 암기 상태를 확인해 보세요.')}

    <div class="chips" role="group" aria-label="레벨 필터">
      ${levels.map(f => `<button type="button" class="chip-btn ${wordsLevel === f ? 'active' : ''}" aria-pressed="${wordsLevel === f}" data-action="words-level" data-level="${f}">${f}</button>`).join('')}
    </div>

    <label class="field sm words-jump"><select data-action="words-jump-select" aria-label="단어 분류 바로가기">
      <option value="">분류 바로가기…</option>
      ${list.map(c => `<option value="${esc(c.id)}">${esc(c.title)} · ${wordCount(c)}개</option>`).join('')}
    </select></label>
    <div class="stickbar words-bar">
      <div class="toggles">
        <button type="button" class="chip-btn" data-action="words-read" aria-pressed="${!wordsShowRead}">${ic('eye-off')} 발음 가리기</button>
        <button type="button" class="chip-btn" data-action="words-hide" aria-pressed="${wordsHideKo}">${ic('eye-off')} 뜻 가리기</button>
      </div>
    </div>
    <p class="list-meta">${list.length}분류 · ${total}단어</p>

    ${list.map(cat => `
    <section class="word-sec" id="words-sec-${cat.id}">
      <div class="sec-head"><h2>${esc(cat.title)}${cat.jp ? ` <small class="jp">${esc(cat.jp)}</small>` : ''}${wordLevel(cat) !== '기초' ? ` ${lvChip(wordLevel(cat))}` : ''}</h2></div>
      ${cat.note ? `<p class="note">${esc(cat.note)}</p>` : ''}
      ${cat.type === 'table' ? wordTable(cat) : `<div class="word-grid">${cat.items.map(wordGridItem).join('')}</div>`}
    </section>`).join('')}
  </div>`;
}

/* ---------- 연습: 설정 화면 공용 조각 ---------- */
// 하단에 떠 있는 '시작' 바 — 선택 요약을 보여 주고 어느 스크롤 위치에서든 바로 시작할 수 있다
function startBar(summary, label, action, extra = '') {
  return `
  <div class="start-bar" role="region" aria-label="시작">
    <div class="sb-copy"><small>선택한 구성</small><b>${esc(summary)}</b></div>
    ${extra}
    <button type="button" class="btn btn-primary btn-lg" data-action="${action}">${label} ${ic('arrow-right')}</button>
  </div>`;
}

// 선택 카드(범위 선택 등) — 2열 컴팩트 그리드
function optCard({ action, attr, title, sub, count, active, disabled, icon }) {
  return `
  <button type="button" class="opt ${active ? 'active' : ''}" data-action="${action}" ${attr} aria-pressed="${!!active}" ${disabled ? 'disabled' : ''}>
    <span class="opt-ico">${icon ? ic(icon) : ''}</span>
    <span class="opt-copy"><b>${title}</b><small>${sub}</small></span>
    ${count != null ? `<span class="opt-count">${count}</span>` : ''}
    <span class="opt-check">${ic('check')}</span>
  </button>`;
}

const kindSeg = (active, action) => seg({ id: 'kind-' + action, label: '대상 선택', action, key: 'kind', active, cls: 'kind-seg',
  items: [{ v: 'sentence', label: '문장', icon: 'lines' }, { v: 'word', label: '단어', icon: 'vocab' }] });

const dirSeg = active => seg({ id: 'quiz-dir', label: '출제 방향', action: 'q-dir', key: 'dir', active,
  items: [{ v: 'jp2ko', html: '<span class="jp">日本語</span> → 한국어' }, { v: 'ko2jp', html: '한국어 → <span class="jp">日本語</span>' }] });

/* ---------- 뷰: 암기 설정 ---------- */
let quizSetup = { kind: 'sentence', src: 'random', ch: 1, dir: 'jp2ko', shuffle: true,
                  wsrc: 'random', wlevel: 'N5', wcat: '' };  // wlevel/wcat은 setup 렌더 시 보정
let quizSession = null;

function poolFor(src, ch) {
  if (src === 'chapter') { const c = chapterOf(ch); return SENTENCES.slice(c.start - 1, c.end).map(s => s.n); }
  if (src === 'book') return bookmarkList();
  if (src === 'weak') return weakList();
  return shuffle(SENTENCES.map(s => s.n)).slice(0, 20); // random
}

function viewQuizSetup() {
  const k = quizSetup.kind === 'word' ? 'word' : 'sentence';
  return `
  <div class="page">
    ${hubHead('practice', 'practice-quiz', k === 'word'
      ? '카드를 뒤집어 단어의 읽기·뜻을 확인하고 스스로 채점해요. 모르는 단어는 복습함에 모여요.'
      : '카드를 뒤집어 답을 확인하고 스스로 채점해요. 모르는 문장은 복습함에 모여요.')}
    ${kindSeg(k, 'q-kind')}
    ${k === 'word' ? quizSetupWordBody() : quizSetupSentenceBody()}
  </div>`;
}

function quizSetupSentenceBody() {
  const bookN = bookmarkList().length, weakN = weakList().length, q = quizSetup;
  const srcLabel = { random: '랜덤 20문장', chapter: `${pad2(q.ch)}과 20문장`, weak: `복습 대기 ${weakN}문장`, book: `북마크 ${bookN}문장` }[q.src];
  const o = (key, title, sub, count, disabled, icon) => optCard({ action: 'q-src', attr: `data-src="${key}"`, title, sub, count, disabled, icon, active: q.src === key });
  return `
    <h2 class="group-h">범위</h2>
    <div class="opt-grid">
      ${o('random', '랜덤 20', `전체 ${TOTAL}문장에서`, null, false, 'shuffle')}
      ${o('chapter', '과 선택', '한 과의 20문장', null, false, 'list')}
      ${o('weak', '복습 대기', '틀렸던 문장만', weakN, weakN === 0, 'refresh')}
      ${o('book', '북마크', '북마크한 문장만', bookN, bookN === 0, 'bookmark')}
    </div>
    ${q.src === 'chapter' ? `
    <label class="field"><span class="field-label">과 선택</span>
      <select data-action="q-ch" aria-label="암기할 과">
        ${CHAPTERS.map(c => { const p = chapterProgress(c); return `<option value="${c.id}" ${q.ch === c.id ? 'selected' : ''}>${pad2(c.id)}. ${esc(c.title)} (${c.level}) — ${p.done}/${p.total}</option>`; }).join('')}
      </select>
    </label>` : ''}

    <h2 class="group-h">출제 방향</h2>
    ${dirSeg(q.dir)}
    <p class="hint-line">${q.dir === 'jp2ko' ? '일본어를 보고 뜻을 떠올려요 (읽기 중심)' : '뜻을 보고 일본어로 말해 봐요 (작문 중심)'}</p>

    ${startBar(`${srcLabel} · ${q.dir === 'jp2ko' ? '日→韓' : '韓→日'}`, '시작하기', 'q-start')}
    <p class="kbd-hint">카드 탭 = 뒤집기 · 좌우로 밀어 채점 · <kbd>O</kbd> 알아요 <kbd>X</kbd> 몰라요</p>`;
}

function quizSetupWordBody() {
  const q = quizSetup;
  const weakN = Object.keys(S.wordWeak).length;
  const learnedN = Object.keys(S.wordLearned).length;
  if (!q.wcat) q.wcat = GRID_CATS[0] ? GRID_CATS[0].id : '';
  if (!WORD_LEVELS.includes(q.wlevel)) q.wlevel = WORD_LEVELS[0] || 'N5';
  const catTitle = (GRID_CATS.find(c => c.id === q.wcat) || {}).title || '';
  const srcLabel = { random: '랜덤 20단어', level: `${q.wlevel} 20단어`, cat: catTitle, weak: `복습 대기 ${weakN}단어` }[q.wsrc];
  const o = (key, title, sub, count, disabled, icon) => optCard({ action: 'qw-src', attr: `data-src="${key}"`, title, sub, count, disabled, icon, active: q.wsrc === key });
  return `
    <h2 class="group-h">범위</h2>
    <div class="opt-grid">
      ${o('random', '랜덤 20', `전체 ${ALL_WORDS.length}단어에서`, null, false, 'shuffle')}
      ${o('level', '레벨 선택', '레벨에서 20단어', null, false, 'filter')}
      ${o('cat', '분류 선택', '분류 전체로', null, false, 'list')}
      ${o('weak', '복습 대기', '틀렸던 단어만', weakN, weakN === 0, 'refresh')}
    </div>
    ${q.wsrc === 'level' ? `
    <label class="field"><span class="field-label">레벨</span>
      <select data-action="qw-level" aria-label="레벨 선택">
        ${WORD_LEVELS.map(lv => `<option value="${lv}" ${q.wlevel === lv ? 'selected' : ''}>${lv} — ${levelWordCount(lv)}단어</option>`).join('')}
      </select></label>` : ''}
    ${q.wsrc === 'cat' ? `
    <label class="field"><span class="field-label">분류</span>
      <select data-action="qw-cat" aria-label="분류 선택">
        ${WORD_LEVELS.map(lv => {
          const cats = GRID_CATS.filter(c => (c.level || '기초') === lv);
          return cats.length ? `<optgroup label="${lv}">${cats.map(c => `<option value="${esc(c.id)}" ${q.wcat === c.id ? 'selected' : ''}>${esc(c.title)} (${c.items.length})</option>`).join('')}</optgroup>` : '';
        }).join('')}
      </select></label>` : ''}

    <h2 class="group-h">출제 방향</h2>
    ${dirSeg(q.dir)}
    <p class="hint-line">${q.dir === 'jp2ko' ? '단어를 보고 읽기·뜻을 떠올려요' : '뜻을 보고 단어를 떠올려요'}</p>

    ${startBar(`${srcLabel} · ${q.dir === 'jp2ko' ? '日→韓' : '韓→日'}`, '시작하기', 'q-start')}
    <p class="kbd-hint">익힌 단어 ${learnedN}개 · 카드 탭 = 뒤집기 · 좌우로 밀어 채점</p>`;
}

/* ---------- 뷰: 암기 실행 ---------- */
function startQuiz() {
  if (quizSetup.kind === 'word') return startWordQuiz();
  let pool = poolFor(quizSetup.src, quizSetup.ch);
  if (!pool.length) { toast('출제할 문장이 없어요', 'info'); return; }
  if (quizSetup.shuffle && quizSetup.src !== 'random') pool = shuffle(pool);
  if (pool.length > 50) pool = pool.slice(0, 50); // 한 세션 상한
  quizSession = { kind: 'sentence', items: pool, idx: 0, dir: quizSetup.dir, flipped: false, wrong: [], right: 0 };
  if (location.hash === '#/quiz/run') render({ anim: true });
  else location.hash = '#/quiz/run';
}

function wordPool() {
  const q = quizSetup;
  if (q.wsrc === 'cat') {
    const c = GRID_CATS.find(x => x.id === q.wcat) || GRID_CATS[0];
    if (!c) return [];
    return shuffle(c.items.map(it => WORD_INDEX.get(it[0] + '|' + it[1])
      || { key: it[0] + '|' + it[1], disp: it[0], read: it[1], ko: it[2], level: c.level || '기초', cat: c.title }));
  }
  if (q.wsrc === 'level') return shuffle(ALL_WORDS.filter(w => w.level === q.wlevel)).slice(0, 20);
  if (q.wsrc === 'weak') return Object.keys(S.wordWeak).map(k => WORD_INDEX.get(k)).filter(Boolean);
  return shuffle(ALL_WORDS).slice(0, 20); // random
}

function startWordQuiz() {
  let pool = wordPool();
  if (!pool.length) { toast('출제할 단어가 없어요', 'info'); return; }
  if (pool.length > 50) pool = pool.slice(0, 50); // 한 세션 상한
  quizSession = { kind: 'word', items: pool, idx: 0, dir: quizSetup.dir, flipped: false, wrong: [], right: 0 };
  if (location.hash === '#/quiz/run') render({ anim: true });
  else location.hash = '#/quiz/run';
}

function quizTop(qs) {
  const pct = qs.idx / qs.items.length * 100;
  return `
    <div class="run-top">
      <button type="button" class="icon-btn" data-action="q-exit" aria-label="그만두기" title="그만두기">${ic('close')}</button>
      <div class="bar" role="progressbar" aria-label="진행" aria-valuemin="0" aria-valuemax="${qs.items.length}" aria-valuenow="${qs.idx}"><i style="width:${pct}%"></i></div>
      <span class="run-count">${qs.idx + 1} / ${qs.items.length}</span>
    </div>`;
}

// 카드 하단: 알아요/몰라요 버튼 + 스와이프·키보드 안내
function quizActions(qs) {
  return `
    <div class="quiz-actions ${qs.flipped ? 'show' : ''}">
      <button type="button" class="btn btn-no btn-lg" data-action="q-no">${ic('close')} 몰라요</button>
      <button type="button" class="btn btn-ok btn-lg" data-action="q-ok">${ic('check')} 알아요</button>
    </div>
    <p class="kbd-hint run"><span class="touch-only">카드를 탭해 뒤집고, 좌우로 밀어 채점해요</span><span class="fine-only"><kbd>Space</kbd> 뒤집기 · <kbd>←</kbd>/<kbd>X</kbd> 몰라요 · <kbd>→</kbd>/<kbd>O</kbd> 알아요</span></p>`;
}

function viewQuizRun() {
  const qs = quizSession;
  if (!qs) { location.hash = '#/quiz'; return ''; }
  if (qs.idx >= qs.items.length) return viewQuizResult();
  if (qs.kind === 'word') return viewWordQuizRun(qs);

  const s = sentence(qs.items[qs.idx]);
  const jpFront = qs.dir === 'jp2ko';
  const frontMain = jpFront ? `<div class="q-main jp">${esc(s.jp)}</div>` : `<div class="q-main ko-main">${esc(s.ko)}</div>`;

  return `
  <div class="page narrow quiz-run">
    ${quizTop(qs)}
    <div class="flip-scene" id="flip-scene">
      <div class="swipe-hint no" aria-hidden="true">${ic('close')}<span>몰라요</span></div>
      <div class="swipe-hint ok" aria-hidden="true">${ic('check')}<span>알아요</span></div>
      <div class="flip-card ${qs.flipped ? 'flipped' : ''}" data-action="q-flip" id="flip-card" role="button" tabindex="0" aria-label="카드 뒤집기">
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
          <button type="button" class="s-btn" data-action="speak" data-n="${s.n}">${ic('volume')}<span>듣기</span></button>
        </div>
      </div>
    </div>
    ${quizActions(qs)}
  </div>`;
}

function viewWordQuizRun(qs) {
  const w = qs.items[qs.idx];
  const jpFront = qs.dir === 'jp2ko';
  const hasRead = w.disp !== w.read;
  const frontMain = jpFront ? `<div class="q-main jp wq-word">${esc(w.disp)}</div>` : `<div class="q-main ko-main">${esc(w.ko)}</div>`;

  return `
  <div class="page narrow quiz-run">
    ${quizTop(qs)}
    <div class="flip-scene" id="flip-scene">
      <div class="swipe-hint no" aria-hidden="true">${ic('close')}<span>몰라요</span></div>
      <div class="swipe-hint ok" aria-hidden="true">${ic('check')}<span>알아요</span></div>
      <div class="flip-card ${qs.flipped ? 'flipped' : ''}" data-action="q-flip" id="flip-card" role="button" tabindex="0" aria-label="카드 뒤집기">
        <div class="flip-face front">
          <span class="q-label">${jpFront ? '日 → 韓' : '韓 → 日'}</span>
          ${frontMain}
          <span class="tap-hint">카드를 누르면 읽기·뜻이 보여요</span>
        </div>
        <div class="flip-face back">
          ${w.level ? `<span class="q-pt">${lvChip(w.level)}</span>` : ''}
          <div class="q-main jp wq-word">${esc(w.disp)}</div>
          ${hasRead ? `<div class="q-read jp">${esc(w.read)}</div>` : ''}
          <div class="q-sub">${esc(w.ko)}</div>
          <button type="button" class="s-btn" data-action="say" data-ch="${esc(w.read)}">${ic('volume')}<span>듣기</span></button>
        </div>
      </div>
    </div>
    ${quizActions(qs)}
  </div>`;
}

function viewQuizResult() {
  const qs = quizSession;
  const isWord = qs.kind === 'word';
  const unit = isWord ? '단어' : '문장';
  const total = qs.items.length;
  const right = qs.right;
  const pct = total ? right / total : 0;
  const cheer = pct === 1 ? '完璧！ 완벽해요' : pct >= 0.8 ? 'よくできました — 잘했어요' : pct >= 0.5 ? 'もう一歩 — 조금만 더' : '大丈夫、반복이 답이에요';
  const wrongN = qs.wrong.length;
  const wrongList = isWord
    ? qs.wrong.map(w => `
        <li class="wrong-item">
          ${w.level ? lvChip(w.level) : ''}
          <div class="jp w-jp">${esc(w.disp)}${w.disp !== w.read ? ` <small>（${esc(w.read)}）</small>` : ''}</div>
          <div class="w-ko">${esc(w.ko)}</div>
        </li>`).join('')
    : qs.wrong.map(sentence).map(s => `
        <li class="wrong-item">
          <div class="w-top"><span class="s-num jp">${pad4(s.n)}</span>${ptChip(s.pt)}</div>
          <div class="jp w-jp">${esc(s.jp)}</div>
          <div class="w-ko">${esc(s.ko)}</div>
        </li>`).join('');

  return `
  <div class="page narrow quiz-run">
    <section class="card quiz-result spot">
      ${ring({ pct, size: 132, stroke: 11, done: pct === 1, label: Math.round(pct * 100) + '%', sub: '정답률' })}
      <h2>${cheer}</h2>
      <p class="sub">${total}${unit} 중 <b>${right}${unit}</b>${isWord ? '를' : '을'} 알고 있었어요${wrongN ? ` · ${wrongN}${unit}${isWord ? '는' : '은'} 복습함에 담았어요` : ''}</p>
      <div class="result-actions">
        ${wrongN ? `<button type="button" class="btn btn-primary" data-action="q-retry-wrong">${ic('refresh')} 틀린 ${wrongN}${unit} 다시</button>` : ''}
        <button type="button" class="btn btn-tonal" data-action="q-retry-same">${ic('shuffle')} 한 번 더</button>
        <a class="btn btn-ghost" href="#/quiz">설정으로</a>
      </div>
      ${wrongN ? `<ul class="wrong-list">${wrongList}</ul>` : ''}
    </section>
  </div>`;
}

function answerQuiz(ok) {
  const qs = quizSession;
  if (!qs || !qs.flipped) return;
  haptic(ok ? 12 : [10, 40, 10]);
  if (qs.kind === 'word') {
    const w = qs.items[qs.idx];
    if (ok) { qs.right++; S.wordLearned[w.key] = 1; delete S.wordWeak[w.key]; }
    else { qs.wrong.push(w); S.wordWeak[w.key] = (S.wordWeak[w.key] || 0) + 1; }
    touchActivity();        // 연속 학습일 유지 (문장 통계는 건드리지 않음)
    qs.idx++;
    qs.flipped = false;
    render({ anim: true });
    return;
  }
  const n = qs.items[qs.idx];
  if (ok) {
    qs.right++;
    P.learned[n] = 1;
    delete P.weak[n];
  } else {
    qs.wrong.push(n);
    P.weak[n] = (P.weak[n] || 0) + 1;
  }
  touchActivity(n);
  qs.idx++;
  qs.flipped = false;
  render({ anim: true });
}

function flipQuizCard() {
  const qs = quizSession;
  if (!qs || qs.flipped || qs.idx >= qs.items.length) return;
  qs.flipped = true;
  haptic(6);
  const card = $('#flip-card'); if (card) card.classList.add('flipped');
  const acts = $('.quiz-actions'); if (acts) acts.classList.add('show');
}

/* 스와이프 채점 — 카드를 뒤집은 뒤 좌(몰라요)·우(알아요)로 밀어서 채점 */
function initSwipeGrading() {
  let st = null;
  const THRESH = 96;
  const reset = (scene, animate) => {
    scene.style.transition = animate ? 'transform .55s var(--spring-snappy)' : 'none';
    scene.style.transform = ''; scene.style.setProperty('--sw', 0);
  };
  document.addEventListener('pointerdown', e => {
    const scene = e.target.closest('#flip-scene');
    if (!scene || !quizSession || !quizSession.flipped || e.target.closest('button, a, select')) return;
    st = { scene, x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, moved: false, t: performance.now(), locked: false };
  });
  document.addEventListener('pointermove', e => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.locked) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { st = null; return; }   // 세로 스크롤은 그대로 둔다
      if (Math.abs(dx) > 8) { st.locked = true; st.scene.setPointerCapture && st.scene.setPointerCapture(e.pointerId); st.scene.classList.add('dragging'); }
      else return;
    }
    st.moved = true; st.dx = dx;
    const p = Math.max(-1, Math.min(1, dx / THRESH));
    st.scene.style.transition = 'none';
    st.scene.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
    st.scene.style.setProperty('--sw', p);
  });
  const end = e => {
    if (!st || e.pointerId !== st.id) return;
    const { scene, dx, moved, t } = st; st = null;
    scene.classList.remove('dragging');
    if (!moved) return;
    const v = Math.abs(dx) / Math.max(1, performance.now() - t);             // px/ms
    if (Math.abs(dx) > THRESH || (Math.abs(dx) > 40 && v > 0.6)) {
      const ok = dx > 0;
      scene.style.transition = 'transform .28s var(--ease-in-out), opacity .28s';
      scene.style.transform = `translateX(${ok ? 140 : -140}%) rotate(${ok ? 18 : -18}deg)`;
      scene.style.opacity = '0';
      setTimeout(() => answerQuiz(ok), 200);
    } else reset(scene, true);
    swallowClick = true; setTimeout(() => { swallowClick = false; }, 60);
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
}
let swallowClick = false;

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

function autoWordPool() {
  const a = S.settings.auto;
  if (a.wsrc === 'cat') {
    const c = GRID_CATS.find(x => x.id === a.wcat) || GRID_CATS[0];
    if (!c) return [];
    return c.items.map(it => WORD_INDEX.get(it[0] + '|' + it[1])
      || { key: it[0] + '|' + it[1], disp: it[0], read: it[1], ko: it[2], level: c.level || '기초', cat: c.title });
  }
  if (a.wsrc === 'level') return ALL_WORDS.filter(w => w.level === a.wlevel);
  if (a.wsrc === 'weak') return Object.keys(S.wordWeak).map(k => WORD_INDEX.get(k)).filter(Boolean);
  return shuffle(ALL_WORDS).slice(0, 30); // random
}

function viewAutoSetup() {
  const a = S.settings.auto;
  const k = a.kind === 'word' ? 'word' : 'sentence';
  const sg = (key, label, opts) => seg({ id: 'auto-' + key, label, action: 'auto-set', key: 'val', attrs: `data-key="${key}"`, active: String(a[key]), cls: 'sm',
    items: opts.map(([v, l]) => ({ v: String(v), label: l })) });
  const weakW = Object.keys(S.wordWeak).length;
  let srcLabel;
  if (k === 'word') srcLabel = { random: '랜덤 30단어', level: `${a.wlevel} 전체`, cat: ((GRID_CATS.find(c => c.id === a.wcat) || {}).title || '분류'), weak: `복습 대기 ${weakW}단어` }[a.wsrc];
  else srcLabel = { chapter: `${pad2(a.ch)}과`, all: `전체 ${TOTAL}문장`, book: `북마크 ${bookmarkList().length}문장`, weak: `복습 대기 ${weakList().length}문장` }[a.src];
  const rateL = { 0.7: '느리게', 0.9: '보통', 1.1: '빠르게' }[a.rate] || '보통';

  return `
  <div class="page">
    ${hubHead('practice', 'practice-auto', `손대지 않아도 카드가 저절로 넘어가며 ${k === 'word' ? '단어의 읽기와 뜻을' : '일본어와 한국어를'} 차례로 읽어 줘요. 출퇴근·설거지·잠들기 전에 좋아요.`)}
    ${kindSeg(k, 'auto-kind')}

    ${k === 'word' ? autoSetupWordBody() : autoSetupSentenceBody()}

    <h2 class="group-h">재생 옵션</h2>
    <div class="opt-form">
      <div class="of-row"><span>${k === 'word' ? '뜻 음성' : '한국어 음성'}</span>${sg('readKo', '한국어 음성', [[true, k === 'word' ? '일본어+뜻' : '일본어+한국어'], [false, '일본어만']])}</div>
      <div class="of-row"><span>${k === 'word' ? '읽기 반복' : '일본어 반복'}</span>${sg('repeat', '반복 횟수', [[1, '1회'], [2, '2회'], [3, '3회']])}</div>
      <div class="of-row"><span>재생 속도</span>${sg('rate', '재생 속도', [[0.7, '느리게'], [0.9, '보통'], [1.1, '빠르게']])}</div>
      <div class="of-row"><span>${k === 'word' ? '단어 간격' : '문장 간격'}</span>${sg('gap', '간격', [[400, '짧게'], [900, '보통'], [1600, '길게']])}</div>
      <div class="of-row"><span>반복 재생</span>${sg('loop', '반복 재생', [[false, '끄기'], [true, '켜기']])}</div>
    </div>

    ${startBar(`${srcLabel} · ${rateL}${a.loop ? ' · 반복' : ''}`, '재생 시작', 'auto-start')}
    <p class="kbd-hint">${hasTTS ? '<kbd>Space</kbd> 재생/정지 · <kbd>←</kbd>/<kbd>→</kbd> 이동' : '이 브라우저는 음성 재생을 지원하지 않아요'}</p>
  </div>`;
}

function autoSetupSentenceBody() {
  const a = S.settings.auto;
  const bookN = bookmarkList().length, weakN = weakList().length;
  const o = (key, title, sub, count, disabled, icon) => optCard({ action: 'auto-src', attr: `data-src="${key}"`, title, sub, count, disabled, icon, active: a.src === key });
  return `
    <h2 class="group-h">재생 범위</h2>
    <div class="opt-grid">
      ${o('chapter', '한 과', '20문장을 순서대로', null, false, 'list')}
      ${o('all', `전체 ${TOTAL}`, '1과부터 끝까지', null, false, 'lines')}
      ${o('book', '북마크', '북마크한 문장', bookN, bookN === 0, 'bookmark')}
      ${o('weak', '복습 대기', '틀렸던 문장', weakN, weakN === 0, 'refresh')}
    </div>
    ${a.src === 'chapter' ? `
    <label class="field"><span class="field-label">과 선택</span>
      <select data-action="auto-ch" aria-label="재생할 과">
        ${CHAPTERS.map(c => `<option value="${c.id}" ${a.ch === c.id ? 'selected' : ''}>${pad2(c.id)}. ${esc(c.title)} (${c.level})</option>`).join('')}
      </select></label>` : ''}`;
}

function autoSetupWordBody() {
  const a = S.settings.auto;
  const weakN = Object.keys(S.wordWeak).length;
  if (!a.wcat) a.wcat = GRID_CATS[0] ? GRID_CATS[0].id : '';
  if (!WORD_LEVELS.includes(a.wlevel)) a.wlevel = WORD_LEVELS[0] || 'N5';
  const o = (key, title, sub, count, disabled, icon) => optCard({ action: 'auto-wsrc', attr: `data-src="${key}"`, title, sub, count, disabled, icon, active: a.wsrc === key });
  return `
    <h2 class="group-h">재생 범위</h2>
    <div class="opt-grid">
      ${o('random', '랜덤 30', `전체 ${ALL_WORDS.length}단어에서`, null, false, 'shuffle')}
      ${o('level', '레벨 전체', '레벨의 단어를 순서대로', null, false, 'filter')}
      ${o('cat', '분류 선택', '분류 전체를 순서대로', null, false, 'list')}
      ${o('weak', '복습 대기', '틀렸던 단어만', weakN, weakN === 0, 'refresh')}
    </div>
    ${a.wsrc === 'level' ? `
    <label class="field"><span class="field-label">레벨</span>
      <select data-action="auto-wlevel" aria-label="레벨 선택">
        ${WORD_LEVELS.map(lv => `<option value="${lv}" ${a.wlevel === lv ? 'selected' : ''}>${lv} — ${levelWordCount(lv)}단어</option>`).join('')}
      </select></label>` : ''}
    ${a.wsrc === 'cat' ? `
    <label class="field"><span class="field-label">분류</span>
      <select data-action="auto-wcat" aria-label="분류 선택">
        ${WORD_LEVELS.map(lv => {
          const cats = GRID_CATS.filter(c => (c.level || '기초') === lv);
          return cats.length ? `<optgroup label="${lv}">${cats.map(c => `<option value="${esc(c.id)}" ${a.wcat === c.id ? 'selected' : ''}>${esc(c.title)} (${c.items.length})</option>`).join('')}</optgroup>` : '';
        }).join('')}
      </select></label>` : ''}`;
}

function autoCardBody(s) {
  const ch = chapterOf(s.ch);
  return `
    <div class="auto-card-top">
      <span class="s-num jp">${pad4(s.n)}</span>${lvChip(ch.level)}${ptChip(s.pt)}
    </div>
    <p class="auto-jp jp" id="auto-jp">${esc(s.jp)}</p>
    <p class="auto-ko" id="auto-ko">${esc(s.ko)}</p>
    <span class="auto-chapter">${pad2(ch.id)}. ${mixJp(ch.title)}</span>`;
}

function autoWordCardBody(w) {
  return `
    <div class="auto-card-top">
      ${w.level ? lvChip(w.level) : ''}
      <span class="auto-chapter">${esc(w.cat || '')}</span>
    </div>
    <p class="auto-jp jp auto-word" id="auto-jp">${esc(w.disp)}</p>
    ${w.disp !== w.read ? `<p class="auto-read jp" id="auto-read">${esc(w.read)}</p>` : ''}
    <p class="auto-ko" id="auto-ko">${esc(w.ko)}</p>`;
}

// 현재 자동 재생 항목의 카드 본문(문장/단어 공용)
function autoBody(A) {
  return A.kind === 'word' ? autoWordCardBody(A.items[A.idx]) : autoCardBody(sentence(A.items[A.idx]));
}

const eqBars = '<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>';

function viewAutoRun() {
  const A = autoPlayer;
  return `
  <div class="page narrow auto-run">
    <div class="run-top">
      <button type="button" class="icon-btn" data-action="auto-exit" aria-label="닫기" title="닫기">${ic('close')}</button>
      <div class="bar" role="progressbar" aria-label="진행"><i id="auto-bar" style="width:0%"></i></div>
      <span class="run-count" id="auto-count">1 / ${A.items.length}</span>
    </div>

    <section class="card auto-card spot" id="auto-card">
      ${eqBars}
      <div id="auto-card-body">${autoBody(A)}</div>
    </section>

    <div class="auto-controls">
      <button type="button" class="auto-ctrl" data-action="auto-prev" aria-label="이전">${ic('prev')}</button>
      <button type="button" class="auto-ctrl auto-main" id="auto-play-btn" data-action="auto-toggle" aria-label="재생/정지">${ic('play')}</button>
      <button type="button" class="auto-ctrl" data-action="auto-next" aria-label="다음">${ic('next')}</button>
    </div>

    <div class="auto-live">
      <button type="button" class="chip-btn" id="auto-rate-btn" data-action="auto-live" data-key="rate">${A.rate}×</button>
      <button type="button" class="chip-btn ${A.readKo ? 'active' : ''}" id="auto-ko-btn" data-action="auto-live" data-key="readKo" aria-pressed="${A.readKo}">${A.kind === 'word' ? '뜻 음성' : '한국어 음성'}</button>
      <button type="button" class="chip-btn ${A.loop ? 'active' : ''}" id="auto-loop-btn" data-action="auto-live" data-key="loop" aria-pressed="${A.loop}">반복</button>
    </div>
    <p class="kbd-hint run"><span class="touch-only">버튼으로 재생·정지·이전·다음을 조작해요</span><span class="fine-only"><kbd>Space</kbd> 재생/정지 · <kbd>←</kbd> 이전 · <kbd>→</kbd> 다음</span></p>
  </div>`;
}

function setAutoSpeaking(which) {
  const jp = $('#auto-jp'), ko = $('#auto-ko'), card = $('#auto-card');
  if (jp) jp.classList.toggle('now', which === 'jp');
  if (ko) ko.classList.toggle('now', which === 'ko');
  if (card) card.classList.toggle('speaking', !!which);
}

function updateAutoControls() {
  const A = autoPlayer; if (!A) return;
  const rb = $('#auto-rate-btn'); if (rb) rb.textContent = A.rate + '×';
  const kb = $('#auto-ko-btn'); if (kb) { kb.classList.toggle('active', A.readKo); kb.setAttribute('aria-pressed', A.readKo); }
  const lb = $('#auto-loop-btn'); if (lb) { lb.classList.toggle('active', A.loop); lb.setAttribute('aria-pressed', A.loop); }
}

function updateAutoUI() {
  const A = autoPlayer; if (!A) return;
  const body = $('#auto-card-body'); if (body) body.innerHTML = autoBody(A);
  const bar = $('#auto-bar'); if (bar) bar.style.width = ((A.idx + (A.finished ? 1 : 0)) / A.items.length * 100) + '%';
  const cnt = $('#auto-count'); if (cnt) cnt.textContent = A.finished ? `${A.items.length} / ${A.items.length} · 완료` : `${A.idx + 1} / ${A.items.length}`;
  const pb = $('#auto-play-btn'); if (pb) pb.innerHTML = A.finished ? ic('replay') : (A.playing ? ic('pause') : ic('play'));
  const card = $('#auto-card'); if (card) card.classList.toggle('playing', !!A.playing);
  updateAutoControls();
}

async function autoRun() {
  const A = autoPlayer; if (!A) return;
  const myToken = ++autoToken;
  A.playing = true; A.finished = false;
  updateAutoUI();
  const alive = () => A === autoPlayer && A.playing && myToken === autoToken;
  const isWord = A.kind === 'word';
  while (alive() && A.idx < A.items.length) {
    const item = A.items[A.idx];
    const jpText = isWord ? item.read : sentence(item).jp;
    const koText = isWord ? item.ko : sentence(item).ko;
    for (let r = 0; r < A.repeat; r++) {
      if (!alive()) return;
      setAutoSpeaking('jp');
      await speakAsync(jpText, 'ja-JP', A.rate);
      if (!alive()) return;
      if (r < A.repeat - 1) await sleep(260);
    }
    if (A.readKo) {
      if (!alive()) return;
      await sleep(300);
      if (!alive()) return;
      setAutoSpeaking('ko');
      await speakAsync(koText, 'ko-KR', A.rate);
    }
    if (!alive()) return;
    setAutoSpeaking(null);
    if (isWord) { if (!S.wordLearned[item.key]) S.wordLearned[item.key] = 1; touchActivity(); }
    else { if (!P.learned[item]) P.learned[item] = 1; touchActivity(item); }
    save();
    await sleep(A.gap);
    if (!alive()) return;
    if (A.idx + 1 >= A.items.length) {
      if (A.loop) { A.idx = 0; updateAutoUI(); }
      else { A.playing = false; A.finished = true; updateAutoUI(); toast('자동 듣기를 마쳤어요', 'check'); return; }
    } else {
      A.idx++; updateAutoUI();
    }
  }
}

function autoToggle() {
  const A = autoPlayer; if (!A) return;
  if (!hasTTS) { toast('이 브라우저는 음성 재생을 지원하지 않아요', 'info'); return; }
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
  const isWord = cfg.kind === 'word';
  const items = isWord ? autoWordPool() : autoPool(cfg.src, cfg.ch);
  if (!items.length) { toast(isWord ? '재생할 단어가 없어요' : '재생할 문장이 없어요', 'info'); return; }
  autoPlayer = {
    kind: isWord ? 'word' : 'sentence',
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

/* ---------- 뷰: 복습함 (복습 대기 · 북마크 목록) ---------- */
let reviewTab = 'weak';   // weak(복습 대기 문장) | book(북마크 문장) | words(복습 대기 단어)

function viewReview() {
  const weak = weakList(), book = bookmarkList();
  const wordsWeak = Object.keys(S.wordWeak).map(k => WORD_INDEX.get(k)).filter(Boolean);
  if (!['weak', 'book', 'words'].includes(reviewTab)) reviewTab = 'weak';
  const tabs = [['weak', '복습 대기', weak.length, 'refresh'], ['book', '북마크', book.length, 'bookmark'], ['words', '단어', wordsWeak.length, 'vocab']];
  const items = reviewTab === 'weak' ? weak : reviewTab === 'book' ? book : wordsWeak;
  const isWord = reviewTab === 'words';

  const sentenceItem = n => {
    const s = sentence(n); if (!s) return '';
    return `
    <li class="rv-item spot" data-n="${n}">
      <div class="rv-body" data-action="speak" data-n="${n}" title="눌러서 발음 듣기">
        <div class="rv-top"><span class="s-num jp">${pad4(n)}</span>${ptChip(s.pt)}</div>
        <p class="jp rv-jp">${esc(s.jp)}</p>
        <p class="rv-ko">${esc(s.ko)}</p>
      </div>
      <div class="rv-actions">
        <a class="icon-btn" href="#/study/${s.ch}?focus=${n}" aria-label="본문에서 보기" title="본문에서 보기">${ic('arrow-right')}</a>
        ${reviewTab === 'weak'
          ? `<button type="button" class="icon-btn" data-action="rv-clear" data-n="${n}" aria-label="복습 대기에서 빼기" title="복습 대기에서 빼기">${ic('check')}</button>`
          : `<button type="button" class="icon-btn on" data-action="rv-unbook" data-n="${n}" aria-label="북마크 해제" title="북마크 해제">${ic('bookmark', 'fill')}</button>`}
      </div>
    </li>`;
  };
  const wordItem = w => `
    <li class="rv-item spot">
      <div class="rv-body" data-action="say" data-ch="${esc(w.read)}" title="눌러서 발음 듣기">
        <div class="rv-top">${lvChip(w.level)}<span class="rv-cat">${esc(w.cat)}</span></div>
        <p class="jp rv-jp">${esc(w.disp)}${w.disp !== w.read ? `<small class="jp"> （${esc(w.read)}）</small>` : ''}</p>
        <p class="rv-ko">${esc(w.ko)}</p>
      </div>
      <div class="rv-actions">
        <button type="button" class="icon-btn" data-action="rv-clear-word" data-key="${esc(w.key)}" aria-label="복습 대기에서 빼기" title="복습 대기에서 빼기">${ic('check')}</button>
      </div>
    </li>`;

  const emptyMsg = {
    weak: ['암기에서 틀린 문장이 여기에 모여요', '아직 복습 대기 문장이 없어요. 암기 카드에서 “몰라요”를 누르면 자동으로 담겨요.'],
    book: ['북마크한 문장이 여기에 모여요', '학습 화면에서 문장의 북마크 버튼을 눌러 보세요.'],
    words: ['암기에서 틀린 단어가 여기에 모여요', '아직 복습 대기 단어가 없어요.'],
  }[reviewTab];

  return `
  <div class="page">
    ${hubHead('practice', 'practice-review', '틀렸거나 북마크해 둔 항목을 한곳에서 보고, 바로 암기·듣기로 이어가요.')}

    <div class="chips" role="group" aria-label="복습함 구분">
      ${tabs.map(([v, l, c, icon]) => `<button type="button" class="chip-btn ${reviewTab === v ? 'active' : ''}" aria-pressed="${reviewTab === v}" data-action="rv-tab" data-tab="${v}">${ic(icon)}${l}<span class="count">${c}</span></button>`).join('')}
    </div>

    ${items.length ? `
    <div class="rv-bar">
      <b>${items.length}${isWord ? '단어' : '문장'}</b>
      <div>
        <button type="button" class="btn btn-primary btn-sm" data-action="rv-quiz">${ic('practice')} 암기 시작</button>
        <button type="button" class="btn btn-tonal btn-sm" data-action="rv-auto">${ic('headphones')} 듣기 시작</button>
      </div>
    </div>
    <ul class="rv-list">${items.map(x => isWord ? wordItem(x) : sentenceItem(x)).join('')}</ul>` : `
    <div class="empty"><span class="jp">空</span><b>${emptyMsg[0]}</b>${emptyMsg[1]}</div>`}
  </div>`;
}

/* ---------- 뷰: 통합 검색 ---------- */
let searchQuery = '';
let searchType = 'all';   // all | sentences | grammar | words

function searchResults(q) {
  const query = q.trim();
  const out = { sentences: [], grammar: [], words: [], counts: { sentences: 0, grammar: 0, words: 0 }, total: 0 };
  if (!query) return out;
  const lim = searchType === 'all' ? { s: 30, g: 20, w: 30 } : { s: 120, g: 60, w: 120 };

  const num = /^\d{1,4}$/.test(query) ? Number(query) : 0;
  const lower = query.toLowerCase();

  for (const s of SENTENCES) {
    const matched = num
      ? s.n === num
      : (s.jp.includes(query) || s.ko.toLowerCase().includes(lower) || s.pt.toLowerCase().includes(lower));
    if (matched) {
      out.counts.sentences++;
      if (out.sentences.length < lim.s) out.sentences.push(s);
    }
  }

  for (const g of GRAMMAR) {
    const ch = chapterOf(g.id);
    const matched = num
      ? g.id === num
      : ([g.formula, g.gist, g.intro, ch ? ch.title : ''].some(v => String(v || '').toLowerCase().includes(lower)));
    if (matched) {
      out.counts.grammar++;
      if (out.grammar.length < lim.g) out.grammar.push({ ...g, ch });
    }
  }

  for (const w of ALL_WORDS) {
    const matched = [w.disp, w.read, w.ko, w.cat].some(v => String(v || '').toLowerCase().includes(lower));
    if (matched) {
      out.counts.words++;
      if (out.words.length < lim.w) out.words.push(w);
    }
  }

  out.total = out.counts.sentences + out.counts.grammar + out.counts.words;
  return out;
}

function hl(text, q) {
  if (!q) return esc(text);
  const source = String(text || '');
  const i = source.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(source);
  return esc(source.slice(0, i)) + '<mark>' + esc(source.slice(i, i + q.length)) + '</mark>' + esc(source.slice(i + q.length));
}

const SEARCH_CHIPS = ['学校', '친구', 'てください', '가능형', '가족'];

function searchLandingHtml() {
  return `
    <div class="search-empty">
      <span class="search-mark jp" aria-hidden="true">探</span>
      <b>찾을 내용을 입력하세요</b>
      <p>일본어 · 한국어 뜻 · 문법 표현 · 문장 번호를 한꺼번에 검색해요.</p>
      <div class="search-chips">
        ${SEARCH_CHIPS.map(x => `<button type="button" class="chip-btn ${JP_HAS_RE.test(x) ? 'jp' : ''}" data-action="search-fill" data-q="${esc(x)}">${esc(x)}</button>`).join('')}
      </div>
    </div>`;
}

function searchListInner(q, res) {
  if (!q.trim()) return searchLandingHtml();
  if (res.total === 0) return `<div class="empty"><span class="jp">無</span><b>일치하는 결과가 없어요</b>다른 단어나 번호로 찾아보세요.</div>`;
  const show = t => searchType === 'all' || searchType === t;

  const sentenceHtml = show('sentences') && res.sentences.length ? `
    <section class="search-group">
      <header><h2>문장</h2><span>${res.counts.sentences}건${res.counts.sentences > res.sentences.length ? ` · 상위 ${res.sentences.length}건` : ''}</span></header>
      <div class="search-group-list">
        ${res.sentences.map(s => `
          <a class="result-item spot" href="#/study/${s.ch}?focus=${s.n}">
            <div class="r-top"><span class="s-num jp">${pad4(s.n)}</span>${lvChip(chapterOf(s.ch).level)}<span>${pad2(s.ch)}. ${esc(chapterOf(s.ch).title)}</span></div>
            <div class="jp r-jp">${hl(s.jp, q)}</div>
            <div class="r-ko">${hl(s.ko, q)}</div>
          </a>`).join('')}
      </div>
    </section>` : '';

  const grammarHtml = show('grammar') && res.grammar.length ? `
    <section class="search-group">
      <header><h2>문법</h2><span>${res.counts.grammar}건</span></header>
      <div class="search-group-list">
        ${res.grammar.map(g => `
          <a class="result-item spot" href="#/grammar/${g.id}">
            <div class="r-top"><span class="s-num">${pad2(g.id)}</span>${g.ch ? lvChip(g.ch.level) : ''}<span>문법 해설</span></div>
            <div class="jp r-jp">${hl(g.formula, q)}</div>
            <div class="r-ko">${hl(g.gist, q)}</div>
          </a>`).join('')}
      </div>
    </section>` : '';

  const wordHtml = show('words') && res.words.length ? `
    <section class="search-group">
      <header><h2>단어</h2><span>${res.counts.words}건${res.counts.words > res.words.length ? ` · 상위 ${res.words.length}건` : ''}</span></header>
      <div class="search-group-list word-result-grid">
        ${res.words.map(w => `
          <a class="result-item spot" href="#/words?level=${encodeURIComponent(w.level)}&cat=${encodeURIComponent(w.catId || '')}&word=${encodeURIComponent(w.key)}">
            <div class="r-top">${lvChip(w.level)}<span>${esc(w.cat)}</span></div>
            <div class="jp r-jp">${hl(w.disp, q)}${w.read && w.read !== w.disp ? ` <small>${hl(w.read, q)}</small>` : ''}</div>
            <div class="r-ko">${hl(w.ko, q)}</div>
          </a>`).join('')}
      </div>
    </section>` : '';

  return sentenceHtml + grammarHtml + wordHtml || `<div class="empty"><span class="jp">無</span><b>이 구분에는 결과가 없어요</b>다른 구분을 눌러 보세요.</div>`;
}

function searchTypesHtml(q, res) {
  if (!q.trim()) return '';
  const c = res.counts;
  const items = [['all', '전체', res.total], ['sentences', '문장', c.sentences], ['grammar', '문법', c.grammar], ['words', '단어', c.words]];
  return items.map(([v, l, n]) => `<button type="button" class="chip-btn ${searchType === v ? 'active' : ''}" aria-pressed="${searchType === v}" data-action="search-type" data-type="${v}">${l}<span class="count">${n}</span></button>`).join('');
}

function syncSearchUrl() {
  const hash = '#/search' + (searchQuery.trim() ? '?q=' + encodeURIComponent(searchQuery.trim()) : '');
  if (location.hash !== hash) history.replaceState(null, '', location.pathname + location.search + hash);
}

function renderSearchResults() {
  const list = $('.result-list'); if (!list) return;
  const res = searchResults(searchQuery);
  const types = $('#search-types'); if (types) { types.innerHTML = searchTypesHtml(searchQuery, res); types.hidden = !searchQuery.trim(); }
  list.innerHTML = searchListInner(searchQuery, res);
  const clr = $('.search-clear'); if (clr) clr.classList.toggle('show', !!searchQuery.trim());
  syncSearchUrl();
}

function viewSearch() {
  const q = searchQuery;
  const res = searchResults(q);
  const course = courseMeta(S.currentCourse);
  return `
  <div class="page">
    <header class="page-head" data-mark="探">
      <span class="kicker">${esc(course.label)} 코스</span>
      <h1 class="page-title">검색</h1>
      <p class="page-sub">문장 · 문법 · 단어를 한 번에 찾아요.</p>
    </header>
    <div class="search-field big">
      ${ic('search')}
      <input type="search" id="search-input" placeholder="문장·문법·단어·번호 검색" value="${esc(q)}" autocomplete="off" enterkeyhint="search" aria-label="문장, 문법, 단어 통합 검색">
      <button type="button" class="search-clear ${q.trim() ? 'show' : ''}" data-action="search-clear" aria-label="지우기" title="지우기">${ic('close')}</button>
    </div>
    <div class="chips" id="search-types" role="group" aria-label="결과 구분" ${q.trim() ? '' : 'hidden'}>${searchTypesHtml(q, res)}</div>
    <div class="result-list">${searchListInner(q, res)}</div>
  </div>`;
}

/* ---------- 라우터 ---------- */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const qi = h.indexOf('?');                                   // 첫 '?'만 경로와 질의의 경계로 본다
  const pathPart = qi < 0 ? h : h.slice(0, qi), queryPart = qi < 0 ? '' : h.slice(qi + 1);
  const seg = pathPart.split('/').filter(Boolean);
  const params = new URLSearchParams(queryPart);
  return { seg, params };
}

const hubLast = {};   // 허브별 마지막으로 본 화면 — 독에서 허브를 다시 누르면 그 자리로 돌아간다
let currentHub = 'home';

/* 화면 결정. nav=true일 때만 주소의 파라미터를 상태에 반영한다(상태 변경에 따른 재렌더가 선택을 덮어쓰지 않도록) */
function resolveRoute(nav) {
  try { return resolveRouteRaw(nav); }
  catch (err) {                                                  // 예기치 못한 상태·주소로 화면 계산이 실패해도 빈 화면 대신 안내를 보여 준다
    console.error(err);
    return { html: errorView(), hub: 'home', leaf: 'home', title: '문제가 생겼어요', memo: '', page: 'error', seg: [], params: new URLSearchParams() };
  }
}
function errorView() {
  return `
  <div class="page">
    <div class="empty"><span class="jp" aria-hidden="true">困</span><b>화면을 불러오지 못했어요</b>잠시 뒤 다시 시도하거나 홈으로 돌아가 주세요.<a class="btn btn-primary" href="#/">홈으로</a></div>
  </div>`;
}
function resolveRouteRaw(nav) {
  const { seg, params } = parseHash();
  const page = seg[0] || 'home';
  const R = { html: '', hub: 'home', leaf: 'home', title: '홈', memo: '', page, seg, params };

  // 자동 듣기 재생 화면을 벗어나면 재생 중지
  if (autoPlayer && !(page === 'auto' && seg[1] === 'run')) autoStop();

  if (page === 'chapters') {
    if (nav) chaptersTab = params.get('tab') === 'grammar' ? 'grammar' : 'list';
    Object.assign(R, { html: viewChapters(), hub: 'learn', leaf: chaptersTab === 'grammar' ? 'learn-grammar' : 'learn-list', title: chaptersTab === 'grammar' ? '문법 색인' : '학습' });
  } else if (page === 'study') {
    const id = clampChapter(seg[1]);
    const ch = chapterOf(id);
    Object.assign(R, { html: viewStudy(id), hub: 'learn', leaf: 'learn-list', title: ch ? `${pad2(id)}. ${ch.title}` : '학습' });
  } else if (page === 'grammar') {
    const gid = clampChapter(seg[1]);
    Object.assign(R, { html: viewGrammar(gid), hub: 'learn', leaf: 'learn-grammar', title: `문법 ${pad2(gid)}` });
  } else if (page === 'all') {
    Object.assign(R, { html: viewAll(), hub: 'learn', leaf: 'learn-all', title: '전체 문장' });
  } else if (page === 'quiz' && seg[1] === 'run') {
    Object.assign(R, { html: viewQuizRun(), hub: 'practice', leaf: 'practice-quiz', title: '암기 중', memo: '#/quiz' });
  } else if (page === 'quiz') {
    if (nav) {
      // 홈/학습에서 진입 시 소스 사전 선택
      const src = params.get('src');
      if (src && ['random', 'chapter', 'weak', 'book'].includes(src)) {
        const chq = chapterNo(params.get('ch'));                 // 잘못된 과 번호는 무시하고 기존 선택을 쓴다
        const pool = poolFor(src, chq || quizSetup.ch);
        if (!((src === 'weak' || src === 'book') && !pool.length)) {
          quizSetup.src = src; quizSetup.kind = 'sentence';
          if (chq) quizSetup.ch = chq;
        }
      }
    }
    Object.assign(R, { html: viewQuizSetup(), hub: 'practice', leaf: 'practice-quiz', title: '암기 카드' });
  } else if (page === 'auto' && seg[1] === 'run') {
    if (!autoPlayer) { location.hash = '#/auto'; return R; }
    Object.assign(R, { html: viewAutoRun(), hub: 'practice', leaf: 'practice-auto', title: '자동 듣기 중', memo: '#/auto' });
  } else if (page === 'auto') {
    if (nav) {
      const asrc = params.get('src');
      if (asrc && ['chapter', 'all', 'book', 'weak'].includes(asrc)) {
        S.settings.auto.src = asrc;
        const chq = chapterNo(params.get('ch'));
        if (chq) S.settings.auto.ch = chq;
      }
    }
    Object.assign(R, { html: viewAutoSetup(), hub: 'practice', leaf: 'practice-auto', title: '자동 듣기' });
  } else if (page === 'review') {
    Object.assign(R, { html: viewReview(), hub: 'practice', leaf: 'practice-review', title: '복습함' });
  } else if (page === 'kana') {
    Object.assign(R, { html: viewKana(), hub: 'vocab', leaf: 'vocab-kana', title: '가나' });
  } else if (page === 'words') {
    if (nav) {
      const level = params.get('level');
      if (level && ['전체', ...WORD_LEVELS_ALL].includes(level)) wordsLevel = level;
    }
    Object.assign(R, { html: viewWords(), hub: 'vocab', leaf: 'vocab-words', title: '단어장' });
  } else if (page === 'search') {
    if (nav) { searchQuery = params.get('q') || ''; searchType = 'all'; }
    Object.assign(R, { html: viewSearch(), hub: 'search', leaf: 'search', title: searchQuery.trim() ? `“${searchQuery.trim()}” 검색` : '검색' });
  } else {
    Object.assign(R, { html: viewHome(), hub: 'home', leaf: 'home', title: '홈' });
  }
  return R;
}

function syncNav(R) {
  currentHub = R.hub;
  $$('[data-leaf]').forEach(a => {
    const on = a.dataset.leaf === R.leaf;
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $$('.dock a[data-hub]').forEach(a => {
    const on = a.dataset.hub === R.hub;
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const dock = $('.dock');
  if (dock) dock.style.setProperty('--i', Math.max(0, HUB_ORDER.indexOf(R.hub)));
  if (R.hub !== 'home') hubLast[R.hub] = R.memo || location.hash || HUB_ROOT[R.hub];
}

// 상태 변경 후 다시 그릴 때 키보드 포커스를 같은 컨트롤로 되돌린다
function focusKeyOf(el, scope = app) {
  if (!el || !el.dataset || !el.dataset.action || !scope.contains(el)) return null;
  return { action: el.dataset.action, data: JSON.stringify(el.dataset) };
}
function restoreFocus(k, scope = app) {
  if (!k) return;
  const cand = $$(`[data-action="${k.action}"]`, scope).find(e => JSON.stringify(e.dataset) === k.data);
  if (cand) cand.focus({ preventScroll: true });
}

function mount(R, { nav = false, first = false } = {}) {
  if (!R.html) return;
  const prevY = window.scrollY;
  const snap = snapSegs(app);
  const fk = nav ? null : focusKeyOf(document.activeElement);

  if (hasTTS) speechSynthesis.cancel();
  app.innerHTML = R.html;
  document.title = R.title && R.page !== 'home' ? `${R.title} · 千日文` : '千日文 — 일본어 천일문';
  syncNav(R);
  updateCourseControl();
  updateRailStatus();

  if (nav) {
    document.body.classList.remove('dock-hidden');
    const focusN = R.page === 'study' ? R.params.get('focus') : null;
    const el = focusN ? document.getElementById('s-' + focusN) : null;   // 선택자 문자열 조립 없이 id로 조회
    if (el) {
      requestAnimationFrame(() => { el.scrollIntoView({ block: 'center', behavior: 'instant' }); el.classList.add('flash'); });
    } else {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
    // 단어 검색 결과에서 정확한 분류·단어로 이동
    if (R.page === 'words' && R.params.get('cat')) {
      requestAnimationFrame(() => {
        const section = document.getElementById('words-sec-' + R.params.get('cat'));
        const wordKey = R.params.get('word');
        const word = wordKey ? $$('.word-item').find(w => w.dataset.wordKey === wordKey) : null;
        const target = word || section;
        if (target) {
          target.scrollIntoView({ block: word ? 'center' : 'start', behavior: 'instant' });
          if (word) { word.classList.add('search-target'); setTimeout(() => word.classList.remove('search-target'), 1800); }
        }
      });
    }
    const page = app.firstElementChild;
    if (page) page.classList.add('enter');                      // 새 화면이 아래에서 스프링으로 떠오른다(전환 효과 유무와 무관)
    if (!first) {                                              // 처음 열 때는 포커스를 건드리지 않아 첫 Tab이 '본문 바로가기'에 닿는다
      app.focus({ preventScroll: true });
      const ann = $('#route-announcer'); if (ann) ann.textContent = document.title;
    }
    // 같은 허브 안에서 탭을 옮길 때: 탭 썸이 이전 위치에서 새 위치로 미끄러진다
    const hubOnly = {}; Object.keys(snap).forEach(k => { if (k.startsWith('hub-')) hubOnly[k] = snap[k]; });
    flipSegs(app, hubOnly);
  } else {
    window.scrollTo({ top: prevY, left: 0, behavior: 'instant' });
    flipSegs(app, snap);
    restoreFocus(fk);
  }

  // 자동 학습 재생 시작(진입 시 1회)
  if (R.page === 'auto' && R.seg[1] === 'run' && autoPlayer) {
    updateAutoUI();
    if (!autoPlayer.started) { autoPlayer.started = true; autoRun(); }
  }

  // 검색 입력 바인딩 (입력 포커스 유지한 채 결과만 갱신)
  const si = $('#search-input');
  if (si) {
    si.addEventListener('input', () => { searchQuery = si.value; searchType = 'all'; renderSearchResults(); });
    if (nav && !('ontouchstart' in window)) { si.focus(); si.setSelectionRange(si.value.length, si.value.length); }
  }

  // 목차·문법 색인은 현재 목록을 즉시 필터링
  const chapterSearch = $('#chapter-search');
  if (chapterSearch) {
    chapterSearch.addEventListener('input', () => {
      const q = chapterSearch.value.trim().toLowerCase();
      let visible = 0;
      $$('.ch-row', app).forEach(item => {
        const show = !q || (item.dataset.search || '').includes(q);
        item.hidden = !show;
        if (show) visible++;
      });
      $$('.ch-group', app).forEach(g => { g.hidden = !$$('.ch-row:not([hidden])', g).length; });
      const count = $('#chapter-search-count'), empty = $('#chapter-no-results');
      if (count) count.textContent = `${visible}개`;
      if (empty) empty.hidden = visible > 0;
    });
  }
}

// 상태 변경(필터·토글 등)에 따른 재렌더 — 스크롤·포커스·세그먼트 썸 위치를 유지한다
function render(opts) { mount(resolveRoute(false), opts); }

// 주소 이동 — 지원하면 View Transitions로 화면을 이어 준다
function navigate() {
  const R = resolveRoute(true);
  if (!R.html) return;                 // 리다이렉트 중 — 곧 hashchange가 다시 호출된다
  runVT(() => mount(R, { nav: true }));
}

/* ---------- 부분 갱신 ---------- */
function refreshStudyProgress() {
  const { seg } = parseHash();
  if (seg[0] !== 'study') return;
  const ch = chapterOf(clampChapter(seg[1]));
  if (!ch) return;
  const p = chapterProgress(ch);
  const bar = $('#ch-bar'); const done = $('#ch-done');
  if (bar) bar.style.width = Math.round(p.done / p.total * 100) + '%';
  if (done) done.textContent = p.done;
}

function toggleLearn(n, btn) {
  const on = !P.learned[n];
  if (on) { P.learned[n] = 1; haptic(8); touchActivity(n); } else { delete P.learned[n]; save(); }   // 목표 달성 진동이 마지막에 오도록
  const card = $('#s-' + n);
  if (card) card.classList.toggle('is-learned', on);
  if (btn) {
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on);
    const label = btn.querySelector('span'); if (label) label.textContent = on ? '완료' : '외웠어요';
  }
  refreshStudyProgress();
  updateCourseControl();
}

function toggleBook(n, btn) {
  const on = !P.bookmarks[n];
  if (on) P.bookmarks[n] = 1; else delete P.bookmarks[n];
  save();
  if (btn) {
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on);
    btn.innerHTML = `${ic('bookmark', on ? 'fill' : '')}<span>북마크</span>`;
  }
  toast(on ? '북마크에 추가했어요' : '북마크를 해제했어요', 'bookmark');
}

/* ---------- 전역 이벤트 ---------- */
document.addEventListener('click', e => {
  if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); return; }

  // 본문 바로가기(스킵 링크): 주소 해시를 건드리지 않고 본문으로 포커스만 옮긴다
  if (e.target.closest('.skip-link')) { e.preventDefault(); app.focus(); return; }

  // 하단 독: 다른 허브 = 그 허브에서 마지막으로 보던 화면 / 지금 허브 다시 누르기 = 허브 처음 화면(이미 처음이면 맨 위로)
  const dockLink = e.target.closest('.dock a[data-hub]');
  if (dockLink) {
    e.preventDefault();
    const hub = dockLink.dataset.hub, root0 = HUB_ROOT[hub];
    if (hub === currentHub) {
      if (location.hash === root0 || (hub === 'home' && (location.hash === '' || location.hash === '#/'))) window.scrollTo({ top: 0, behavior: scrollBehavior() });
      else location.hash = root0;
    } else location.hash = hubLast[hub] || root0;
    return;
  }
  // 사이드바에서 현재 화면을 다시 누르면 맨 위로
  const railLink = e.target.closest('.rail-link[aria-current="page"]');
  if (railLink && railLink.getAttribute('href') === location.hash) { e.preventDefault(); window.scrollTo({ top: 0, behavior: scrollBehavior() }); return; }

  const t = e.target.closest('[data-action]');
  if (!t || t.disabled) return;
  const act = t.dataset.action;

  switch (act) {
    case 'toggle-theme': {
      const dark = root.dataset.theme === 'dark';
      runVT(() => { S.settings.theme = dark ? 'light' : 'dark'; save(); applyTheme(); renderSettings(); }, 'theme');
      break;
    }
    case 'open-course-menu': openCourseMenu(); break;
    case 'open-settings': openSettings(); break;
    case 'close-sheet': closeSheet(); break;
    case 'confirm-yes': settleConfirm(true); break;
    case 'confirm-no': settleConfirm(false); break;
    case 'inapp-dismiss': {
      try { localStorage.setItem(STORE_INAPP, '1'); } catch (err) {}
      const b = document.getElementById('inapp-banner'); if (b) b.remove();
      break;
    }
    case 'set-theme':
      runVT(() => { S.settings.theme = t.dataset.theme; save(); applyTheme(); renderSettings(); }, 'theme');
      break;
    case 'font-inc': S.settings.scale = Math.min(1.25, Math.round((S.settings.scale + 0.05) * 100) / 100); save(); applyScale(); renderSettings(); break;
    case 'font-dec': S.settings.scale = Math.max(0.85, Math.round((S.settings.scale - 0.05) * 100) / 100); save(); applyScale(); renderSettings(); break;
    case 'set-pitch': S.settings.pitch = Number(t.dataset.val); save(); renderSettings(); if (hasTTS) speak('これは日本語の音声サンプルです。'); break;
    case 'set-goal': S.settings.goal = Number(t.dataset.val); save(); renderSettings(); updateRailStatus(); if (parseHash().seg[0] === undefined) render(); break;
    case 'set-haptics': S.settings.haptics = !S.settings.haptics; save(); renderSettings(); if (S.settings.haptics) haptic(15); break;
    case 'reset-data':
      confirmDialog({ title: '학습 기록을 모두 지울까요?', body: '모든 코스의 완료·북마크·복습 기록이 사라지고 되돌릴 수 없어요. 설정은 그대로 남아요.', yes: '모두 지우기', danger: true }).then(ok => {
        if (!ok) return;
        S.courses = {}; COURSES.forEach(c => { S.courses[c.id] = emptyProgress(); });
        S.streak = { last: '', count: 0 }; S.goalDone = ''; S.wordLearned = {}; S.wordWeak = {};
        setCourse(S.currentCourse);
        save(); closeSheet(); updateCourseControl(); updateRailStatus(); render(); toast('학습 기록을 초기화했어요', 'trash');
      });
      break;
    case 'set-course': switchCourse(t.dataset.course); break;

    case 'speak': {
      e.stopPropagation();
      const s = sentence(Number(t.dataset.n));
      if (s) speak(s.jp, t);
      break;
    }
    case 'learn': toggleLearn(Number(t.dataset.n), t); break;
    case 'book': toggleBook(Number(t.dataset.n), t); break;
    case 'reveal': {
      e.stopPropagation();
      const masked = t.closest('.masked');
      if (masked) masked.classList.add('revealed');
      break;
    }
    case 'hide-mode': {
      const m = t.dataset.mode;
      S.settings.hideMode = m; save();
      // 전체 재렌더 없이 마스크만 갱신 (학습 뷰 + 전체 문장 뷰 공용)
      $$('.seg[data-seg="hide-mode"]').forEach(sg => {
        const btns = $$('button', sg);
        btns.forEach(b => { const on = b.dataset.mode === m; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
        sg.style.setProperty('--i', Math.max(0, btns.findIndex(b => b.dataset.mode === m)));
      });
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
      for (let n = ch.start; n <= ch.end; n++) { P.learned[n] = 1; touchActivity(n); }
      save(); updateCourseControl(); render(); toast(`${pad2(ch.id)}과 ${ch.end - ch.start + 1}문장을 완료로 표시했어요`, 'check');
      break;
    }
    case 'filter': chapterFilter = t.dataset.filter; render(); break;
    case 'all-filter': allFilter = t.dataset.filter; render(); break;
    case 'all-state': allState = t.dataset.state; render(); break;
    case 'to-top': window.scrollTo({ top: 0, behavior: scrollBehavior() }); break;
    case 'search-clear': {
      searchQuery = '';
      const si = $('#search-input'); if (si) { si.value = ''; si.focus(); }
      renderSearchResults();
      break;
    }
    case 'search-fill': {
      searchQuery = t.dataset.q; searchType = 'all';
      const si = $('#search-input'); if (si) si.value = searchQuery;
      renderSearchResults();
      break;
    }
    case 'search-type': searchType = t.dataset.type; renderSearchResults(); break;

    case 'q-kind': if (quizSetup.kind !== t.dataset.kind) { quizSetup.kind = t.dataset.kind; render(); } break;
    case 'q-src': quizSetup.src = t.dataset.src; render(); break;
    case 'qw-src': quizSetup.wsrc = t.dataset.src; render(); break;
    case 'q-dir': quizSetup.dir = t.dataset.dir; render(); break;
    case 'q-start': startQuiz(); break;
    case 'q-flip':
      if (e.target.closest('[data-action="speak"], [data-action="say"]')) break;
      flipQuizCard();
      break;
    case 'q-ok': answerQuiz(true); break;
    case 'q-no': answerQuiz(false); break;
    case 'q-exit':
      confirmDialog({ title: '암기를 그만둘까요?', body: '지금까지의 채점은 저장돼요.', yes: '그만두기' }).then(ok => {
        if (ok) { quizSession = null; location.hash = '#/quiz'; }
      });
      break;
    case 'q-retry-wrong': {
      const wrong = quizSession.wrong.slice();
      quizSession = { kind: quizSession.kind, items: shuffle(wrong), idx: 0, dir: quizSession.dir, flipped: false, wrong: [], right: 0 };
      render();
      break;
    }
    case 'q-retry-same': startQuiz(); break;

    case 'auto-kind': if (S.settings.auto.kind !== t.dataset.kind) { S.settings.auto.kind = t.dataset.kind; save(); render(); } break;
    case 'auto-src': S.settings.auto.src = t.dataset.src; save(); render(); break;
    case 'auto-wsrc': S.settings.auto.wsrc = t.dataset.src; save(); render(); break;
    case 'auto-set': {
      let v = t.dataset.val;
      v = v === 'true' ? true : v === 'false' ? false : Number(v);
      S.settings.auto[t.dataset.key] = v; save(); render();
      break;
    }
    case 'auto-start': startAuto(); break;
    case 'auto-quick': S.settings.auto.kind = 'sentence'; S.settings.auto.src = 'chapter'; S.settings.auto.ch = Number(t.dataset.ch); save(); startAuto(); break;
    case 'say': { e.stopPropagation(); speak(t.dataset.ch, t); break; }
    case 'word-say': {
      e.stopPropagation();
      speak(t.dataset.ch, t);
      // 발음이나 뜻 중 하나라도 가린 상태에서는 클릭해도 시각 정보는 공개하지 않는다.
      if (!wordsHideKo && wordsShowRead) t.classList.add('revealed');
      touchActivity();
      break;
    }
    case 'words-hide': {
      wordsHideKo = !wordsHideKo;
      const rootEl = $('#words-root'); if (rootEl) rootEl.classList.toggle('words-hide', wordsHideKo);
      t.setAttribute('aria-pressed', String(wordsHideKo));
      // 토글할 때마다 공개 상태 초기화 (켜면 전부 가려지고, 끄면 깔끔하게)
      $$('.word-item.revealed, .wt-cell.revealed').forEach(el => el.classList.remove('revealed'));
      break;
    }
    case 'words-read': {
      wordsShowRead = !wordsShowRead;
      const hideRead = !wordsShowRead;
      const rootEl = $('#words-root'); if (rootEl) rootEl.classList.toggle('read-hidden', hideRead);
      t.setAttribute('aria-pressed', String(hideRead));
      $$('.word-item.revealed, .wt-cell.revealed').forEach(el => el.classList.remove('revealed'));
      break;
    }
    case 'words-level': {
      if (wordsLevel !== t.dataset.level) {
        wordsLevel = t.dataset.level;
        location.hash = '#/words?level=' + encodeURIComponent(wordsLevel);
      }
      break;
    }
    case 'kana-script': S.settings.kanaScript = t.dataset.sc; save(); render(); break;
    case 'kana-speak': { e.stopPropagation(); speak(t.dataset.ch, t); break; }
    case 'kana-mode': kanaMode = t.dataset.mode; render(); break;
    case 'kana-range': kanaPractice.range = t.dataset.range; reshuffleKana(); render(); break;
    case 'kana-shuffle': reshuffleKana(); render(); toast('새로 섞었어요', 'shuffle'); break;
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
        if (n === kanaPractice.items.length) toast('전부 확인했어요! 다시 섞기로 한 번 더', 'check');
        touchActivity();
      }
      break;
    }

    case 'auto-toggle': autoToggle(); break;
    case 'auto-prev': autoJump(-1); break;
    case 'auto-next': autoJump(1); break;
    case 'auto-exit': location.hash = '#/auto'; break;
    case 'auto-live': autoLive(t.dataset.key); break;

    // 복습함
    case 'rv-tab': reviewTab = t.dataset.tab; render(); break;
    case 'rv-clear': delete P.weak[Number(t.dataset.n)]; save(); render(); toast('복습 대기에서 뺐어요', 'check'); break;
    case 'rv-unbook': delete P.bookmarks[Number(t.dataset.n)]; save(); render(); toast('북마크를 해제했어요', 'bookmark'); break;
    case 'rv-clear-word': delete S.wordWeak[t.dataset.key]; save(); render(); toast('복습 대기에서 뺐어요', 'check'); break;
    case 'rv-quiz':
      if (reviewTab === 'words') { quizSetup.kind = 'word'; quizSetup.wsrc = 'weak'; }
      else { quizSetup.kind = 'sentence'; quizSetup.src = reviewTab; }
      startQuiz();
      break;
    case 'rv-auto':
      if (reviewTab === 'words') { S.settings.auto.kind = 'word'; S.settings.auto.wsrc = 'weak'; }
      else { S.settings.auto.kind = 'sentence'; S.settings.auto.src = reviewTab; }
      save(); startAuto();
      break;
  }
});

document.addEventListener('change', e => {
  const t = e.target.closest('[data-action="q-ch"]');
  if (t) { quizSetup.ch = Number(t.value); render(); }
  const wl = e.target.closest('[data-action="qw-level"]');
  if (wl) { quizSetup.wlevel = wl.value; render(); }
  const wc = e.target.closest('[data-action="qw-cat"]');
  if (wc) { quizSetup.wcat = wc.value; render(); }
  const a = e.target.closest('[data-action="auto-ch"]');
  if (a) { S.settings.auto.ch = Number(a.value); save(); render(); }
  const al = e.target.closest('[data-action="auto-wlevel"]');
  if (al) { S.settings.auto.wlevel = al.value; save(); render(); }
  const ac = e.target.closest('[data-action="auto-wcat"]');
  if (ac) { S.settings.auto.wcat = ac.value; save(); render(); }
  const v = e.target.closest('[data-action="set-voice"]');
  if (v) {
    S.settings.voiceJa = v.value; save(); pickVoice();
    if (hasTTS && v.value) speak('これは日本語の音声サンプルです。'); // 미리듣기
  }
  const j = e.target.closest('[data-action="all-jump"]');
  if (j && j.value) {
    const el = $('#all-ch-' + j.value);
    if (el) el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    j.value = '';
  }
  const sj = e.target.closest('[data-action="study-ch-jump"]');
  if (sj && sj.value) location.hash = '#/study/' + sj.value;
  const wj = e.target.closest('[data-action="words-jump-select"]');
  if (wj && wj.value) {
    const el = document.getElementById('words-sec-' + wj.value);
    if (el) el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    wj.value = '';
  }
});

// 문법 해설 접기/펼치기 상태를 기억 (toggle 이벤트는 버블링되지 않아 capture로 받는다)
document.addEventListener('toggle', e => {
  if (e.target.matches && e.target.matches('details.lesson')) { S.settings.lessonOpen = e.target.open; save(); }
}, true);

document.addEventListener('keydown', e => {
  const { seg } = parseHash();
  if (e.target.matches('input, select, textarea')) return;

  // 자동 듣기
  if (seg[0] === 'auto' && seg[1] === 'run' && autoPlayer && !sheetEl.open && !confirmEl.open) {
    if (e.code === 'Space') { e.preventDefault(); autoToggle(); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); autoJump(1); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); autoJump(-1); }
    return;
  }
  // 암기 카드
  if (seg[0] === 'quiz' && seg[1] === 'run' && quizSession && quizSession.idx < quizSession.items.length && !sheetEl.open && !confirmEl.open) {
    // 카드가 아닌 다른 컨트롤(그만두기 버튼 등)에 포커스가 있을 땐 Enter/Space가 그 컨트롤 고유 동작을 하도록 둔다
    const onOtherControl = e.target.id !== 'flip-card' && !!e.target.closest('button, a[href], summary, [role="button"]');
    if ((e.code === 'Space' || e.code === 'Enter') && !quizSession.flipped) { if (onOtherControl) return; e.preventDefault(); flipQuizCard(); }
    else if (quizSession.flipped) {
      if (e.code === 'ArrowRight' || e.key.toLowerCase() === 'o') { e.preventDefault(); answerQuiz(true); }
      else if (e.code === 'ArrowLeft' || e.key.toLowerCase() === 'x') { e.preventDefault(); answerQuiz(false); }
    }
    return;
  }
  // 어디서든 '/' = 검색
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !sheetEl.open && !confirmEl.open) {
    e.preventDefault();
    if (seg[0] === 'search') { const input = $('#search-input'); if (input) input.focus(); }
    else location.hash = '#/search';
  }
});

window.addEventListener('hashchange', navigate);

/* ---------- 스포트라이트: 커서·터치를 따라다니는 빛 ---------- */
(() => {
  let raf = 0, tgt = null, px = 0, py = 0;
  const apply = () => {
    raf = 0; if (!tgt) return;
    const r = tgt.getBoundingClientRect();
    tgt.style.setProperty('--mx', (px - r.left) + 'px');
    tgt.style.setProperty('--my', (py - r.top) + 'px');
  };
  const spotOf = e => (e.target && e.target.closest) ? e.target.closest('.spot') : null;
  document.addEventListener('pointermove', e => {
    if (reduceMotion() || e.pointerType === 'touch') return;
    const el = spotOf(e); if (!el) return;
    tgt = el; px = e.clientX; py = e.clientY;
    if (!raf) raf = requestAnimationFrame(apply);
  }, { passive: true });
  document.addEventListener('pointerdown', e => {
    if (reduceMotion()) return;
    const el = spotOf(e); if (!el) return;
    tgt = el; px = e.clientX; py = e.clientY; apply();
    if (e.pointerType === 'touch') {
      el.classList.add('lit');
      const off = () => {                                    // 둘 중 먼저 오는 쪽에서 둘 다 해제(리스너가 쌓이지 않게)
        document.removeEventListener('pointerup', off); document.removeEventListener('pointercancel', off);
        setTimeout(() => el.classList.remove('lit'), 420);
      };
      document.addEventListener('pointerup', off);
      document.addEventListener('pointercancel', off);
    }
  }, { passive: true });
})();

initSwipeGrading();

/* ---------- 스크롤: 맨 위로 버튼 · 하단 독 자동 숨김 ---------- */
const toTopBtn = $('#to-top');
const mqCompact = window.matchMedia('(max-width: 959px)');
let lastY = window.scrollY, scrollTick = false;
function onScroll() {
  scrollTick = false;
  const y = window.scrollY;
  toTopBtn.classList.toggle('show', y > 700);
  if (!mqCompact.matches || reduceMotion()) { document.body.classList.remove('dock-hidden'); lastY = y; return; }
  const nearBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 160;
  if (y < 120 || nearBottom) { document.body.classList.remove('dock-hidden'); lastY = y; }
  else if (y > lastY + 10) { document.body.classList.add('dock-hidden'); lastY = y; }
  else if (y < lastY - 6) { document.body.classList.remove('dock-hidden'); lastY = y; }
}
window.addEventListener('scroll', () => { if (!scrollTick) { scrollTick = true; requestAnimationFrame(onScroll); } }, { passive: true });

/* ---------- 일본어 덩어리에 lang="ja" ---------- */
// 스크린리더가 일본어 음성으로 읽고, 폰트 대체 시에도 일본어 자형이 고르게 선택되도록 새로 그려진 .jp에 자동으로 단다
const tagJa = node => {
  if (node.nodeType !== 1) return;
  if (node.matches('.jp:not([lang])')) node.lang = 'ja';
  node.querySelectorAll('.jp:not([lang])').forEach(e => { e.lang = 'ja'; });
};
new MutationObserver(recs => recs.forEach(r => r.addedNodes.forEach(tagJa))).observe(document.body, { childList: true, subtree: true });
tagJa(document.body);

/* ---------- 시작 ---------- */
applyTheme();
applyScale();
updateCourseControl();
updateRailStatus();
if (!location.hash) history.replaceState(null, '', location.pathname + location.search + '#/');
mount(resolveRoute(true), { nav: true, first: true });
mountInAppBanner();   // 인앱 브라우저면 음성 안내 배너 표시

})();
