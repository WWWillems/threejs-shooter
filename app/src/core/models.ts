import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadColorTexture, loadDataTexture, loadTextureSet } from './textures';

const loader = new GLTFLoader();
const sources = new Map<string, Promise<THREE.Group>>();
const materials = new Map<string, THREE.MeshStandardMaterial>();

/**
 * Looks up (and caches) the PBR material for a generated texture slug, e.g.
 * `brick-soot` or `weathered-concrete`. Shared with code that builds raw
 * geometry (like the boundary walls) so it matches the buildings exactly.
 */
export function surface(name: string): THREE.MeshStandardMaterial | undefined {
  const slug = name.replace(/\.\d+$/, '');
  const cached = materials.get(slug);
  if (cached) return cached;
  let material: THREE.MeshStandardMaterial;
  if (slug === 'crate-planks') {
    const maps = loadTextureSet(slug);
    for (const texture of Object.values(maps)) texture.flipY = false;
    material = new THREE.MeshStandardMaterial({ map: maps.basecolor, normalMap: maps.normal,
      normalScale: new THREE.Vector2(.45, .45), roughnessMap: maps.roughness, aoMap: maps.ao });
  } else if (slug === 'trash-bag-plastic' || slug === 'oil-barrel-steel' || slug === 'forklift-yellow') {
    const maps = loadTextureSet(slug);
    for (const texture of Object.values(maps)) texture.flipY = false;
    material = new THREE.MeshStandardMaterial({
      map: maps.basecolor, normalMap: maps.normal, roughnessMap: maps.roughness,
      aoMap: maps.ao, aoMapIntensity: .65,
      normalScale: new THREE.Vector2(.65, .65),
      metalness: slug === 'trash-bag-plastic' ? 0 : slug === 'oil-barrel-steel' ? .5 : .25,
    });
  } else if (slug === 'utility-pole-timber' || slug === 'fence-galvanized-steel') {
    const maps = loadTextureSet(slug);
    for (const texture of Object.values(maps)) texture.flipY = false;
    material = new THREE.MeshStandardMaterial({
      map: maps.basecolor, normalMap: maps.normal, roughnessMap: maps.roughness,
      aoMap: maps.ao, aoMapIntensity: .5,
      normalScale: new THREE.Vector2(.55, .55),
      metalness: slug === 'utility-pole-timber' ? 0 : .7,
    });
  } else if (
    slug === 'brick-soot' ||
    slug === 'corrugated-rust' ||
    slug === 'weathered-concrete'
  ) {
    // Building UVs are box-projected in world metres in Blender, so they run past 0-1.
    const maps = loadTextureSet(slug, { repeat: 1 });
    for (const texture of Object.values(maps)) texture.flipY = false;
    material = new THREE.MeshStandardMaterial({
      map: maps.basecolor,
      normalMap: maps.normal,
      roughnessMap: maps.roughness,
      aoMap: maps.ao,
      aoMapIntensity: .7,
      normalScale: new THREE.Vector2(
        slug === 'corrugated-rust' ? .7 : .55,
        slug === 'corrugated-rust' ? .7 : .55
      ),
      metalness: slug === 'corrugated-rust' ? .45 : 0,
    });
  } else if (slug === 'noir-coat-wool') {
    const maps = loadTextureSet(slug, { repeat: 3 });
    for (const texture of Object.values(maps)) texture.flipY = false;
    material = new THREE.MeshStandardMaterial({ map: maps.basecolor, normalMap: maps.normal,
      normalScale: new THREE.Vector2(.18, .18), roughnessMap: maps.roughness, aoMap: maps.ao,
      aoMapIntensity: .35, roughness: 1 });
  } else if (slug === 'weathered-plaster') {
    const map = loadColorTexture('/textures/concrete/concrete_diffuse.jpg', { repeat: [3, 2] });
    const normalMap = loadDataTexture('/textures/concrete/concrete_normal.jpg', { repeat: [3, 2] });
    map.flipY = normalMap.flipY = false;
    material = new THREE.MeshStandardMaterial({ map, normalMap, roughness: .94,
      normalScale: new THREE.Vector2(.6, .6) });
  } else return undefined;
  materials.set(slug, material);
  return material;
}

/** Cached geometry/materials are shared by props; removing an instance only detaches it. */
export function attachModel(parent: THREE.Object3D, name: string, onReady?: (model: THREE.Group) => void): void {
  let source = sources.get(name);
  if (!source) {
    source = loader.loadAsync(`/models/${name}.glb`).then(({ scene, animations }) => {
      scene.animations = animations;
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = object.receiveShadow = true;
        const resolve = (material: THREE.Material) => surface(material.name) ?? material;
        object.material = Array.isArray(object.material) ? object.material.map(resolve) : resolve(object.material);
      });
      return scene;
    });
    sources.set(name, source);
  }
  void source.then((source) => {
    const model = cloneSkeleton(source) as THREE.Group;
    model.name = name;
    parent.add(model);
    onReady?.(model);
  }).catch((error: unknown) => console.error(`Could not load ${name}`, error));
}
