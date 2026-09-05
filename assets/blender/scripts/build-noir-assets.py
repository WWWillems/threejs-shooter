"""Run via Blender MCP execute_blender_code. Game coordinates: Y up, -Z forward.
Creates an isolated scene and exports reusable, image-free glTF material slots.
"""
import bpy, math, random, os
from mathutils import Vector
ROOT = os.environ.get('NOIR_REPO_ROOT', '/Users/wwwillems/Projects/threejs-shooter')
rng = random.Random(17029)
scene = bpy.data.scenes.new('Noir asset workshop')
bpy.context.window.scene = scene

def xyz(p): return (p[0], -p[2], p[1])
def mat(name, color, rough=.6, metal=0, emission=0):
    m=bpy.data.materials.new(name); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    # Hex values are sRGB; glTF expects linear base factors.
    rgb=[((v/255+.055)/1.055)**2.4 if v/255>.04045 else v/255/12.92 for v in color]
    p.inputs['Base Color'].default_value=(*rgb,1)
    p.inputs['Roughness'].default_value=rough; p.inputs['Metallic'].default_value=metal
    if emission:
        p.inputs['Emission Color'].default_value=(*rgb,1); p.inputs['Emission Strength'].default_value=emission
    return m
steel=mat('aged-steel',(82,78,69),.38,.72)
black=mat('rubber',(24,25,24),.88)
paint=mat('pickup-enamel',(72,78,71),.3,.55)
glass=mat('smoked-glass',(40,53,59),.13,.32)
rust=mat('oxidised-metal',(86,47,30),.78,.28)
wood=mat('crate-planks',(255,255,255),.8)
plaster=mat('weathered-plaster',(255,255,255),.92)
roofmat=mat('roof-oxide',(62,33,26),.48,.45)
trim=mat('window-timber',(63,46,31),.85)
light=mat('halogen-lens',(255,204,130),.18,0,5)
tail=mat('tail-lens',(181,28,13),.23,0,2)
coat=mat('charcoal-wool',(46,48,45),.97)
cloth=mat('trouser-twill',(37,39,38),.95)
skin=mat('skin',(145,112,84),.84)
shirt=mat('shirt',(139,132,111),.9)
bark=mat('bark',(65,51,36),.95)
leaves=[mat('foliage-'+str(i),c,.88) for i,c in enumerate([(41,52,29),(56,66,35),(70,74,38),(32,44,28)])]

current=None

def finish(o,name,m):
    o.name=name
    if m: o.data.materials.append(m)
    if current: o.parent=current
    return o

def box(name,pos,size,m,bevel=.02):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(pos)); o=bpy.context.object
    o.dimensions=(size[0],size[2],size[1]); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('soft worn edges','BEVEL'); mod.width=bevel; mod.segments=2
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod=o.modifiers.new('weighted normals','WEIGHTED_NORMAL'); bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o,name,m)

def cyl(name,pos,r1,r2,h,m,vertices=16):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=r1,radius2=r2,depth=h,location=xyz(pos))
    o=finish(bpy.context.object,name,m)
    for p in o.data.polygons: p.use_smooth=len(p.vertices)==4
    return o

def ellipsoid(name,pos,size,m):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=1,location=xyz(pos))
    o=bpy.context.object; o.scale=(size[0],size[2],size[1]); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    for p in o.data.polygons: p.use_smooth=True
    return finish(o,name,m)

def rod(name,a,b,r,m,r2=None,vertices=8):
    v1=Vector(xyz(a)); v2=Vector(xyz(b)); mid=(v1+v2)*.5
    o=cyl(name,(0,0,0),r,r2 if r2 is not None else r,(v2-v1).length,m,vertices)
    o.location=mid; o.rotation_euler=(v2-v1).to_track_quat('Z','Y').to_euler(); return o

def start(name):
    global current
    current=None
    o=bpy.data.objects.new(name,None); scene.collection.objects.link(o); current=o; return o

exports=[]
def export(name,merge=True):
    global current
    objs=list(current.children_recursive)
    if merge:
        groups={}
        for o in objs:
            if o.type=='MESH': groups.setdefault(o.data.materials[0].name,[]).append(o)
        for key,group in groups.items():
            bpy.ops.object.select_all(action='DESELECT')
            for o in group:o.select_set(True)
            bpy.context.view_layer.objects.active=group[0]; bpy.ops.object.join(); group[0].name=key
    bpy.ops.object.select_all(action='DESELECT'); current.select_set(True)
    for o in current.children_recursive:o.select_set(True)
    path=os.path.join(ROOT,'app/public/models',name+'.glb')
    bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',use_selection=True,use_active_scene=True,export_image_format='NONE',export_yup=True,export_apply=True)
    verts=sum(len(o.data.vertices) for o in current.children_recursive if o.type=='MESH')
    exports.append({'name':name,'vertices':verts,'bytes':os.path.getsize(path)})
    return current

# A weathered, compact utility pickup. Its body remains inside the shared car box.
start('Noir pickup')
box('frame',(0,.49,0),(1.95,.22,4.7),black)
box('body',(0,.79,0),(2.17,.5,4.7),paint,.07)
box('hood',(0,1.12,-1.55),(2.1,.27,1.55),paint,.07)
box('cab glass',(0,1.39,-.35),(1.98,.57,1.5),glass,.09)
box('roof',(0,1.75,-.29),(2.12,.11,1.7),paint,.07)
for x in [-1.02,1.02]:
    for z in [-1.05,.42]: rod('cab pillar',(x,1.07,z),(x*.95,1.73,z+.07),.055,paint)
    box('door',(x,1.03,-.25),(.09,.4,1.46),paint)
    box('door handle',(x*1.055,1.2,.2),(.045,.055,.21),steel,.01)
    box('mirror',(x*1.13,1.4,-.83),(.19,.18,.23),steel)
    box('bed side',(x,1.07,1.51),(.14,.53,1.65),paint)
    box('bed rail',(x,1.36,1.51),(.17,.08,1.7),steel)
box('bed floor',(0,.99,1.52),(1.9,.09,1.6),black)
box('tailgate',(0,1.1,2.31),(2.04,.49,.13),paint)
for x in [-.8,-.4,0,.4,.8]: box('bed ribs',(x,1.04,1.5),(.03,.025,1.5),steel,.005)
for z in [-2.4,2.4]: box('bumper',(0,.53,z),(2.32,.18,.18),steel,.03)
box('grille',(0,.89,-2.376),(1.1,.34,.045),black,.005)
for x in [i*.11 for i in range(-4,5)]: box('grille slat',(x,.89,-2.41),(.033,.3,.018),steel,.003)
box('license plate',(0,.55,-2.499),(.46,.14,.012),shirt,.005)
for x in [-.83,.83]:
    box('headlight surround',(x,.95,-2.37),(.48,.38,.055),steel)
    box('headlight',(x,.95,-2.407),(.34,.27,.04),light,.055)
    box('rear lamp',(x,1.11,2.394),(.24,.29,.03),tail)
for x in [-1.04,1.04]:
    for z in [-1.5,1.55]:
        wheel=cyl('tyre',(x,.43,z),.43,.43,.3,black,24); wheel.rotation_euler[1]=math.pi/2
        hub=cyl('wheel hub',(x*1.135,.43,z),.26,.26,.035,steel,20); hub.rotation_euler[1]=math.pi/2
        for i in range(6):
            a=i*math.tau/6
            hole=cyl('hub recess',(x*1.155,.43+math.sin(a)*.17,z+math.cos(a)*.17),.048,.048,.012,black,8);hole.rotation_euler[1]=math.pi/2
# Small rust scars and rain gutters read at grazing light without extra textures.
for side in [-1,1]:
    for i in range(14):
        box('sill corrosion',(side*1.087,.64+rng.random()*.12,-2+rng.random()*4),(.006,.015+rng.random()*.035,.04+rng.random()*.13),rust,.002)
car=export('noir-pickup')

# Trench coat, fedora and a two-handed ready pose. Origin is the hitbox centre.
start('Noir character')
for side in [-1,1]:
    box('boot',(side*.18,-.87,-.07),(.23,.22,.4),black,.06)
    rod('trouser',(side*.18,-.78,0),(side*.17,-.16,.02),.115,cloth,.14,12)
body=cyl('coat skirt',(0,-.18,0),.42,.27,.85,coat,12);body.scale.y=.68
box('coat shoulders',(0,.3,0),(.69,.43,.37),coat,.13)
box('shirt',(0,.43,-.19),(.17,.22,.025),shirt,.01)
for side in [-1,1]:
    lapel=box('lapel',(side*.13,.4,-.212),(.16,.27,.035),coat,.012);lapel.rotation_euler[1]=side*.35
    rod('upper sleeve',(side*.32,.37,0),(side*.4,.09,-.22),.125,coat,.11,12)
    handx=.32 if side==1 else .23
    rod('forearm',(side*.4,.09,-.22),(handx,.11,-.52),.105,coat,.08,12)
    ellipsoid('hand',(handx,.11,-.53),(.08,.075,.105),skin)
box('belt',(0,.0,-.245),(.58,.065,.025),black,.01)
box('buckle',(.07,.0,-.265),(.07,.07,.018),steel,.005)
for y in [.13,.28]: ellipsoid('button',(.055,y,-.222),(.022,.022,.012),steel)
cyl('neck',(0,.58,0),.1,.1,.15,skin)
ellipsoid('head',(0,.71,-.015),(.17,.215,.165),skin)
box('hair',(0,.77,.08),(.29,.24,.13),cloth,.04)
ellipsoid('nose',(0,.70,-.18),(.032,.045,.048),skin)
hat=cyl('fedora brim',(0,.88,-.025),.3,.3,.035,coat,24);hat.scale.y=.84
hat=cyl('fedora crown',(0,.965,0),.192,.163,.16,coat,16);hat.scale.y=.84
hat=cyl('hat ribbon',(0,.92,0),.195,.19,.04,black,16);hat.scale.y=.84
character=export('noir-character')

# Weathered shop shell, standing-seam roof, barred windows, drainpipes and fascia.
start('Noir shop')
box('plaster shell',(0,2,0),(10,4,8),plaster,.055)
box('stone plinth',(0,.18,0),(10.08,.36,8.08),steel,.025)
for side in [-1,1]:
    panel=box('roof slope',(side*2.67,4.62,0),(5.62,.13,8.75),roofmat,.025)
    panel.rotation_euler[1]=side*math.atan2(1.25,5.34)
    for i in range(36):
        z=-4.3+i*.245
        rod('roof seam',(side*.02,5.36,z),(side*5.38,4.1,z),.023,roofmat,vertices=6)
    rod('gutter',(side*5.2,3.94,-4.3),(side*5.2,3.94,4.3),.075,steel)
    rod('downpipe',(side*4.9,.18,4.14),(side*4.9,3.98,4.14),.065,steel)
rod('ridge cap',(0,5.36,-4.4),(0,5.36,4.4),.08,steel)
# End gables.
for z in [-4,4]:
    mesh=bpy.data.meshes.new('gable');mesh.from_pydata([xyz((-5,4,z)),xyz((5,4,z)),xyz((0,5.23,z))],[],[(0,1,2)]);mesh.update()
    o=bpy.data.objects.new('gable',mesh);scene.collection.objects.link(o);finish(o,'gable',plaster)
box('door recess',(0,1.22,4.035),(1.6,2.44,.08),black)
for x in [-.55,-.18,.18,.55]: box('door planks',(x,1.22,4.092),(.35,2.32,.065),wood,.008)
for x in [-.85,.85]:box('door jamb',(x,1.27,4.14),(.13,2.54,.18),trim)
box('door lintel',(0,2.55,4.14),(1.83,.15,.18),trim)
box('door pull',(.53,1.18,4.16),(.06,.22,.07),steel)
for x in [-2.8,2.8]:
    box('window recess',(x,2.01,4.06),(1.59,1.57,.09),black)
    box('window glass',(x,2.01,4.115),(1.36,1.32,.025),glass)
    for dx in [-.79,.79]:box('window jamb',(x+dx,2.01,4.17),(.12,1.69,.15),trim)
    for y in [1.19,2.83]:box('window lintel',(x,y,4.17),(1.69,.12,.15),trim)
    for dx in [-.5,0,.5]:rod('security bar',(x+dx,1.3,4.25),(x+dx,2.73,4.25),.024,steel)
    rod('crossbar',(x-.7,2,4.25),(x+.7,2,4.25),.023,steel)
box('entry step',(0,.09,4.31),(2.1,.18,.62),plaster)
box('fascia frame',(0,3.43,4.16),(3.9,.92,.17),trim)
box('aged sign',(0,3.43,4.26),(3.7,.73,.04),plaster)
box('sign lamp hood',(0,4.0,4.5),(.74,.12,.35),steel)
box('sign lamp lens',(0,3.935,4.48),(.58,.03,.24),light)
# Pipes and ventilation within the shop silhouette.
for i in range(8): box('wall vent',(4.4,2.5+i*.085,4.09),(.55,.035,.09),steel,.005)
shop=export('noir-shop')

# Foliage is geometry, so it casts detailed shadows without alpha sorting.
def leafmesh(name,clusters,needle=False):
    verts=[]; faces=[]; indices=[]
    for center,spread,count in clusters:
        for i in range(count):
            p=Vector((center[0]+rng.uniform(-spread,spread), center[1]+rng.uniform(-spread*.5,spread*.5),center[2]+rng.uniform(-spread,spread)))
            a=rng.random()*math.tau; length=rng.uniform(.09,.22) if not needle else rng.uniform(.13,.3)
            width=length*(.35 if not needle else .19)
            along=Vector((math.cos(a)*length,rng.uniform(-.06,.1),math.sin(a)*length));cross=Vector((-math.sin(a)*width,.035,math.cos(a)*width))
            base=len(verts)
            for v in [p-along,p+cross,p+along,p-cross,p+Vector((0,.035,0))]:verts.append(xyz(v))
            faces.extend([(base,base+1,base+4),(base+1,base+2,base+4),(base+2,base+3,base+4),(base+3,base,base+4)])
            indices.extend([rng.randrange(len(leaves))]*4)
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    o=bpy.data.objects.new(name,mesh);scene.collection.objects.link(o);o.parent=current
    for m in leaves:mesh.materials.append(m);m.use_backface_culling=False
    for p,i in zip(mesh.polygons,indices):p.material_index=i

start('Noir pine')
rod('trunk',(0,0,0),(0,4.3,0),.2,bark,.035,12)
clusters=[]
for level in range(9):
    y=1.05+level*.36; radius=1.22*(1-level/11)
    for b in range(7):
        a=b*math.tau/7+level*1.7; ex=math.cos(a)*radius;ez=math.sin(a)*radius
        rod('branch',(0,y,0),(ex,y-.18,ez),.034,bark,.009)
        for t in [.4,.72,1]:clusters.append(((ex*t,y-.12*t,ez*t),radius*.28,34))
leafmesh('pine needles',clusters,True)
tree=export('noir-pine')
start('Noir shrub')
clusters=[]
for i in range(17):
    a=i*2.4;r=rng.uniform(.18,.45);y=rng.uniform(.38,.8);x=math.cos(a)*r;z=math.sin(a)*r
    rod('twig',(0,.04,0),(x,y,z),.018,bark,.005,6)
    clusters.append(((x,y,z),.2,34))
leafmesh('shrub leaves',clusters)
bush=export('noir-shrub')

# Present the authored models together in a dedicated Blender scene.
car.location=xyz((-3,0,0));character.location=xyz((0,1,2));shop.location=xyz((3,0,-8));tree.location=xyz((-6,0,-5));bush.location=xyz((2,0,2))
current=None
box('preview floor',(0,-.1,-3),(26,.18,24),mat('preview asphalt',(43,46,47),.33))
world=bpy.data.worlds.new('Noir workshop sky');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.16,.2,.28,1);world.node_tree.nodes['Background'].inputs[1].default_value=.35;scene.world=world
for name,pos,power,color,size in [('warm key',(-5,9,5),1900,(1,.65,.34),7),('cool rim',(3,10,-7),2300,(.48,.65,1),8)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=color;data.shape='DISK';data.size=size
    o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=xyz(pos);o.rotation_euler=(Vector(xyz((0,1,-3)))-o.location).to_track_quat('-Z','Y').to_euler()
data=bpy.data.cameras.new('Asset review camera');camera=bpy.data.objects.new('Asset review camera',data);scene.collection.objects.link(camera)
camera.location=xyz((17,15,22));camera.rotation_euler=(Vector(xyz((0,1.6,-3)))-camera.location).to_track_quat('-Z','Y').to_euler();data.type='ORTHO';data.ortho_scale=24;scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=1300;scene.render.resolution_y=950;scene.render.resolution_percentage=100
scene.render.filepath=ROOT+'/assets/blender/noir-assets-preview.png'
# Link exactly the same texture sets used by Three.js, without packing images.
for material, slug in [(wood, 'crate-planks')]:
    nodes=material.node_tree.nodes; links=material.node_tree.links; bsdf=nodes.get('Principled BSDF')
    for suffix, space, socket in [('basecolor.jpg','sRGB','Base Color'), ('roughness.jpg','Non-Color','Roughness'), ('normal.png','Non-Color','Normal')]:
        tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(ROOT+'/app/public/textures/'+slug+'/'+slug+'_'+suffix,check_existing=True);tex.image.colorspace_settings.name=space
        if socket=='Normal':
            normal=nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.45;links.new(tex.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],bsdf.inputs[socket])
        else:links.new(tex.outputs['Color'],bsdf.inputs[socket])
for material, filename in [(plaster,'concrete_diffuse.jpg')]:
    nodes=material.node_tree.nodes;tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(ROOT+'/app/public/textures/concrete/'+filename,check_existing=True);tex.image.colorspace_settings.name='sRGB';material.node_tree.links.new(tex.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
# Write just this workshop and its dependencies; preserve the user's original scene.
bpy.data.libraries.write(ROOT+'/assets/blender/noir-assets.blend', {scene}, path_remap='RELATIVE_ALL')
result={'exports':exports,'scene':scene.name,'blend':ROOT+'/assets/blender/noir-assets.blend'}
