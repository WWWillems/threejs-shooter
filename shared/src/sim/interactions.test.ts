import { describe, expect, it } from 'vitest';
import { InteractiveWorld, interactionBoxes, smokeObscures } from './interactions';
import { aabbContains } from './aabb';
import type { PropSpec, PropType } from './props';
const prop = (type: PropType, id = type, x = 0): PropSpec => ({ id, type, position: { x, y: 0, z: 0 }, rotation: 0, scale: 1 });
const alive = (x = 0, z = 2) => ({ status: 'alive', position: { x, y: 1, z } });
describe('interactive yard rules', () => {
    it('rejects missing, distant and dead users; smoke has a finite lifetime and cooldown', () => {
        const w = new InteractiveWorld([prop('smoke-zone')]);
        expect(w.interact('missing', alive(), [])).toBe(false);
        expect(w.interact('smoke-zone', alive(20), [])).toBe(false);
        expect(w.interact('smoke-zone', { ...alive(), status: 'dead' }, [])).toBe(false);
        expect(w.interact('smoke-zone', alive(), [])).toBe(true);
        expect(w.interact('smoke-zone', alive(), [])).toBe(false);
        w.tick(8, []);
        expect(w.snapshot()[0].active).toBe(0);
        expect(w.interact('smoke-zone', alive(), [])).toBe(false);
        w.tick(14, []);
        expect(w.interact('smoke-zone', alive(), [])).toBe(true);
    });
    it('lifts gates clear of the passage, leaves guide posts, and rejects closing onto players', () => {
        const p = prop('fence-gate'), w = new InteractiveWorld([p]);
        const blocks = () => interactionBoxes(p, w.snapshot()[0]).some(b => aabbContains(b, { x: 0, y: 1, z: 0 }));
        expect(blocks()).toBe(true);
        w.interact(p.id, alive(), []);
        w.tick(1, []);
        expect(blocks()).toBe(false);
        expect(interactionBoxes(p, w.snapshot()[0]).some(b => aabbContains(b, { x: 2.02, y: 1, z: 0 }))).toBe(true);
        expect(w.interact(p.id, alive(), [alive(0, 0)])).toBe(false);
        expect(w.interact(p.id, alive(), [])).toBe(true);
        w.tick(.1, [alive(0, 0)]);
        expect(w.snapshot()[0].targetOpen).toBe(true);
    });
    it('alarms trigger from proximity, expire, and cannot be retriggered continuously', () => {
        const w = new InteractiveWorld([prop('alarm-zone')]);
        w.tick(.1, [alive()], false);
        expect(w.snapshot()[0].active).toBe(0);
        w.tick(.1, [alive()]);
        expect(w.snapshot()[0].active).toBe(4);
        w.tick(5, [alive()]);
        expect(w.snapshot()[0].active).toBe(0);
        w.tick(5, [alive()]);
        expect(w.snapshot()[0].active).toBe(4);
    });
    it('cover destruction removes collision, barrel destruction emits once, reset restores all state', () => {
        const tire = prop('tire-stack'), barrel = prop('explosive-barrel');
        const w = new InteractiveWorld([tire, barrel]);
        w.damage(tire.id, NaN);
        expect(w.states.get(tire.id)!.hp).toBe(120);
        w.damage(tire.id, 120);
        expect(interactionBoxes(tire, w.states.get(tire.id)!)).toHaveLength(0);
        expect(w.damage(barrel.id, 45)).toBe(true);
        expect(w.damage(barrel.id, 45)).toBe(false);
        expect(w.states.get(barrel.id)!.active).toBe(8);
        const snapshot = w.snapshot();
        snapshot[0].hp = 999;
        expect(w.states.get(tire.id)!.hp).toBe(0);
        w.reset();
        expect(w.states.get(tire.id)!.hp).toBe(120);
        expect(w.states.get(barrel.id)!.active).toBe(0);
    });
});

it('conceals nameplates through active smoke and reveals them once the cloud expires', () => {
    const p=prop('smoke-zone'),w=new InteractiveWorld([p]);
    w.interact(p.id,alive(),[]);const state=w.snapshot()[0];
    expect(smokeObscures({x:0,y:8,z:10},{x:0,y:1,z:0},p,state)).toBe(true);
    expect(smokeObscures({x:10,y:8,z:10},{x:10,y:1,z:0},p,state)).toBe(false);
    expect(smokeObscures({x:0,y:8,z:10},{x:0,y:1,z:0},p,{...state,active:0})).toBe(false);
});
