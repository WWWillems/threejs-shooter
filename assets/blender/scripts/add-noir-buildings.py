"""Create the warehouse and tenement exterior shells.

Run this file through Blender MCP's execute_blender_code tool. Coordinates use
the game convention: Y is up and negative Z is the forward-facing direction.
The exported GLBs contain geometry and material slots, but no embedded images.
"""

import math
import os
from mathutils import Vector

import bpy


ROOT = os.environ.get("NOIR_REPO_ROOT", "/Users/wwwillems/Projects/threejs-shooter")
if bpy.app.background:
    scene = bpy.context.scene
else:
    scene = bpy.data.scenes.new("Noir building workshop")
    bpy.context.window.scene = scene


def xyz(point):
    return (point[0], -point[2], point[1])


def material(name, color, roughness=0.7, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*[
        ((value / 255 + 0.055) / 1.055) ** 2.4
        if value / 255 > 0.04045
        else value / 255 / 12.92
        for value in color
    ], 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return mat


def texture_material(name, slug, roughness=0.7, metallic=0.0):
    mat = material(name, (128, 128, 128), roughness, metallic)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    shader = nodes.get("Principled BSDF")
    base = os.path.join(ROOT, "app/public/textures", slug, slug)
    base_tex = nodes.new("ShaderNodeTexImage")
    base_tex.image = bpy.data.images.load(base + "_basecolor.jpg", check_existing=True)
    base_tex.image.colorspace_settings.name = "sRGB"
    links.new(base_tex.outputs["Color"], shader.inputs["Base Color"])
    rough_tex = nodes.new("ShaderNodeTexImage")
    rough_tex.image = bpy.data.images.load(base + "_roughness.jpg", check_existing=True)
    rough_tex.image.colorspace_settings.name = "Non-Color"
    links.new(rough_tex.outputs["Color"], shader.inputs["Roughness"])
    normal_tex = nodes.new("ShaderNodeTexImage")
    normal_tex.image = bpy.data.images.load(base + "_normal.png", check_existing=True)
    normal_tex.image.colorspace_settings.name = "Non-Color"
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = 0.6
    links.new(normal_tex.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], shader.inputs["Normal"])
    return mat


brick = texture_material("brick-soot", "brick-soot", 0.86)
steel = texture_material("corrugated-rust", "corrugated-rust", 0.6, 0.45)
concrete = texture_material("weathered-concrete", "weathered-concrete", 0.9)
black = material("building-shadow", (18, 20, 20), 0.9)
glass = material("smoked-window-glass", (31, 43, 47), 0.18, 0.25)
warning = material("warning-paint", (170, 116, 34), 0.52, 0.1)
rust = material("fire-escape-rust", (73, 43, 30), 0.8, 0.25)

current = None


def finish(obj, name, mat):
    obj.name = name
    if mat:
        obj.data.materials.append(mat)
    if current:
        obj.parent = current
    return obj


def box(name, position, size, mat, bevel=0.02, rotation=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(position))
    obj = bpy.context.object
    obj.dimensions = (size[0], size[2], size[1])
    if rotation:
        obj.rotation_euler = rotation
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        bevel_mod = obj.modifiers.new("soft worn edges", "BEVEL")
        bevel_mod.width = bevel
        bevel_mod.segments = 2
        bpy.ops.object.modifier_apply(modifier=bevel_mod.name)
        normal_mod = obj.modifiers.new("weighted normals", "WEIGHTED_NORMAL")
        bpy.ops.object.modifier_apply(modifier=normal_mod.name)
    return finish(obj, name, mat)


def cylinder(name, position, radius, height, mat, vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=height,
        location=xyz(position),
    )
    obj = finish(bpy.context.object, name, mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def rod(name, start, end, radius, mat, vertices=8):
    first = Vector(xyz(start))
    second = Vector(xyz(end))
    direction = second - first
    obj = cylinder(name, (0, 0, 0), radius, direction.length, mat, vertices)
    obj.location = (first + second) * 0.5
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return obj


def start(name):
    global current
    current = bpy.data.objects.new(name, None)
    scene.collection.objects.link(current)
    return current


def export(name):
    objects = [obj for obj in current.children_recursive if obj.type == "MESH"]
    groups = {}
    for obj in objects:
        groups.setdefault(obj.data.materials[0].name, []).append(obj)
    for group in groups.values():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in group:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.join()
    bpy.ops.object.select_all(action="DESELECT")
    current.select_set(True)
    for obj in current.children_recursive:
        obj.select_set(True)
    path = os.path.join(ROOT, "app/public/models", name + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        use_active_scene=True,
        export_image_format="NONE",
        export_yup=True,
        export_apply=True,
    )
    return {
        "name": name,
        "vertices": sum(
            len(obj.data.vertices)
            for obj in current.children_recursive
            if obj.type == "MESH"
        ),
        "path": path,
        "bytes": os.path.getsize(path),
    }


def add_warehouse():
    start("Noir warehouse")
    box("concrete plinth", (0, 0.15, 0), (14.2, 0.3, 10.2), concrete, 0.04)
    box("rear wall", (0, 2.8, 4.8), (14, 5.4, 0.28), steel, 0.03)
    box("left wall", (-6.85, 2.8, 0), (0.3, 5.4, 9.7), steel, 0.03)
    box("right wall", (6.85, 2.8, 0), (0.3, 5.4, 9.7), steel, 0.03)
    box("front lintel", (0, 4.75, -4.8), (14, 1.5, 0.3), steel, 0.03)
    box("front beam", (0, 3.15, -4.83), (14, 0.22, 0.32), concrete, 0.02)
    for x in (-4.7, 0, 4.7):
        box("loading bay shadow", (x, 2.25, -5.0), (3.8, 3.9, 0.06), black, 0.01)
        box("loading bay header", (x, 4.35, -5.08), (4.1, 0.22, 0.34), concrete)
        for side in (-1, 1):
            box("loading bay jamb", (x + side * 1.92, 2.25, -5.08), (0.22, 4.1, 0.34), concrete)
    box("loading dock", (0, 0.43, -5.45), (13.5, 0.56, 1.0), concrete, 0.04)
    box("dock warning stripe", (0, 0.74, -5.95), (13.4, 0.08, 0.12), warning, 0.01)
    for x in (-5.6, -4.9, 4.9, 5.6):
        box("corner warning stripe", (x, 1.0, -5.02), (0.15, 1.6, 0.08), warning, 0.01)
    for x in (-4.7, -2.35, 0, 2.35, 4.7):
        box("roof vent", (x, 4.95, 1.5), (0.72, 0.25, 1.8), concrete, 0.04)
        box("roof vent cap", (x, 5.14, 1.5), (1.0, 0.1, 2.0), steel, 0.02)
    for index in range(5):
        z = -4 + index * 2
        panel_rotation = (0.18 if index % 2 == 0 else -0.18, 0, 0)
        box("sawtooth roof", (0, 5.35, z), (14.3, 0.16, 2.25), steel, 0.02, panel_rotation)
    for side in (-1, 1):
        for z in (-3.4, -1.7, 0, 1.7, 3.4):
            rod("side rain gutter", (side * 7.05, 0.7, z), (side * 7.05, 4.7, z), 0.045, concrete)
    return export("noir-warehouse")


def add_fire_escape():
    for level, y in enumerate((2.9, 5.2)):
        box("fire escape platform", (0, y, -4.35), (5.8, 0.16, 1.35), steel, 0.02)
        for x in (-2.7, -1.8, -0.9, 0, 0.9, 1.8, 2.7):
            box("fire escape grate", (x, y + 0.1, -4.35), (0.07, 0.05, 1.15), rust, 0.005)
        for x in (-2.75, 2.75):
            rod("fire escape rail post", (x, y, -4.88), (x, y + 1.0, -4.88), 0.045, rust)
        rod("fire escape rail", (-2.75, y + 1.0, -4.88), (2.75, y + 1.0, -4.88), 0.05, rust)
    for x in (-2.2, -1.1, 0, 1.1, 2.2):
        rod("fire escape stair rail", (x, 2.85, -4.95), (x, 5.15, -4.95), 0.035, rust)
    for index in range(7):
        y = 2.75 + index * 0.4
        box("fire escape stair", (0, y, -5.05 + index * 0.12), (2.2, 0.08, 0.42), steel, 0.01)


def add_tenement():
    start("Noir tenement office")
    box("concrete plinth", (0, 0.18, 0), (7.15, 0.36, 8.15), concrete, 0.04)
    box("brick shell", (0, 3.8, 0), (7, 7.1, 8), brick, 0.04)
    box("roof cap", (0, 7.48, 0), (7.2, 0.22, 8.2), concrete, 0.03)
    box("front shadow", (0, 3.2, -4.03), (6.3, 5.7, 0.05), black, 0.01)
    for floor_y in (2.1, 4.45, 6.8):
        box("front floor band", (0, floor_y, -4.1), (7.05, 0.18, 0.16), concrete, 0.02)
        for x in (-2.55, -0.85, 0.85, 2.55):
            box("window glass", (x, floor_y + 0.82, -4.13), (1.1, 1.35, 0.06), glass, 0.01)
            box("window sill", (x, floor_y + 0.12, -4.2), (1.3, 0.12, 0.24), concrete, 0.015)
            for side in (-1, 1):
                box("window jamb", (x + side * 0.62, floor_y + 0.82, -4.2), (0.12, 1.55, 0.22), concrete, 0.01)
    box("entry shadow", (0, 1.0, -4.14), (1.5, 1.8, 0.06), black, 0.01)
    box("entry door", (0, 1.0, -4.19), (1.2, 1.65, 0.08), steel, 0.02)
    box("entry lintel", (0, 1.95, -4.2), (1.55, 0.16, 0.24), concrete, 0.02)
    box("sign panel", (0, 6.95, -4.2), (4.9, 0.7, 0.08), concrete, 0.02)
    for x in (-1.9, -0.95, 0, 0.95, 1.9):
        box("sign stripe", (x, 6.95, -4.26), (0.5, 0.06, 0.02), warning, 0.005)
    for side in (-1, 1):
        box("side pilaster", (side * 3.45, 3.8, -0.1), (0.18, 7.0, 8.05), concrete, 0.02)
    cylinder("rooftop water tank", (0, 8.05, 0.4), 0.82, 1.2, steel, 20)
    for x in (-0.55, 0.55):
        for z in (0.05, 0.75):
            rod("water tank leg", (x, 7.48, z), (x, 7.62, z), 0.07, rust)
    add_fire_escape()
    return export("noir-tenement")


warehouse = add_warehouse()
tenement = add_tenement()

floor = material("preview-concrete", (58, 61, 60), 0.85)
box_current = current
current = None
box("preview floor", (0, -0.1, 0), (32, 0.18, 26), floor)
warehouse_root = bpy.data.objects.get("Noir warehouse")
tenement_root = bpy.data.objects.get("Noir tenement office")
if warehouse_root:
    warehouse_root.location = xyz((-8, 0, 0))
if tenement_root:
    tenement_root.location = xyz((8, 0, 0))

world = bpy.data.worlds.new("Noir building workshop sky")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.16, 0.2, 0.28, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.35
scene.world = world
for name, position, power, color in [
    ("warm key", (-10, 12, 8), 1800, (1, 0.65, 0.34)),
    ("cool rim", (8, 10, -8), 2100, (0.48, 0.65, 1)),
]:
    light_data = bpy.data.lights.new(name, "AREA")
    light_data.energy = power
    light_data.color = color
    light_data.shape = "DISK"
    light_data.size = 7
    light_obj = bpy.data.objects.new(name, light_data)
    scene.collection.objects.link(light_obj)
    light_obj.location = xyz(position)
    light_obj.rotation_euler = (
        Vector(xyz((0, 2.5, 0))) - light_obj.location
    ).to_track_quat("-Z", "Y").to_euler()

camera_data = bpy.data.cameras.new("Building review camera")
camera = bpy.data.objects.new("Building review camera", camera_data)
scene.collection.objects.link(camera)
camera.location = xyz((19, 15, 22))
camera.rotation_euler = (
    Vector(xyz((0, 2.5, 0))) - camera.location
).to_track_quat("-Z", "Y").to_euler()
camera_data.type = "ORTHO"
camera_data.ortho_scale = 25
scene.camera = camera
scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.resolution_x = 1300
scene.render.resolution_y = 950
scene.render.resolution_percentage = 100
scene.render.filepath = os.path.join(ROOT, "assets/blender/noir-buildings-preview.png")

bpy.data.libraries.write(
    os.path.join(ROOT, "assets/blender/noir-buildings.blend"),
    {scene},
    path_remap="RELATIVE_ALL",
)
result = {
    "exports": [warehouse, tenement],
    "blend": os.path.join(ROOT, "assets/blender/noir-buildings.blend"),
    "preview": scene.render.filepath,
}
