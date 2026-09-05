/** Shared world-scale puddle mask keeps the asphalt and its reflection aligned. */
export const wetSurfaceGLSL = `
  float rainHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float rainNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(rainHash(i), rainHash(i + vec2(1.0, 0.0)), f.x),
               mix(rainHash(i + vec2(0.0, 1.0)), rainHash(i + vec2(1.0)), f.x), f.y);
  }
  float rainPuddle(vec2 metres) {
    vec2 p = metres * .22;
    float basin = rainNoise(p) * .7 + rainNoise(p * 2.1 + 8.3) * .3;
    return smoothstep(.43, .65, basin);
  }
`;
