import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CharacterAnimator, type CharacterMotion } from './CharacterAnimator';
const bytes = readFileSync(new URL('../../public/models/noir-character.glb', import.meta.url));
const asset = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const rest: CharacterMotion = {speed:0,forward:0,strafe:0,verticalSpeed:0,grounded:true,crouched:false,dead:false,reload:0};
const make = () => new CharacterAnimator(clone(asset.scene),asset.animations);
const advance = (a:CharacterAnimator,motion:CharacterMotion,seconds=1) => {for(let t=0;t<seconds;t+=1/60)a.update(1/60,motion);};
describe('Blender character animation',()=>{
 it('exports a complete rig and independent skeletons for separate players',()=>{
  expect(asset.animations.map(a=>a.name)).toEqual(expect.arrayContaining(['Idle','Walk','Run','CrouchIdle','CrouchWalk','Jump','Fall','Land','Death']));
  const a=make(),b=make();advance(a,{...rest,speed:10,forward:10},.19);advance(b,rest,.19);
  expect(a.model.getObjectByName('ThighL')).not.toBe(b.model.getObjectByName('ThighL'));
  expect(a.model.getObjectByName('ThighL')!.quaternion.equals(b.model.getObjectByName('ThighL')!.quaternion)).toBe(false);
 });
 it('bends the crouch skeleton without scaling the character and keeps the gun near the hands',()=>{
  const a=make();advance(a,rest);const standing=a.socket!.getWorldPosition(new THREE.Vector3());
  expect(standing.y).toBeGreaterThan(1.2);expect(standing.z).toBeLessThan(-.3);
  advance(a,{...rest,crouched:true});const crouched=a.socket!.getWorldPosition(new THREE.Vector3());
  expect(crouched.y).toBeLessThan(standing.y-.15);expect(a.model.scale.y).toBe(1);
  expect(a.model.getObjectByName('ShinL')!.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.4);
 });
 it('transitions jump to fall and landing, then holds death until reset',()=>{
  const a=make();advance(a,{...rest,grounded:false,verticalSpeed:3},.1);expect(a.state).toBe('Jump');
  advance(a,{...rest,grounded:false,verticalSpeed:-3},.1);expect(a.state).toBe('Fall');
  a.update(1/60,rest);expect(a.state).toBe('Land');advance(a,{...rest,dead:true},2);
  const root=a.model.getObjectByName('Root')!;const q=root.quaternion.clone();advance(a,{...rest,dead:true},1);expect(root.quaternion.angleTo(q)).toBeLessThan(.001);
  a.reset();advance(a,rest,.3);expect(a.state).toBe('Idle');expect(root.quaternion.angleTo(q)).toBeGreaterThan(1);
 });
 it('keeps every deformed vertex finite across all authored actions',()=>{
  for(const clip of asset.animations){const scene=clone(asset.scene);const mixer=new THREE.AnimationMixer(scene);mixer.clipAction(clip).play();mixer.update(clip.duration*.53);scene.updateMatrixWorld(true);
   const bounds=new THREE.Box3().setFromObject(scene,true);expect([...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite)).toBe(true);
   expect(bounds.getSize(new THREE.Vector3()).length()).toBeLessThan(4);
  }
 });
});
