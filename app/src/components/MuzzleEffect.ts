import * as THREE from 'three';

/** Reused flash/smoke meshes: no per-shot geometry or perpetual animation callbacks. */
export class MuzzleEffect {
  private flash = new THREE.Group();
  private core: THREE.Mesh;
  private glow: THREE.Mesh;
  private smoke: THREE.Mesh;
  private light = new THREE.PointLight(0xffbe72, 0, 3, 2);
  private age = 1;
  private size = 1;
  private direction = new THREE.Vector3();
  private origin = new THREE.Vector3();
  private smokeMaterial: THREE.MeshBasicMaterial;
  private flashMaterial = new THREE.MeshBasicMaterial({ color: 0xffd799, toneMapped: false,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  constructor(private scene: THREE.Scene) {
    const geometry = new THREE.ConeGeometry(.095, .38, 7);
    geometry.rotateX(-Math.PI / 2); geometry.translate(0, 0, -.19);
    this.core = new THREE.Mesh(geometry, this.flashMaterial);
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(.08, 10, 6), this.flashMaterial);
    this.glow.scale.set(1, 1, 1.6);
    this.flash.add(this.core, this.glow);
    this.smokeMaterial = new THREE.MeshBasicMaterial({ color: 0x9b9890, transparent: true,
      opacity: 0, depthWrite: false });
    this.smoke = new THREE.Mesh(new THREE.IcosahedronGeometry(.065, 1), this.smokeMaterial);
    this.flash.visible = this.smoke.visible = false;
    scene.add(this.flash, this.smoke, this.light);
  }
  fire(position: THREE.Vector3, direction: THREE.Vector3, size: number): void {
    this.age = 0; this.size = size; this.origin.copy(position); this.direction.copy(direction).normalize();
    this.flash.position.copy(position);
    this.flash.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.direction);
    this.flash.rotateZ(Math.random() * Math.PI * 2);
    this.light.position.copy(position);
    this.flash.visible = this.smoke.visible = true;
    this.update(0);
  }
  update(dt: number): void {
    this.age += dt;
    const fade = Math.max(0, 1 - this.age / .055);
    this.flash.visible = fade > 0;
    this.flash.scale.setScalar(this.size * (.65 + fade * .45));
    this.flashMaterial.opacity = fade;
    this.light.intensity = fade * 8 * this.size;
    this.smoke.visible = this.age < .32;
    this.smoke.position.copy(this.origin).addScaledVector(this.direction, this.age * .5);
    this.smoke.position.y += this.age * .22;
    this.smoke.scale.setScalar(1 + this.age * 5);
    this.smokeMaterial.opacity = Math.max(0, 1 - this.age / .32) * .16;
  }
  dispose(): void {
    this.scene.remove(this.flash, this.smoke, this.light);
    this.core.geometry.dispose(); this.glow.geometry.dispose(); this.smoke.geometry.dispose();
    this.flashMaterial.dispose(); this.smokeMaterial.dispose();
  }
}
