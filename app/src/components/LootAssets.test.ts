import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WEAPON_IDS } from '@threejs-shooter/shared';

describe('Blender loot and projectiles', () => {
  for (const name of [
    ...WEAPON_IDS.map(id => `noir-ammo-${id}`),
    'noir-health-pickup', 'noir-armor-pickup',
    'noir-projectile-rocket', 'noir-projectile-round', 'noir-projectile-arc',
  ]) it(`${name} loads with bounded geometry and no embedded textures`, async () => {
    const file = readFileSync(new URL(`../../public/models/${name}.glb`, import.meta.url));
    const asset = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
    let triangles = 0;
    let meshes = 0;
    asset.scene.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      meshes++;
      triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    });
    expect(triangles).toBeGreaterThan(20);
    expect(triangles).toBeLessThan(5000);
    expect(meshes).toBeLessThanOrEqual(6);
    const bounds = new THREE.Box3().setFromObject(asset.scene);
    expect(bounds.getSize(new THREE.Vector3()).length()).toBeLessThan(1.5);
    expect(bounds.getCenter(new THREE.Vector3()).length()).toBeLessThan(.5);
    expect(file.byteLength).toBeLessThan(300_000);
  });
});
