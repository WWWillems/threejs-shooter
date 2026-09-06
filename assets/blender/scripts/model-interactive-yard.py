"""Interactive yard kit, authored through Blender MCP; isolated from other workshops."""
import bpy, math, os
from mathutils import Vector
ROOT='/Users/wwwillems/Projects/threejs-shooter'
name='Noir interactive workshop'
scene=bpy.data.scenes.get(name) or bpy.data.scenes.new(name)
bpy.context.window.scene=scene
for o in list(scene.objects): bpy.data.objects.remove(o,do_unlink=True)
def xyz(v):return (v[0],-v[2],v[1])
def mat(name,rgb,rough=.6,metal=0,emission=0):
    m=bpy.data.materials.get(name) or bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    linear=[((c/255+.055)/1.055)**2.4 if c>10 else c/255/12.92 for c in rgb]
    p.inputs['Base Color'].default_value=(*linear,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    if emission:p.inputs['Emission Color'].default_value=(*linear,1);p.inputs['Emission Strength'].default_value=emission
    return m
wood=mat('utility-pole-timber',(104,91,69),.85)
zinc=mat('fence-galvanized-steel',(128,132,128),.48,.7)
black=mat('lamp-enamel',(37,42,40),.38,.4)
ceramic=mat('lamp-ceramic',(136,129,104),.34)
lens=mat('lamp-warm-glass',(255,201,125),.18,0,5)
current=None

def start(name):
    global current
    current=bpy.data.objects.new(name,None);scene.collection.objects.link(current)

def finish(o,name,m):
    o.name=name;o.parent=current;o.data.materials.append(m);return o

def cyl(name,pos,r,h,m,r2=None,n=20):
    bpy.ops.mesh.primitive_cone_add(vertices=n,radius1=r,radius2=r if r2 is None else r2,depth=h,location=xyz(pos))
    o=finish(bpy.context.object,name,m)
    for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
    return o

def box(name,pos,size,m,bevel=.01):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(pos));o=bpy.context.object;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('edge wear','BEVEL');mod.width=bevel;mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o,name,m)

def rod(name,a,b,r,m):
    va=Vector(xyz(a));vb=Vector(xyz(b));o=cyl(name,(0,0,0),r,(vb-va).length,m,n=12);o.location=(va+vb)/2;o.rotation_euler=(vb-va).to_track_quat('Z','Y').to_euler();return o

def pipe(name,points,r,m):
    curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.resolution_u=1;curve.bevel_depth=r;curve.bevel_resolution=2
    spline=curve.splines.new('POLY');spline.points.add(len(points)-1)
    for p,co in zip(spline.points,points):p.co=(*xyz(co),1)
    o=bpy.data.objects.new(name,curve);scene.collection.objects.link(o);finish(o,name,m)
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');return bpy.context.object

def export(slug):
    groups={}
    for o in current.children_recursive:
        if o.type=='MESH':groups.setdefault(o.data.materials[0].name,[]).append(o)
    for key,objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1:bpy.ops.object.join()
        objects[0].name=key
        # Generate UVs for tube/cable meshes that did not originate as primitives.
        if not objects[0].data.uv_layers:
            bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project();bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT');current.select_set(True)
    for o in current.children_recursive:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=ROOT+'/app/public/models/'+slug+'.glb',export_format='GLB',use_selection=True,use_active_scene=True,export_image_format='NONE',export_yup=True,export_apply=True)
    return current


rubber=mat('tire-rubber',(37,39,38),.91)
steel=mat('oil-barrel-steel',(100,102,98),.66,.55)
red=mat('fuel-red-enamel',(128,40,27),.55,.25)
cream=mat('hazard-ivory',(195,168,108),.7)
def torus(name,pos,major,minor,m):
    bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=minor,major_segments=40,minor_segments=10,location=xyz(pos))
    return finish(bpy.context.object,name,m)
roots=[]
start('Tire stack')
for i in range(4):
    y=.15+i*.285;dx=.035*math.sin(i*2);dz=.03*math.cos(i*3)
    o=torus('rubber carcass',(dx,y,dz),.392,.145,rubber);o.scale.z=.95
    for sy in [-1,1]:torus('sidewall bead',(dx,y+sy*.08,dz),.28,.024,rubber)
    for j in range(32):
        a=j*math.tau/32+i*.17
        for offset in [-.058,.058]:
            o=box('worn tread block',(dx+math.cos(a)*.527,y+offset,dz+math.sin(a)*.527),(.06,.083,.078),rubber,0)
            o.rotation_euler[2]=-a
roots.append(export('noir-tire-stack'))
start('Timber barricade')
for x in [-.9,.9]:
    box('steel foot',(x,.07,0),(.22,.14,.55),zinc)
    box('upright',(x,.65,0),(.12,1.25,.12),zinc)
for y in [.48,.88,1.28]:
    box('splintered timber plank',(0,y,0),(2.4,.32,.12),wood)
    for x in [-.9,.9]:
        o=cyl('bolt',(x,y,.08),.025,.04,zinc,n=6);o.rotation_euler[0]=math.pi/2
wood.name='utility-pole-timber'
roots.append(export('noir-cover-panel'))
for slug,burning in [('explosive-barrel',False),('fire-barrel',True)]:
    start(slug)
    if burning:
        # An open mouth, with the dark inset and rolled rim visible from the camera.
        for j in range(24):
            a=j*math.tau/24
            o=box('open steel wall',(math.cos(a)*.30,.46,math.sin(a)*.30),(.085,.88,.045),steel,.004)
            o.rotation_euler[2]=-a-math.pi/2
        cyl('charcoal bed',(0,.71,0),.29,.035,black)
        for j in range(6):
            a=j*math.tau/6
            o=box('charred timber',(math.cos(a)*.1,.77,math.sin(a)*.1),(.12,.09,.37),black)
            o.rotation_euler[2]=a
    else:
        cyl('fuel drum',(0,.46,0),.315,.87,red,n=32)
        cyl('lid',(0,.902,0),.299,.018,steel,n=32)
        cyl('bung',(0.13,.925,.07),.041,.029,black,n=12)
        for y in [.25,.63]:cyl('hazard band',(0,y,0),.317,.095,cream,n=32)
        # Raised black diamonds provide readable hazard markings without a UV decal.
        for z in [-.319,.319]:
            o=box('hazard diamond',(0,.445,z),(.17,.17,.008),black,.002);o.rotation_euler[1]=math.pi/4
    for y in [.035,.32,.65,.895]:torus('rolled steel hoop',(0,y,0),.31,.023,steel)
    roots.append(export('noir-'+slug))
for slug in ['smoke-zone','alarm-zone','warning-light']:
    start(slug)
    box('mounting foot',(0,.055,0),(.44,.11,.36),zinc)
    if slug=='smoke-zone':
        box('smoke generator',(0,.25,0),(.48,.4,.38),black)
        for x in [-.15,-.05,.05,.15]:box('vent slot',(x,.38,-.199),(.035,.12,.018),zinc)
        box('amber control',(0,.47,0),(.22,.04,.12),cream)
    else:
        cyl('beacon stanchion',(0,.76,0),.045,1.45,zinc,n=12)
        box('relay box',(0,1.08,0),(.24,.28,.16),black)
        cyl('beacon base',(0,1.48,0),.16,.1,black)
        cyl('beacon lens',(0,1.65,0),.12,.24,red if slug=='alarm-zone' else cream,r2=.1)
        cyl('beacon cap',(0,1.79,0),.13,.025,black)
    roots.append(export('noir-'+slug))
# A counterweighted lift gate: the frame stays put while GatePanel moves upward.
start('Lift gate')
for x in [-2.02,2.02]:
    box('lift guide',(x,2.75,0),(.14,5.5,.18),zinc)
    box('anchor plate',(x,.045,0),(.26,.09,.3),black)
box('overhead motor beam',(0,5.38,0),(4.18,.2,.24),black)
box('motor housing',(1.55,5.55,0),(.46,.3,.3),black)
frame=export('noir-lift-gate-frame');roots.append(frame)
start('GatePanel')
for x in [-1.9,1.9]:rod('gate stile',(x,.12,0),(x,2.55,0),.033,zinc)
for y in [.12,2.55]:rod('gate rail',(-1.9,y,0),(1.9,y,0),.033,zinc)
for j in range(17):
    x=-1.84+j*.23;rod('vertical wire',(x,.15,0),(x,2.52,0),.009,zinc)
for j in range(11):
    y=.17+j*.23;rod('horizontal wire',(-1.87,y,0),(1.87,y,0),.009,zinc)
box('bottom safety edge',(0,.1,0),(3.86,.11,.1),black)
roots.append(export('noir-lift-gate-panel'))
# Reusable approved maps in Blender. GLBs use external runtime materials.
for slug in ['utility-pole-timber','oil-barrel-steel','fence-galvanized-steel']:
    m=bpy.data.materials.get(slug);p=m.node_tree.nodes.get('Principled BSDF')
    for suffix,socket in [('basecolor','Base Color'),('roughness','Roughness')]:
        path=ROOT+'/app/public/textures/'+slug+'/'+slug+'_'+suffix+'.jpg'
        n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=bpy.data.images.load(path,check_existing=True)
        if suffix!='basecolor':n.image.colorspace_settings.name='Non-Color'
        m.node_tree.links.new(n.outputs['Color'],p.inputs[socket])
for i,o in enumerate(roots):o.location=xyz(((i%4)*3.7,0,(i//4)*4.5))
roots[-1].location=roots[-2].location.copy()
scene.world=bpy.data.worlds.new('Interactive studio world');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.18,.22,.3,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
bpy.ops.object.light_add(type='AREA',location=(4,-2,10));bpy.context.object.data.energy=2200;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=10
bpy.ops.object.camera_add(location=(17,14,17));cam=bpy.context.object;cam.rotation_euler=(Vector((5,-4,1.8))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=23;scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=16;scene.render.resolution_x=1200;scene.render.resolution_y=850;scene.render.resolution_percentage=100
scene.render.filepath=ROOT+'/assets/blender/noir-interactives-preview.png'
bpy.data.libraries.write(ROOT+'/assets/blender/noir-interactives.blend',{scene},path_remap='RELATIVE',fake_user=True)
bpy.ops.render.render(write_still=True)
print('Interactive kit exported and saved',len(roots))
