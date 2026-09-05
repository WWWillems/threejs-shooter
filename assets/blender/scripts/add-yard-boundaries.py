"""Author the timber lamp and chain-link panels via Blender MCP. Safe to rerun."""
import bpy, math, os
from mathutils import Vector
ROOT=os.environ.get('NOIR_REPO_ROOT','/Users/wwwillems/Projects/threejs-shooter')
scene=bpy.context.scene
assert 'Noir asset workshop' in scene.name, 'Open noir-assets.blend first'
NAMES=['Timber lightpole','Chain-link fence','Chain-link gate']
for name in NAMES:
    old=bpy.data.objects.get(name)
    if old:
        for child in list(old.children_recursive):bpy.data.objects.remove(child,do_unlink=True)
        bpy.data.objects.remove(old,do_unlink=True)
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

start('Timber lightpole')
# A tapered, slightly irregular timber shaft. Explicit cylindrical UVs keep grain vertical.
profile=[(0,.19),(.3,.181),(1.8,.169),(3.5,.151),(5.2,.136),(6.3,.12)]
verts=[];faces=[];n=32
for y,r in profile:
    for j in range(n+1):
        a=j/n*math.tau;rr=r*(1+.02*math.sin(a*7+y));verts.append(xyz((math.cos(a)*rr,y,math.sin(a)*rr)))
for i in range(len(profile)-1):
    for j in range(n):
        k=i*(n+1)+j;faces.append((k,k+n+1,k+n+2,k+1))
mesh=bpy.data.meshes.new('timber grain UV');mesh.from_pydata(verts,[],faces);mesh.update();uv=mesh.uv_layers.new()
for p in mesh.polygons:
    p.use_smooth=True
    for li in p.loop_indices:
        vi=mesh.loops[li].vertex_index;uv.data[li].uv=(vi%(n+1)/n,profile[vi//(n+1)][0]/2.2)
o=bpy.data.objects.new('weathered timber shaft',mesh);scene.collection.objects.link(o);finish(o,o.name,wood)
cyl('end grain cap',(0,6.3,0),.121,.012,wood)
# Steel straps, bolts, conduit and an access box at eye height.
for y,r in [(1.1,.178),(5.6,.143),(6.06,.13)]:
    cyl('galvanized band',(0,y,0),r,.065,zinc)
    bolt=cyl('band fastener',(.01,y,.184 if y<2 else .146),.025,.022,zinc,n=6);bolt.rotation_euler[0]=math.pi/2
box('electrical junction box',(-.03,1.18,.208),(.18,.29,.1),black)
rod('metal conduit',(-.09,1.36,.165),(-.09,5.68,.13),.016,zinc)
# Curved gooseneck arm drops into the enamel shade, at the existing light source.
pipe('gooseneck lamp arm',[(.05,5.62,0),(.27,5.95,0),(.55,6.19,0),(.92,6.25,0),(1.23,6.19,0),(1.4,6.06,0),(1.4,5.98,0)],.039,black)
rod('arm brace',(.15,5.52,0),(.76,6.18,0),.019,zinc)
cyl('lampshade',(1.4,5.99,0),.33,.18,black,r2=.095,n=32)
cyl('shade rolled rim',(1.4,5.9,0),.335,.026,black,n=32)
cyl('warm recessed diffuser',(1.4,5.888,0),.256,.02,lens,n=32)
# Top crossarm and porcelain insulators add the utility-pole silhouette.
box('utility crossarm',(0,6.08,0),(.92,.085,.085),wood)
for x in [-.35,.35]:
    rod('insulator pin',(x,6.08,0),(x,6.27,0),.014,zinc)
    for y in [6.16,6.21,6.26]:cyl('porcelain insulator',(x,y,0),.045,.028,ceramic)
pole=export('noir-lightpole')

# Real open diamond wire geometry, batched into one mesh per panel (no alpha cards).
def wire_mesh(xmin,xmax,ymin,ymax,z):
    vv=[];ff=[];uvs=[]
    def segment(a,b):
        a=Vector(xyz(a));b=Vector(xyz(b));direction=(b-a).normalized();side=direction.cross(Vector((0,1,0))).normalized();up=direction.cross(side).normalized();offset=len(vv)
        for end in [a,b]:
            for k in range(4):
                v=end+.0105*(side*math.cos(k*math.pi/2)+up*math.sin(k*math.pi/2));vv.append(tuple(v))
        for k in range(4):ff.append((offset+k,offset+(k+1)%4,offset+4+(k+1)%4,offset+4+k))
    # Clip y = slope*x + intercept against the panel rectangle.
    for slope in [-1,1]:
        for i in range(-50,51):
            b=i*.23;points=[]
            for x in [xmin,xmax]:
                y=slope*x+b
                if ymin-1e-6<=y<=ymax+1e-6:points.append((x,y,z+slope*.008))
            for y in [ymin,ymax]:
                x=(y-b)/slope
                if xmin+1e-6<x<xmax-1e-6:points.append((x,y,z+slope*.008))
            if len(points)==2:segment(*points)
    mesh=bpy.data.meshes.new('open diamond wire');mesh.from_pydata(vv,[],ff);mesh.update();uv=mesh.uv_layers.new()
    for p in mesh.polygons:
        p.use_smooth=True
        for li in p.loop_indices:
            v=mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=(v.x,v.z)
    o=bpy.data.objects.new('woven chain link',mesh);scene.collection.objects.link(o);finish(o,o.name,zinc)

def fence(gate=False):
    start('Chain-link gate' if gate else 'Chain-link fence')
    for x in [-2,2]:
        cyl('post',(x,1.31,0),.065,2.62,zinc)
        cyl('post cap',(x,2.635,0),.077,.055,zinc,r2=.045)
        for y in [.27,2.35]:
            cyl('rail clamp',(x,y,0),.075,.052,black)
        box('post foot',(x,.04,0),(.18,.08,.18),zinc)
    if gate:
        for left,right in [(-1.89,-.05),(.05,1.89)]:
            for x in [left,right]:rod('gate stile',(x,.18,.018),(x,2.43,.018),.032,zinc)
            for y in [.18,2.43]:rod('gate rail',(left,y,.018),(right,y,.018),.032,zinc)
            rod('diagonal gate brace',(left,.18,.018),(right,2.43,.018),.024,zinc)
            wire_mesh(left+.025,right-.025,.21,2.4,.018)
        for x in [-1.94,1.94]:
            for y in [.5,2.1]:cyl('gate hinge',(x,y,.018),.058,.16,black)
        box('gate latch',(0,1.1,.078),(.28,.07,.075),black)
        box('brass padlock',(.02,.99,.11),(.095,.12,.04),ceramic)
    else:
        for y in [.24,2.42]:rod('horizontal rail',(-2,y,0),(2,y,0),.033,zinc)
        wire_mesh(-1.95,1.95,.27,2.39,0)
        for x in [-1.93,1.93]:rod('tension bar',(x,.27,.022),(x,2.38,.022),.017,zinc)
        for x in [-1.5,-.75,0,.75,1.5]:
            pipe('wire fastening',[(x-.025,2.37,.012),(x,2.46,.028),(x+.025,2.4,-.02)],.01,black)
    return export('noir-fence-gate' if gate else 'noir-fence')
panel=fence();gate=fence(True)
pole.location=xyz((-3,0,7));panel.location=xyz((.5,0,7));gate.location=xyz((5,0,7))
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/assets/blender/noir-assets.blend',check_existing=False)
result={'blend':bpy.data.filepath,'models':['noir-lightpole','noir-fence','noir-fence-gate']}
