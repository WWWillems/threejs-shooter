import * as THREE from "three";
import { GAME_EVENTS, GRENADE } from "@threejs-shooter/shared";
import type { NetworkClient } from "../net/NetworkClient";
import type { Replication } from "../net/Replication";

interface ExplosionEffect {
  group: THREE.Group;
  flash: THREE.Mesh;
  shockwave: THREE.Mesh;
  particles: THREE.Points;
  velocities: Float32Array;
  age: number;
}

const EXPLOSION_DURATION = 0.6;
const PARTICLE_COUNT = 60;

/**
 * Presentation only: draws the grenades the server simulates (read from the
 * interpolated snapshot stream) and plays a cosmetic explosion when the server
 * says one detonated. Damage arrives separately via COMBAT.HIT / CRATE.*.
 */
export class GrenadeRenderer {
  private readonly meshes = new Map<string, THREE.Mesh>();
  private readonly explosions: ExplosionEffect[] = [];
  private readonly geometry = new THREE.SphereGeometry(GRENADE.radius, 12, 10);
  private readonly material = new THREE.MeshStandardMaterial({
    color: 0x2f4f2f, // Olive-drab painted casing
    roughness: 0.6,
    metalness: 0,
  });

  constructor(
    private readonly scene: THREE.Scene,
    net: NetworkClient,
    private readonly replication: Replication
  ) {
    net.on(GAME_EVENTS.GRENADE.EXPLODED, (event) => {
      this.spawnExplosion(
        new THREE.Vector3(event.position.x, event.position.y, event.position.z)
      );
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
        mesh = new THREE.Mesh(this.geometry, this.material);
        mesh.castShadow = true;
        this.meshes.set(id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(state.position.x, state.position.y, state.position.z);
    }

    for (const [id, mesh] of this.meshes) {
      if (!grenades.has(id)) {
        this.scene.remove(mesh);
        this.meshes.delete(id);
      }
    }
  }

  private spawnExplosion(center: THREE.Vector3): void {
    const group = new THREE.Group();
    group.position.copy(center);

    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffcc66,
        transparent: true,
        opacity: 0.9,
      })
    );
    group.add(flash);

    const shockwave = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.4, 32),
      new THREE.MeshBasicMaterial({
        color: 0xff8833,
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
        color: 0xffaa44,
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
    });
  }

  private updateExplosions(delta: number): void {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const fx = this.explosions[i];
      fx.age += delta;
      const t = Math.min(fx.age / EXPLOSION_DURATION, 1);

      const flashScale = 1 + t * 2;
      fx.flash.scale.setScalar(flashScale);
      (fx.flash.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);

      const waveScale = 1 + t * (GRENADE.blastRadius / 0.4);
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
