import {describe,it,expect} from 'vitest';
import {WEAPONS,WEAPON_IDS,LOOT_WEAPON_IDS,rocketBlastDamage} from './weapons';
import {Rng} from './rng';
import {rollCrateDrop} from './pickups';
import {GRENADE_KINDS,GRENADE_LOADOUT} from './grenade';
import {spawnPellets,integrateProjectile} from './projectile';
describe('expanded arsenal',()=>{
 it('has seven weapons with distinct ammunition and varied combat roles',()=>{
  expect(WEAPON_IDS).toHaveLength(7);expect(new Set(WEAPON_IDS.map(id=>WEAPONS[id].ammoType)).size).toBe(7);
  expect(WEAPONS.flamethrower.range).toBeLessThan(WEAPONS.arc.range);
  expect(WEAPONS.precision.bulletSpeed).toBeGreaterThan(WEAPONS.rocket.bulletSpeed);
  expect(rocketBlastDamage(0)).toBe(120);expect(rocketBlastDamage(5.5)).toBe(0);
 });
 it('crates roll every weapon, every throwable, and matching balanced ammo amounts',()=>{
  const rng=new Rng(44),drops=Array.from({length:1000},(_,i)=>rollCrateDrop(rng,String(i),{x:0,y:.5,z:0}));
  expect(new Set(drops.filter(p=>p.kind==='weapon').map(p=>p.kind==='weapon'?p.weaponId:''))).toEqual(new Set(WEAPON_IDS));
  for(const id of LOOT_WEAPON_IDS)expect(drops.some(p=>p.kind==='ammo'&&p.weaponId===id&&p.amount===WEAPONS[id].ammoPickup)).toBe(true);
  const throwables=drops.filter(p=>p.kind==='throwable');
  expect(new Set(throwables.map(p=>p.kind==='throwable'?p.grenadeKind:''))).toEqual(new Set(GRENADE_KINDS));
  for(const p of throwables)if(p.kind==='throwable')expect(p.amount).toBe(GRENADE_LOADOUT[p.grenadeKind].pickup);
  expect(drops.some(p=>p.kind==='health')).toBe(true);
 });
 it('short flames never overshoot their range even on a long frame; rockets stop at ground',()=>{
  const flame=spawnPellets(()=>1,'a',WEAPONS.flamethrower,{x:0,y:1,z:0},{x:0,y:0,z:-1})[1];
  expect(integrateProjectile(flame,1,[]).expired).toBe(true);expect(flame.traveled).toBeCloseTo(7);
  const rocket=spawnPellets(()=>2,'a',WEAPONS.rocket,{x:0,y:1,z:0},{x:0,y:-1,z:-1})[0];
  expect(integrateProjectile(rocket,1,[]).expired).toBe(true);expect(rocket.position.y).toBeCloseTo(0);
 });
});
