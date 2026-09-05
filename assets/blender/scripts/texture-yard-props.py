"""Attach the generated PBR sets and save the existing workshop. Run via Blender MCP."""
import bpy, os, re
from mathutils import Vector
ROOT=os.environ.get('NOIR_REPO_ROOT','/Users/wwwillems/Projects/threejs-shooter')
SLUGS={'trash-bag-plastic','oil-barrel-steel','forklift-yellow'}
for mat in bpy.data.materials:
    slug=re.sub(r'\.\d+$','',mat.name)
    if slug not in SLUGS:continue
    nodes=mat.node_tree.nodes;links=mat.node_tree.links
    bsdf=nodes.get('Principled BSDF')
    for node in list(nodes):
        if node.type not in {'BSDF_PRINCIPLED','OUTPUT_MATERIAL'}:nodes.remove(node)
    def tex(suffix,space):
        node=nodes.new('ShaderNodeTexImage')
        node.image=bpy.data.images.load(ROOT+'/app/public/textures/'+slug+'/'+slug+'_'+suffix,check_existing=True)
        node.image.colorspace_settings.name=space;node.extension='REPEAT'
        return node
    base=tex('basecolor.jpg','sRGB');rough=tex('roughness.jpg','Non-Color');normal=tex('normal.png','Non-Color');ao=tex('ao.jpg','Non-Color')
    mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=.65
    links.new(base.outputs['Color'],mix.inputs[1]);links.new(ao.outputs['Color'],mix.inputs[2]);links.new(mix.outputs[0],bsdf.inputs['Base Color'])
    links.new(rough.outputs['Color'],bsdf.inputs['Roughness'])
    normal_node=nodes.new('ShaderNodeNormalMap');normal_node.inputs['Strength'].default_value=.65
    links.new(normal.outputs['Color'],normal_node.inputs['Color']);links.new(normal_node.outputs['Normal'],bsdf.inputs['Normal'])
    bsdf.inputs['Metallic'].default_value=0 if slug=='trash-bag-plastic' else .5 if slug=='oil-barrel-steel' else .25
# Keep all textures external, with paths relative to the saved .blend.
bpy.ops.file.make_paths_relative()
scene=bpy.context.scene
# Spread the new models out for a clear three-object review.
xyz=lambda p:(p[0],-p[2],p[1])
for name,pos in [('Yellow forklift',(-2,0,3)),('Trash bag',(1,0,3.6)),('Oil barrel',(2.2,0,3.1))]:
    bpy.data.objects[name].location=xyz(pos)
cam=scene.camera;cam.location=xyz((8,6,-7));cam.rotation_euler=(Vector(xyz((-.2,1,3)))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=8.5
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/assets/blender/noir-assets.blend',check_existing=False)
# Only hide the earlier assets for the isolated review render, then restore them.
roots={bpy.data.objects[n] for n in ['Yellow forklift','Trash bag','Oil barrel']}
keep=set(roots)
for root in roots:keep.update(root.children_recursive)
changed=[]
for o in scene.objects:
    if o.type=='MESH' and o not in keep and o.name!='preview floor':
        changed.append((o,o.hide_render));o.hide_render=True
scene.render.filepath=ROOT+'/assets/blender/yard-props-preview.png'
bpy.ops.render.render(write_still=True)
for o,hidden in changed:o.hide_render=hidden
result={'preview':scene.render.filepath,'blend':bpy.data.filepath,'missing':[im.filepath for im in bpy.data.images if im.source=='FILE' and not os.path.exists(bpy.path.abspath(im.filepath))]}
