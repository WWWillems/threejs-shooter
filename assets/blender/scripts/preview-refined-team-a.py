"""Render neutral front/rear three-quarter previews for the refined Team A model."""
import os
import bpy
from mathutils import Vector

ROOT = os.environ.get("NOIR_REPO_ROOT", "/Users/wwwillems/Projects/threejs-shooter")
scene = bpy.data.scenes.get("Noir team workshop A")
assert scene, "Team A workshop is not loaded"
bpy.context.window.scene = scene
rig = next(o for o in scene.objects if o.type == "ARMATURE")
body = next(o for o in scene.objects if o.type == "MESH" and o.parent == rig)

# Remove only preview staging from earlier passes.
for obj in list(scene.objects):
    if obj.get("team_a_preview_staging"):
        bpy.data.objects.remove(obj, do_unlink=True)

def xyz(point):
    return (point[0], -point[2], point[1])

def look_at(obj, target):
    obj.rotation_euler = (Vector(xyz(target)) - obj.location).to_track_quat("-Z", "Y").to_euler()

def add_area(name, location, energy, color, size):
    light_data = bpy.data.lights.new(name, "AREA")
    light_data.energy = energy
    light_data.color = color
    light_data.shape = "DISK"
    light_data.size = size
    light = bpy.data.objects.new(name, light_data)
    light["team_a_preview_staging"] = True
    scene.collection.objects.link(light)
    light.location = xyz(location)
    look_at(light, (0, 1.05, 0))
    return light

if scene.world is None:
    scene.world = bpy.data.worlds.new("Team A preview world")
scene.world.use_nodes = True
background = scene.world.node_tree.nodes.get("Background")
background.inputs[0].default_value = (.055, .065, .08, 1)
background.inputs[1].default_value = .35

# Neutral cool key plus warm edge separates the charcoal coat from the field.
add_area("Team A preview key", (2.8, 4.2, -3.8), 650, (1.0, .82, .64), 3.8)
add_area("Team A preview rim", (-2.8, 3.1, 2.7), 850, (.53, .68, 1.0), 3.2)
add_area("Team A preview fill", (-3.0, 1.8, -2.0), 240, (.75, .82, 1.0), 4.5)

# A matte floor gives the boots a readable contact shadow without changing the
# runtime asset or adding a mesh to the exported GLB.
bpy.ops.mesh.primitive_plane_add(size=8, location=xyz((0, 0, 0)))
floor = bpy.context.object
floor.name = "Team A preview floor"
floor["team_a_preview_staging"] = True
floor.data.materials.append(bpy.data.materials.new("Team A preview floor material"))
floor.data.materials[0].diffuse_color = (.06, .065, .075, 1)
floor.data.materials[0].use_nodes = True
floor.data.materials[0].node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = .88

# Attach the approved wool PBR maps to the coat material for review only.
coat = bpy.data.materials.get("noir-coat-wool")
if coat:
    coat.use_nodes = True
    nodes = coat.node_tree.nodes
    links = coat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    for node in list(nodes):
        if node.type not in {"BSDF_PRINCIPLED", "OUTPUT_MATERIAL"}:
            nodes.remove(node)
    coords = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (3.0, 3.0, 1.0)
    links.new(coords.outputs["UV"], mapping.inputs["Vector"])
    for suffix, extension, color_space, socket_name in [
        ("basecolor", "jpg", "sRGB", "Base Color"),
        ("roughness", "jpg", "Non-Color", "Roughness"),
    ]:
        image = bpy.data.images.load(
            ROOT + "/app/public/textures/noir-coat-wool/noir-coat-wool_" + suffix + "." + extension,
            check_existing=True,
        )
        image.colorspace_settings.name = color_space
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image
        links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
        links.new(tex.outputs["Color"], bsdf.inputs[socket_name])
    image = bpy.data.images.load(ROOT + "/app/public/textures/noir-coat-wool/noir-coat-wool_normal.png", check_existing=True)
    image.colorspace_settings.name = "Non-Color"
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = .18
    links.new(tex.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])

camera_data = bpy.data.cameras.new("Team A preview camera")
camera = bpy.data.objects.new("Team A preview camera", camera_data)
camera["team_a_preview_staging"] = True
scene.collection.objects.link(camera)
camera.data.type = "ORTHO"
camera.data.ortho_scale = 2.65
scene.camera = camera
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 900
scene.render.resolution_y = 1100
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"

for label, camera_position, filename in [
    ("front three-quarter", (2.7, 1.95, -4.2), "noir-team-a-refined-front.png"),
    ("rear three-quarter", (-2.7, 1.95, 4.2), "noir-team-a-refined-rear.png"),
]:
    camera.location = xyz(camera_position)
    look_at(camera, (0, 1.03, 0))
    scene.render.filepath = ROOT + "/assets/blender/" + filename
    bpy.ops.render.render(write_still=True)
    print(label, scene.render.filepath)

bpy.ops.file.make_paths_relative()
bpy.data.libraries.write(ROOT + "/assets/blender/noir-team-a.blend", {scene},
                         path_remap="RELATIVE", fake_user=True)
print({"front": ROOT + "/assets/blender/noir-team-a-refined-front.png",
       "rear": ROOT + "/assets/blender/noir-team-a-refined-rear.png"})
