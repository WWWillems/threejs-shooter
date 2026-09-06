import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import { CharacterAnimator } from './CharacterAnimator';
import { characterModelForTeam } from './CharacterVisual';

const clips = ['CrouchIdle', 'CrouchWalk', 'Death', 'Fall', 'Idle', 'Jump', 'Land', 'Run', 'Walk'];
it('maps the server teams to their matching character assets', () => {
    expect(characterModelForTeam('blue')).toBe('noir-character-team-a');
    expect(characterModelForTeam('red')).toBe('noir-character-team-b');
});

for (const team of ['a', 'b']) describe(`Team ${team} browser character`, () => {
  it('keeps a bounded rig, independent instances and a working weapon socket', async () => {
    const bytes = readFileSync(new URL(`../../public/models/noir-character-team-${team}.glb`, import.meta.url));
    const asset = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    expect(asset.animations.map(a => a.name).sort()).toEqual(clips);
    let triangles = 0;
    let primitives = 0;
    asset.scene.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
      primitives++;
      expect(o).toBeInstanceOf(THREE.SkinnedMesh);
      expect((o as THREE.SkinnedMesh).skeleton.bones).toHaveLength(18);
    });
    expect(triangles).toBeLessThan(18000);
    expect(primitives).toBeLessThanOrEqual(12);
    expect(bytes.byteLength).toBeLessThan(1_500_000);
    const a = new CharacterAnimator(clone(asset.scene), asset.animations);
    const b = new CharacterAnimator(clone(asset.scene), asset.animations);
    expect(a.socket).toBeDefined();
    expect(a.model.getObjectByName('Spine')).not.toBe(b.model.getObjectByName('Spine'));
    asset.scene.updateMatrixWorld(true);
    for (const side of ['L', 'R']) {
      // Catch meshes authored in a different arm pose from their preserved rig.
      const center = new THREE.Vector3();
      let totalWeight = 0;
      asset.scene.traverse(o => {
        if (!(o instanceof THREE.SkinnedMesh)) return;
        const hand = o.skeleton.bones.findIndex(bone => bone.name === `Hand${side}`);
        const { position, skinIndex, skinWeight } = o.geometry.attributes;
        for (let i = 0; i < position.count; i++) {
          let weight = 0;
          for (let j = 0; j < 4; j++) if (skinIndex.getComponent(i, j) === hand) weight += skinWeight.getComponent(i, j);
          if (weight > 0) {
            center.addScaledVector(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld), weight);
            totalWeight += weight;
          }
        }
      });
      expect(totalWeight).toBeGreaterThan(0);
      center.divideScalar(totalWeight);
      const handPosition = asset.scene.getObjectByName(`Hand${side}`)!.getWorldPosition(new THREE.Vector3());
      expect(center.distanceTo(handPosition)).toBeLessThan(.2);
    }
    for (const clip of asset.animations) {
      for (const fraction of [.15, .65, .95]) {
        const model = clone(asset.scene);
        const mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(clip).play();
        mixer.update(clip.duration * fraction);
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model, true);
        expect([...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)).toBe(true);
        expect(box.getSize(new THREE.Vector3()).length()).toBeLessThan(4);
        mixer.stopAllAction();
        mixer.uncacheRoot(model);
      }
    }
    a.dispose();
    b.dispose();
  });
});
