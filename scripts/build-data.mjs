#!/usr/bin/env node
// 1000.md → js/data.js 변환 스크립트
// 사용법: node scripts/build-data.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const md = readFileSync(join(root, '1000.md'), 'utf8');

const chapterRe = /^## (\d{2})\. (.+?) \((N\d)\)\s*$/;
const sentenceRe = /^\*\*(\d{4})\.\*\* (.+?)\s*$/;
const koRe = /^→ (.+?)\s*$/;
const ptRe = /^문형: `(.+?)`\s*$/;

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

// 검증
if (chapters.length !== 50) throw new Error(`챕터 수 오류: ${chapters.length}`);
if (sentences.length !== 1000) throw new Error(`문장 수 오류: ${sentences.length}`);
sentences.forEach((s, i) => {
  if (s.n !== i + 1) throw new Error(`문장 번호 불연속: ${s.n}`);
  if (!s.jp || !s.ko || !s.pt) throw new Error(`문장 ${s.n} 필드 누락`);
});

const out = `// 자동 생성 파일 — 직접 수정하지 마세요. (node scripts/build-data.mjs)
window.NIHONGO_DATA = ${JSON.stringify({ chapters, sentences }, null, 0)};
`;
mkdirSync(join(root, 'js'), { recursive: true });
writeFileSync(join(root, 'js', 'data.js'), out);
console.log(`OK: ${chapters.length} chapters, ${sentences.length} sentences → js/data.js`);
