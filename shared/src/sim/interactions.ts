import { isDynamicProp, propBoxes, type PropSpec } from './props';
import type { Vec3 } from '../types';
import { aabbIntersects, aabbFromCenterSize } from './aabb';
export interface InteractionState {
    id: string;
    hp: number;
    open: number;
    targetOpen: boolean;
    active: number;
    cooldown: number;
}
/** Smoke conceals labels too; CSS nameplates otherwise draw through the cloud. */
export function smokeObscures(from: Vec3, to: Vec3, prop: PropSpec, state: InteractionState): boolean {
    if (state.active <= .75 || !['smoke-zone', 'explosive-barrel'].includes(prop.type)) return false;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const cx = prop.position.x - from.x;
    const cy = prop.position.y + 1.5 * prop.scale - from.y;
    const cz = prop.position.z - from.z;
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, (cx * dx + cy * dy + cz * dz) / lengthSquared)) : 0;
    return Math.hypot(cx - t * dx, cy - t * dy, cz - t * dz) < 2.8 * prop.scale;
}
export const interactionHp = (type: string): number => type === 'explosive-barrel' ? 45 : type === 'tire-stack' ? 120 : type === 'cover-panel' ? 80 : 1;
export function initialInteractions(props: readonly PropSpec[]): InteractionState[] {
    return props.filter(p => isDynamicProp(p.type)).map(p => ({ id: p.id, hp: interactionHp(p.type), open: 0, targetOpen: false, active: 0, cooldown: 0 }));
}
export function interactionBoxes(prop: PropSpec, state: InteractionState) {
    if (state.hp <= 0)
        return [];
    const guides = prop.type === 'fence-gate' ? [-2.02, 2.02].map(x => {
        const c = Math.cos(prop.rotation), sin = Math.sin(prop.rotation), k = prop.scale;
        return aabbFromCenterSize({ x: prop.position.x + x * c * k, y: prop.position.y + 2.75 * k, z: prop.position.z - x * sin * k }, { x: .26 * k, y: 5.5 * k, z: .3 * k });
    }) : [];
    return [...guides, ...propBoxes({ ...prop, position: { ...prop.position, y: prop.position.y + (prop.type === 'fence-gate' ? state.open * 3 * prop.scale : 0) } })];
}
export const interactionDistance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
export interface InteractionPlayer {
    position?: Vec3;
    status: string;
}
/** Deterministic state machine shared by tests and the authoritative room. */
export class InteractiveWorld {
    readonly specs: Map<string, PropSpec>;
    readonly states = new Map<string, InteractionState>();
    constructor(props: readonly PropSpec[]) {
        this.specs = new Map(props.filter(p => isDynamicProp(p.type)).map(p => [p.id, p]));
        this.reset();
    }
    reset() {
        this.states.clear();
        for (const s of initialInteractions([...this.specs.values()])) this.states.set(s.id, s);
    }
    snapshot() { return [...this.states.values()].map(s => ({ ...s })); }
    interact(id: string, player: InteractionPlayer, players: readonly InteractionPlayer[]): boolean {
        const p = this.specs.get(id), s = this.states.get(id);
        if (!p || !s || !player.position || player.status !== 'alive' || s.hp <= 0 || s.cooldown > 0 || interactionDistance(p.position, player.position) > 3 * p.scale || Math.abs(player.position.y - p.position.y) > 3)
            return false;
        if (p.type === 'fence-gate') {
            if (s.targetOpen && this.occupied(p, players))
                return false;
            s.targetOpen = !s.targetOpen;
            s.cooldown = 1;
            return true;
        }
        if (p.type === 'smoke-zone') {
            s.active = 7;
            s.cooldown = 22;
            return true;
        }
        return false;
    }
    private occupied(p: PropSpec, players: readonly InteractionPlayer[]) {
        return players.some(player => player.status === 'alive' && player.position && propBoxes(p).some(b => aabbIntersects(b, aabbFromCenterSize(player.position!, { x: 1.4, y: 2, z: 1.4 }))));
    }
    tick(dt: number, players: readonly InteractionPlayer[], enabled = true) {
        for (const [id, s] of this.states) {
            const p = this.specs.get(id)!;
            s.active = Math.max(0, s.active - dt);
            s.cooldown = Math.max(0, s.cooldown - dt);
            if (p.type === 'fence-gate') {
                if (!s.targetOpen && s.open > 0 && this.occupied(p, players))
                    s.targetOpen = true;
                s.open = Math.max(0, Math.min(1, s.open + (s.targetOpen ? 1 : -1) * dt));
            }
            if (enabled && p.type === 'alarm-zone' && s.cooldown === 0 && players.some(v => v.status === 'alive' && v.position && interactionDistance(p.position, v.position) < 3 * p.scale && Math.abs(v.position.y - p.position.y) < 3)) {
                s.active = 4;
                s.cooldown = 10;
            }
        }
    }
    /** Returns true only for the first destruction of an explosive barrel. */
    damage(id: string, damage: number): boolean {
        const s = this.states.get(id), p = this.specs.get(id);
        if (!s || !p || !['tire-stack', 'cover-panel', 'explosive-barrel'].includes(p.type) || s.hp <= 0 || !Number.isFinite(damage) || damage <= 0)
            return false;
        s.hp = Math.max(0, s.hp - damage);
        if (s.hp === 0 && p.type === 'explosive-barrel') {
            s.active = 8;
            return true;
        }
        return false;
    }
}
