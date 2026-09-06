"""Four fictional game weapons, authored through Blender MCP in an isolated workshop."""
import bpy, math, os
from mathutils import Vector
ROOT='/Users/wwwillems/Projects/threejs-shooter'
scene=bpy.data.scenes.get('Noir arsenal workshop') or bpy.data.scenes.new('Noir arsenal workshop')
bpy.context.window.scene=scene
for o in list(scene.objects):bpy.data.objects.remove(o,do_unlink=True)
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

olive=mat('launcher-enamel',(46,57,36),.35)
red=mat('fuel-enamel',(105,31,20),.35)
ceramic=mat('arc-ceramic',(161,157,133))
blue=mat('arc-glass',(28,144,169),.3)
p=blue.node_tree.nodes.get('Principled BSDF');p.inputs['Emission Color'].default_value=(.05,.55,.7,1);p.inputs['Emission Strength'].default_value=1.5
roots=[]
for kind in ['rocket','flamethrower','precision','arc']:
 root=group('Held '+kind);current=root
 grip=box('grip',(0,-.105,.035),(.08,.19,.095),rubber,.012);grip.rotation_euler[0]=-.2
 box('trigger guard',(0,-.1,-.08),(.065,.12,.12),steel)
 if kind=='rocket':
  barrel('launcher tube',(0,.12,-.1),.105,1.25,olive)
  for z in [-.72,-.5,.2,.53]:barrel('reinforcing collar',(0,.12,z),.117,.035,edge)
  barrel('dark muzzle',(0,.12,-.737),.083,.015,rubber);muzzle=-.75;my=.12
  box('shoulder rest',(0,-.065,.38),(.19,.13,.3),rubber,.025)
  box('front grip',(0,-.10,-.38),(.08,.18,.09),wood)
  box('sight mount',(.14,.16,-.22),(.06,.07,.28),steel)
  barrel('optical sight',(.14,.22,-.27),.035,.25,edge)
  for z in [-.31,-.24,-.17]:box('warning stripe',(0,.226,z),(.065,.01,.025),brass,.001)
 elif kind=='flamethrower':
  box('valve receiver',(0,.015,-.07),(.13,.15,.32),steel,.025)
  barrel('heat shield',(0,.025,-.47),.065,.52,edge)
  for z in [-.3,-.37,-.44,-.51,-.58,-.65]:barrel('heat fins',(0,.025,z),.082,.018,steel)
  barrel('nozzle',(0,.025,-.79),.052,.17,brass);muzzle=-.89;my=.025
  barrel('pilot tube',(.07,-.025,-.72),.012,.3,brass)
  current=group('Magazine',root)
  for x in [-.10,.10]:
   barrel('fuel cylinder',(x,-.12,.21),.085,.43,red)
   for z in [.025,.38]:barrel('tank strap',(x,-.12,z),.09,.025,edge)
  current=root;box('pressure gauge',(0,.14,.015),(.08,.06,.08),ceramic)
  barrel('fuel feed',(.08,-.07,-.15),.025,.23,brass)
 elif kind=='precision':
  box('receiver',(0,.025,-.08),(.095,.11,.35),steel)
  box('walnut stock',(0,-.025,.29),(.095,.145,.42),wood,.025)
  box('butt pad',(0,-.025,.51),(.1,.15,.025),rubber)
  box('handguard',(0,-.008,-.4),(.10,.09,.32),wood)
  barrel('long barrel',(0,.038,-.76),.023,.6,steel);muzzle=-1.075;my=.038
  barrel('muzzle crown',(0,.038,-1.06),.033,.04,edge)
  for z in [-.25,.015]:box('scope riser',(0,.115,z),(.055,.09,.04),edge)
  barrel('scope',(0,.2,-.17),.044,.44,steel)
  barrel('objective',(0,.2,-.40),.063,.11,edge)
  barrel('scope glass',(0,.2,-.459),.051,.004,blue)
  current=group('Bolt',root);box('bolt handle',(.10,.018,.04),(.14,.028,.025),edge);current=root
  current=group('Magazine',root);box('magazine',(0,-.11,-.1),(.075,.14,.10),steel)
 else:
  box('capacitor receiver',(0,.025,-.08),(.17,.17,.3),steel,.025)
  box('stock',(0,-.025,.26),(.11,.14,.30),wood,.018)
  barrel('ceramic core',(0,.055,-.43),.053,.43,ceramic)
  for z in [-.25,-.31,-.37,-.43,-.49,-.55,-.61]:barrel('copper coil',(0,.055,z),.079,.024,brass)
  for x in [-.095,.095]:
   barrel('electrode',(x,.055,-.64),.018,.34,edge)
   barrel('energized tip',(x,.055,-.82),.024,.045,blue)
  muzzle=-.85;my=.055
  current=group('Magazine',root);box('cell pack',(0,-.135,-.10),(.13,.17,.13),edge)
  for x in [-.035,.035]:box('charge window',(x,-.14,-.17),(.018,.1,.01),blue,.001)
 current=root;socket=group('Muzzle',root);socket.location=xyz((0,my,muzzle))
 # Batch by material, preserving the magazine and muzzle attachment nodes.
 for parent in [root,*[o for o in root.children if o.type=='EMPTY']]:
  batches={}
  for o in list(parent.children):
   if o.type=='MESH':batches.setdefault(o.data.materials[0].name,[]).append(o)
  for key,objects in batches.items():
   bpy.ops.object.select_all(action='DESELECT')
   for o in objects:o.select_set(True)
   bpy.context.view_layer.objects.active=objects[0]
   if len(objects)>1:bpy.ops.object.join()
   objects[0].name=key
 bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
 for o in root.children_recursive:o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=ROOT+'/app/public/models/noir-'+kind+'.glb',export_format='GLB',use_selection=True,use_active_scene=True,export_image_format='NONE',export_yup=True,export_animations=False)
 roots.append(root)
scene.world=bpy.data.worlds.new('Arsenal studio');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
bpy.ops.object.light_add(type='AREA',location=(1,0,3));bpy.context.object.data.energy=250;bpy.context.object.data.size=3
bpy.ops.object.camera_add(location=(2,1,1.2));cam=bpy.context.object;cam.rotation_euler=(Vector((0,.15,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=1.9;scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.render.film_transparent=True
scene.render.resolution_x=384;scene.render.resolution_y=192;scene.render.resolution_percentage=100
for i,kind in enumerate(['rocket','flamethrower','precision','arc']):
 for j,root in enumerate(roots):
  for o in root.children_recursive:o.hide_render=j!=i
 scene.render.filepath=ROOT+'/app/public/icons/noir-'+kind+'.png';bpy.ops.render.render(write_still=True)
for i,root in enumerate(roots):
 for o in root.children_recursive:o.hide_render=False
 root.location.x=(i-1.5)*.75
cam.location=(4,3,3);cam.rotation_euler=(Vector((0,.15,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=4.5
scene.render.resolution_x=1100;scene.render.resolution_y=650
scene.render.filepath=ROOT+'/assets/blender/noir-arsenal-preview.png'
bpy.ops.render.render(write_still=True)
bpy.data.libraries.write(ROOT+'/assets/blender/noir-arsenal.blend',{scene},path_remap='RELATIVE',fake_user=True)
print('Exported four weapons, four HUD icons and isolated arsenal blend')
