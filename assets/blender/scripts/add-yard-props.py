"""Add three metre-scale yard props to the existing noir workshop via Blender MCP."""
import bpy, math, os, random
from mathutils import Vector
ROOT=os.environ.get('NOIR_REPO_ROOT','/Users/wwwillems/Projects/threejs-shooter')
scene=bpy.context.scene
assert 'Noir asset workshop' in scene.name, 'Open noir-assets.blend first'
rng=random.Random(90217)

def xyz(v): return (v[0],-v[2],v[1])
def mat(name,color,rough=.6,metal=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    rgb=[((c/255+.055)/1.055)**2.4 if c>10 else c/255/12.92 for c in color]
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*rgb,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    return m
plastic=mat('trash-bag-plastic',(28,29,30),.33)
barrelmat=mat('oil-barrel-steel',(64,63,58),.42,.5)
yellow=mat('forklift-yellow',(187,139,34),.48,.3)
steel=mat('yard-machined-steel',(113,118,115),.3,.78)
darksteel=mat('yard-painted-steel',(37,41,41),.42,.55)
rubber=mat('yard-rubber',(20,22,21),.86)
seat=mat('yard-seat-vinyl',(38,36,32),.62)
label=mat('yard-label',(196,185,151),.8)
red=mat('yard-red-lens',(139,22,8),.22)
current=None

def finish(o,name,m):
    o.name=name;o.parent=current
    if m:o.data.materials.append(m)
    return o

def box(name,pos,size,m,bevel=.02):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(pos));o=bpy.context.object;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('rounded worn edges','BEVEL');mod.width=bevel;mod.segments=3;bpy.ops.object.modifier_apply(modifier=mod.name)
        mod=o.modifiers.new('weighted normals','WEIGHTED_NORMAL');bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o,name,m)

def cyl(name,pos,r,h,m,r2=None,segments=24):
    bpy.ops.mesh.primitive_cone_add(vertices=segments,radius1=r,radius2=r if r2 is None else r2,depth=h,location=xyz(pos))
    o=finish(bpy.context.object,name,m)
    for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
    return o

def rod(name,a,b,r,m,r2=None):
    va=Vector(xyz(a));vb=Vector(xyz(b));o=cyl(name,(0,0,0),r,(vb-va).length,m,r2,12);o.location=(va+vb)/2;o.rotation_euler=(vb-va).to_track_quat('Z','Y').to_euler();return o

def torus(name,pos,major,minor,m):
    bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=minor,major_segments=24,minor_segments=8,location=xyz(pos));return finish(bpy.context.object,name,m)

def start(name):
    global current
    current=bpy.data.objects.new(name,None);scene.collection.objects.link(current);return current

def export(name):
    # Group draw calls by material; UVs from primitive geometry stay intact.
    groups={}
    for o in current.children_recursive:
        if o.type=='MESH':groups.setdefault(o.data.materials[0].name,[]).append(o)
    for key,objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1:bpy.ops.object.join()
        objects[0].name=key
    bpy.ops.object.select_all(action='DESELECT');current.select_set(True)
    for o in current.children_recursive:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=ROOT+'/app/public/models/'+name+'.glb',export_format='GLB',use_selection=True,use_active_scene=True,export_image_format='NONE',export_yup=True,export_apply=True)
    return current

# Gathered refuse sack, bulging asymmetrically with sculpted pleats and a tied neck.
start('Trash bag')
bpy.ops.mesh.primitive_uv_sphere_add(segments=40,ring_count=24,radius=1)
bag=finish(bpy.context.object,'gathered polyethylene sack',plastic)
for v in bag.data.vertices:
    t=(v.co.z+1)/2;a=math.atan2(v.co.y,v.co.x)
    wrinkle=1+.045*math.sin(13*a+t*17)+.03*math.cos(7*a-t*21)
    gather=1-.7*max(0,(t-.65)/.35)
    v.co.x*=.38*wrinkle*gather
    v.co.y*=.31*wrinkle*gather
    v.co.z=max(.028,.035+t*.77+.012*math.sin(5*a+t*8))
    v.co.x+=.045*math.sin(t*math.pi)
for p in bag.data.polygons:p.use_smooth=True
cyl('gathered neck',(.0,.80,0),.061,.09,plastic,.037)
torus('cinched tie',(.0,.79,0),.055,.013,darksteel)
for side in [-1,1]:
    flap=box('tied plastic ear',(side*.07,.875,0),(.14,.13,.035),plastic,.025);flap.rotation_euler[1]=side*-.55
bagroot=export('noir-trash-bag')

# Rolled 200-litre oil drum: two reinforcing beads, recessed lid and twin bungs.
start('Oil barrel')
profile=[(0,.285),(.018,.32),(.04,.32),(.06,.304),(.24,.305),(.265,.325),(.285,.326),(.305,.307),(.61,.307),(.63,.327),(.65,.326),(.67,.305),(.87,.30),(.89,.322),(.92,.322)]
verts=[];faces=[];segments=40
for y,r in profile:
    for j in range(segments+1):
        a=j/segments*math.tau;dent=1-.019*math.sin(a*3+y*4)**4
        verts.append(xyz((math.cos(a)*r*dent,y,math.sin(a)*r*dent)))
for i in range(len(profile)-1):
    for j in range(segments):
        k=i*(segments+1)+j;faces.append((k,k+segments+1,k+segments+2,k+1))
mesh=bpy.data.meshes.new('rolled drum shell');mesh.from_pydata(verts,[],faces);mesh.update();uv=mesh.uv_layers.new()
for p in mesh.polygons:
    p.use_smooth=True
    for li in p.loop_indices:
        vi=mesh.loops[li].vertex_index;uv.data[li].uv=(vi%(segments+1)/segments,profile[vi//(segments+1)][0]/.92)
o=bpy.data.objects.new('dented drum shell',mesh);scene.collection.objects.link(o);finish(o,'dented drum shell',barrelmat)
cyl('recessed lid',(0,.895,0),.299,.016,barrelmat)
cyl('bottom',(0,.015,0),.29,.014,barrelmat)
for x,z,r in [(.14,-.12,.048),(-.15,.13,.026)]:
    cyl('bung recess',(x,.908,z),r,.008,rubber)
    torus('bung flange',(x,.911,z),r,.009,steel)
    cyl('bung cap',(x,.916,z),r*.75,.013,darksteel,segments=6)
barrelroot=export('noir-oil-barrel')

# Counterbalanced yellow forklift with open operator station and lowered forks.
start('Yellow forklift')
box('chassis',(0,.37,.05),(1.48,.25,2.25),darksteel,.07)
box('engine body',(0,.69,.48),(1.44,.53,1.55),yellow,.13)
box('rear counterweight',(0,.73,1.02),(1.53,.72,.47),yellow,.17)
box('engine hood',(0,1.03,.6),(1.32,.17,1.1),yellow,.07)
for side in [-1,1]:
    box('front wheel fender',(side*.58,.93,-.63),(.37,.13,.8),yellow,.045)
    box('entry step',(side*.71,.41,-.16),(.27,.07,.55),steel,.012)
    for z,r in [(-.69,.38),(.83,.29)]:
        wheel=cyl('industrial tyre',(side*.67,r,z),r,.25,rubber,segments=32);wheel.rotation_euler[1]=math.pi/2
        hub=cyl('wheel rim',(side*.806,r,z),r*.57,.032,steel,segments=20);hub.rotation_euler[1]=math.pi/2
        for i in range(6):
            a=i*math.tau/6;bolt=cyl('wheel nut',(side*.831,r+math.sin(a)*r*.35,z+math.cos(a)*r*.35),.025,.027,darksteel,segments=6);bolt.rotation_euler[1]=math.pi/2
    for z in [-.64,.78]:
        box('overhead guard upright',(side*.63,1.69,z),(.075,1.34,.075),darksteel,.018)
    box('guard side rail',(side*.66,2.36,.08),(.1,.1,1.65),yellow)
    box('rear reflector',(side*.48,.88,1.257),(.18,.12,.025),red,.01)
for z in [-.7,.88]:box('overhead guard cross rail',(0,2.36,z),(1.4,.1,.1),yellow)
for x in [-.4,-.2,0,.2,.4]:box('overhead safety slat',(x,2.36,.08),(.055,.055,1.55),darksteel,.01)
box('operator floor',(0,.58,-.35),(1.1,.09,.72),darksteel)
box('seat pedestal',(0,.9,.2),(.44,.32,.45),darksteel)
box('seat cushion',(0,1.095,.18),(.61,.15,.58),seat,.075)
back=box('seat backrest',(0,1.36,.43),(.6,.48,.13),seat,.07);back.rotation_euler[0]=-.12
rod('steering column',(-.18,.65,-.48),(-.18,1.25,-.32),.035,darksteel)
wheel=torus('steering wheel',(-.18,1.27,-.32),.19,.023,rubber);wheel.rotation_euler[0]=.45
for i in range(3):
    a=i*math.tau/3;rod('steering spoke',(-.18,1.27,-.32),(-.18+math.cos(a)*.175,1.27,-.32+math.sin(a)*.175),.013,steel)
for x in [.35,.43]:
    rod('hydraulic control lever',(x,.95,-.22),(x,1.26,-.37),.018,steel)
    cyl('lever knob',(x,1.28,-.37),.04,.05,rubber,segments=12)
for side in [-1,1]:
    box('mast outer channel',(side*.5,1.28,-1.06),(.14,2.47,.19),darksteel,.016)
    box('mast inner slide',(side*.38,1.27,-1.12),(.075,2.23,.12),steel,.008)
    rod('lift ram barrel',(side*.28,.26,-.96),(side*.28,1.27,-.96),.066,darksteel)
    rod('polished lift ram',(side*.28,1.25,-.96),(side*.28,2.18,-.96),.033,steel)
    for i in range(19):box('lift chain link',(side*.16,.32+i*.1,-1.18),(.032,.066,.024),steel,.005)
    box('fork upright',(side*.45,.48,-1.29),(.13,.74,.075),darksteel,.012)
    box('fork blade',(side*.45,.13,-1.93),(.13,.065,1.34),steel,.012)
    tip=box('tapered fork tip',(side*.45,.12,-2.60),(.13,.035,.18),steel,.01)
for y in [.4,.82,2.43]:box('mast cross beam',(0,y,-1.12),(1.12,.12,.12),darksteel)
box('fork carriage',(0,.63,-1.245),(1.23,.29,.095),darksteel)
# Engine ventilation, safety labels, grab handle and rear LPG cylinder.
for i in range(8):box('counterweight cooling slot',(-.34+i*.095,.73,1.263),(.045,.24,.01),rubber,.003)
for side in [-1,1]:
    box('safety label',(side*.726,.81,.53),(.012,.14,.27),label,.002)
    rod('grab handle',(side*.67,1.25,-.55),(side*.67,1.59,-.55),.023,yellow)
tank=cyl('LPG cylinder',(0,1.30,.86),.19,.98,steel,segments=24);tank.rotation_euler[1]=math.pi/2
for x in [-.3,.3]:
    strap=torus('tank strap',(x,1.3,.86),.192,.018,darksteel);strap.rotation_euler[1]=math.pi/2
cyl('tank valve',(.51,1.3,.86),.035,.08,darksteel,segments=8).rotation_euler[1]=math.pi/2
forkroot=export('noir-forklift')

# Place new assets in the existing review workshop; export happened at the origin.
bagroot.location=xyz((2.8,0,2.8));barrelroot.location=xyz((4.1,0,2.8));forkroot.location=xyz((-3,0,4.2))
# A closer review camera for this group, retained alongside the original camera.
data=bpy.data.cameras.new('Yard props review');camera=bpy.data.objects.new('Yard props review',data);scene.collection.objects.link(camera)
camera.location=xyz((9,7,12));camera.rotation_euler=(Vector(xyz((0,1,3.2)))-camera.location).to_track_quat('-Z','Y').to_euler();data.type='ORTHO';data.ortho_scale=11;scene.camera=camera
scene.render.resolution_x=1300;scene.render.resolution_y=950;scene.render.resolution_percentage=100
scene.render.filepath=ROOT+'/assets/blender/yard-props-preview.png'
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/assets/blender/noir-assets.blend',check_existing=False)
result={'models':['noir-trash-bag','noir-oil-barrel','noir-forklift'],'blend':bpy.data.filepath,'scene':scene.name}
