import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {WEAPONS,LOOT_WEAPON_IDS} from '@threejs-shooter/shared';
vi.mock('../core/models',()=>({attachModel:(parent:THREE.Group,_name:string,ready?:(model:THREE.Group)=>void)=>{const model=new THREE.Group();const muzzle=new THREE.Object3D();muzzle.name='Muzzle';muzzle.position.set(0,0,-.5);model.add(muzzle);parent.add(model);ready?.(model);}}));
import {WeaponSystem} from './Weapon';
let now=5000;
beforeEach(()=>{vi.stubGlobal('window',{__impactAnimations:[]});vi.spyOn(performance,'now').mockImplementation(()=>now);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function system(){return new WeaponSystem(new THREE.Scene(),new THREE.Mesh(),null);}
describe('looted weapon inventory',()=>{
 it('retains dedicated ammo before acquisition and never gives fuel to another gun',()=>{
  const w=system();w.addAmmoById('flamethrower',40);w.addAmmoById('rocket',2);
  w.grantWeapon('flamethrower',20);expect(w.getCurrentWeapon().totalBullets).toBe(60);
  w.grantWeapon('rocket',2);expect(w.getCurrentWeapon().totalBullets).toBe(4);
  expect(w.getInventory()[0].totalBullets).toBe(120);w.dispose();
 });
 it('adds four looted guns, merges duplicate loot, and switches all seven slots',()=>{
  const w=system();for(const id of LOOT_WEAPON_IDS)w.grantWeapon(id);
  expect(w.getInventory()).toHaveLength(7);const reserve=w.getCurrentWeapon().totalBullets;
  w.grantWeapon('arc');expect(w.getInventory()).toHaveLength(7);expect(w.getCurrentWeapon().totalBullets).toBe(reserve+WEAPONS.arc.ammoPickup+WEAPONS.arc.magazineSize);
  for(let i=0;i<7;i++){w.switchToWeapon(i);expect(w.getCurrentWeaponIndex()).toBe(i);}w.dispose();
 });
 it('consumes one rocket per trigger and reloads only from its own reserve',()=>{
  const w=system();w.grantWeapon('rocket',2);const scene=new THREE.Scene();w.shoot(scene);
  expect(w.getCurrentWeapon().bulletsInMagazine).toBe(0);now+=2000;expect(w.shoot(scene)).toBe(null);
  w.reload();now+=3000;expect(w.checkReloadProgress(now)).toBe(true);w.completeReload();
  expect(w.getCurrentWeapon().bulletsInMagazine).toBe(1);expect(w.getCurrentWeapon().totalBullets).toBe(1);w.dispose();
 });
});
