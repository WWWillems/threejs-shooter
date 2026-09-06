import * as THREE from 'three';
import {type MapLayout,Rng} from '@threejs-shooter/shared';
import {surface} from '../core/models';

/** Low-cost set dressing beyond the playable boundary plus bounded ambient motion. */
export class CityAtmosphere {
  private readonly rain:THREE.LineSegments;
  private readonly rainPositions:Float32Array;
  private readonly papers:THREE.InstancedMesh;
  private readonly rng=new Rng(613);
  private time=0;
  private readonly dummy=new THREE.Object3D();
  private readonly paperStarts:THREE.Vector3[]=[];
  constructor(scene:THREE.Scene,map:MapLayout,private readonly player:THREE.Object3D) {
    const boxes=map.walls.map(w=>w.box);
    const minX=Math.min(...boxes.map(b=>b.min.x)),maxX=Math.max(...boxes.map(b=>b.max.x));
    const minZ=Math.min(...boxes.map(b=>b.min.z)),maxZ=Math.max(...boxes.map(b=>b.max.z));
    const concrete=surface('weathered-concrete')??new THREE.MeshStandardMaterial({color:0x737b80,roughness:1});
    const masonry=surface('brick-soot')??new THREE.MeshStandardMaterial({color:0x454b50,roughness:1});
    const cube=new THREE.BoxGeometry(1,1,1);
    const buildings=new THREE.InstancedMesh(cube,masonry,40),roofs=new THREE.InstancedMesh(cube,concrete,40);
    const windows=new THREE.InstancedMesh(new THREE.PlaneGeometry(.55,.85),new THREE.MeshBasicMaterial({color:0xb9a376,transparent:true,opacity:.35,fog:true}),320);
    let n=0,w=0;
    const setBox=(mesh:THREE.InstancedMesh,index:number,x:number,y:number,z:number,sx:number,sy:number,sz:number)=>{
      this.dummy.position.set(x,y,z);this.dummy.rotation.set(0,0,0);this.dummy.scale.set(sx,sy,sz);this.dummy.updateMatrix();mesh.setMatrixAt(index,this.dummy.matrix);
    };
    for(const side of [-1,1])for(let i=0;i<10;i++) {
      const along=-48+i*10.5,h=this.rng.range(5,13),depth=this.rng.range(6,10);
      const north=i%2===0;
      const x=north?along:(side<0?minX-13:maxX+13),z=north?(side<0?minZ-13:maxZ+13):along;
      setBox(buildings,n,x,h/2,z,8,h,depth);setBox(roofs,n,x,h+.1,z,8.3,.25,depth+.3);n++;
      for(let row=0;row<2;row++)for(let col=0;col<4;col++) {
        this.dummy.position.set(x+(col-1.5)*1.5,2+row*2.5,z+(side<0?1:-1)*(depth/2+.025));
        this.dummy.rotation.set(0,side<0?0:Math.PI,0);this.dummy.scale.setScalar(1);this.dummy.updateMatrix();windows.setMatrixAt(w++,this.dummy.matrix);
      }
    }
    buildings.count=n;roofs.count=n;windows.count=w;scene.add(buildings,roofs,windows);
    // Two draw calls for rain and drifting scraps; no lights, physics or per-frame allocations.
    this.rainPositions=new Float32Array(180*6);
    for(let i=0;i<180;i++){this.rainPositions[i*6]=this.rng.range(-22,22);this.rainPositions[i*6+1]=this.rng.range(1,18);this.rainPositions[i*6+2]=this.rng.range(-22,22);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(this.rainPositions,3).setUsage(THREE.DynamicDrawUsage));
    this.rain=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0xa6b9cc,transparent:true,opacity:.16,depthWrite:false}));this.rain.frustumCulled=false;scene.add(this.rain);
    this.papers=new THREE.InstancedMesh(new THREE.PlaneGeometry(.18,.25),new THREE.MeshStandardMaterial({color:0x918875,side:THREE.DoubleSide,roughness:1}),16);
    for(let i=0;i<16;i++)this.paperStarts.push(new THREE.Vector3(this.rng.range(minX+2,maxX-2),.035,this.rng.range(minZ+2,maxZ-2)));
    scene.add(this.papers);
  }
  update(dt:number) {
    this.time+=dt;this.rain.position.set(this.player.position.x,0,this.player.position.z);
    for(let i=0;i<180;i++) {
      const k=i*6;this.rainPositions[k+1]-=dt*13;if(this.rainPositions[k+1]<0)this.rainPositions[k+1]+=18;
      this.rainPositions[k+3]=this.rainPositions[k]+.08;this.rainPositions[k+4]=this.rainPositions[k+1]+.45;this.rainPositions[k+5]=this.rainPositions[k+2]+.03;
    }
    this.rain.geometry.attributes.position.needsUpdate=true;
    for(let i=0;i<16;i++) {
      const p=this.paperStarts[i];this.dummy.position.set(p.x+Math.sin(this.time*.3+i)*.6,.04+Math.max(0,Math.sin(this.time*.7+i))*.12,p.z+Math.cos(this.time*.2+i)*.5);
      this.dummy.rotation.set(-Math.PI/2+Math.sin(this.time+i)*.15,0,this.time*.2+i);this.dummy.scale.setScalar(1);this.dummy.updateMatrix();this.papers.setMatrixAt(i,this.dummy.matrix);
    }
    this.papers.instanceMatrix.needsUpdate=true;
  }
}
