TEAM=globals().get("TEAM","A")
"""Rebuild a skinned trench-coat character and reusable animation clips via Blender MCP."""
import bpy, math, os
from mathutils import Vector, Quaternion, Matrix
ROOT=os.environ.get('NOIR_REPO_ROOT','/Users/wwwillems/Projects/threejs-shooter')
# Keep other open Blender workshops intact, including work on buildings.
scene=bpy.data.scenes.get('Noir team workshop '+TEAM) or bpy.data.scenes.new('Noir team workshop '+TEAM)
bpy.context.window.scene=scene
for o in list(scene.objects):bpy.data.objects.remove(o,do_unlink=True)
bpy.context.window.scene=scene
def xyz(p):return (p[0],-p[2],p[1])
def material(name,rgb,rough=.8,metal=0):
    m=bpy.data.materials.get(name) or bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF')
    c=[((v/255+.055)/1.055)**2.4 if v>10 else v/255/12.92 for v in rgb]
    p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;return m
coat=material('noir-coat-wool',(56,58,57));lapel=material('coat-lapel',(42,45,43));pants=material('noir-trousers',(67,63,55));leather=material('noir-leather',(35,30,26),.42);skin=material('noir-skin',(173,130,99),.7);hair=material('noir-hair',(42,34,28));shirt=material('noir-shirt',(166,154,128));steel=material('noir-buttons',(90,86,71),.4,.55)
# Bone rest coordinates are authored in Y-up game space. All models face -Z.
def bone(h,t,parent=None):return (h,t,parent)
defs={
 'Root':bone((0,0,0),(0,.2,0)),
 'Hips':bone((0,.96,0),(0,1.08,0),'Root'),
 'Spine':bone((0,1.08,0),(0,1.48,0),'Hips'),
 'Head':bone((0,1.51,0),(0,1.81,0),'Spine'),
}
for side,x in [('L',-.15),('R',.15)]:
 defs['Thigh'+side]=bone((x,.96,0),(x,.53,.015),'Hips')
 defs['Shin'+side]=bone((x,.53,.015),(x,.13,0),'Thigh'+side)
 defs['Foot'+side]=bone((x,.13,0),(x,.1,-.19),'Shin'+side)
 defs['Tail'+side]=bone((x,1.03,.09),(x,.48,.14),'Hips')
for side,a,b,c in [('R',(.265,1.47,0),(.31,1.22,-.17),(.19,1.32,-.45)),('L',(-.265,1.47,0),(-.3,1.19,-.19),(-.04,1.29,-.61))]:
 defs['UpperArm'+side]=bone(a,b,'Spine');defs['Forearm'+side]=bone(b,c,'UpperArm'+side);defs['Hand'+side]=bone(c,(c[0],c[1],c[2]-.105),'Forearm'+side)
data=bpy.data.armatures.new('Noir humanoid skeleton');rig=bpy.data.objects.new('NoirPlayerRig',data);scene.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for name,(h,t,parent) in defs.items():
 b=data.edit_bones.new(name);b.head=xyz(h);b.tail=xyz(t)
 if parent:b.parent=data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT');parts=[]
canvas=material('gang-charcoal-canvas',(72,70,61));red=material('gang-red-cloth',(133,43,34));vest=material('gang-webbing',(48,46,37));knit=material('noir-knit',(57,56,52))
def finish(o,name,mat,joint):

 if TEAM=='B':
  if name.startswith(('split coat','fedora','creased crown','grosgrain','curved fedora','broad notched','shirt front','black tie','coat button','back storm','shoulder epaulette')):
   bpy.data.objects.remove(o,do_unlink=True);return None
  if mat==coat or mat==pants:mat=canvas
 o.name=name;o.data.materials.append(mat);vg=o.vertex_groups.new(name=joint);vg.add(list(range(len(o.data.vertices))),1,'REPLACE');parts.append(o)
 for p in o.data.polygons:p.use_smooth=True
 return o
def ellipsoid(name,pos,scale,mat,joint):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,location=xyz(pos));o=bpy.context.object;o.scale=(scale[0],scale[2],scale[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return finish(o,name,mat,joint)
def box(name,pos,size,mat,joint,bevel=.015):
 bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(pos));o=bpy.context.object;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 mod=o.modifiers.new('tailored edges','BEVEL');mod.width=bevel;mod.segments=1;bpy.ops.object.modifier_apply(modifier=mod.name);return finish(o,name,mat,joint)
def limb(name,a,b,r1,r2,mat,joint):
 va=Vector(xyz(a));vb=Vector(xyz(b));bpy.ops.mesh.primitive_cone_add(vertices=12,radius1=r1,radius2=r2,depth=(vb-va).length,location=(va+vb)/2);o=bpy.context.object;o.rotation_euler=(vb-va).to_track_quat('Z','Y').to_euler();return finish(o,name,mat,joint)
def shell(name,profile,mat,joint,start=0,end=math.tau,segments=24):
 verts=[];faces=[]
 for y,rx,rz in profile:
  for j in range(segments+1):
   a=start+(end-start)*j/segments;fold=1+.023*math.cos(a*11+y*9);verts.append(xyz((math.cos(a)*rx*fold,y,math.sin(a)*rz*fold)))
 for i in range(len(profile)-1):
  for j in range(segments):
   k=i*(segments+1)+j;faces.append((k,k+segments+1,k+segments+2,k+1))
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();uv=mesh.uv_layers.new()
 for p in mesh.polygons:
  for li in p.loop_indices:
   v=mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=(math.atan2(v.y,v.x)/math.tau,v.z*2)
 o=bpy.data.objects.new(name,mesh);scene.collection.objects.link(o)
 if finish(o,name,mat,joint) is None:return None
 mod=o.modifiers.new('fabric thickness','SOLIDIFY');mod.thickness=.012;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name);return o
shell('fitted double breasted coat',[(.94,.215,.135),(1.02,.225,.145),(1.18,.225,.145),(1.38,.272,.16),(1.48,.27,.13),(1.53,.20,.105)],coat,'Spine',-math.pi/2+.28,3*math.pi/2-.28)
ellipsoid('hips',(0,.97,0),(.205,.14,.13),pants,'Hips')
# Split flared coat skirts have independent tail bones, avoiding a rigid cone.
for side,start,end in [('R',-math.pi/2+.07,math.pi/2-.035),('L',math.pi/2+.035,3*math.pi/2-.07)]:
 shell('split coat tail '+side,[(.48,.29,.21),(.68,.27,.19),(.87,.24,.16),(1.03,.22,.14)],coat,'Tail'+side,start,end,22)
for side in ['L','R']:
 h,k,_=defs['Thigh'+side];_,ankle,_=defs['Shin'+side];x=h[0]
 limb('trouser thigh',h,k,.104,.085,pants,'Thigh'+side);ellipsoid('tailored knee',k,(.085,.095,.085),pants,'Shin'+side);limb('trouser calf',k,ankle,.083,.065,pants,'Shin'+side)
 ellipsoid('polished boot',(x,.09,-.077),(.089,.062,.153),leather,'Foot'+side);box('boot sole',(x,.03,-.08),(.18,.042,.29),leather,'Foot'+side,.024)
 for joint in ['UpperArm'+side,'Forearm'+side]:
  a,b,_=defs[joint];limb('coat sleeve',a,b,.103 if 'Upper' in joint else .085,.08 if 'Upper' in joint else .062,coat,joint)
 shoulder=defs['UpperArm'+side][0];ellipsoid('rounded shoulder',shoulder,(.105,.09,.105),coat,'UpperArm'+side)
 elbow=defs['Forearm'+side][0];ellipsoid('sleeve elbow',elbow,(.083,.083,.083),coat,'Forearm'+side)
 wrist=defs['Hand'+side][0];ellipsoid('gloved hand',(wrist[0],wrist[1]-.012,wrist[2]-.035),(.063,.057,.085),leather,'Hand'+side)
# Shirt, tie, lapels, storm flap, epaulettes, belt and double row of buttons.
box('shirt front',(0,1.405,-.145),(.17,.2,.028),shirt,'Spine')
box('black tie',(0,1.387,-.166),(.032,.17,.014),leather,'Spine',.004)
for sign in [-1,1]:
 o=box('broad notched lapel',(sign*.103,1.405,-.171),(.115,.28,.029),lapel,'Spine')
 if o:o.rotation_euler[1]=sign*.32
 box('shoulder epaulette',(sign*.24,1.487,.0),(.17,.024,.097),lapel,'Spine')
 for y in [1.1,1.21,1.32]:ellipsoid('coat button',(sign*.093,y,-.153),(.017,.017,.009),steel,'Spine')
box('back storm flap',(0,1.36,.165),(.47,.17,.025),lapel,'Spine')
shell('belt',[(1.015,.232,.155),(1.06,.232,.155)],leather,'Spine')
box('belt buckle',(.03,1.035,-.17),(.073,.057,.02),steel,'Spine',.006)
limb('neck',(0,1.48,0),(0,1.65,0),.076,.073,skin,'Head')
ellipsoid('face',(0,1.704,-.025),(.106,.145,.103),skin,'Head')
ellipsoid('jaw',(0,1.652,-.036),(.087,.061,.085),skin,'Head')
ellipsoid('nose',(0,1.717,-.139),(.022,.033,.022),skin,'Head')
for sign in [-1,1]:
 ellipsoid('ear',(sign*.107,1.718,-.006),(.025,.052,.032),skin,'Head')
 box('brow',(sign*.046,1.77,-.126),(.058,.011,.009),hair,'Head',.006)
 ellipsoid('eye shadow',(sign*.044,1.751,-.127),(.024,.011,.008),hair,'Head')
ellipsoid('hair',(0,1.797,.023),(.128,.092,.103),hair,'Head')
# Fedora has a pinched crown, curved brim and grosgrain band.
shell('fedora crown',[(1.844,.151,.133),(1.905,.15,.131),(1.972,.126,.117),(2.006,.093,.096)],coat,'Head')
ellipsoid('creased crown top',(0,1.989,0),(.104,.02,.092),coat,'Head')
shell('grosgrain hat band',[(1.869,.154,.137),(1.908,.15,.136)],leather,'Head')
# Closed elliptical brim, gently turned down at front.
bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=8,location=xyz((0,1.868,-.008)));o=bpy.context.object;o.scale=(.229,.201,.019);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);finish(o,'curved fedora brim',coat,'Head')
# Broad readable details, weighted to existing joints rather than extra bones.
if TEAM=='A':
 box('knitted waistcoat',(0,1.24,-.135),(.28,.40,.055),knit,'Spine',.02)
 for sign in [-1,1]:
  box('belt pouch',(sign*.22,1.02,-.095),(.09,.13,.085),leather,'Hips',.012)
  box('coat cuff strap',(sign*.30,1.23,-.16),(.15,.04,.13),leather,'Forearm'+('R' if sign>0 else 'L'),.008)
 box('back half belt',(0,1.055,.16),(.4,.05,.035),leather,'Spine',.007)
else:
 # The short jacket, hood rim and gear change the silhouette from every angle.
 shell('jacket hem',[(.94,.235,.155),(1.03,.24,.16)],canvas,'Hips')
 box('tactical vest',(0,1.255,-.145),(.42,.34,.095),vest,'Spine',.035)
 for sign in [-1,1]:
  box('harness strap',(sign*.18,1.39,-.16),(.045,.31,.055),leather,'Spine',.01)
  for x in [.07,.16]:box('magazine pouch',(sign*x,1.19,-.218),(.075,.15,.065),vest,'Spine',.012)
  box('side pouch',(sign*.245,1.05,0),(.10,.19,.13),leather,'Hips',.015)
  box('cargo pocket',(sign*.235,.75,.015),(.085,.22,.17),canvas,'Thigh'+('R' if sign>0 else 'L'),.018)
  box('kneepad',(sign*.15,.52,-.083),(.15,.17,.04),leather,'Shin'+('R' if sign>0 else 'L'),.025)
 shell('hood outer rim',[(1.43,.225,.145),(1.52,.215,.17),(1.60,.14,.12)],canvas,'Spine',-.1,math.pi+.1,18)
 box('folded hood',(0,1.44,.19),(.33,.17,.1),canvas,'Spine',.045)
 shell('red neck wrap',[(1.47,.093,.085),(1.55,.095,.085)],red,'Spine',segments=16)
 o=box('red neck kerchief',(0,1.42,-.18),(.13,.16,.028),red,'Spine',.014);o.rotation_euler[1]=.35
 a,b,_=defs['UpperArmL'];mid=tuple(a[i]*.5+b[i]*.5 for i in range(3));end=tuple(a[i]*.32+b[i]*.68 for i in range(3))
 limb('red armband',mid,end,.108,.105,red,'UpperArmL')
 box('red belt rag',(-.22,.89,-.07),(.07,.28,.025),red,'ThighL',.008)
 # Knit cap reads better than individual hair strands at gameplay distance.
 ellipsoid('watch cap',(0,1.836,.008),(.123,.106,.115),knit,'Head')
 shell('watch cap rolled brim',[(1.785,.13,.118),(1.825,.13,.118)],knit,'Head',segments=20)
 # Pale angular crew emblem on the back, made from a few broad strips.
 for sign in [-1,1]:
  o=box('back crew slash',(0,1.28,.208),(.027,.25,.008),shirt,'Spine',.001);o.rotation_euler[1]=sign*.65
 box('back crew crown',(0,1.415,.209),(.18,.022,.009),shirt,'Spine',.001)
for side in ['L','R']:
 x=defs['Thigh'+side][0][0]
 for y,z in [(.12,-.13),(.15,-.10),(.18,-.075)]:box('boot lacing',(x,y,z),(.08,.014,.014),leather,'Foot'+side,.002)
 wrist=defs['Hand'+side][0]
 ellipsoid('exposed fingers',(wrist[0],wrist[1]-.012,wrist[2]-.082),(.052,.037,.035),skin,'Hand'+side)
# Join the weighted components into one skinned mesh; the skeleton is cloned per player.
bpy.ops.object.select_all(action='DESELECT')
for o in parts:o.select_set(True)
bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();body=bpy.context.object;body.name='Noir tailored character';body.parent=rig
mod=body.modifiers.new('Noir skeletal deformation','ARMATURE');mod.object=rig
# Hand socket is oriented in world game coordinates at rest; it follows the hand bone.
socket=bpy.data.objects.new('WeaponSocket',None);scene.collection.objects.link(socket);socket.parent=rig;socket.parent_type='BONE';socket.parent_bone='HandR'
bpy.context.view_layer.update();socket.matrix_world=Matrix.Translation(Vector(xyz((.19,1.37,-.46))))
# Actions use global game axes converted into each bone's rest frame.
for p in rig.pose.bones:p.rotation_mode='QUATERNION'
def setrot(name,angle,axis=(1,0,0)):
 b=rig.pose.bones[name];q=b.bone.matrix_local.to_quaternion();b.rotation_quaternion=q.inverted() @ Quaternion(Vector(xyz(axis)),angle) @ q

def pose(kind,t):
 for b in rig.pose.bones:b.location=(0,0,0);b.rotation_quaternion=Quaternion()
 phase=t*math.tau;walk=kind in ['Walk','Run','CrouchWalk'];crouch=kind.startswith('Crouch')
 if crouch:
  # Hips bone's local Y follows game up.
  rig.pose.bones['Hips'].location.y=-.44
  setrot('Spine',-.62);setrot('Head',.28);setrot('UpperArmR',.6)
  for side in ['L','R']:setrot('Thigh'+side,1.16);setrot('Shin'+side,-2.02);setrot('Foot'+side,.86)
 if walk:
  amp=.68 if kind=='Run' else .44 if kind=='Walk' else .21
  for side,sign in [('L',1),('R',-1)]:
   swing=math.sin(phase)*sign
   setrot('Thigh'+side,(1.16 if crouch else .03)+amp*swing)
   setrot('Shin'+side,(-2.02 if crouch else -.06)-max(0,-swing)*amp*.8)
   setrot('Foot'+side,(.86 if crouch else 0)+max(0,-swing)*amp*.35)
   setrot('Tail'+side,-.12+amp*swing*.45)
  rig.pose.bones['Hips'].location.y+=abs(math.sin(phase))*(.028 if crouch else .035)
  setrot('Spine',(-.62 if crouch else -.08)+math.sin(phase*2)*.015)
  setrot('Hips',math.sin(phase)*.045,(0,1,0))
 else:
  if kind in ['Idle','CrouchIdle']:
   setrot('Spine',(-.62 if crouch else -.015)+math.sin(phase)*.009)
   setrot('TailL',math.sin(phase)*.018);setrot('TailR',-math.sin(phase)*.015)
 if kind in ['Jump','Fall']:
  setrot('ThighL',.52 if kind=='Jump' else .18);setrot('ThighR',.25);setrot('ShinL',-.85);setrot('ShinR',-.5);setrot('Spine',-.12)
  setrot('TailL',-.36);setrot('TailR',-.28)
 if kind=='Land':
  w=math.sin(math.pi*t);rig.pose.bones['Hips'].location.y=-.13*w
  for side in ['L','R']:setrot('Thigh'+side,.4*w);setrot('Shin'+side,-.7*w)
  setrot('Spine',-.12*w)
 if kind=='Death':
  w=t*t*(3-2*t);setrot('Root',-1.49*w);rig.pose.bones['Root'].location.y=.15*w
  setrot('Spine',-.15*math.sin(t*math.pi));setrot('Head',-.25*w)
  setrot('UpperArmL',-.6*w,(0,0,1));setrot('UpperArmR',.45*w,(0,0,1));setrot('ShinL',-.3*w);setrot('TailL',.25*w);setrot('TailR',.2*w)

rig.animation_data_create();clips=[]
for kind,duration in [('Idle',2.4),('Walk',.8),('Run',.54),('CrouchIdle',2.4),('CrouchWalk',1.05),('Jump',.3),('Fall',.4),('Land',.2),('Death',1.05)]:
 action=bpy.data.actions.new(kind);rig.animation_data.action=action;count=16
 for i in range(count+1):
  pose(kind,i/count);frame=1+duration*30*i/count
  for b in rig.pose.bones:
   b.keyframe_insert(data_path='location',frame=frame,group=b.name);b.keyframe_insert(data_path='rotation_quaternion',frame=frame,group=b.name)
 action.use_fake_user=True;clips.append(action)
 rig.animation_data.action=None
 track=rig.animation_data.nla_tracks.new();track.name=kind;strip=track.strips.new(kind,1,action);track.mute=True
pose('Idle',0);scene.render.fps=30
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);socket.select_set(True)
bpy.ops.export_scene.gltf(filepath=ROOT+'/app/public/models/noir-character-team-'+TEAM.lower()+'.glb',export_format='GLB',use_selection=True,use_active_scene=True,export_image_format='NONE',export_yup=True,export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=True)
bpy.data.libraries.write(ROOT+'/assets/blender/noir-team-'+TEAM.lower()+'.blend',{scene},path_remap='RELATIVE',fake_user=True)
result={'blend':ROOT+'/assets/blender/noir-team-'+TEAM.lower()+'.blend','bones':len(data.bones),'clips':[a.name for a in clips],'vertices':len(body.data.vertices)}
