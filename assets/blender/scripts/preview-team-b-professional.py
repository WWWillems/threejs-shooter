"""Render the isolated Team B workshop for visual QA; never changes Team A."""
import bpy, os
from mathutils import Vector

ROOT = os.environ.get("NOIR_REPO_ROOT", "/Users/wwwillems/Projects/threejs-shooter")
scene = bpy.data.scenes.get("Noir team workshop B")
if scene is None:
    raise RuntimeError("Team B workshop scene is not loaded")
bpy.context.window.scene = scene
rig = next(o for o in scene.objects if o.type == "ARMATURE" and o.name.startswith("NoirPlayerRig"))

# Set a clean rest-pose review, without touching the authored clips.
if rig.animation_data:
    rig.animation_data.action = None
    for track in rig.animation_data.nla_tracks:
        track.mute = True
for bone in rig.pose.bones:
    bone.location = (0, 0, 0)
    bone.rotation_mode = "QUATERNION"
    bone.rotation_quaternion = (1, 0, 0, 0)

# Reuse the approved canvas texture for the fabric surfaces in Blender.
for mat in (bpy.data.materials.get("gang-charcoal-canvas"), bpy.data.materials.get("gang-cargo-canvas")):
    if not mat:
        continue
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    for node in list(nt.nodes):
        if node.type in {"TEX_IMAGE", "NORMAL_MAP", "MAPPING", "TEX_COORD"}:
            nt.nodes.remove(node)
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (3, 3, 1)
    nt.links.new(coord.outputs["UV"], mapping.inputs["Vector"])
    for suffix, socket_name in (("basecolor", "Base Color"), ("roughness", "Roughness"), ("normal", "Normal")):
        ext = "png" if suffix == "normal" else "jpg"
        path = ROOT + "/app/public/textures/gang-charcoal-canvas/gang-charcoal-canvas_" + suffix + "." + ext
        if not os.path.exists(path):
            continue
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(path, check_existing=True)
        nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
        if suffix == "roughness":
            tex.image.colorspace_settings.name = "Non-Color"
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Roughness"])
        elif suffix == "normal":
            tex.image.colorspace_settings.name = "Non-Color"
            normal = nt.nodes.new("ShaderNodeNormalMap")
            normal.inputs["Strength"].default_value = .18
            nt.links.new(tex.outputs["Color"], normal.inputs["Color"])
            nt.links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
        else:
            nt.links.new(tex.outputs["Color"], bsdf.inputs[socket_name])

# Replace only Team B preview lights and camera.
for obj in list(scene.objects):
    if obj.type in {"LIGHT", "CAMERA"}:
        bpy.data.objects.remove(obj, do_unlink=True)
scene.world = bpy.data.worlds.get("Team B professional review world") or bpy.data.worlds.new("Team B professional review world")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (.055, .065, .08, 1)
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = .34

def light(name, typ, pos, energy, color, size=3):
    data = bpy.data.lights.new(name, typ)
    data.energy = energy
    data.color = color
    if typ == "AREA":
        data.shape = "DISK"
        data.size = size
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = xyz(pos)
    obj.rotation_euler = (Vector(xyz((0, 1.0, 0))) - obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj

def xyz(p):
    return (p[0], -p[2], p[1])

light("Team B key", "AREA", (-3.4, 4.1, 4.0), 520, (1.0, .83, .68), 3.8)
light("Team B rim", "AREA", (3.0, 2.8, 2.5), 450, (.48, .65, 1.0), 3.2)
light("Team B fill", "AREA", (-2.0, 1.8, -3.0), 260, (.65, .72, 1.0), 2.5)

# Ground plane is preview-only and removed before the workshop blend is saved.
bpy.ops.mesh.primitive_plane_add(size=8, location=xyz((0, 0, 0)))
ground = bpy.context.object
ground.data.materials.append(bpy.data.materials.get("gang-preview-ground") or bpy.data.materials.new("gang-preview-ground"))
ground.data.materials[0].diffuse_color = (.055, .065, .075, 1)

bpy.ops.object.camera_add(location=xyz((3.2, 2.7, -3.2)))
cam = bpy.context.object
cam.data.type = "ORTHO"
cam.data.ortho_scale = 2.65
cam.rotation_euler = (Vector(xyz((0, 1.02, 0))) - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 820
scene.render.resolution_y = 980
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = ROOT + "/assets/blender/noir-team-b-professional-preview.png"
bpy.ops.render.render(write_still=True)

# Do not persist preview-only camera, lights or plane into the authoring blend.
for obj in list(scene.objects):
    if obj.type in {"LIGHT", "CAMERA", "MESH"} and obj.name != "Noir Team B tailored character":
        bpy.data.objects.remove(obj, do_unlink=True)
bpy.data.libraries.write(ROOT + "/assets/blender/noir-team-b.blend", {scene}, path_remap="RELATIVE", fake_user=True)
print({"preview": scene.render.filepath, "triangles": sum(len(o.data.loop_triangles) for o in scene.objects if o.type == "MESH")})
