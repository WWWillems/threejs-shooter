import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { wetSurfaceGLSL } from './wetSurface';
import { loadTextureSet } from './textures';

/** Wet asphalt: PBR aggregate plus a single masked, low-resolution reflection pass. */
export class Ground {
  constructor(scene: THREE.Scene) {
    const maps = loadTextureSet('wet-asphalt', { repeat: 64 });
    const material = new THREE.MeshPhysicalMaterial({
      map: maps.basecolor, normalMap: maps.normal,
      normalScale: new THREE.Vector2(.65, .65), roughnessMap: maps.roughness,
      roughness: 1, aoMap: maps.ao, aoMapIntensity: .6,
      metalness: 0, clearcoat: .22, clearcoatRoughness: .45, clearcoatRoughnessMap: maps.roughness,
      clearcoatNormalMap: maps.normal, clearcoatNormalScale: new THREE.Vector2(.5, .5),
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = 'varying vec2 rainMetres;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\nrainMetres = uv * 400.0;'
      );
      shader.fragmentShader = 'varying vec2 rainMetres;\n' + wetSurfaceGLSL + shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float basinWet = rainPuddle(rainMetres);
        roughnessFactor = mix(clamp(roughnessFactor + .25, .5, 1.0), .16, basinWet * .88);
        diffuseColor.rgb *= mix(1.0, .78, basinWet);`
      );
    };
    material.customProgramCacheKey = () => 'asphalt-puddle-basins-v2';
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), material);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Reflection coverage follows the same roughness texture as the surface.
    // It is strongest in smooth hollows and breaks apart over the aggregate.
    const reflection = new Reflector(new THREE.PlaneGeometry(400, 400), {
      textureWidth: 768, textureHeight: 768, multisample: 0, clipBias: .003,
      shader: {
        name: 'Rain puddles',
        uniforms: {
          tDiffuse: { value: null }, color: { value: new THREE.Color() },
          textureMatrix: { value: new THREE.Matrix4() },
          roughnessMap: { value: null }, normalMap: { value: null },
        },
        vertexShader: `
          uniform mat4 textureMatrix;
          varying vec4 reflectionUv;
          varying vec2 surfaceUv;
          varying vec2 rainMetres;
          varying vec3 worldPosition;
          void main() {
            surfaceUv = uv * 64.0;
            rainMetres = uv * 400.0;
            reflectionUv = textureMatrix * vec4(position, 1.0);
            worldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          ${wetSurfaceGLSL}
          uniform sampler2D tDiffuse;
          uniform sampler2D roughnessMap;
          uniform sampler2D normalMap;
          varying vec4 reflectionUv;
          varying vec2 surfaceUv;
          varying vec2 rainMetres;
          varying vec3 worldPosition;
          void main() {
            float roughness = texture2D(roughnessMap, surfaceUv).g;
            vec2 distortion = texture2D(normalMap, surfaceUv).xy * 2.0 - 1.0;
            vec2 uv = reflectionUv.xy / reflectionUv.w + distortion * .004;
            vec3 reflected = texture2D(tDiffuse, uv).rgb;
            float wet = rainPuddle(rainMetres) * .8 + (1.0 - smoothstep(.28, .64, roughness)) * .12;
            vec3 viewDir = normalize(cameraPosition - worldPosition);
            float fresnel = .12 + .5 * pow(1.0 - abs(viewDir.y), 3.0);
            gl_FragColor = vec4(reflected, wet * fresnel * (1.0 - smoothstep(65.0, 105.0, length(cameraPosition - worldPosition))));
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      },
    });
    reflection.rotation.x = -Math.PI / 2;
    reflection.position.y = .012;
    const reflectionMaterial = reflection.material as THREE.ShaderMaterial;
    reflectionMaterial.uniforms.roughnessMap.value = maps.roughness;
    reflectionMaterial.uniforms.normalMap.value = maps.normal;
    reflectionMaterial.transparent = true;
    reflectionMaterial.depthWrite = false;
    scene.add(reflection);
  }
}
