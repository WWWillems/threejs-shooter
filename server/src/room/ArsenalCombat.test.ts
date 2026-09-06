import {describe,it,expect} from 'vitest';
import {GAME_EVENTS,generateMap,aabbFromCenterSize,type WeaponId,type MapLayout} from '@threejs-shooter/shared';
import {GameRoom} from './GameRoom';
import {MemoryClient,MemoryTransport} from '../adapters/memory';
function setup(walls:MapLayout["walls"]=[]) {
 const map={...generateMap(),props:[],walls,cars:[],crates:[],streetLights:[],trees:[],bushes:[],cones:[],buildings:[]};
 map.shop={...map.shop,position:{x:100,y:0,z:100}};
 const transport=new MemoryTransport();let now=1000;
 const room=new GameRoom(transport,{map,clock:()=>now,matchRules:{countdownMs:0,roundMs:100000,roundEndMs:100,killLimit:100}});
 const clients=['a','b','c','d'].map(id=>new MemoryClient(id,room,transport).connect().send(GAME_EVENTS.USER.JOINED,{name:id}));
 room.tick(.05,now);room.tick(.05,++now);
 const move=(i:number,x:number,z:number)=>clients[i].send(GAME_EVENTS.PLAYER.POSITION,{position:{x,y:1,z},rotation:0});
 move(0,0,0);move(1,0,-5);move(2,2,-5);move(3,4,-5);transport.clear();
 const shoot=(weaponType:WeaponId,direction={x:0,y:0,z:-1})=>clients[0].send(GAME_EVENTS.WEAPON.SHOOT,{weaponType,action:'shoot',data:{position:{x:0,y:1,z:-.6},direction}});
 const tick=(n:number)=>{for(let i=0;i<n;i++){now+=50;room.tick(.05,now);}};
 return {room,transport,clients,move,shoot,tick};
}
describe('special weapon combat',()=>{
 it('rockets explode once, damage a group by distance and can hurt the shooter',()=>{
  const {room,transport,move,shoot,tick}=setup();move(1,0,-3);move(2,2,-3);move(3,12,-3);
  shoot('rocket');tick(12);
  expect(transport.received('a',GAME_EVENTS.WORLD.BLAST)).toHaveLength(1);
  expect(room.players.get('b')!.hp).toBeLessThan(room.players.get('c')!.hp);
  expect(room.players.get('c')!.hp).toBeLessThan(100);expect(room.players.get('d')!.hp).toBe(100);
  expect(room.players.get('a')!.hp).toBeLessThan(100);
 });
 it('flamethrower damages close targets but cannot reach beyond seven metres',()=>{
  const {room,move,shoot,tick}=setup();move(1,0,-3);move(2,12,-3);move(3,15,-3);
  shoot('flamethrower');tick(12);expect(room.players.get('b')!.hp).toBeLessThan(100);
  move(1,0,-10);const hp=room.players.get('b')!.hp;shoot('flamethrower');tick(12);expect(room.players.get('b')!.hp).toBe(hp);
 });
 it('precision rounds travel quickly and deal one high-damage hit',()=>{
  const {room,move,shoot,tick}=setup();move(1,0,-35);move(2,15,-5);move(3,20,-5);
  shoot('precision');tick(5);expect(room.players.get('b')!.hp).toBe(15);
 });
 it('arc gun chains to two distinct nearby targets with diminishing damage',()=>{
  const {room,transport,shoot,tick}=setup();shoot('arc');tick(4);
  expect(room.players.get('b')!.hp).toBe(68);expect(room.players.get('c')!.hp).toBe(80);expect(room.players.get('d')!.hp).toBe(88);
  expect(room.players.get('a')!.hp).toBe(100);
  expect(transport.received('a',GAME_EVENTS.WORLD.ARC)[0].payload.points).toHaveLength(4);
 });
 it('solid walls stop rockets and block splash',()=>{
  // Create a room with a wall present at construction (static collision is cached).
  const map={...generateMap(),props:[],cars:[],crates:[],streetLights:[],trees:[],bushes:[],cones:[],buildings:[],walls:[{id:'wall',box:aabbFromCenterSize({x:0,y:2,z:-3},{x:10,y:4,z:.5})}]};
  map.shop={...map.shop,position:{x:100,y:0,z:100}};
  const transport=new MemoryTransport();let now=1000;
  const room=new GameRoom(transport,{map,clock:()=>now,matchRules:{countdownMs:0,roundMs:100000,roundEndMs:100,killLimit:100}});
  const a=new MemoryClient('a',room,transport).connect().send(GAME_EVENTS.USER.JOINED,{name:'A'});
  const b=new MemoryClient('b',room,transport).connect().send(GAME_EVENTS.USER.JOINED,{name:'B'});
  room.tick(.05,now);room.tick(.05,++now);
  a.send(GAME_EVENTS.PLAYER.POSITION,{position:{x:0,y:1,z:0},rotation:0});b.send(GAME_EVENTS.PLAYER.POSITION,{position:{x:0,y:1,z:-5},rotation:0});
  a.send(GAME_EVENTS.WEAPON.SHOOT,{weaponType:'rocket',action:'shoot',data:{position:{x:0,y:1,z:-.6},direction:{x:0,y:0,z:-1}}});
  for(let i=0;i<10;i++){now+=50;room.tick(.05,now);}expect(room.players.get('b')!.hp).toBe(100);
 });
});

it('arc chains cannot jump through a solid wall',()=>{
 const {room,shoot,tick}=setup([{id:'divider',box:aabbFromCenterSize({x:1,y:1,z:-5},{x:.2,y:3,z:8})}]);
 shoot('arc');tick(5);expect(room.players.get('b')!.hp).toBe(68);expect(room.players.get('c')!.hp).toBe(100);expect(room.players.get('d')!.hp).toBe(100);
});
it('weapon loot claims are authoritative, single-use and carry matching ammo',()=>{
 const {room,clients,transport}=setup();
 room.pickups.set('loot',{spec:{id:'loot',kind:'weapon',weaponId:'rocket',amount:2,position:{x:0,y:.5,z:0}},expiresAt:10000});
 clients[1].send(GAME_EVENTS.PICKUP.CLAIM,{pickupId:'loot'});expect(room.pickups.has('loot')).toBe(true);
 clients[0].send(GAME_EVENTS.PICKUP.CLAIM,{pickupId:'loot'});clients[0].send(GAME_EVENTS.PICKUP.CLAIM,{pickupId:'loot'});
 const taken=transport.received('a',GAME_EVENTS.PICKUP.TAKEN);expect(taken).toHaveLength(1);expect(taken[0].payload.pickup).toMatchObject({kind:'weapon',weaponId:'rocket',amount:2});
});
