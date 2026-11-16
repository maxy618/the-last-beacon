import { readFileSync, writeFileSync } from 'node:fs';
let src = readFileSync('src/world/structures.js', 'utf8');
// revert the destructuring edit if it ran
src = src.replace(/const \[(\w+)x, \1z\] = l2w/g, 'const $1 = l2w');
// convert l2w calls to return plain {x, z} objects
src = src.replace(/return \[x \+ lx \* c \+ lz \* s, z - lx \* s \+ lz \* c\];/,
  'return { x: x + lx * c + lz * s, z: z - lx * s + lz * c };');
src = src.replace(/return \[x \+ lx \* c \+ lz \* s, z - lx \* s \+ lz \* c\];/,
  'return { x: x + lx * c + lz * s, z: z - lx * s + lz * c };');
writeFileSync('src/world/structures.js', src, 'utf8');
console.log((src.match(/applyAxisAngle/g) || []).length, (src.match(/l2w/g) || []).length);
console.log(src.split('\n').slice(5, 12).join('\n'));
