import * as THREE from 'three';

/** A faint, depth-tested shaft of mist around a practical light. */
export function lightHaze(color: number, length: number, radius: number, opacity = .04): THREE.Mesh {
  const geometry = new THREE.ConeGeometry(radius, length, 32, 1, true);
  geometry.translate(0, -length / 2, 0);
  const material = new THREE.ShaderMaterial({
    uniforms: { tint: { value: new THREE.Color(color) }, opacity: { value: opacity } },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vNormal = normalMatrix * normal;
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vView = -view.xyz;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `
      uniform vec3 tint;
      uniform float opacity;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float edge = pow(abs(dot(normalize(vNormal), normalize(vView))), 1.6);
        float endFade = smoothstep(0.0, .35, vUv.y) * (1.0 - smoothstep(.85, 1.0, vUv.y));
        gl_FragColor = vec4(tint, opacity * edge * endFade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Mesh(geometry, material);
}
