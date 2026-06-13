#!/usr/bin/env node
// 코스별 원문(.md) → js/data.js 변환 스크립트
// 사용법: node scripts/build-data.mjs
//   1000.md(기초) / 1000-inter.md(중급) / 1000-adv.md(최상급)
//   파일이 존재하는 코스만 빌드에 포함됩니다(코스는 단계적으로 채울 수 있음).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 코스 등록부 — 순서가 곧 앱에서의 노출 순서
const COURSES = [
  { id: 'basic', file: '1000.md',       label: '기초',   sub: 'N5–N3', strict: true },
  { id: 'inter', file: '1000-inter.md', label: '중급',   sub: 'N3–N2' },
  { id: 'adv',   file: '1000-adv.md',   label: '최상급', sub: 'N1'    },
];

const chapterRe = /^## (\d{2})\. (.+?) \((N\d)\)\s*$/;
const sentenceRe = /^\*\*(\d{4})\.\*\* (.+?)\s*$/;
const koRe = /^→ (.+?)\s*$/;
const ptRe = /^문형: `(.+?)`\s*$/;

function parseCourse(meta) {
  const md = readFileSync(join(root, meta.file), 'utf8');
  const chapters = [];
  const sentences = [];
  let current = null;
  let pending = null;

  for (const line of md.split('\n')) {
    const ch = line.match(chapterRe);
    if (ch) {
      current = { id: Number(ch[1]), title: ch[2], level: ch[3], start: 0, end: 0 };
      chapters.push(current);
      continue;
    }
    if (!current) continue;

    const s = line.match(sentenceRe);
    if (s) {
      pending = { n: Number(s[1]), jp: s[2], ko: '', pt: '', ch: current.id };
      continue;
    }
    const ko = line.match(koRe);
    if (ko && pending) { pending.ko = ko[1]; continue; }
    const pt = line.match(ptRe);
    if (pt && pending) {
      pending.pt = pt[1];
      sentences.push(pending);
      if (!current.start) current.start = pending.n;
      current.end = pending.n;
      pending = null;
    }
  }

  // 코스 내부 일관성 검증
  chapters.forEach((c, i) => {
    if (c.id !== i + 1) throw new Error(`[${meta.id}] 챕터 번호 불연속: ${c.id} (기대 ${i + 1})`);
  });
  sentences.forEach((s, i) => {
    if (s.n !== i + 1) throw new Error(`[${meta.id}] 문장 번호 불연속: ${s.n} (기대 ${i + 1})`);
    if (!s.jp || !s.ko || !s.pt) throw new Error(`[${meta.id}] 문장 ${s.n} 필드 누락`);
  });
  // 기초 코스는 완성본이어야 함(회귀 방지). 그 외 코스는 단계적 채움을 허용.
  if (meta.strict && (chapters.length !== 50 || sentences.length !== 1000)) {
    throw new Error(`[${meta.id}] 기초 코스는 50과·1000문장이어야 합니다: ${chapters.length}과 ${sentences.length}문장`);
  }

  return { id: meta.id, label: meta.label, sub: meta.sub, chapters, sentences };
}

const courses = [];
for (const meta of COURSES) {
  if (!existsSync(join(root, meta.file))) continue;
  const c = parseCourse(meta);
  courses.push(c);
  const complete = c.chapters.length >= 50 && c.sentences.length >= 1000;
  console.log(`  ${c.id} (${c.label} · ${c.sub}): ${c.chapters.length}과 ${c.sentences.length}문장${complete ? '  ✓' : '  …진행 중'}`);
}
if (!courses.length) throw new Error('빌드할 코스 원문(.md)이 없습니다');

const out = `// 자동 생성 파일 — 직접 수정하지 마세요. (node scripts/build-data.mjs)
window.NIHONGO_DATA = ${JSON.stringify({ courses }, null, 0)};
`;
mkdirSync(join(root, 'js'), { recursive: true });
writeFileSync(join(root, 'js', 'data.js'), out);
console.log(`OK: ${courses.length} courses → js/data.js`);
