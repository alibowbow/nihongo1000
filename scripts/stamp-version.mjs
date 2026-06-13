#!/usr/bin/env node
// index.html의 CSS/JS 링크에 ?v=<버전> 쿼리를 붙여 캐시를 무력화한다.
// 배포 직전에 실행: node scripts/stamp-version.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'index.html');
let html = readFileSync(file, 'utf8');

const v = Date.now().toString(36); // 배포마다 고유한 짧은 버전 문자열
html = html.replace(/(href="css\/[^"?]+\.css)(\?v=[^"]*)?"/g, `$1?v=${v}"`);
html = html.replace(/(src="js\/[^"?]+\.js)(\?v=[^"]*)?"/g, `$1?v=${v}"`);

writeFileSync(file, html);
console.log(`stamped asset version: ${v}`);
