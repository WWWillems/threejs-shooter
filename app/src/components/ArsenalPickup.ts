import * as THREE from 'three';
import { WEAPONS,type WeaponId } from '@threejs-shooter/shared';
import { Pickup } from './Pickup';
import { attachModel } from '../core/models';
/** Server-owned weapon loot, visually distinct from the matching ammunition box. */
export class ArsenalPickup extends Pickup {
  constructor(scene:THREE.Scene,position:THREE.Vector3,id:WeaponId){super(scene,position,{weaponId:id});}
  protected createMesh():THREE.Object3D {
    const id=this.pickupData.weaponId as WeaponId;
    const root=new THREE.Group();const gun=new THREE.Group();gun.rotation.z=-Math.PI/5;gun.scale.setScalar(1.4);root.add(gun);attachModel(gun,`noir-${id}`);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.5,.025,6,32),new THREE.MeshBasicMaterial({color:WEAPONS[id].color}));ring.rotation.x=Math.PI/2;ring.position.y=-.35;root.add(ring);
    let age=0;window.__pickupAnimations??=[];window.__pickupAnimations.push(dt=>{if(!root.parent)return false;age+=dt;gun.position.y=Math.sin(age*2)*.1;gun.rotation.y+=dt*.5;return true;});
    return root;
  }
  protected getPickupType():string{return `weapon_${this.pickupData.weaponId}`;}
}
