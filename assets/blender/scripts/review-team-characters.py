import bpy,math,struct,json
from mathutils import Vector
ROOT='/Users/wwwillems/Projects/threejs-shooter'
# Prune duplicated actions exported from other open workshops, preserving newest clips.
for team in ['a','b']:
 path=ROOT+'/app/public/models/noir-character-team-'+team+'.glb'
 raw=open(path,'rb').read();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);chunks=raw[20+length:]
 chosen={}
 for a in doc.get('animations',[]):
  base=a['name'].split('.')[0];chosen[base]=a;a['name']=base
 doc['animations']=list(chosen.values())
 for n in doc['nodes']:
  if n.get('name','').startswith('WeaponSocket'):n['name']='WeaponSocket'
 data=json.dumps(doc,separators=(',',':')).encode();data+=b' '*((-len(data))%4)
 output=struct.pack('<III',0x46546c67,2,20+len(data)+len(chunks))+struct.pack('<II',len(data),0x4e4f534a)+data+chunks
 open(path,'wb').write(output)
 scene=bpy.data.scenes['Noir team workshop '+team.upper()];bpy.context.window.scene=scene
 rig=next(o for o in scene.objects if o.type=='ARMATURE');rig.animation_data.action=None
 for b in rig.pose.bones:b.rotation_quaternion=(1,0,0,0);b.location=(0,0,0)
 scene.world=bpy.data.worlds.new('Team review world '+team);scene.world.use_nodes=True
 scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.19,.23,.29,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
 bpy.ops.object.light_add(type='AREA',location=(-3,4,5));bpy.context.object.data.energy=450;bpy.context.object.data.size=4
 bpy.ops.object.light_add(type='AREA',location=(3,-2,3));bpy.context.object.data.energy=300;bpy.context.object.data.color=(.65,.76,1);bpy.context.object.data.size=3
 bpy.ops.object.camera_add(location=(3.2,4.5,3.1));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,1.05))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=2.8;scene.camera=cam
 scene.render.engine='CYCLES';scene.cycles.samples=24;scene.render.resolution_x=750;scene.render.resolution_y=900;scene.render.resolution_percentage=100
 # External approved PBR maps, consistent with the Three.js material setup.
 for slug in ['noir-coat-wool','gang-charcoal-canvas']:
  mat=bpy.data.materials.get(slug)
  if not mat:continue
  nt=mat.node_tree;bsdf=nt.nodes.get('Principled BSDF')
  coord=nt.nodes.new('ShaderNodeTexCoord');mapping=nt.nodes.new('ShaderNodeMapping');mapping.inputs['Scale'].default_value=(3,3,1);nt.links.new(coord.outputs['UV'],mapping.inputs['Vector'])
  for suffix,socket in [('basecolor','Base Color'),('roughness','Roughness'),('normal','Normal')]:
   ext='png' if suffix=='normal' else 'jpg';path=ROOT+'/app/public/textures/'+slug+'/'+slug+'_'+suffix+'.'+ext
   n=nt.nodes.new('ShaderNodeTexImage');n.image=bpy.data.images.load(path,check_existing=True);nt.links.new(mapping.outputs['Vector'],n.inputs['Vector'])
   if suffix!='basecolor':n.image.colorspace_settings.name='Non-Color'
   if suffix=='normal':
    normal=nt.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.15;nt.links.new(n.outputs['Color'],normal.inputs['Color']);nt.links.new(normal.outputs[0],bsdf.inputs['Normal'])
   else:nt.links.new(n.outputs['Color'],bsdf.inputs[socket])
 scene.render.filepath=ROOT+'/assets/blender/noir-team-'+team+'-preview.png'
 bpy.ops.render.render(write_still=True)
 bpy.data.libraries.write(ROOT+'/assets/blender/noir-team-'+team+'.blend',{scene},path_remap='RELATIVE',fake_user=True)
 print(team,'triangles',sum(len(o.data.loop_triangles) for o in scene.objects if o.type=='MESH'),'clips',len(doc['animations']))
