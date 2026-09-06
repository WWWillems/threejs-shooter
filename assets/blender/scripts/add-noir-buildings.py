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
scene = bpy.context.scene


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

# Metres covered by one repeat of each generated texture set. Primitives ship
# with 0-1 UVs per face, which would stretch one tile over a whole wall.
TILE_METRES = {brick.name: 2.4, steel.name: 1.5, concrete.name: 3.0}

current = None


def world_uv(obj, tile):
    """Box-project UVs in world metres so every face tiles at the same density."""
    mesh = obj.data
    uv = mesh.uv_layers.active or mesh.uv_layers.new()
    matrix = obj.matrix_world
    rotation = matrix.to_3x3()
    for polygon in mesh.polygons:
        normal = (rotation @ polygon.normal).normalized()
        axis = max(range(3), key=lambda index: abs(normal[index]))
        for loop_index in polygon.loop_indices:
            co = matrix @ mesh.vertices[mesh.loops[loop_index].vertex_index].co
            if axis == 2:
                u, v = co.x, co.y
            elif axis == 0:
                u, v = co.y, co.z
            else:
                u, v = co.x, co.z
            uv.data[loop_index].uv = (u / tile, v / tile)


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
    bpy.context.view_layer.update()
    groups = {}
    for obj in objects:
        material_name = obj.data.materials[0].name
        if material_name in TILE_METRES:
            world_uv(obj, TILE_METRES[material_name])
        groups.setdefault(material_name, []).append(obj)
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


def prism(name, x_center, thickness, profile, mat):
    """Extrude a (z, y) game-space polygon along game X: walls with a shaped top edge."""
    count = len(profile)
    verts = []
    for dx in (-thickness / 2, thickness / 2):
        for z, y in profile:
            verts.append(xyz((x_center + dx, y, z)))
    faces = [list(range(count))[::-1], list(range(count, 2 * count))]
    for index in range(count):
        following = (index + 1) % count
        faces.append((index, following, count + following, count + index))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    return finish(obj, name, mat)


# Warehouse body: 14 wide, 9 deep from FRONT to REAR, so the 1 m dock in front
# still sits inside the 14 x 10 collider. Four sawtooth roof teeth, glazing on
# the vertical face of each tooth.
WH_FRONT, WH_REAR, WH_HALF_W = -4.0, 5.0, 7.0
WH_WALL_TOP, WH_TOOTH_TOP = 5.2, 6.05
WH_TEETH = 4
WH_TOOTH_DEPTH = (WH_REAR - WH_FRONT) / WH_TEETH


def sawtooth_profile():
    points = [(WH_FRONT, 0.3), (WH_REAR, 0.3), (WH_REAR, WH_TOOTH_TOP)]
    for index in range(WH_TEETH - 1, 0, -1):
        z = WH_FRONT + index * WH_TOOTH_DEPTH
        points.append((z, WH_WALL_TOP))
        points.append((z, WH_TOOTH_TOP))
    points.append((WH_FRONT, WH_WALL_TOP))
    return points


def loading_bay(front_wall, x, door_open):
    """Cut a bay into the front wall and fit a roller door, drum, stripes and bumpers."""
    width, height, sill = 3.6, 3.6, 0.3
    center_y = sill + height / 2
    cut(front_wall, (x, center_y, WH_FRONT), (width, height, 0.9))
    box("bay interior", (x, center_y, WH_FRONT + 0.6), (width - 0.02, height - 0.02, 0.04), black, 0)
    door_y0 = sill + (height * 0.5 if door_open else 0)
    door_h = sill + height - door_y0
    door = box("roller door", (x, door_y0 + door_h / 2, WH_FRONT + 0.32), (width - 0.1, door_h, 0.06), steel, 0)
    slat_y = door_y0 + 0.4
    while slat_y < sill + height - 0.15:
        box("door slat seam", (x, slat_y, WH_FRONT + 0.285), (width - 0.14, 0.025, 0.02), rust, 0)
        slat_y += 0.4
    if door_open:
        box("door bottom rail", (x, door_y0 + 0.04, WH_FRONT + 0.31), (width - 0.1, 0.08, 0.09), rust, 0)
    rod("roller drum", (x - width / 2, sill + height + 0.26, WH_FRONT - 0.16),
        (x + width / 2, sill + height + 0.26, WH_FRONT - 0.16), 0.19, rust, 14)
    for side in (-1, 1):
        box("drum bracket", (x + side * (width / 2 + 0.05), sill + height + 0.26, WH_FRONT - 0.1), (0.1, 0.5, 0.24), rust, 0)
        stripe_y = sill + 0.25
        stripe = 0
        while stripe_y < sill + height - 0.2:
            box("bay warning stripe", (x + side * (width / 2 + 0.16), stripe_y, WH_FRONT - 0.01),
                (0.16, 0.4, 0.03), warning if stripe % 2 == 0 else black, 0)
            stripe_y += 0.42
            stripe += 1
        box("dock bumper", (x + side * 1.3, 0.5, WH_FRONT - 1.02), (0.4, 0.3, 0.14), black, 0)
    return door


def add_warehouse():
    start("Noir warehouse")
    depth = WH_REAR - WH_FRONT
    box("concrete plinth", (0, 0.15, (WH_FRONT + WH_REAR) / 2), (14.2, 0.3, depth + 0.2), concrete, 0.04)
    front_wall = box("front wall", (0, 0.15 + WH_WALL_TOP / 2, WH_FRONT + 0.14), (14, WH_WALL_TOP - 0.15, 0.28), steel, 0.02)
    box("rear wall", (0, 0.15 + WH_TOOTH_TOP / 2, WH_REAR - 0.14), (14, WH_TOOTH_TOP - 0.15, 0.28), steel, 0.02)
    profile = sawtooth_profile()
    for side in (-1, 1):
        prism("side wall", side * (WH_HALF_W - 0.15), 0.3, profile, steel)
        for z in (WH_FRONT + 0.25, WH_REAR - 0.25):
            rod("downpipe", (side * (WH_HALF_W + 0.06), 0.35, z), (side * (WH_HALF_W + 0.06), WH_WALL_TOP - 0.1, z), 0.05, rust)
    box("front parapet", (0, WH_WALL_TOP + 0.12, WH_FRONT + 0.14), (14.3, 0.32, 0.36), concrete, 0.02)
    # Sawtooth roof: a sloped sheet per tooth and glazing on the vertical faces.
    rise = WH_TOOTH_TOP - WH_WALL_TOP
    slope_length = math.hypot(WH_TOOTH_DEPTH, rise)
    slope_angle = math.atan2(rise, WH_TOOTH_DEPTH)
    for index in range(WH_TEETH):
        z0 = WH_FRONT + index * WH_TOOTH_DEPTH
        z1 = z0 + WH_TOOTH_DEPTH
        box("roof sheet", (0, (WH_WALL_TOP + WH_TOOTH_TOP) / 2 + 0.05, (z0 + z1) / 2),
            (14.4, 0.1, slope_length), steel, 0.01, (-slope_angle, 0, 0))
        if index < WH_TEETH - 1:
            box("roof glazing", (0, (WH_WALL_TOP + WH_TOOTH_TOP) / 2, z1 - 0.05), (13.7, rise - 0.1, 0.06), glass, 0)
            box("glazing head", (0, WH_TOOTH_TOP - 0.03, z1 - 0.06), (13.8, 0.08, 0.14), steel, 0)
            box("glazing cill", (0, WH_WALL_TOP + 0.04, z1 - 0.06), (13.8, 0.1, 0.16), steel, 0)
            for x in (-5.85, -3.9, -1.95, 0, 1.95, 3.9, 5.85):
                box("glazing mullion", (x, (WH_WALL_TOP + WH_TOOTH_TOP) / 2, z1 - 0.1), (0.07, rise - 0.1, 0.06), rust, 0)
    for index, x in ((1, -3.6), (3, 3.6), (2, 0.4)):
        z = WH_FRONT + index * WH_TOOTH_DEPTH + 0.7
        cylinder("vent stack", (x, 5.85, z), 0.18, 1.5, rust, 12)
        cylinder("vent hood", (x, 6.66, z), 0.32, 0.1, rust, 12)
        cylinder("vent cap", (x, 6.78, z), 0.2, 0.16, rust, 12)
    # Loading dock and three bays, the middle door left half open.
    box("loading dock", (0, 0.43, WH_FRONT - 0.5), (13.5, 0.56, 1.0), concrete, 0.04)
    box("dock warning stripe", (0, 0.74, WH_FRONT - 0.94), (13.4, 0.08, 0.12), warning, 0)
    for x, door_open in ((-4.7, False), (0, True), (4.7, False)):
        loading_bay(front_wall, x, door_open)
    for side in (-1, 1):
        box("dock step", (side * 7.05, 0.2, WH_FRONT - 0.75), (0.7, 0.14, 0.5), concrete, 0.01)
        box("dock step", (side * 7.05, 0.42, WH_FRONT - 0.35), (0.7, 0.3, 0.7), concrete, 0.01)
        cylinder("bollard", (side * 6.7, 0.55, WH_FRONT - 1.35), 0.11, 0.9, warning, 12)
        cylinder("bollard band", (side * 6.7, 0.8, WH_FRONT - 1.35), 0.115, 0.12, black, 12)
    # Pallets stacked by the right-hand bay, a side door and a floodlight over the middle bay.
    for level in range(3):
        box("pallet", (5.7, 0.79 + level * 0.15, WH_FRONT - 0.5), (1.2, 0.13, 0.9), rust, 0)
    box("side door reveal", (WH_HALF_W + 0.01, 1.35, 2.6), (0.05, 2.2, 1.1), black, 0)
    box("side door", (WH_HALF_W + 0.03, 1.3, 2.6), (0.06, 2.1, 1.0), steel, 0)
    rod("floodlight arm", (0, WH_WALL_TOP - 0.3, WH_FRONT), (0, WH_WALL_TOP - 0.05, WH_FRONT - 0.7), 0.03, rust)
    box("floodlight", (0, WH_WALL_TOP - 0.1, WH_FRONT - 0.75), (0.5, 0.3, 0.3), black, 0.01)
    box("floodlight lens", (0, WH_WALL_TOP - 0.18, WH_FRONT - 0.78), (0.4, 0.12, 0.3), glass, 0)
    return export("noir-warehouse")


def cut(target, position, size):
    """Subtract a box from `target` so openings are really recessed, not painted on."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(position))
    cutter = bpy.context.object
    cutter.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    modifier = target.modifiers.new("opening", "BOOLEAN")
    modifier.operation = "DIFFERENCE"
    modifier.object = cutter
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


# Tenement facade: the shell is 7 wide (x), 8 deep (z), 7.1 tall on a plinth.
TENEMENT_WALL_X = 3.5
TENEMENT_WALL_Z = 4.0
WINDOW_ROWS = (1.75, 4.15, 6.15)  # glass centres; three low storeys fit under the roof
WINDOW_W, WINDOW_H, RECESS = 1.0, 1.3, 0.3


def window(shell, center, facing):
    """A recessed window in the face given by `facing`: 'front', 'rear', 'left' or 'right'."""
    x, y, z = center
    if facing in ("front", "rear"):
        sign = -1 if facing == "front" else 1
        wall = TENEMENT_WALL_Z * sign
        cut(shell, (x, y, wall), (WINDOW_W, WINDOW_H, RECESS * 2))
        depth = wall - sign * RECESS
        box("window reveal", (x, y, depth + sign * 0.02), (WINDOW_W + 0.02, WINDOW_H + 0.02, 0.04), black, 0)
        box("window glass", (x, y, depth + sign * 0.06), (WINDOW_W - 0.12, WINDOW_H - 0.12, 0.03), glass, 0)
        box("window mullion", (x, y, depth + sign * 0.08), (0.05, WINDOW_H - 0.12, 0.03), rust, 0)
        box("window transom", (x, y + 0.2, depth + sign * 0.08), (WINDOW_W - 0.12, 0.05, 0.03), rust, 0)
        box("window sill", (x, y - WINDOW_H / 2 - 0.05, wall - sign * 0.02), (WINDOW_W + 0.3, 0.1, 0.36), concrete, 0.012)
        box("window lintel", (x, y + WINDOW_H / 2 + 0.07, wall - sign * 0.02), (WINDOW_W + 0.3, 0.14, 0.3), concrete, 0.012)
    else:
        sign = -1 if facing == "left" else 1
        wall = TENEMENT_WALL_X * sign
        cut(shell, (wall, y, z), (RECESS * 2, WINDOW_H, WINDOW_W))
        depth = wall - sign * RECESS
        box("window reveal", (depth + sign * 0.02, y, z), (0.04, WINDOW_H + 0.02, WINDOW_W + 0.02), black, 0)
        box("window glass", (depth + sign * 0.06, y, z), (0.03, WINDOW_H - 0.12, WINDOW_W - 0.12), glass, 0)
        box("window mullion", (depth + sign * 0.08, y, z), (0.03, WINDOW_H - 0.12, 0.05), rust, 0)
        box("window transom", (depth + sign * 0.08, y + 0.2, z), (0.03, 0.05, WINDOW_W - 0.12), rust, 0)
        box("window sill", (wall - sign * 0.02, y - WINDOW_H / 2 - 0.05, z), (0.36, 0.1, WINDOW_W + 0.3), concrete, 0.012)
        box("window lintel", (wall - sign * 0.02, y + WINDOW_H / 2 + 0.07, z), (0.3, 0.14, WINDOW_W + 0.3), concrete, 0.012)


def add_fire_escape():
    """Two landings under the upper window rows, a stair between them and a drop ladder."""
    front = -TENEMENT_WALL_Z
    landings = (3.35, 5.35)
    half_w, depth = 2.3, 1.1
    outer = front - depth
    # The upper landing leaves a gap where the stair comes up through it.
    segments = {
        landings[0]: ((-half_w, half_w),),
        landings[1]: ((-half_w, -1.0), (0.6, half_w)),
    }
    for y in landings:
        for x_min, x_max in segments[y]:
            box("fire escape landing", ((x_min + x_max) / 2, y, front - depth / 2), (x_max - x_min, 0.08, depth), steel, 0.01)
            grate_x = x_min + 0.2
            while grate_x < x_max - 0.1:
                box("fire escape grate", (grate_x, y + 0.055, front - depth / 2), (0.05, 0.03, depth - 0.15), rust, 0)
                grate_x += 0.7
        for x in (-half_w, -half_w / 2, 0, half_w / 2, half_w):
            rod("fire escape rail post", (x, y, outer), (x, y + 1.0, outer), 0.03, rust)
        rod("fire escape hand rail", (-half_w, y + 1.0, outer), (half_w, y + 1.0, outer), 0.035, rust)
        rod("fire escape mid rail", (-half_w, y + 0.5, outer), (half_w, y + 0.5, outer), 0.025, rust)
        for x in (-half_w, half_w):
            rod("fire escape end rail", (x, y + 1.0, outer), (x, y + 1.0, front), 0.035, rust)
            rod("fire escape end post", (x, y, front + 0.05), (x, y + 1.0, front + 0.05), 0.03, rust)
        for x in (-half_w + 0.2, half_w - 0.2):
            rod("fire escape bracket", (x, y - 0.04, front), (x, y - 0.65, front + 0.02), 0.03, rust)
            rod("fire escape bracket", (x, y - 0.65, front + 0.02), (x, y - 0.04, outer + 0.1), 0.03, rust)
    # Stair rising along the facade from the lower landing's right end to the upper one's left.
    steps = 10
    x0, x1 = half_w - 0.3, -half_w + 1.2
    y0, y1 = landings[0], landings[1]
    stair_z = front - depth / 2
    for index in range(1, steps):
        t = index / steps
        x = x0 + (x1 - x0) * t
        y = y0 + (y1 - y0) * t
        box("fire escape tread", (x, y, stair_z), (0.32, 0.04, depth - 0.3), steel, 0)
    for z in (stair_z - (depth - 0.3) / 2, stair_z + (depth - 0.3) / 2):
        rod("fire escape stringer", (x0 + 0.2, y0 + 0.02, z), (x1 - 0.2, y1 + 0.02, z), 0.035, rust)
    rod("stair hand rail", (x0 + 0.2, y0 + 0.95, outer + 0.15), (x1 - 0.2, y1 + 0.95, outer + 0.15), 0.03, rust)
    # Drop ladder from the lower landing towards the pavement.
    for x in (-1.9, -1.5):
        rod("drop ladder rail", (x, landings[0] - 0.05, outer + 0.15), (x, 1.5, outer + 0.15), 0.03, rust)
    for index in range(6):
        rod("drop ladder rung", (-1.9, 1.7 + index * 0.3, outer + 0.15), (-1.5, 1.7 + index * 0.3, outer + 0.15), 0.02, rust)


def add_water_tank():
    """Timber-era steel tank on a braced frame above the rear half of the roof."""
    base_y = 7.62
    frame_h = 1.3
    cx, cz = 0.0, 1.6
    legs = [(cx + sx * 0.7, cz + sz * 0.7) for sx in (-1, 1) for sz in (-1, 1)]
    for x, z in legs:
        rod("tank leg", (x, base_y, z), (x, base_y + frame_h, z), 0.05, rust)
        box("tank foot", (x, base_y + 0.05, z), (0.22, 0.1, 0.22), concrete, 0.01)
    for (ax, az), (bx, bz) in (
        (legs[0], legs[1]), (legs[1], legs[3]), (legs[3], legs[2]), (legs[2], legs[0]),
    ):
        rod("tank brace", (ax, base_y + 0.1, az), (bx, base_y + frame_h - 0.1, bz), 0.025, rust)
        rod("tank beam", (ax, base_y + frame_h, az), (bx, base_y + frame_h, bz), 0.04, rust)
    tank_h = 1.7
    tank_y = base_y + frame_h + 0.05 + tank_h / 2
    cylinder("water tank", (cx, tank_y, cz), 0.78, tank_h, steel, 24)
    for band in (-0.6, -0.15, 0.3, 0.7):
        cylinder("tank hoop", (cx, tank_y + band, cz), 0.8, 0.06, rust, 16)
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.84, radius2=0.08, depth=0.5,
                                    location=xyz((cx, tank_y + tank_h / 2 + 0.25, cz)))
    cap = finish(bpy.context.object, "tank cap", steel)
    for polygon in cap.data.polygons:
        polygon.use_smooth = True
    rod("tank downpipe", (cx + 0.55, tank_y - tank_h / 2, cz - 0.6), (cx + 0.55, base_y, cz - 0.6), 0.04, rust)


def add_tenement():
    start("Noir tenement office")
    box("concrete plinth", (0, 0.18, 0), (7.15, 0.36, 8.15), concrete, 0.04)
    shell = box("brick shell", (0, 3.8, 0), (7, 7.1, 8), brick, 0.04)
    box("roof cap", (0, 7.48, 0), (7.2, 0.22, 8.2), concrete, 0.03)
    # Parapet and a stone coping so the roofline is not a bare slab.
    for x, z, size in (
        (0, -4.05, (7.3, 0.4, 0.3)), (0, 4.05, (7.3, 0.4, 0.3)),
        (-3.5, 0, (0.3, 0.4, 8.4)), (3.5, 0, (0.3, 0.4, 8.4)),
    ):
        box("parapet", (x, 7.79, z), size, brick, 0.02)
        box("parapet coping", (x, 8.02, z), (size[0] + 0.08, 0.08, size[2] + 0.08), concrete, 0.01)
    # Openings on every side; the storey bands mark the floors.
    for y in (3.05, 5.05):
        box("storey band", (0, y, -TENEMENT_WALL_Z - 0.03), (7.15, 0.14, 0.12), concrete, 0.01)
        box("storey band", (0, y, TENEMENT_WALL_Z + 0.03), (7.15, 0.14, 0.12), concrete, 0.01)
    for row, y in enumerate(WINDOW_ROWS):
        front_xs = (-2.2, 2.2) if row == 0 else (-2.5, -0.85, 0.85, 2.5)
        for x in front_xs:
            window(shell, (x, y, 0), "front")
        for x in (-2.2, 0, 2.2):
            window(shell, (x, y, 0), "rear")
        for z in (-2.4, 0, 2.4):
            window(shell, (0, y, z), "left")
            window(shell, (0, y, z), "right")
    # Entry: a deep recess with a steel door, step and a worn sign above it.
    cut(shell, (0, 1.15, -TENEMENT_WALL_Z), (1.5, 2.3, 0.9))
    box("entry reveal", (0, 1.15, -TENEMENT_WALL_Z + 0.44), (1.52, 2.32, 0.04), black, 0.005)
    box("entry door", (0, 1.05, -TENEMENT_WALL_Z + 0.4), (1.2, 2.1, 0.08), steel, 0.02)
    box("entry step", (0, 0.42, -TENEMENT_WALL_Z - 0.2), (1.8, 0.12, 0.5), concrete, 0.015)
    box("entry lintel", (0, 2.4, -TENEMENT_WALL_Z - 0.06), (1.9, 0.18, 0.28), concrete, 0.015)
    box("sign panel", (0, 2.75, -TENEMENT_WALL_Z - 0.09), (3.2, 0.5, 0.08), concrete, 0.01)
    for x in (-1.2, -0.6, 0, 0.6, 1.2):
        box("sign stripe", (x, 2.75, -TENEMENT_WALL_Z - 0.14), (0.4, 0.05, 0.02), warning, 0)
    for x in (-1.4, 1.4):
        rod("sign bracket", (x, 3.1, -TENEMENT_WALL_Z), (x, 2.95, -TENEMENT_WALL_Z - 0.16), 0.02, rust)
    for side in (-1, 1):
        for z in (-3.85, 3.85):
            box("corner pilaster", (side * 3.55, 3.8, z), (0.24, 7.0, 0.5), concrete, 0.02)
    # Chimney and a couple of vent hoods on the roof.
    box("chimney stack", (-2.4, 8.4, 2.6), (0.7, 1.4, 0.9), brick, 0.02)
    box("chimney cap", (-2.4, 9.15, 2.6), (0.82, 0.1, 1.02), concrete, 0.01)
    for x, z in ((2.3, -1.8), (2.3, -0.8)):
        cylinder("roof vent stack", (x, 7.95, z), 0.12, 0.7, rust, 12)
        cylinder("roof vent hood", (x, 8.34, z), 0.22, 0.08, rust, 12)
    add_water_tank()
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
# Lights and camera are reused by name so re-running the script does not stack them.
for name, position, power, color in [
    ("warm key", (-10, 12, -8), 1800, (1, 0.65, 0.34)),
    ("cool rim", (8, 10, 8), 2100, (0.48, 0.65, 1)),
]:
    light_obj = bpy.data.objects.get(name)
    if light_obj is None or light_obj.type != "LIGHT":
        light_data = bpy.data.lights.new(name, "AREA")
        light_obj = bpy.data.objects.new(name, light_data)
        scene.collection.objects.link(light_obj)
    light_data = light_obj.data
    light_data.energy = power
    light_data.color = color
    light_data.shape = "DISK"
    light_data.size = 7
    light_obj.location = xyz(position)
    light_obj.rotation_euler = (
        Vector(xyz((0, 2.5, 0))) - light_obj.location
    ).to_track_quat("-Z", "Y").to_euler()

camera = bpy.data.objects.get("Building review camera")
if camera is None or camera.type != "CAMERA":
    camera_data = bpy.data.cameras.new("Building review camera")
    camera = bpy.data.objects.new("Building review camera", camera_data)
    scene.collection.objects.link(camera)
camera_data = camera.data
camera.location = xyz((19, 15, -22))
camera.rotation_euler = (
    Vector(xyz((0, 2.5, 0))) - camera.location
).to_track_quat("-Z", "Y").to_euler()
camera_data.type = "ORTHO"
camera_data.ortho_scale = 25
scene.camera = camera
scene.render.engine = (
    "BLENDER_EEVEE_NEXT"
    if "BLENDER_EEVEE_NEXT" in {item.identifier for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    else "BLENDER_EEVEE"
)
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
