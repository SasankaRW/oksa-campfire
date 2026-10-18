// Cheap noise: one lookup into a shared tileable 3D fbm texture (see noise3D()).
// Materials that use this must provide the `uN3` uniform.
export const NOISE = /* glsl */ `
uniform highp sampler3D uN3;
float fbm3(vec3 p){ return texture(uN3, p * 0.25).r; }
float vnoise(vec3 p){ return texture(uN3, p * 0.25).r; }
float fbm2(vec2 p){ return fbm3(vec3(p, 0.0)); }
`;
