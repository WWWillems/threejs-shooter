import bpy, os
ROOT='/Users/wwwillems/Projects/threejs-shooter'
scene=bpy.data.scenes['Noir character workshop'];bpy.context.window.scene=scene;rig=scene.objects['NoirPlayerRig'];body=scene.objects['Noir tailored character']
# Counter the torso lean so a crouched character keeps the firing arm raised.
for action in bpy.data.actions:
 if action.name not in ['CrouchIdle','CrouchWalk']:continue
 # Blender 4.4 actions keep channels inside a channelbag.
 for layer in action.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    for curve in bag.fcurves:
     if curve.data_path=='pose.bones["UpperArmR"].rotation_quaternion':
      from mathutils import Quaternion, Vector
      bone=rig.pose.bones['UpperArmR'];q=bone.bone.matrix_local.to_quaternion();value=(q.inverted() @ Quaternion(Vector((1,0,0)),.60) @ q)[curve.array_index]
      for key in curve.keyframe_points:key.co.y=value;key.handle_left.y=value;key.handle_right.y=value
# Narrow the facial features and flatten the oversized rounded boot uppers.
head=body.vertex_groups['Head'].index
for v in ([] if body.get('proportions_refined') else body.data.vertices):
 if any(g.group==head for g in v.groups):
  # All head parts keep a common scale around the neck, preserving hat contact.
  v.co.x*=.9
  if v.co.z>1.60:v.co.z=1.60+(v.co.z-1.60)*.9
 if v.co.z<.18:
  v.co.z=.025+(v.co.z-.025)*.78
body['proportions_refined']=True
body.data.update()
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);body.select_set(True);scene.objects['WeaponSocket'].select_set(True)
# The review rifle is a child of the socket; don't export its geometry with the character.
bpy.ops.export_scene.gltf(filepath=ROOT+'/app/public/models/noir-character.glb',export_format='GLB',use_selection=True,use_active_scene=True,export_image_format='NONE',export_yup=True,export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=True)
bpy.data.libraries.write(ROOT+'/assets/blender/noir-character.blend',{scene},path_remap='RELATIVE',fake_user=True)
result={'refined':True}
