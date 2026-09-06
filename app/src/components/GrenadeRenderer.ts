import * as THREE from "three";
import {
  GAME_EVENTS,
  GRENADE,
  GRENADE_EFFECTS,
  GRENADE_KINDS,
  type GrenadeKind,
} from "@threejs-shooter/shared";
import type { NetworkClient } from "../net/NetworkClient";
import type { Replication } from "../net/Replication";
import { sfx } from "../audio/sfx";
import type { FlashOverlay } from "./FlashOverlay";
import { grenadeGeometry, grenadeMaterial } from "./grenadeMeshes";

interface ExplosionEffect {
  group: THREE.Group;
  flash: THREE.Mesh;
  shockwave: THREE.Mesh;
  particles: THREE.Points;
  velocities: Float32Array;
  age: number;
  duration: number;
  /** How far the ground ring expands by the end. */
  waveRadius: number;
}

const EXPLOSION_DURATION = 0.6;
/** A flashbang is all light and no debris: a big white burst that dies quickly. */
const FLASH_DURATION = 0.35;
/** A molotov bursts into a low orange flare; the fire itself is a cloud. */
const MOLOTOV_DURATION = 0.45;
const PARTICLE_COUNT = 60;

/**
 * Presentation only: draws the grenades the server simulates (read from the
 * interpolated snapshot stream) and plays a cosmetic detonation when the
 * server says one went off: a blast for frag, a burst of light for flash, a
 * pop for smoke and gas, a splash of flame for the molotov (their clouds are
 * drawn by `GrenadeClouds`). Damage arrives separately via COMBAT.HIT /
 * CRATE.*; being blinded arrives on the exploded event's `flashed` list and is
 * shown through `FlashOverlay`.
 */
export class GrenadeRenderer {
  private readonly meshes = new Map<string, THREE.Mesh>();
  private readonly explosions: ExplosionEffect[] = [];
  private readonly geometries: Record<GrenadeKind, THREE.BufferGeometry> = Object.fromEntries(
    GRENADE_KINDS.map((kind) => [kind, grenadeGeometry(kind)])
  ) as Record<GrenadeKind, THREE.BufferGeometry>;
  private readonly materials: Record<GrenadeKind, THREE.MeshStandardMaterial> = Object.fromEntries(
    GRENADE_KINDS.map((kind) => [kind, grenadeMaterial(kind)])
  ) as Record<GrenadeKind, THREE.MeshStandardMaterial>;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly net: NetworkClient,
    private readonly replication: Replication,
    private readonly flashOverlay: FlashOverlay
  ) {
    net.on(GAME_EVENTS.WORLD.ARC, ({points}) => {
      const vertices:THREE.Vector3[]=[];
      for(let i=1;i<points.length;i++) {
        const a=new THREE.Vector3(points[i-1].x,points[i-1].y,points[i-1].z),b=new THREE.Vector3(points[i].x,points[i].y,points[i].z);
        for(let j=0;j<=8;j++){const p=a.clone().lerp(b,j/8);if(j>0&&j<8){p.x+=(Math.random()-.5)*.25;p.y+=(Math.random()-.5)*.25;}vertices.push(p);}
      }
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(vertices),new THREE.LineBasicMaterial({color:0x88eaff,transparent:true,opacity:1,blending:THREE.AdditiveBlending}));
      this.scene.add(line);let age=0;
      const animate=(dt:number)=>{age+=dt;(line.material as THREE.LineBasicMaterial).opacity=Math.max(0,1-age/.22);if(age>=.22){this.scene.remove(line);line.geometry.dispose();(line.material as THREE.Material).dispose();window.__impactAnimations=window.__impactAnimations.filter(f=>f!==animate);}};
      window.__impactAnimations??=[];window.__impactAnimations.push(animate);
    });
    net.on(GAME_EVENTS.WORLD.BLAST, ({position}) => {
      const p = new THREE.Vector3(position.x,position.y,position.z);
      sfx.play("grenade:explode",p);this.spawnExplosion(p, 0xffcc66, 0xff8833, EXPLOSION_DURATION, GRENADE.blastRadius);
    });
    net.on(GAME_EVENTS.GRENADE.THROW, (event) => {
      sfx.play(
        "grenade:throw",
        new THREE.Vector3(
          event.position.x,
          event.position.y,
          event.position.z
        )
      );
    });

    net.on(GAME_EVENTS.GRENADE.EXPLODED, (event) => {
      const position = new THREE.Vector3(
        event.position.x,
        event.position.y,
        event.position.z
      );
      switch (event.kind) {
        case "frag":
          sfx.play("grenade:explode", position);
          this.spawnExplosion(position, 0xffcc66, 0xff8833, EXPLOSION_DURATION, GRENADE.blastRadius);
          break;
        case "flash": {
          sfx.play("grenade:flash", position);
          this.spawnExplosion(position, 0xffffff, 0xfff6c8, FLASH_DURATION, GRENADE_EFFECTS.flash.radius);
          const me = event.flashed.find((f) => f.targetId === this.net.selfId);
          if (me) this.flashOverlay.flash(me.intensity);
          break;
        }
        case "smoke":
          sfx.play("grenade:smoke", position);
          break;
        case "gas":
          sfx.play("grenade:gas", position);
          break;
        case "molotov":
          sfx.play("grenade:molotov", position);
          this.spawnExplosion(position, 0xffa040, 0xff5a1a, MOLOTOV_DURATION, GRENADE_EFFECTS.molotov.radius);
          break;
        default: {
          const unhandled: never = event.kind;
          throw new Error(`Unhandled grenade kind: ${String(unhandled)}`);
        }
      }
    });
  }

  update(delta: number): void {
    this.syncGrenades();
    this.updateExplosions(delta);
  }

  private syncGrenades(): void {
    const { grenades } = this.replication.sampleWorld(performance.now());

    for (const [id, state] of grenades) {
      let mesh = this.meshes.get(id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.geometries[state.kind], this.materials[state.kind]);
        mesh.castShadow = true;
        this.meshes.set(id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(state.position.x, state.position.y, state.position.z);
      // Canisters and bottles tumble in flight; the sphere would not show it.
      if (state.kind !== "frag") mesh.rotation.x += 0.15;
    }

    for (const [id, mesh] of this.meshes) {
      if (!grenades.has(id)) {
        this.scene.remove(mesh);
        this.meshes.delete(id);
      }
    }
  }

  /** Flash sphere, expanding ground ring and a spray of embers, in the given colours. */
  private spawnExplosion(
    center: THREE.Vector3,
    flashColor: number,
    waveColor: number,
    duration: number,
    waveRadius: number
  ): void {
    const group = new THREE.Group();
    group.position.copy(center);

    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 16, 12),
      new THREE.MeshBasicMaterial({
        color: flashColor,
        transparent: true,
        opacity: 0.9,
      })
    );
    group.add(flash);

    const shockwave = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.4, 32),
      new THREE.MeshBasicMaterial({
        color: waveColor,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      })
    );
    shockwave.rotation.x = -Math.PI / 2;
    shockwave.position.y = 0.05 - center.y;
    group.add(shockwave);

    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.8,
        Math.random() - 0.5
      ).normalize();
      const speed = 4 + Math.random() * 6;
      velocities[i * 3] = dir.x * speed;
      velocities[i * 3 + 1] = dir.y * speed;
      velocities[i * 3 + 2] = dir.z * speed;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );
    const particles = new THREE.Points(
      particleGeometry,
      new THREE.PointsMaterial({
        color: flashColor,
        size: 0.15,
        transparent: true,
        opacity: 1,
      })
    );
    group.add(particles);

    this.scene.add(group);
    this.explosions.push({
      group,
      flash,
      shockwave,
      particles,
      velocities,
      age: 0,
      duration,
      waveRadius,
    });
  }

  private updateExplosions(delta: number): void {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const fx = this.explosions[i];
      fx.age += delta;
      const t = Math.min(fx.age / fx.duration, 1);

      const flashScale = 1 + t * 2;
      fx.flash.scale.setScalar(flashScale);
      (fx.flash.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);

      const waveScale = 1 + t * (fx.waveRadius / 0.4);
      fx.shockwave.scale.setScalar(waveScale);
      (fx.shockwave.material as THREE.MeshBasicMaterial).opacity =
        0.8 * (1 - t);

      const positions = fx.particles.geometry.getAttribute(
        "position"
      ) as THREE.BufferAttribute;
      for (let p = 0; p < PARTICLE_COUNT; p++) {
        fx.velocities[p * 3 + 1] -= 9.8 * delta;
        positions.setXYZ(
          p,
          positions.getX(p) + fx.velocities[p * 3] * delta,
          positions.getY(p) + fx.velocities[p * 3 + 1] * delta,
          positions.getZ(p) + fx.velocities[p * 3 + 2] * delta
        );
      }
      positions.needsUpdate = true;
      (fx.particles.material as THREE.PointsMaterial).opacity = 1 - t;

      if (t >= 1) {
        this.scene.remove(fx.group);
        fx.flash.geometry.dispose();
        (fx.flash.material as THREE.Material).dispose();
        fx.shockwave.geometry.dispose();
        (fx.shockwave.material as THREE.Material).dispose();
        fx.particles.geometry.dispose();
        (fx.particles.material as THREE.Material).dispose();
        this.explosions.splice(i, 1);
      }
    }
  }
}
