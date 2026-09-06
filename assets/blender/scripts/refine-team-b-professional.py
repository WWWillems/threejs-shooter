"""Refine Team B into a compact, readable street-gang character.

This is deliberately separate from ``model-team-characters.py``.  It opens the
existing Team B workshop, keeps its 18 bone rig, actions and weapon socket, and
replaces only the mesh.  The geometry is intentionally low-poly and layered so
the silhouette reads in the isometric camera while the vest, hood, mohawk,
cargo pockets, gloves and boots survive at gameplay distance.

Run from Blender MCP with noir-team-b.blend open.  The script writes a fresh
GLB and standalone workshop blend; it never touches Team A.
"""
import bpy, math, os
from mathutils import Vector

ROOT = os.environ.get("NOIR_REPO_ROOT", "/Users/wwwillems/Projects/threejs-shooter")
SCENE_NAME = "Noir team workshop B"
scene = bpy.data.scenes.get(SCENE_NAME)
if scene is None:
    raise RuntimeError("Open assets/blender/noir-team-b.blend before refining Team B")
bpy.context.window.scene = scene

rig = next((o for o in scene.objects if o.type == "ARMATURE" and o.name.startswith("NoirPlayerRig")), None)
if rig is None:
    raise RuntimeError("Team B rig NoirPlayerRig is missing")
socket = next((o for o in scene.objects if o.name.startswith("WeaponSocket")), None)

# Game coordinates are X/Y/Z with Y up and the character looking toward -Z.
def xyz(p):
    return (p[0], -p[2], p[1])

def srgb(v):
    v = v / 255.0
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4

def material(name, rgb, rough=.78, metal=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = tuple(srgb(v) for v in rgb) + (1,)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return mat

# Use the approved canvas material on the large fabric masses.  The runtime
# loader attaches its PBR maps by name, so keeping this material name stable is
# important.  Small accent materials remain flat and cheap.
canvas = material("gang-charcoal-canvas", (62, 61, 55), .88)
canvas_edge = material("gang-jacket-edge", (42, 42, 39), .91)
webbing = material("gang-webbing", (35, 35, 31), .94)
red = material("gang-red-cloth", (138, 39, 32), .82)
# Keep a distinct material name so the runtime can apply the approved canvas
# maps with the olive cargo tint used by the reference sheet.
trouser = material("gang-cargo-canvas", (73, 70, 61), .92)
leather = material("gang-boot-leather", (32, 29, 26), .68)
rubber = material("gang-rubber", (20, 21, 21), .82)
skin = material("noir-skin", (148, 104, 76), .72)
beard = material("gang-beard", (29, 25, 23), .9)
metal = material("gang-hardware", (72, 70, 62), .4, .62)
shirt = material("gang-shirt", (49, 47, 42), .9)
mark = material("gang-back-mark", (130, 124, 108), .88)

# Remove only old Team B mesh.  Camera, lights, rig, animations and socket are
# retained so this refinement can be rerun safely in the workshop.
for obj in list(scene.objects):
    if obj.type == "MESH":
        bpy.data.objects.remove(obj, do_unlink=True)

parts = []

def finish(obj, name, mat, joint, smooth=True):
    obj.name = name
    obj.data.materials.append(mat)
    group = obj.vertex_groups.new(name=joint)
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    parts.append(obj)
    if smooth:
        for poly in obj.data.polygons:
            poly.use_smooth = True
    return obj

def rounded_box(name, pos, size, mat, joint, bevel=.018):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(pos))
    obj = bpy.context.object
    obj.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new("soft tailored edge", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(obj, name, mat, joint)

def ellipsoid(name, pos, scale, mat, joint, segments=16, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=xyz(pos))
    obj = bpy.context.object
    obj.scale = (scale[0], scale[2], scale[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat, joint)

def ico(name, pos, scale, mat, joint):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=xyz(pos))
    obj = bpy.context.object
    obj.scale = (scale[0], scale[2], scale[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat, joint)

def limb(name, a, b, r1, r2, mat, joint, vertices=12):
    # Multi-ring tapered tube with a gentle elbow bulge.  A single Blender
    # cone made the old character read as toy tubing, especially on the shins.
    va, vb = Vector(xyz(a)), Vector(xyz(b))
    axis = (vb - va).normalized()
    ref = Vector((0, 0, 1)) if abs(axis.z) < .88 else Vector((1, 0, 0))
    u = axis.cross(ref).normalized()
    v = axis.cross(u).normalized()
    ring_t = (0.0, .24, .74, 1.0)
    ring_r = (r1 * .88, r1, r2 * 1.08, r2 * .9)
    verts, faces = [], []
    for t, radius in zip(ring_t, ring_r):
        center = va.lerp(vb, t)
        for i in range(vertices):
            ang = math.tau * i / vertices
            verts.append(tuple(center + u * (math.cos(ang) * radius) + v * (math.sin(ang) * radius)))
    for row in range(len(ring_t) - 1):
        for i in range(vertices):
            a0 = row * vertices + i
            a1 = row * vertices + (i + 1) % vertices
            b0 = (row + 1) * vertices + i
            b1 = (row + 1) * vertices + (i + 1) % vertices
            faces.append((a0, a1, b1, b0))
    faces.append(tuple(range(vertices - 1, -1, -1)))
    last = (len(ring_t) - 1) * vertices
    faces.append(tuple(last + i for i in range(vertices)))
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return finish(obj, name, mat, joint)

def shell_at(name, center, profile, mat, joint, segments=16):
    """A multi-ring volume centred on a joint, useful for shaped trousers."""
    verts, faces = [], []
    cx, cz = center
    for y, rx, rz in profile:
        for i in range(segments):
            a = math.tau * i / segments
            crease = 1 + .012 * math.sin(a * 5 + y * 8)
            verts.append(xyz((cx + math.cos(a) * rx * crease, y, cz + math.sin(a) * rz * crease)))
    for row in range(len(profile) - 1):
        for i in range(segments):
            k = row * segments + i
            faces.append((k, k + segments, (row + 1) * segments + (i + 1) % segments, row * segments + (i + 1) % segments))
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    finish(obj, name, mat, joint)
    solid = obj.modifiers.new("tailored cloth thickness", "SOLIDIFY")
    solid.thickness = .009
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=solid.name)
    return obj

def shell(name, profile, mat, joint, start=0, end=math.tau, segments=20):
    """Low-poly fabric shell around the Y axis, with no hidden backfaces."""
    verts, faces = [], []
    for y, rx, rz in profile:
        for i in range(segments + 1):
            a = start + (end - start) * i / segments
            crease = 1 + .018 * math.sin(a * 9 + y * 11)
            verts.append(xyz((math.cos(a) * rx * crease, y, math.sin(a) * rz * crease)))
    for row in range(len(profile) - 1):
        for i in range(segments):
            k = row * (segments + 1) + i
            faces.append((k, k + segments + 1, k + segments + 2, k + 1))
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    finish(obj, name, mat, joint)
    solid = obj.modifiers.new("fabric thickness", "SOLIDIFY")
    solid.thickness = .011
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=solid.name)
    return obj

def triangle(name, points, mat, joint):
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata([xyz(p) for p in points], [], [(0, 1, 2)])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return finish(obj, name, mat, joint, smooth=False)

def add_rotation(obj, euler):
    obj.rotation_euler = euler
    return obj

# Torso: one broad, tapered jacket volume, a cropped hem and a separate vest
# plate.  These layers create depth without a texture-heavy per-model unwrap.
# A soft, tapered loft gives the jacket a shoulder-to-waist contour instead of
# another rectangular primitive.  Its broad upper ring carries the tactical
# harness, while the lower ring stays compact like the reference sheet.
shell("cropped hooded jacket", [(1.00, .235, .15), (1.08, .275, .17),
      (1.33, .285, .18), (1.47, .245, .16)], canvas, "Spine", 0, math.tau, 24)
rounded_box("jacket lower hem", (0, 1.00, .01), (.53, .10, .31), canvas_edge, "Hips", .025)
rounded_box("tactical vest plate", (0, 1.285, -.176), (.43, .35, .075), webbing, "Spine", .035)
rounded_box("vest lower plate", (0, 1.13, -.181), (.39, .10, .06), webbing, "Spine", .018)
rounded_box("utility belt", (0, 1.02, -.01), (.56, .09, .12), leather, "Hips", .025)
rounded_box("belt buckle", (0, 1.02, -.082), (.09, .065, .024), metal, "Hips", .008)

# Hood is visible from the isometric rear and side views.  The front opening
# stays clear around the face; a rear half-shell and a thick rolled rim do the
# readable work at a distance.
shell("hood rear", [(1.39, .26, .16), (1.49, .29, .19), (1.61, .22, .15)], canvas_edge,
      "Spine", 0.05, math.pi - .05, 18)
shell("hood rim", [(1.40, .255, .16), (1.47, .275, .17)], canvas, "Spine",
      0.02, math.pi - .02, 18)
shell("red neck scarf", [(1.47, .105, .085), (1.54, .108, .087)], red, "Spine", 0, math.tau, 18)
triangle("red scarf tail", [(-.02, 1.46, -.214), (.12, 1.46, -.214), (.045, 1.27, -.214)], red, "Spine")
limb("left hood cord", (-.13, 1.46, -.19), (-.16, 1.28, -.20), .012, .009, canvas_edge, "Spine", 8)
limb("right hood cord", (.13, 1.46, -.19), (.16, 1.28, -.20), .012, .009, canvas_edge, "Spine", 8)
ellipsoid("left hood cord toggle", (-.16, 1.27, -.20), (.018, .022, .018), metal, "Spine", 8, 5)
ellipsoid("right hood cord toggle", (.16, 1.27, -.20), (.018, .022, .018), metal, "Spine", 8, 5)

# The painted gang mark is built from two broad strips on the rear vest.  It
# remains legible in the isometric camera without adding a second texture set.
back_mark_l = triangle("rear gang mark left", [(-.13, 1.40, .205), (0, 1.26, .208), (-.015, 1.30, .208)], mark, "Spine")
back_mark_r = triangle("rear gang mark right", [( .13, 1.40, .205), (0, 1.26, .208), ( .015, 1.30, .208)], mark, "Spine")
rounded_box("rear gang mark bar", (0, 1.385, .209), (.22, .025, .012), mark, "Spine", .003)

# Integrated harness and MOLLE rows.  Pouches are shallow, close to the chest,
# rather than oversized blocks that made the previous model read toy-like.
for side, sign in [("L", -1), ("R", 1)]:
    strap = rounded_box("shoulder harness " + side, (sign * .145, 1.39, -.213), (.048, .31, .032), leather, "Spine", .012)
    add_rotation(strap, (0, sign * .14, sign * .08))
    rounded_box("shoulder strap keeper " + side, (sign * .145, 1.50, -.232), (.085, .045, .04), metal, "Spine", .009)
    for row, y in enumerate((1.20, 1.30)):
        for col in range(2):
            x = sign * (.065 + col * .085)
            rounded_box("chest mag pouch %s %d" % (side, row * 2 + col), (x, y, -.238), (.068, .075, .055), leather, "Spine", .011)
    rounded_box("side utility pouch " + side, (sign * .28, 1.08, -.01), (.11, .18, .15), leather, "Hips", .02)
    rounded_box("side pouch flap " + side, (sign * .28, 1.17, -.085), (.10, .035, .016), metal, "Hips", .006)

# Arms are deliberately relaxed and human-proportioned.  The authored weapon
# animation still drives the same forearm/hand bones later.
for side, sign in [("L", -1), ("R", 1)]:
    # These points intentionally follow the existing rig's rest pose.  The
    # hands are raised and angled toward the weapon socket in the authored
    # animation; inventing a lower wrist here makes the rifle float in-game.
    shoulder = (sign * .265, 1.47, 0)
    elbow = ((.31 if sign > 0 else -.30), 1.22, (-.17 if sign > 0 else -.19))
    wrist = ((.19 if sign > 0 else -.04), (1.32 if sign > 0 else 1.29), (-.45 if sign > 0 else -.61))
    limb("jacket upper sleeve " + side, shoulder, elbow, .115, .098, canvas, "UpperArm" + side)
    ellipsoid("rounded shoulder seam " + side, shoulder, (.135, .12, .12), canvas, "UpperArm" + side)
    ellipsoid("sleeve elbow " + side, elbow, (.105, .105, .105), canvas, "Forearm" + side)
    limb("jacket forearm " + side, elbow, wrist, .095, .070, canvas, "Forearm" + side)
    # Red cloth band sits over the left upper sleeve; the right is a dark strap.
    bandmat = red if side == "L" else leather
    rounded_box("upper arm band " + side, (sign * .322, 1.31, -.073), (.225, .047, .205), bandmat, "UpperArm" + side, .018)
    hand = ellipsoid("fingerless glove " + side, wrist, (.073, .073, .09), leather, "Hand" + side)
    ellipsoid("exposed fingers " + side, (wrist[0], wrist[1] - .008, wrist[2] - .075), (.055, .042, .038), skin, "Hand" + side)
    # Small metal studs make the gloves readable in the shadowed isometric view.
    for i, x in enumerate((-.025, .025)):
        ellipsoid("glove stud %s %d" % (side, i), (wrist[0] + x, wrist[1] + .018, wrist[2] - .067), (.009, .009, .006), metal, "Hand" + side, 8, 5)

# Cargo trousers: thick thighs, independent cargo pockets, modest kneepads,
# then narrow lower legs tucked into high boots.
for side, sign in [("L", -1), ("R", 1)]:
    hip = (sign * .15, .96, .01)
    knee = (sign * .15, .55, -.005)
    ankle = (sign * .15, .14, -.015)
    shell_at("cargo thigh " + side, (sign * .15, .005),
             [(.95, .115, .095), (.82, .145, .115), (.63, .12, .105), (.55, .105, .09)],
             trouser, "Thigh" + side, 16)
    rounded_box("cargo pocket " + side, (sign * .245, .76, -.035), (.125, .22, .145), trouser, "Thigh" + side, .022)
    rounded_box("cargo pocket flap " + side, (sign * .245, .875, -.112), (.12, .035, .018), leather, "Thigh" + side, .007)
    rounded_box("cargo seam " + side, (sign * .15, .72, -.11), (.018, .20, .015), canvas_edge, "Thigh" + side, .003)
    ellipsoid("cargo knee " + side, knee, (.112, .105, .10), trouser, "Shin" + side)
    rounded_box("hard kneepad " + side, (sign * .15, .55, -.108), (.18, .17, .055), leather, "Shin" + side, .028)
    rounded_box("kneepad plate " + side, (sign * .15, .55, -.139), (.13, .11, .018), metal, "Shin" + side, .012)
    shell_at("cargo calf " + side, (sign * .15, -.005),
             [(.55, .105, .09), (.40, .105, .09), (.20, .082, .075), (.14, .073, .068)],
             trouser, "Shin" + side, 16)
    ellipsoid("ankle boot " + side, (sign * .15, .13, -.04), (.10, .09, .13), leather, "Foot" + side)
    ellipsoid("shaped boot upper " + side, (sign * .15, .105, -.105), (.115, .12, .18), leather, "Foot" + side)
    ellipsoid("rounded boot toe " + side, (sign * .15, .09, -.205), (.12, .10, .10), leather, "Foot" + side)
    rounded_box("boot sole " + side, (sign * .15, .025, -.115), (.215, .055, .33), rubber, "Foot" + side, .018)
    for idx, y in enumerate((.11, .16, .21)):
        rounded_box("red boot lace %s %d" % (side, idx), (sign * .15, y, -.275), (.105, .017, .018), red, "Foot" + side, .003)

# Head and face: shorter neck, angular jaw, close beard and a compact mohawk.
# The silhouette follows the reference sheet while keeping facial detail sparse
# enough for a browser game.
limb("short neck", (0, 1.47, 0), (0, 1.59, 0), .078, .073, skin, "Head")
ico("angular face", (0, 1.705, -.035), (.125, .145, .108), skin, "Head")
ellipsoid("strong jaw", (0, 1.645, -.052), (.104, .067, .094), skin, "Head")
ellipsoid("chin stubble", (0, 1.646, -.112), (.052, .034, .022), beard, "Head")
for side, sign in [("L", -1), ("R", 1)]:
    ellipsoid("cheek stubble " + side, (sign * .052, 1.67, -.105), (.035, .040, .020), beard, "Head", 10, 6)
ellipsoid("nose bridge", (0, 1.715, -.137), (.016, .027, .014), skin, "Head")
for side, sign in [("L", -1), ("R", 1)]:
    ellipsoid("ear " + side, (sign * .123, 1.716, -.01), (.028, .052, .034), skin, "Head")
    rounded_box("brow " + side, (sign * .052, 1.758, -.132), (.058, .014, .012), beard, "Head", .006)
    ellipsoid("eye shadow " + side, (sign * .052, 1.735, -.137), (.022, .010, .007), beard, "Head", 8, 5)
ellipsoid("shaved hair cap", (0, 1.795, .018), (.128, .092, .105), beard, "Head")
# The reference has a cropped swept mohawk running forehead-to-nape.  A row
# across X reads like a crown, so use overlapping low-poly ridges along Z with
# a slight rearward rise instead.
for i, z in enumerate((-.080, -.040, 0, .040, .080)):
    ridge = ellipsoid("swept mohawk ridge %d" % i,
                      (0, 1.835 + .010 * (1 - abs(z) / .08), z),
                      (.042, .052 if i in (0, 4) else .060, .024), beard, "Head", 10, 6)
    ridge.rotation_euler[1] = -.12 if z < 0 else .08

# Join every component into one skinned mesh, retaining the existing armature
# and animation actions.  One material per component is enough for the runtime
# and keeps draw calls manageable after Blender's GLB export.
bpy.ops.object.select_all(action="DESELECT")
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
body = bpy.context.object
body.name = "Noir Team B tailored character"
body.data.validate()
body.parent = rig
arm = body.modifiers.new("Noir skeletal deformation", "ARMATURE")
arm.object = rig

if socket is None:
    socket = bpy.data.objects.new("WeaponSocket", None)
    scene.collection.objects.link(socket)
    socket.parent = rig
    socket.parent_type = "BONE"
    socket.parent_bone = "HandR"

# Re-export only Team B's rig, mesh and socket.  Existing action clips remain on
# the armature and are included by the GLB exporter.
bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
body.select_set(True)
socket.select_set(True)
bpy.context.view_layer.objects.active = rig
out_glb = ROOT + "/app/public/models/noir-character-team-b.glb"
# Blender object names are global.  Team A owns the canonical name in the
# shared workshop, so temporarily reserve it for Team B during export and
# standalone save, then restore both objects in memory.  Team A is untouched
# in the saved Team A scene and the exported B GLB gets the runtime name.
old_socket_name = socket.name
other_socket = bpy.data.objects.get("WeaponSocket")
if other_socket is not None and other_socket != socket:
    other_socket.name = "Team A WeaponSocket temporary"
socket.name = "WeaponSocket"
try:
    bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", use_selection=True,
                               use_active_scene=True, export_image_format="NONE",
                               export_yup=True, export_animations=True,
                               export_animation_mode="ACTIONS", export_force_sampling=True)
    out_blend = ROOT + "/assets/blender/noir-team-b.blend"
    bpy.data.libraries.write(out_blend, {scene}, path_remap="RELATIVE", fake_user=True)
finally:
    socket.name = old_socket_name
    if other_socket is not None and other_socket != socket:
        other_socket.name = "WeaponSocket"

triangles = sum(len(obj.data.loop_triangles) for obj in scene.objects if obj.type == "MESH")
print({"blend": out_blend, "glb": out_glb, "bones": len(rig.data.bones),
       "triangles": triangles, "clips": len([a for a in bpy.data.actions if a.name.split('.')[0] in {
           "Idle", "Walk", "Run", "CrouchIdle", "CrouchWalk", "Jump", "Fall", "Land", "Death"}])})

exec(compile(open(ROOT+"/assets/blender/scripts/prune-team-b-glb.py").read(), "prune-team-b-glb.py", "exec"))
