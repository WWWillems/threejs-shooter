"""Reusable compact loot / projectile kit. Run through Blender MCP.
Geometry uses metres, game Y up and projectile forward -Z. No new image maps.
"""
import bpy, math, json
from mathutils import Vector
ROOT='/Users/wwwillems/Projects/threejs-shooter'
scene=bpy.data.scenes.get('Noir loot workshop') or bpy.data.scenes.new('Noir loot workshop')
bpy.context.window.scene=scene
for o in list(scene.objects): bpy.data.objects.remove(o,do_unlink=True)
def xyz(p):return(p[0],-p[2],p[1])
def mat(name,c,metal=0,rough=.65):
 m=bpy.data.materials.get(name) or bpy.data.materials.new(name);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in c],1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;return m
steel=mat('loot-steel',(.24,.27,.27),.7,.48);olive=mat('loot-olive-enamel',(.31,.35,.25),.25)
leather=mat('loot-leather',(.18,.12,.08),0,.85);canvas=mat('gang-charcoal-canvas',(.28,.28,.25),0,.95)
cream=mat('loot-medical-canvas',(.73,.69,.56));green=mat('loot-medical-green',(.12,.48,.29));brass=mat('loot-brass',(.7,.51,.2),.7,.4)
red=mat('loot-red-enamel',(.57,.15,.1),.25);blue=mat('loot-cell-blue',(.2,.7,.82),.35);dark=mat('loot-rubber',(.07,.08,.08))
roots=[];parts=[];current=None

def finish(o,name,m):
 o.name=name;o.data.materials.append(m);o.parent=current;parts.append(o);return o

def box(name,p,s,m,b=.015):
 bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(p));o=bpy.context.object;o.dimensions=(s[0],s[2],s[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if b:
  q=o.modifiers.new('edge bevel','BEVEL');q.width=b;q.segments=2;bpy.ops.object.modifier_apply(modifier=q.name)
 return finish(o,name,m)

def cylinder(name,p,r,h,m,axis='y',r2=None):
 bpy.ops.mesh.primitive_cone_add(vertices=12,radius1=r,radius2=r if r2 is None else r2,depth=h,location=xyz(p));o=bpy.context.object
 if axis=='z':o.rotation_euler.x=-math.pi/2
 for f in o.data.polygons:f.use_smooth=len(f.vertices)==4
 return finish(o,name,m)

def round(name,p,r,m):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,location=xyz(p));o=bpy.context.object;o.scale=xyz((r[0],r[1],-r[2]));bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return finish(o,name,m)

def new(name):
 global current,parts
 current=bpy.data.objects.new(name,None);scene.collection.objects.link(current);roots.append(current);parts=[]

def export(name):
 # Merge per-material parts into a single mesh to bound draw calls.
 bpy.ops.object.select_all(action='DESELECT')
 for o in parts:o.select_set(True)
 bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();body=bpy.context.object;body.name=name+' mesh'
 body.data.calc_loop_triangles();stats[name]=len(body.data.loop_triangles)
 current.select_set(True)
 bpy.ops.export_scene.gltf(filepath=ROOT+'/app/public/models/'+name+'.glb',export_format='GLB',use_selection=True,use_active_scene=True,export_animations=False,export_image_format='NONE',export_yup=True)

stats={}
# Seven ammo families each have a physical silhouette and color ID.
for kind in ['pistol','rifle','shotgun','precision','rocket','flamethrower','arc']:
 new('noir-ammo-'+kind)
 if kind in ['flamethrower','arc']:
  if kind=='flamethrower':
   box('fuel can body',(0,.2,0),(.4,.4,.26),red,.05)
   for x in [-.13,.13]:box('pressed reinforcement',(x,.19,-.137),(.025,.27,.012),steel,.004)
   for x in [-.1,.1]:box('handle riser',(x,.45,0),(.035,.1,.035),steel,.007)
   box('carry handle',(0,.5,0),(.23,.035,.035),steel,.008);cylinder('filler cap',(.13,.42,.06),.05,.04,brass)
  else:
   box('cell cradle',(0,.08,0),(.42,.15,.28),steel)
   for x in [-.1,.1]:
    cylinder('ceramic cell',(x,.25,0),.078,.3,cream)
    for y in [.15,.23,.31]:cylinder('charge band',(x,y,0),.082,.018,blue)
    cylinder('contact',(x,.42,0),.035,.06,brass)
 else:
  box('ammo tin',(0,.14,0),(.46,.28,.36),olive)
  box('lid lip',(0,.29,0),(.49,.045,.39),steel,.009)
  for x in [-.16,.16]:box('latch',(x,.23,-.2),(.055,.11,.025),brass,.005)
  box('lid handle',(0,.345,.08),(.2,.025,.035),steel,.005)
  if kind=='rocket':
   cylinder('packed rocket',(0,.39,0),.065,.5,olive,'z');cylinder('warhead',(0,.39,-.29),.065,.08,brass,'z',0)
  else:
   for x in [-.12,0,.12]:
    h=.27 if kind=='precision' else .19;r=.037 if kind=='shotgun' else .027
    cylinder('cartridge',(x,.37,0),r,h,red if kind=='shotgun' else brass,'z')
    cylinder('projectile tip',(x,.37,-h/2-.035),r,.07,cream if kind=='shotgun' else steel,'z',0)
 colors={'pistol':0x6d9fff,'rifle':0x83ac78,'shotgun':0xd79166,'rocket':0xd88c53,'flamethrower':0xf3b34d,'precision':0xb5c1ca,'arc':0x77d8eb}
 code=colors[kind];label=mat('loot-id-'+kind,tuple(((code >> shift)&255)/255 for shift in [16,8,0]))
 box('ammo identification plate',(0,.15,-(.151 if kind=='arc' else .141 if kind=='flamethrower' else .19)),(.15,.07,.013),label,.004)
 export('noir-ammo-'+kind)
new('noir-health-pickup')
box('medical satchel',(0,.19,0),(.55,.37,.3),cream,.055)
box('overlapping flap',(0,.31,-.15),(.56,.15,.04),cream,.015)
for x in [-.19,.19]:
 box('leather strap',(x,.19,-.18),(.045,.33,.018),leather,.004)
 box('brass buckle',(x,.21,-.194),(.065,.06,.018),brass,.003)
 box('handle riser',(x*.5,.41,0),(.035,.09,.04),leather,.004)
box('carry grip',(0,.45,0),(.23,.03,.04),leather)
box('medical badge',(0,.2,-.18),(.18,.18,.016),green,.016)
box('medical plus vertical',(0,.2,-.193),(.035,.12,.01),cream,.001)
box('medical plus horizontal',(0,.2,-.194),(.12,.035,.01),cream,.001)
export('noir-health-pickup')
new('noir-armor-pickup')
# Contoured vest silhouette with arm cut-outs, neck opening and layered plates.
points=[(-.24,.08),(.24,.08),(.27,.39),(.18,.48),(.16,.62),(.07,.62),(.055,.51),(-.055,.51),(-.07,.62),(-.16,.62),(-.18,.48),(-.27,.39)]
verts=[xyz((x,y,z)) for z in [-.1,.1] for x,y in points];n=len(points)
faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
mesh=bpy.data.meshes.new('vest cutout mesh');mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new('vest body',mesh);scene.collection.objects.link(o);finish(o,'vest body',canvas)
for y,w in [(.18,.4),(.32,.43),(.44,.3)]:box('segmented plate',(0,y,-.13),(w,.105,.05),steel,.025)
for x in [-.2,.2]:box('side fastening',(x,.26,-.17),(.06,.16,.035),leather)
box('armor blue badge',(0,.34,-.17),(.09,.065,.012),blue,.009)
export('noir-armor-pickup')
for kind in ['rocket','round','arc']:
 new('noir-projectile-'+kind)
 if kind=='rocket':
  cylinder('rocket casing',(0,0,0),.065,.42,olive,'z')
  cylinder('ogive warhead',(0,0,-.27),.065,.12,steel,'z',0)
  for z in [-.15,.15]:cylinder('casing collar',(0,0,z),.069,.02,brass,'z')
  cylinder('exhaust bell',(0,0,.24),.045,.065,dark,'z',.055)
  for a in range(4):
   fin=box('stabilizer fin',(0,0,.16),(.22,.012,.14),steel,.002);fin.rotation_euler.y=a*math.pi/2
 elif kind=='round':
  cylinder('bullet core',(0,0,.015),.018,.13,brass,'z');cylinder('bullet nose',(0,0,-.075),.018,.05,steel,'z',0)
 else:
  round('charged core',(0,0,0),(.06,.06,.14),blue)
  for z in [-.065,.065]:cylinder('energy collar',(0,0,z),.075,.018,cream,'z')
 export('noir-projectile-'+kind)
# Arrange a catalogue for inspection; exports above remain at their local origin.
for i,o in enumerate(roots):o.location=(i%4*1.1,i//4*1.0,0)
world=bpy.data.worlds.new('Loot studio');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.13,.16,.2,1);world.node_tree.nodes['Background'].inputs[1].default_value=.7;scene.world=world
for p,energy,size in [((1,-2,6),900,5),((5,3,4),700,4)]:
 bpy.ops.object.light_add(type='AREA',location=p);bpy.context.object.data.energy=energy;bpy.context.object.data.size=size
bpy.ops.object.camera_add(location=(5,8,7));cam=bpy.context.object;cam.rotation_euler=(Vector((1.6,1,.1))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=5.7;scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.render.resolution_x=1100;scene.render.resolution_y=850;scene.render.resolution_percentage=100;scene.render.filepath=ROOT+'/assets/blender/noir-loot-preview.png';bpy.ops.render.render(write_still=True)
bpy.data.libraries.write(ROOT+'/assets/blender/noir-loot.blend',{scene},path_remap='RELATIVE',fake_user=True)
print(json.dumps(stats))
