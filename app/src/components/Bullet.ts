import * as THREE from 'three';
import { attachModel } from '../core/models';
import {WEAPONS,type WeaponId} from '@threejs-shooter/shared';

/** Cosmetic projectile with the same speed/range as the authoritative simulation. */
export class Bullet {
  private mesh:THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;
  private tracer:THREE.Line;
  private visual?: THREE.Group;
  private removed = false;
  private velocity:THREE.Vector3;
  private previousPosition:THREE.Vector3;
  private remaining:number;
  private age=0;
  private alive=true;
  constructor(position:THREE.Vector3,direction:THREE.Vector3,scene:THREE.Scene,private readonly id:WeaponId='pistol') {
    const stats=WEAPONS[id];this.remaining=stats.range/stats.bulletSpeed;
    const flame=id==='flamethrower',rocket=id==='rocket';
    const color=flame?0xff982c:id==='arc'?0x79e8ff:rocket?0xb6b3a3:0xffdf9f;
    const geometry=flame?new THREE.IcosahedronGeometry(.14,1):new THREE.CylinderGeometry(rocket?.07:.022,rocket?.1:.022,rocket?.48:.23,8);
    this.mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,transparent:true,opacity:1,depthWrite:!flame,blending:flame?THREE.AdditiveBlending:THREE.NormalBlending}));
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.clone().normalize());
    this.mesh.position.copy(position);this.previousPosition=position.clone();
    this.velocity=direction.clone().normalize().multiplyScalar(stats.bulletSpeed);scene.add(this.mesh);
    if (!flame) {
      // Root moves with the simulation; GLB's authored forward axis is -Z.
      this.visual = new THREE.Group();
      this.visual.position.copy(position);
      this.visual.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction.clone().normalize());
      scene.add(this.visual);
      attachModel(this.visual, `noir-projectile-${rocket ? 'rocket' : id === 'arc' ? 'arc' : 'round'}`, model => {
        if (this.removed) { model.removeFromParent(); return; }
        this.mesh.visible = false;
        model.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = false; });
      });
    }

    this.tracer=new THREE.Line(new THREE.BufferGeometry().setFromPoints([position.clone(),position.clone()]),new THREE.LineBasicMaterial({color:id==='arc'?0x79e8ff:0xffb351,transparent:true,opacity:.7}));
    this.tracer.visible=!flame;scene.add(this.tracer);
  }
  update(dt:number):boolean {
    this.previousPosition.copy(this.mesh.position);
    const step=Math.min(Math.max(0,dt),this.remaining);
    this.mesh.position.addScaledVector(this.velocity,step);this.remaining-=step;this.age+=step;
    if(this.id==='flamethrower') {
      this.mesh.scale.setScalar(1+this.age*6);this.mesh.material.opacity=Math.min(1,this.remaining*5);this.mesh.material.color.setHSL(.04+this.remaining*.15,1,.55);
    }
    const positions=this.tracer.geometry.getAttribute('position');
    positions.setXYZ(0,this.mesh.position.x,this.mesh.position.y,this.mesh.position.z);
    positions.setXYZ(1,this.previousPosition.x,this.previousPosition.y,this.previousPosition.z);positions.needsUpdate=true;
    this.visual?.position.copy(this.mesh.position);
    this.alive=this.remaining>1e-6&&this.mesh.position.y>0;
    return this.alive;
  }
  remove(scene:THREE.Scene){this.removed = true; this.visual?.removeFromParent(); scene.remove(this.mesh,this.tracer);this.mesh.geometry.dispose();this.mesh.material.dispose();this.tracer.geometry.dispose();(this.tracer.material as THREE.Material).dispose();}
  isAlive(){return this.alive;}
  getPosition(){return this.mesh.position;}
}
