import { ATMOS_GLSL } from '../src/shaders/common.js';
const s = `${ATMOS_GLSL.replace('uniform vec4 uAtmos[6];', '').replace('uniform vec3 uCamPos;', '')}
        gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vWorld);`;
console.log(JSON.stringify(s.slice(0, 240)));
console.log('---FULL---');
console.log(s);
