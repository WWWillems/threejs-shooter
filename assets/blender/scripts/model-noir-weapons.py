"""Build held weapons with moving slide/magazine/pump and exact muzzle sockets."""
import bpy, math, os
from mathutils import Vector
ROOT=os.environ.get('NOIR_REPO_ROOT','/Users/wwwillems/Projects/threejs-shooter')
scene=bpy.context.scene
assert scene.name.startswith('Noir character workshop')
def xyz(p):return (p[0],-p[2],p[1])
def mat(name,c,metal=0):
 m=bpy.data.materials.get(name) or bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*[v/255 for v in c],1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=.42;return m
steel=mat('weapon-blued-steel',(14,17,19),.75);edge=mat('weapon-machined-steel',(49,53,52),.8);wood=mat('weapon-walnut',(48,24,11));rubber=mat('weapon-grip',(8,9,8));brass=mat('weapon-brass',(98,65,17),.7)
current=None;root=None
def group(name,parent=None):
 o=bpy.data.objects.new(name,None);scene.collection.objects.link(o);o.parent=parent;return o
def finish(o,name,m):
 o.name=name;o.parent=current;o.data.materials.append(m);return o
def box(name,pos,size,m,b=.008):
 bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(pos));o=bpy.context.object;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if b:
  mod=o.modifiers.new('machined bevel','BEVEL');mod.width=b;mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name)
 return finish(o,name,m)
def barrel(name,pos,r,length,m):
 bpy.ops.mesh.primitive_cylinder_add(vertices=20,radius=r,depth=length,location=xyz(pos));o=bpy.context.object;o.rotation_euler[0]=math.pi/2
 for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
 return finish(o,name,m)
for kind in ['pistol','rifle','shotgun']:
 root=group('Held '+kind);current=root
 if kind=='pistol':
  box('frame',(0,-.022,-.09),(.081,.055,.28),steel)
  grip=box('walnut grip',(0,-.103,.023),(.073,.163,.09),wood);grip.rotation_euler[0]=-.18
  current=group('Slide',root)
  box('slide',(0,.027,-.13),(.077,.065,.34),edge)
  box('ejection port',(.039,.036,-.057),(.005,.025,.058),rubber,.002)
  for i in range(6):box('slide serration',(.039,.02,-.019+i*.013),(.004,.043,.004),steel,.001)
  box('front sight',(0,.068,-.263),(.012,.018,.024),steel,.002)
  current=root;barrel('barrel',(0,.023,-.22),.025,.225,steel);muzzle=-.338
  barrel('bore',(0,.023,muzzle-.001),.016,.006,rubber)
  current=group('Magazine',root);box('magazine base',(0,-.191,.022),(.079,.022,.088),steel)
 else:
  shotgun=kind=='shotgun';muzzle=-.81 if shotgun else -.76
  box('receiver',(0,.009,-.05),(.09,.105,.31),steel)
  box('ejection port',(.047,.027,-.06),(.009,.039,.087),rubber,.003)
  box('buttstock',(0,-.03,.244),(.09,.125,.29),wood,.02)
  box('rubber buttplate',(0,-.03,.395),(.095,.13,.02),rubber)
  grip=box('pistol grip',(0,-.105,.052),(.075,.17,.08),wood,.012);grip.rotation_euler[0]=-.25
  barrel('barrel',(0,.022,(muzzle-.15)/2),.027 if shotgun else .019,abs(muzzle+.15),steel)
  barrel('muzzle bore',(0,.022,muzzle-.003),.016,.008,rubber)
  if shotgun:
   barrel('magazine tube',(0,-.033,-.4),.021,.51,edge)
   current=group('Pump',root);box('ribbed fore-end',(0,-.019,-.375),(.095,.091,.20),wood)
   for i in range(9):box('pump groove',(0,-.019,-.47+i*.022),(.098,.094,.004),rubber,.001)
  else:
   box('wood handguard',(0,-.012,-.37),(.094,.078,.28),wood)
   current=group('Magazine',root);mag=box('box magazine',(0,-.142,-.112),(.065,.21,.106),steel);mag.rotation_euler[0]=.14
   current=root;box('front sight post',(0,.066,-.645),(.025,.08,.022),steel,.004)
   for side in [-1,1]:box('sight guard',(side*.021,.097,-.644),(.009,.04,.03),steel,.003)
  current=root;box('rear sight',(0,.079,-.012),(.048,.033,.043),steel,.004)
 # Trigger guard built from four thin bars, with a curved trigger inside.
 current=root
 for x in [-.04,.04]:box('trigger guard',(x,-.075,-.043),(.013,.075,.105),steel,.009)
 box('trigger',(0,-.068,-.027),(.015,.05,.013),edge,.004)
 current=root;socket=group('Muzzle',root);socket.location=xyz((0,.023,muzzle))
 # Keep a handful of batches under each moving assembly.
 for parent in [root,*[o for o in root.children if o.type=='EMPTY']]:
  groups={}
  for o in list(parent.children):
   if o.type=='MESH':groups.setdefault(o.data.materials[0].name,[]).append(o)
  for key,objects in groups.items():
   bpy.ops.object.select_all(action='DESELECT')
   for o in objects:o.select_set(True)
   bpy.context.view_layer.objects.active=objects[0]
   if len(objects)>1:bpy.ops.object.join()
   objects[0].name=key
 bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
 for o in root.children_recursive:o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=ROOT+'/app/public/models/noir-'+kind+'.glb',export_format='GLB',use_selection=True,use_active_scene=True,export_image_format='NONE',export_yup=True,export_animations=False)
 root.location=xyz((1+['pistol','rifle','shotgun'].index(kind)*.6,1,0))
bpy.data.libraries.write(ROOT+'/assets/blender/noir-character.blend',{scene},path_remap='RELATIVE',fake_user=True)
result={'weapons':['pistol','rifle','shotgun'],'blend':ROOT+'/assets/blender/noir-character.blend'}
