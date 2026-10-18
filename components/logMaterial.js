import * as THREE from 'three';
import { NOISE } from '@/lib/glsl';
import { getN3 } from '@/lib/noise3d';

// Shared uniforms so every log material follows the same clock.
export const logUniforms = {
  uTime: { value: 0 },
  uGlow: { value: 1 }, // ember glow multiplier (higher in "embers" mode)
  uHighlight: { value: -1 }, // instance id to highlight (your log)
  uHighlightAmt: { value: 0 },
};

// Bark, end-grain rings, charring and glowing ember cracks, all procedural.
// Expects instanced attributes: aIgnite, aSeed, aLen, aRad.
export function makeLogMaterial({ instanced = true } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, logUniforms);
    shader.uniforms.uN3 = getN3();
    if (!instanced) {
      mat.userData.single = mat.userData.single || {
        aIgnite: { value: 1e9 },
        aSeed: { value: 3 },
        aLen: { value: 1.3 },
        aRad: { value: 0.075 },
      };
      Object.assign(shader.uniforms, { uSelfGlow: { value: 0 } }, mat.userData.single);
    }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        ${NOISE}
        ${instanced ? 'attribute float aIgnite; attribute float aSeed; attribute float aLen; attribute float aRad;' : 'uniform float aIgnite; uniform float aSeed; uniform float aLen; uniform float aRad;'}
        varying vec3 vLocal; varying vec3 vLocalN; varying float vIgn; varying float vSeed; varying float vLen; varying float vRad; varying float vInst; varying vec3 vWP;`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        float ang0 = atan(position.z, position.x);
        float wob = (vnoise(vec3(position.y*aLen*1.3, aSeed, 0.0))-0.5)*0.22
                  + (vnoise(vec3(cos(ang0)*2.0, sin(ang0)*2.0, position.y*aLen*6.0 + aSeed))-0.5)*0.12;
        transformed.xz *= 1.0 + wob;
        // taper the very ends a little
        transformed.xz *= 1.0 - smoothstep(0.42, 0.5, abs(position.y))*0.08;
        vLocal = position; vLocalN = normal; vIgn = aIgnite; vSeed = aSeed; vLen = aLen; vRad = aRad;
        #ifdef USE_INSTANCING
          vInst = float(gl_InstanceID);
          vWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vInst = -2.0;
          vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${NOISE}
        uniform float uTime; uniform float uGlow; uniform float uHighlight; uniform float uHighlightAmt; uniform float uSelfGlow;
        varying vec3 vLocal; varying vec3 vLocalN; varying float vIgn; varying float vSeed; varying float vLen; varying float vRad; varying float vInst; varying vec3 vWP;
        float gBurn; float gChar; vec3 gEmit;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float ang = atan(vLocal.z, vLocal.x);
        float along = vLocal.y * vLen;
        float circ = ang * vRad;           // arc length around the log (metres)
        bool cap = abs(vLocalN.y) > 0.5;
        vec2 sp = vec2(cos(ang), sin(ang));
        float streak = fbm3(vec3(sp*2.0*(vRad*20.0), along*3.0 + vSeed));
        float groove = fbm3(vec3(sp*(vRad*90.0) + streak*1.5, along*0.9 + vSeed*1.7));
        float fiss = smoothstep(0.42, 0.58, groove);
        vec3 bark = mix(vec3(0.075,0.055,0.04), vec3(0.30,0.22,0.15), fiss*0.75 + streak*0.35);
        bark = mix(bark, vec3(0.34,0.33,0.28), smoothstep(0.62,0.75, fbm3(vec3(sp*6.0, along*2.0 + vSeed*3.0)))*0.35);
        if (cap) {
          float r = length(vLocal.xz);
          float rn = fbm3(vec3(vLocal.xz*4.0, vSeed));
          float rings = sin((r + rn*0.08)*34.0)*0.5+0.5;
          vec3 wood = mix(vec3(0.26,0.18,0.11), vec3(0.45,0.34,0.22), rings*0.6 + rn*0.4);
          wood *= 1.0 - smoothstep(0.0, 0.08, 0.12 - abs(fbm3(vec3(vLocal.xz*6.0, vSeed+5.0))-0.5))*0.0;
          bark = mix(wood, bark, smoothstep(0.84, 0.93, r));
        }
        // ---- burning ----
        float bt = uTime - vIgn;
        gBurn = clamp(bt / 45.0, 0.0, 1.0);
        float axisD = length(vWP.xz);
        float core = 1.0 - smoothstep(0.12, 1.1, axisD);
        float low = 1.0 - smoothstep(0.0, 0.45, vWP.y);
        float heatZone = clamp(core * 0.85 + low * 0.45, 0.0, 1.0);
        float charN = fbm3(vec3(sp*vRad*9.0, along*4.0 + vSeed*0.7));
        float charP = gBurn*1.4 + heatZone*min(bt*0.08, 0.6) - 0.08;
        gChar = bt > 0.0 ? smoothstep(charN - 0.1, charN + 0.1, charP) : 0.0;
        vec3 q = vec3(sp*vRad*17.0, along*8.0 + vSeed);
        vec3 charC = mix(vec3(0.016,0.014,0.012), vec3(0.075,0.07,0.065), smoothstep(0.5,0.8, fbm3(q*1.7)));
        vec3 ash = vec3(0.30,0.29,0.27);
        charC = mix(charC, ash, smoothstep(0.7, 1.0, gBurn) * smoothstep(0.55,0.75, fbm3(q*0.8 + 7.0)) * 0.55);
        diffuseColor.rgb = mix(bark, charC, gChar);
        // glowing alligator cracks and ember patches, strongest inside the pile
        float cr = fbm3(q);
        float crack = 1.0 - smoothstep(0.0, 0.04, abs(cr - 0.5));
        float cell = fbm3(q*0.55 + 4.0);
        float flick = 0.45 + 0.55*fbm3(vec3(sp*2.0 + vec2(0.0, uTime*0.45 + vSeed), along*1.2));
        float deep = smoothstep(0.18, 0.7, gBurn);
        float glowAmt = gChar * flick * (crack * deep * (0.06 + 0.94*heatZone) + smoothstep(0.55, 0.8, cell) * heatZone * (0.08 + deep));
        gEmit = vec3(1.0, 0.25, 0.035) * (glowAmt * 0.85 + gChar * heatZone * 0.05) * uGlow;
        gEmit += vec3(1.0, 0.62, 0.25) * uSelfGlow;
        if (abs(vInst - uHighlight) < 0.5) gEmit += vec3(1.0, 0.75, 0.35) * uHighlightAmt * 0.35;
        `,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += gEmit;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.95, 0.8, gChar);`,
      );
  };
  mat.customProgramCacheKey = () => (instanced ? 'log-inst' : 'log-single');
  return mat;
}
