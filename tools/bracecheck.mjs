import { readFileSync } from 'node:fs';
const src = readFileSync('tools/fragdump.glsl', 'utf8');
const lines = src.split('\n');
let depth = 0;
for (let i = 0; i < lines.length; i++) {
  let line = lines[i];
  // strip line comments
  const ci = line.indexOf('//');
  if (ci >= 0) line = line.slice(0, ci);
  for (const ch of line) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  if (depth < 0) { console.log('NEGATIVE at line', i + 1, lines[i]); break; }
}
console.log('final depth', depth);
// print depth at each injected region
for (const n of [55, 56, 106, 158, 200, 209, 250, 262, 290, 296, 301, 330, 344]) {
  console.log('line', n, ':', JSON.stringify(lines[n - 1]?.slice(0, 80)));
}
