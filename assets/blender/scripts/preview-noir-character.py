import bpy, os
from mathutils import Vector, Matrix
ROOT=os.environ.get('NOIR_REPO_ROOT','/Users/wwwillems/Projects/threejs-shooter')
scene=bpy.data.scenes.get('Noir character workshop');assert scene
bpy.context.window.scene=scene
mat=bpy.data.materials['noir-coat-wool'];nodes=mat.node_tree.nodes;links=mat.node_tree.links;p=nodes.get('Principled BSDF')
for n in list(nodes):
 if n.type not in {'BSDF_PRINCIPLED','OUTPUT_MATERIAL'}:nodes.remove(n)
coords=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeMapping');mapping.inputs['Scale'].default_value=(3,3,1);links.new(coords.outputs['UV'],mapping.inputs['Vector'])
def tex(suffix,space):
 n=nodes.new('ShaderNodeTexImage');n.image=bpy.data.images.load(ROOT+'/app/public/textures/noir-coat-wool/noir-coat-wool_'+suffix,check_existing=True);n.image.colorspace_settings.name=space;links.new(mapping.outputs['Vector'],n.inputs['Vector']);return n
base=tex('basecolor.jpg','sRGB');rough=tex('roughness.jpg','Non-Color');normal=tex('normal.png','Non-Color');ao=tex('ao.jpg','Non-Color');links.new(base.outputs['Color'],p.inputs['Base Color']);links.new(rough.outputs['Color'],p.inputs['Roughness']);norm=nodes.new('ShaderNodeNormalMap');norm.inputs['Strength'].default_value=.18;links.new(normal.outputs['Color'],norm.inputs['Color']);links.new(norm.outputs['Normal'],p.inputs['Normal'])
xyz=lambda p:(p[0],-p[2],p[1])
rig=scene.objects['NoirPlayerRig'];socket=scene.objects['WeaponSocket'];rifle=scene.objects.get('Held rifle')
for o in scene.objects:
 if o.name.startswith('Held '):
  for child in [o,*o.children_recursive]:child.hide_render=o!=rifle
if rifle:rifle.parent=socket;rifle.matrix_parent_inverse=Matrix.Identity(4);rifle.matrix_basis=Matrix.Identity(4)
# Neutral studio floor and practical warm/cool lighting for silhouette review.
if not scene.world:scene.world=bpy.data.worlds.new('Character studio world')
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.12,.15,.18,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.4
for name,loc,power,color,size in [('Character warm key',(2,4,-3),450,(1,.78,.54),4),('Character rim',(-2,3,2),600,(.56,.7,1),3),('Character fill',(-3,2,-2),180,(.85,.9,1),3)]:
 o=scene.objects.get(name)
 if not o:
  d=bpy.data.lights.new(name,'AREA');o=bpy.data.objects.new(name,d);scene.collection.objects.link(o)
 o.location=xyz(loc);o.rotation_euler=(Vector(xyz((0,1,0)))-o.location).to_track_quat('-Z','Y').to_euler();o.data.energy=power;o.data.color=color;o.data.shape='DISK';o.data.size=size
cam=scene.objects.get('Character review')
if not cam:
 d=bpy.data.cameras.new('Character review');cam=bpy.data.objects.new('Character review',d);scene.collection.objects.link(cam)
cam.location=xyz((2.8,1.95,-4.1));cam.rotation_euler=(Vector(xyz((0,1,0)))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=2.75;scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.render.resolution_x=1000;scene.render.resolution_y=1100;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX';scene.render.filepath=ROOT+'/assets/blender/noir-character-preview.png'
bpy.ops.file.make_paths_relative();bpy.data.libraries.write(ROOT+'/assets/blender/noir-character.blend',{scene},path_remap='RELATIVE',fake_user=True)
bpy.ops.render.render(write_still=True)
result={'preview':scene.render.filepath,'blend':ROOT+'/assets/blender/noir-character.blend'}
