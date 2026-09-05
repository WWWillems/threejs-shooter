"""Apply approved material sets and render the new boundary assets via Blender MCP."""
import bpy, os, re
from mathutils import Vector
ROOT=os.environ.get('NOIR_REPO_ROOT','/Users/wwwillems/Projects/threejs-shooter')
for mat in bpy.data.materials:
    slug=re.sub(r'\.\d+$','',mat.name)
    if slug not in {'utility-pole-timber','fence-galvanized-steel'}:continue
    nodes=mat.node_tree.nodes;links=mat.node_tree.links
    bsdf=nodes.get('Principled BSDF')
    for node in list(nodes):
        if node.type not in {'BSDF_PRINCIPLED','OUTPUT_MATERIAL'}:nodes.remove(node)
    def tex(suffix,space):
        node=nodes.new('ShaderNodeTexImage');node.image=bpy.data.images.load(ROOT+'/app/public/textures/'+slug+'/'+slug+'_'+suffix,check_existing=True);node.image.reload();node.image.colorspace_settings.name=space
        return node
    base=tex('basecolor.jpg','sRGB');rough=tex('roughness.jpg','Non-Color');normal=tex('normal.png','Non-Color');ao=tex('ao.jpg','Non-Color')
    mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=.5
    links.new(base.outputs['Color'],mix.inputs[1]);links.new(ao.outputs['Color'],mix.inputs[2]);links.new(mix.outputs[0],bsdf.inputs['Base Color']);links.new(rough.outputs['Color'],bsdf.inputs['Roughness'])
    norm=nodes.new('ShaderNodeNormalMap');norm.inputs['Strength'].default_value=.55;links.new(normal.outputs['Color'],norm.inputs['Color']);links.new(norm.outputs['Normal'],bsdf.inputs['Normal']);bsdf.inputs['Metallic'].default_value=0 if slug=='utility-pole-timber' else .7
bpy.ops.file.make_paths_relative()
scene=bpy.context.scene
xyz=lambda v:(v[0],-v[2],v[1])
# Review arrangements only; exported GLBs retain their ground origins.
for name,pos in [('Timber lightpole',(-3,0,7)),('Chain-link fence',(.0,0,7)),('Chain-link gate',(4.3,0,7))]:bpy.data.objects[name].location=xyz(pos)
name='Boundary assets review'
cam=bpy.data.objects.get(name)
if not cam:
    data=bpy.data.cameras.new(name);cam=bpy.data.objects.new(name,data);scene.collection.objects.link(cam)
cam.location=xyz((10,7,-6));cam.rotation_euler=(Vector(xyz((1,2.6,7)))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=12;scene.camera=cam
scene.render.resolution_x=1400;scene.render.resolution_y=1050;scene.render.resolution_percentage=100
scene.render.filepath=ROOT+'/assets/blender/yard-boundaries-preview.png'
bpy.ops.wm.save_as_mainfile(filepath=ROOT+'/assets/blender/noir-assets.blend',check_existing=False)
roots=[bpy.data.objects[n] for n in ['Timber lightpole','Chain-link fence','Chain-link gate']];keep=set(roots)
for root in roots:keep.update(root.children_recursive)
changed=[]
for o in scene.objects:
    if o.type=='MESH' and o not in keep:
        changed.append((o,o.hide_render));o.hide_render=True
bpy.ops.render.render(write_still=True)
for o,hidden in changed:o.hide_render=hidden
result={'blend':bpy.data.filepath,'preview':scene.render.filepath,'missing':[im.filepath for im in bpy.data.images if im.source=='FILE' and not os.path.exists(bpy.path.abspath(im.filepath))]}
