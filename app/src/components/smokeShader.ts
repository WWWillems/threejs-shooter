import * as THREE from "three";

/**
 * Billboarded noise-cloud shader shared by the yard's smoke generators and
 * barrels (`WorldInteractions`) and by grenade clouds (`GrenadeClouds`).
 * `tintA`/`tintB` are the dark and light ends of the cloud's colour.
 */
const smokeVertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const smokeFragment = `varying vec2 vUv;uniform float opacity;uniform float time;uniform vec3 tintA;uniform vec3 tintB;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
void main(){float n=noise(vUv*7.+vec2(time*.1,-time*.16));float edge=1.-smoothstep(.2,.5,length(vUv-.5));gl_FragColor=vec4(mix(tintA,tintB,n),edge*opacity*(.55+n*.45));}`;

/** The yard's grey-blue smoke. */
export const SMOKE_TINT = { a: new THREE.Color(0.19, 0.22, 0.24), b: new THREE.Color(0.39, 0.42, 0.43) };
/** Poison gas: a sickly yellow-green haze. */
export const GAS_TINT = { a: new THREE.Color(0.28, 0.36, 0.1), b: new THREE.Color(0.62, 0.72, 0.28) };
/** Molotov fire: deep ember red to bright flame orange. Drawn additively so it glows. */
export const FIRE_TINT = { a: new THREE.Color(0.55, 0.08, 0.0), b: new THREE.Color(1.0, 0.55, 0.12) };

export type SmokeMaterial = THREE.ShaderMaterial & {
  uniforms: {
    opacity: { value: number };
    time: { value: number };
    tintA: { value: THREE.Color };
    tintB: { value: THREE.Color };
  };
};

export function createSmokeMaterial(
  tint: { a: THREE.Color; b: THREE.Color } = SMOKE_TINT,
  blending: THREE.Blending = THREE.NormalBlending
): SmokeMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: smokeVertex,
    fragmentShader: smokeFragment,
    uniforms: {
      opacity: { value: 0 },
      time: { value: 0 },
      tintA: { value: tint.a.clone() },
      tintB: { value: tint.b.clone() },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending,
  }) as SmokeMaterial;
}
