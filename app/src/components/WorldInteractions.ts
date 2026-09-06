import * as THREE from 'three';
import { GAME_EVENTS, initialInteractions, interactionDistance, smokeObscures, type InteractionState, type MapLayout, type PropSpec } from '@threejs-shooter/shared';
import { sfx } from '../audio/sfx';
import type { NetworkClient } from '../net/NetworkClient';
import type { EnvironmentBuilder } from '../environment/EnvironmentBuilder';
import type { WorldColliders } from '../environment/WorldColliders';
import { createSmokeMaterial, type SmokeMaterial } from './smokeShader';
interface Effect {
    root: THREE.Group;
    light?: THREE.PointLight;
    flames: THREE.Mesh[];
    smoke: THREE.Mesh<THREE.PlaneGeometry, SmokeMaterial>[];
    beacon?: THREE.Mesh;
}
/** Cosmetic effects consume server state; only the server decides damage, timers and gate travel. */
export class WorldInteractions {
    private states = new Map<string, InteractionState>();
    private readonly effects = new Map<string, Effect>();
    private readonly hint = document.createElement('div');
    private near?: PropSpec;
    private time = 0;
    private readonly nextAlarm = new Map<string, number>();
    private readonly orientation = new THREE.Quaternion();
    constructor(private readonly map: MapLayout, private readonly environment: EnvironmentBuilder, private readonly world: WorldColliders, private readonly net: NetworkClient, private readonly player: THREE.Object3D, private readonly camera: THREE.Camera, private readonly canInteract: () => boolean) {
        this.hint.style.cssText = 'position:fixed;left:50%;bottom:190px;transform:translateX(-50%);padding:7px 12px;border:1px solid #b89b64;background:#161b20e8;color:#e9d5aa;font:12px monospace;pointer-events:none;display:none;z-index:15';
        document.body.append(this.hint);
        for (const p of map.props) {
            const visual = environment.propVisuals.get(p.id);
            if (!visual)
                continue;
            const root = new THREE.Group();
            visual.add(root);
            const effect: Effect = { root, flames: [], smoke: [] };
            this.effects.set(p.id, effect);
            if (p.type === 'fire-barrel') {
                for (let i = 0; i < 5; i++) {
                    const flame = new THREE.Mesh(new THREE.ConeGeometry(.13, .7, 7), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffa830 : 0xff5e13, transparent: true, opacity: .72, depthWrite: false, blending: THREE.AdditiveBlending }));
                    flame.position.set(Math.sin(i * 2.4) * .13, 1.05, Math.cos(i * 2.4) * .13);
                    root.add(flame);
                    effect.flames.push(flame);
                }
                effect.light = new THREE.PointLight(0xff913f, 5, 5, 2);
                effect.light.position.y = 1.3;
                root.add(effect.light);
            }
            if (['smoke-zone', 'explosive-barrel', 'fire-barrel'].includes(p.type)) {
                const count = p.type === 'fire-barrel' ? 3 : 9;
                for (let i = 0; i < count; i++) {
                    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), createSmokeMaterial());
                    root.add(mesh);
                    effect.smoke.push(mesh);
                }
            }
            if (p.type === 'warning-light' || p.type === 'alarm-zone') {
                const beacon = new THREE.Mesh(new THREE.SphereGeometry(.14, 12, 8), new THREE.MeshBasicMaterial({ color: p.type === 'alarm-zone' ? 0xff4433 : 0xffb94d }));
                beacon.position.y = 1.66;
                root.add(beacon);
                effect.beacon = beacon;
                effect.light = new THREE.PointLight(p.type === 'alarm-zone' ? 0xff4526 : 0xffac45, 0, 5, 2);
                effect.light.position.y = 1.7;
                root.add(effect.light);
            }
            if (p.type === 'alarm-zone') {
                const ring = new THREE.Mesh(new THREE.RingGeometry(2.94, 3, 64), new THREE.MeshBasicMaterial({ color: 0xb7583d, transparent: true, opacity: .2, depthWrite: false, side: THREE.DoubleSide }));
                ring.rotation.x = -Math.PI / 2;
                ring.position.y = .025;
                root.add(ring);
            }
        }
        this.sync(initialInteractions(map.props));
        net.on(GAME_EVENTS.GAME.STATE, s => this.sync(s.interactions ?? initialInteractions(map.props)));
        net.on(GAME_EVENTS.WORLD.SNAPSHOT, s => { if (s.interactions)
            this.sync(s.interactions, true); });
    }
    private sync(states: InteractionState[], feedback = false) {
        if (feedback)
            for (const state of states) {
                const before = this.states.get(state.id), p = this.map.props.find(p => p.id === state.id);
                if (!before || !p)
                    continue;
                const at = new THREE.Vector3(p.position.x, p.position.y, p.position.z);
                if (state.hp < before.hp)
                    sfx.play(state.hp === 0 ? 'crate:break' : 'crate:hit', at);
                if (state.targetOpen !== before.targetOpen)
                    sfx.play('world:gate', at);
                if (p.type === 'smoke-zone' && state.active > before.active + .5)
                    sfx.play('world:smoke', at);
            }
        else
            this.nextAlarm.clear();
        this.states = new Map(states.map(s => [s.id, { ...s }]));
        this.world.syncInteractions(states);
    }
    obscuresNameplate(position: THREE.Vector3): boolean {
        return this.map.props.some(p=>{const state=this.states.get(p.id);return state ? smokeObscures(this.camera.position,position,p,state) : false;});
    }
    interact() { if (this.near && this.canInteract())
        this.net.send(GAME_EVENTS.WORLD.INTERACT, { id: this.near.id }); }
    update(dt: number) {
        this.time += dt;
        this.near = undefined;
        let nearest = 3;
        for (const p of this.map.props) {
            const visual = this.environment.propVisuals.get(p.id), effect = this.effects.get(p.id), s = this.states.get(p.id);
            if (!visual || !effect)
                continue;
            if (s) {
                s.active = Math.max(0, s.active - dt);
                s.cooldown = Math.max(0, s.cooldown - dt);
            }
            // Keep effects alive after destruction; hide only the asynchronously loaded model.
            for (const child of visual.children)
                if (child !== effect.root && child.name !== 'GateFrame')
                    child.visible = !s || s.hp > 0;
            if (p.type === 'fence-gate') {
                const panel = visual.getObjectByName('MovingGate');
                if (panel)
                    panel.position.y = (s?.open ?? 0) * 3;
            }
            if ((p.type === 'fence-gate' || p.type === 'smoke-zone') && this.canInteract() && Math.abs(this.player.position.y - p.position.y) < 3) {
                const distance = interactionDistance(this.player.position, p.position) / p.scale;
                if (distance < nearest) {
                    nearest = distance;
                    this.near = p;
                }
            }
            effect.flames.forEach((flame, i) => {
                const pulse = .75 + .25 * Math.sin(this.time * 9 + i * 2) + .1 * Math.sin(this.time * 17 + i);
                flame.scale.set(.85 + pulse * .12, pulse, 1);
                flame.rotation.z = .13 * Math.sin(this.time * 5 + i);
                flame.position.y = .84 + .35 * pulse;
            });
            if (p.type === 'fire-barrel' && effect.light)
                effect.light.intensity = 4 + .8 * Math.sin(this.time * 11) + .4 * Math.sin(this.time * 19);
            if (p.type === 'alarm-zone' && (s?.active ?? 0) > 0 && this.time >= (this.nextAlarm.get(p.id) ?? 0)) {
                sfx.play('world:alarm', new THREE.Vector3(p.position.x, p.position.y, p.position.z));
                this.nextAlarm.set(p.id, this.time + 1);
            }
            if (effect.beacon && effect.light) {
                const active = p.type === 'warning-light' || (s?.active ?? 0) > 0;
                const pulse = active ? Math.pow(.5 + .5 * Math.sin(this.time * Math.PI * 2), 4) : 0;
                effect.light.intensity = pulse * 5;
                effect.beacon.visible = pulse > .15;
            }
            const ambient = p.type === 'fire-barrel', remaining = s?.active ?? 0;
            effect.smoke.forEach((mesh, i) => {
                const phase = (this.time * .12 + i * .137) % 1;
                const angle = i * 2.399 + this.time * .05;
                const radius = ambient ? .12 : 1.6;
                mesh.position.set(Math.cos(angle) * radius, .8 + phase * (ambient ? 2.5 : 1.7), Math.sin(angle) * radius);
                mesh.scale.setScalar(ambient ? (.6 + phase) : 3.6 + phase);
                // Account for prop rotation when facing the camera.
                mesh.quaternion.copy(visual.getWorldQuaternion(this.orientation).invert()).multiply(this.camera.quaternion);
                mesh.material.uniforms.time.value = this.time + i;
                mesh.material.uniforms.opacity.value = ambient ? .18 * Math.sin(phase * Math.PI) : Math.min(1, remaining / 1.5) * .8;
                mesh.visible = ambient || remaining > 0;
            });
        }
        this.hint.style.display = this.near ? 'block' : 'none';
        if (this.near) {
            const s = this.states.get(this.near.id);
            this.hint.textContent = this.near.type === 'fence-gate' ? `V — ${s?.targetOpen ? 'Close' : 'Open'} gate` :
                (s?.cooldown ?? 0) > 0 ? `Smoke recharging · ${Math.ceil(s!.cooldown)}s` : 'V — Release smoke';
        }
    }
}
