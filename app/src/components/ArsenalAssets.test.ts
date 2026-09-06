import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import {LOOT_WEAPON_IDS} from '@threejs-shooter/shared';
describe('Blender arsenal exports',()=>{
 for(const id of LOOT_WEAPON_IDS)it(`${id} has a usable muzzle, compact bounds and an inventory icon`,async()=>{
  const bytes=readFileSync(new URL(`../../public/models/noir-${id}.glb`,import.meta.url));
  const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  let muzzle:THREE.Object3D|undefined;scene.traverse(o=>{if(o.name.replace(/\.\d+$/,'')==='Muzzle')muzzle=o;});
  expect(muzzle).toBeDefined();expect(muzzle!.getWorldPosition(new THREE.Vector3()).z).toBeLessThan(-.65);
  const size=new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());expect(size.z).toBeLessThan(1.8);expect(size.x).toBeLessThan(.5);
  const icon=readFileSync(new URL(`../../public/icons/noir-${id}.png`,import.meta.url));expect(icon.subarray(1,4).toString()).toBe('PNG');
 });
});
