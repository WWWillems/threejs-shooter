import { describe, it, expect } from 'vitest';
import { GAME_EVENTS, generateMap, interactionBoxes, type PropSpec, type PropType } from '@threejs-shooter/shared';
import { GameRoom } from './GameRoom';
import { MemoryClient, MemoryTransport } from '../adapters/memory';
import { WorldColliders } from '../../../app/src/environment/WorldColliders';
const prop = (id: string, type: PropType, x: number, z = 0): PropSpec => ({ id, type, position: { x, y: 0, z }, rotation: 0, scale: 1 });
function setup(props: PropSpec[]) {
    const map = { ...generateMap(), props, walls: [], cars: [], crates: [], streetLights: [], trees: [], bushes: [], cones: [], buildings: [] };
    map.shop = { ...map.shop, position: { x: 100, y: 0, z: 100 } };
    const transport = new MemoryTransport();
    let now = 0;
    const room = new GameRoom(transport, { map, clock: () => now, matchRules: { countdownMs: 0, roundMs: 100000, roundEndMs: 100, killLimit: 100 } });
    const alice = new MemoryClient('a', room, transport).connect(), bob = new MemoryClient('b', room, transport).connect();
    alice.send(GAME_EVENTS.USER.JOINED, { name: 'A' });
    bob.send(GAME_EVENTS.USER.JOINED, { name: 'B' });
    room.tick(.05, now);
    room.tick(.05, ++now);
    const move = (client: MemoryClient, x: number, z = 0) => client.send(GAME_EVENTS.PLAYER.POSITION, { position: { x, y: 1, z }, rotation: 0 });
    move(alice, 0, 2);
    move(bob, 15);
    transport.clear();
    return { map, room, transport, alice, bob, move };
}
describe('replicated world interactivity', () => {
    it('chain explosions damage nearby players once per barrel, respect falloff, and reach late joiners', () => {
        const { room, transport, alice, bob, move } = setup([prop('fuel1', 'explosive-barrel', 0), prop('fuel2', 'explosive-barrel', 1), prop('cover', 'cover-panel', 2)]);
        move(alice, 0, 3);
        move(bob, 15);
        room.damageInteraction('fuel1', 45, 'a');
        expect(transport.received('a', GAME_EVENTS.WORLD.BLAST).map(m => m.payload.id)).toEqual(['fuel1', 'fuel2']);
        expect(room.players.get('a')!.hp).toBeGreaterThan(0);
        expect(room.players.get('a')!.hp).toBeLessThan(100);
        expect(room.players.get('b')!.hp).toBe(100);
        expect(room.interactions.states.get('cover')!.hp).toBe(0);
        room.damageInteraction('fuel1', 100, 'a');
        expect(transport.received('a', GAME_EVENTS.WORLD.BLAST)).toHaveLength(2);
        new MemoryClient('late', room, transport).connect().send(GAME_EVENTS.USER.JOINED, { name: 'Late' });
        expect(transport.received('late', GAME_EVENTS.GAME.STATE).slice(-1)[0]!.payload.interactions!.find(s => s.id === 'fuel1')!.hp).toBe(0);
    });
    it('replicates gate movement and destroyed cover to client collision, restores both on round reset', () => {
        const { room, map, alice, move, transport } = setup([prop('gate', 'fence-gate', 0), prop('cover', 'cover-panel', 7)]);
        const world = new WorldColliders(map);
        const box = { min: { x: -.3, y: 0, z: -.3 }, max: { x: .3, y: 2, z: .3 } };
        expect(world.blocksMovement(box)).toBe(true);
        alice.send(GAME_EVENTS.WORLD.INTERACT, { id: 'gate' });
        room.tick(1, 2);
        world.syncInteractions(room.interactions.snapshot());
        expect(world.blocksMovement(box)).toBe(false);
        expect(world.stopsBullet({ x: 7, y: 1, z: 0 })).toBe(true);
        room.damageInteraction('cover', 80, 'a');
        world.syncInteractions(room.interactions.snapshot());
        expect(world.stopsBullet({ x: 7, y: 1, z: 0 })).toBe(false);
        move(alice, 0, 0);
        alice.send(GAME_EVENTS.WORLD.INTERACT, { id: 'gate' });
        expect(room.interactions.states.get('gate')!.targetOpen).toBe(true);
        room.tick(.05, 200000);
        room.tick(.05, 200101);
        const reset = transport.received('a', GAME_EVENTS.GAME.STATE).slice(-1)[0]!.payload.interactions!;
        world.syncInteractions(reset);
        expect(world.blocksMovement(box)).toBe(true);
        expect(world.stopsBullet({ x: 7, y: 1, z: 0 })).toBe(true);
        for (const s of reset)
            expect(interactionBoxes(map.props.find(p => p.id === s.id)!, s).length).toBeGreaterThan(0);
    });
    it('actual bullets hit destructible props and smoke intents respect range and phase', () => {
        const { room, alice, move } = setup([prop('cover', 'cover-panel', 0, -3), prop('smoke', 'smoke-zone', 10)]);
        alice.send(GAME_EVENTS.WORLD.INTERACT, { id: 'smoke' });
        expect(room.interactions.states.get('smoke')!.active).toBe(0);
        alice.send(GAME_EVENTS.WEAPON.SHOOT, { weaponType: 'pistol', action: 'shoot', data: { position: { x: 0, y: 1, z: 1.5 }, direction: { x: 0, y: 0, z: -1 } } });
        for (let i = 0; i < 15; i++)
            room.tick(.05, i + 2);
        expect(room.interactions.states.get('cover')!.hp).toBeLessThan(80);
        move(alice, 10, 2);
        alice.send(GAME_EVENTS.WORLD.INTERACT, { id: 'smoke' });
        expect(room.interactions.states.get('smoke')!.active).toBe(7);
        room.tick(8, 100);
        expect(room.interactions.states.get('smoke')!.active).toBe(0);
    });
});
