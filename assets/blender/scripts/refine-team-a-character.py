"""Refine the Team A character against the supplied character sheet.

This is intentionally a Team A only pass.  It reuses the existing 18-bone
rig and nine animation clips, but replaces the joined primitive body with a
small, readable set of tailored garment panels and anatomical forms.  Run it
through the Blender MCP from the repository root; it writes only the Team A
GLB and workshop blend.
"""
import os
import math
import json
import struct
import runpy
import bpy
from mathutils import Vector

ROOT = os.environ.get("NOIR_REPO_ROOT", "/Users/wwwillems/Projects/threejs-shooter")

# Rebuild the existing isolated Team A workshop so the other character and
# environment workshops in the same Blender session are left untouched.
runpy.run_path(ROOT + "/assets/blender/scripts/model-team-characters.py", init_globals={"TEAM": "A"})
scene = bpy.data.scenes.get("Noir team workshop A")
assert scene, "Team A workshop was not created"
bpy.context.window.scene = scene
rig = next(o for o in scene.objects if o.type == "ARMATURE")
socket_candidates = [o for o in scene.objects if o.name.split(".")[0] == "WeaponSocket"]
assert socket_candidates, "WeaponSocket missing from the base Team A rig"
socket = socket_candidates[-1]
for duplicate in socket_candidates[:-1]:
    bpy.data.objects.remove(duplicate, do_unlink=True)
socket.name = "WeaponSocket"


# Remove only the old Team A mesh.  The skeleton, its animation actions, and
# the weapon socket stay intact and keep their production-compatible names.
for obj in list(scene.objects):
    if obj.type == "MESH":
        bpy.data.objects.remove(obj, do_unlink=True)

def xyz(p):
    """Convert game coordinates (Y up, -Z forward) to Blender coordinates."""
    return (p[0], -p[2], p[1])

def mat(name, rgb, rough=.78, metal=0.0):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    c = [((v / 255 + .055) / 1.055) ** 2.4 if v > 10 else v / 255 / 12.92 for v in rgb]
    bsdf.inputs["Base Color"].default_value = (*c, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return material

coat = mat("noir-coat-wool", (54, 56, 55), .92)
coat_dark = mat("coat-lapel", (33, 35, 35), .83)
trouser = mat("noir-trousers", (58, 56, 51), .88)
leather = mat("noir-leather", (28, 25, 22), .47)
skin = mat("noir-skin", (150, 106, 79), .72)
stubble = mat("noir-stubble", (49, 39, 34), .94)
hair = mat("noir-hair", (31, 25, 22), .84)
shirt = mat("noir-shirt", (168, 160, 142), .84)
knit = mat("noir-knit", (56, 55, 51), .96)
steel = mat("noir-buttons", (105, 97, 79), .36, .55)

parts = []

def finish(obj, name, material, joint, smooth=True):
    obj.name = name
    obj.data.materials.append(material)
    group = obj.vertex_groups.new(name=joint)
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    if smooth:
        for poly in obj.data.polygons:
            poly.use_smooth = True
    parts.append(obj)
    return obj

def finish_multi(obj, name, material, weights, smooth=True, ring_segments=16):
    """Finish a mesh with per-vertex weights for a connected joint path."""
    obj.name = name
    obj.data.materials.append(material)
    joint_names = {joint for row_weights in weights for joint in row_weights}
    groups = {joint: obj.vertex_groups.new(name=joint) for joint in joint_names}
    vertex_count = len(obj.data.vertices)
    for index in range(vertex_count):
        row = index // ring_segments
        row_weights = weights[min(row, len(weights) - 1)]
        for joint, weight in row_weights.items():
            if weight > 0:
                groups[joint].add([index], weight, "REPLACE")
    if smooth:
        for poly in obj.data.polygons:
            poly.use_smooth = True
    parts.append(obj)
    return obj

def bevel_box(name, center, size, material, joint, bevel=.012):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(center))
    obj = bpy.context.object
    obj.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    modifier = obj.modifiers.new("tailored seam", "BEVEL")
    modifier.width = bevel
    modifier.segments = 2
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    return finish(obj, name, material, joint, smooth=False)

def ellipsoid(name, center, scale, material, joint, segments=16, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=xyz(center))
    obj = bpy.context.object
    obj.scale = (scale[0], scale[2], scale[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, material, joint)

def tapered_limb(name, start, end, radius_start, radius_end, material, joint):
    a, b = Vector(xyz(start)), Vector(xyz(end))
    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=radius_start, radius2=radius_end,
                                    depth=(b - a).length, location=(a + b) * .5)
    obj = bpy.context.object
    obj.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    return finish(obj, name, material, joint)

def connected_path(name, points, radii, material, weights, ring_segments=16):
    """Create a connected garment path with per-ring joint blending."""
    centers = [Vector(xyz(point)) for point in points]
    vertices = []
    for index, center in enumerate(centers):
        tangent = (centers[min(index + 1, len(centers) - 1)] -
                   centers[max(index - 1, 0)]).normalized()
        up = Vector((1, 0, 0)) if abs(tangent.z) > .85 else Vector((0, 0, 1))
        side = tangent.cross(up).normalized()
        up_ring = side.cross(tangent).normalized()
        for segment in range(ring_segments):
            angle = math.tau * segment / ring_segments
            vertices.append(center + side * (math.cos(angle) * radii[index]) +
                            up_ring * (math.sin(angle) * radii[index]))
    faces = []
    for row in range(len(centers) - 1):
        for segment in range(ring_segments):
            a = row * ring_segments + segment
            b = row * ring_segments + (segment + 1) % ring_segments
            faces.append((a, b, b + ring_segments, a + ring_segments))
    faces.append(tuple(range(ring_segments - 1, -1, -1)))
    faces.append(tuple((len(centers) - 1) * ring_segments + i for i in range(ring_segments)))
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    # Rings are ordered shoulder, elbow, wrist.  The elbow ring blends 50/50,
    # which removes the hard cone seam when the weapon pose rotates.
    finish_multi(obj, name, material, weights, ring_segments=ring_segments)
    return obj

def connected_sleeve(name, points, radii, upper_joint, lower_joint):
    """Create one elbow-spanning sleeve and blend its rings between arm bones."""
    return connected_path(name, points, radii, coat, [
        {upper_joint: 1.0},
        {upper_joint: .55, lower_joint: .45},
        {lower_joint: 1.0},
    ])

def boot_shape(name, x, material, joint):
    """A compact four-sided boot last with a raised ankle and shaped toe."""
    rings = [
        (-.235, .105, .045, .145),
        (-.10, .115, .045, .17),
        (.055, .082, .045, .19),
        (.11, .075, .055, .20),
    ]
    vertices = []
    for z, width, bottom, top in rings:
        vertices.extend([xyz((x - width, bottom, z)), xyz((x + width, bottom, z)),
                         xyz((x + width * .92, top, z)), xyz((x - width * .92, top, z))])
    faces = []
    for row in range(len(rings) - 1):
        for edge in range(4):
            a = row * 4 + edge
            faces.append((a, row * 4 + (edge + 1) % 4,
                          (row + 1) * 4 + (edge + 1) % 4, (row + 1) * 4 + edge))
    faces.extend([(3, 2, 1, 0), (len(vertices) - 4, len(vertices) - 3,
                                  len(vertices) - 2, len(vertices) - 1)])
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    finish(obj, name, material, joint, smooth=False)
    modifier = obj.modifiers.new("boot edge", "BEVEL")
    modifier.width = .018
    modifier.segments = 2
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj

def face_form(name, material, joint):
    """Angular low-poly face ring profile; front remains slightly asymmetrical."""
    profile = [
        (1.585, .050, .052, -.028),
        (1.625, .086, .073, -.040),
        (1.690, .108, .092, -.030),
        (1.755, .106, .098, -.020),
        (1.815, .080, .078, .000),
        (1.842, .040, .040, .006),
    ]
    segments = 12
    vertices, faces = [], []
    for y, rx, rz, zcenter in profile:
        for segment in range(segments):
            angle = math.tau * segment / segments
            vertices.append(xyz((math.cos(angle) * rx, y,
                                 zcenter + math.sin(angle) * rz)))
    for row in range(len(profile) - 1):
        for segment in range(segments):
            a = row * segments + segment
            next_segment = (segment + 1) % segments
            faces.append((a, a + segments, (row + 1) * segments + next_segment,
                          row * segments + next_segment))
    faces.append(tuple(range(segments - 1, -1, -1)))
    faces.append(tuple((len(profile) - 1) * segments + i for i in range(segments)))
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.validate(verbose=False, clean_customdata=True)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return finish(obj, name, material, joint)

def canonicalize_exported_glb(path):
    """Canonicalize only this exported file; never mutate shared Blender actions."""
    required = {"Idle", "Walk", "Run", "CrouchIdle", "CrouchWalk",
                "Jump", "Fall", "Land", "Death"}
    raw = open(path, "rb").read()
    json_length = struct.unpack_from("<I", raw, 12)[0]
    document = json.loads(raw[20:20 + json_length])
    chosen = {}
    for animation in document.get("animations", []):
        base = animation.get("name", "").split(".")[0]
        if base in required:
            animation["name"] = base
            chosen[base] = animation
    document["animations"] = [chosen[name] for name in required if name in chosen]
    socket_seen = False
    for node in document.get("nodes", []):
        if node.get("name", "").split(".")[0] != "WeaponSocket":
            continue
        if not socket_seen:
            node["name"] = "WeaponSocket"
            socket_seen = True
        else:
            node["name"] = "WeaponSocketExtra"
    json_bytes = json.dumps(document, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    binary = raw[20 + json_length:]
    output = (struct.pack("<III", 0x46546C67, 2, 20 + len(json_bytes) + len(binary)) +
              struct.pack("<II", len(json_bytes), 0x4E4F534A) + json_bytes + binary)
    open(path, "wb").write(output)

def shell(name, profile, material, joint, start=-math.pi, end=math.pi, segments=32):
    """A low-poly tailored fabric shell with an optional front opening."""
    vertices, faces = [], []
    for y, rx, rz in profile:
        for i in range(segments + 1):
            angle = start + (end - start) * i / segments
            # Subtle vertical grain/fold variation keeps the silhouette quiet
            # while avoiding the smooth stacked primitive look.
            fold = 1 + .014 * math.cos(angle * 13 + y * 8)
            vertices.append(xyz((math.cos(angle) * rx * fold, y,
                                 math.sin(angle) * rz * fold)))
    for row in range(len(profile) - 1):
        for i in range(segments):
            k = row * (segments + 1) + i
            faces.append((k, k + segments + 1, k + segments + 2, k + 1))
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="Tailored UV")
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = (math.atan2(vertex.y, vertex.x) / math.tau, vertex.z * 2.0)
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    finish(obj, name, material, joint)
    solid = obj.modifiers.new("fabric thickness", "SOLIDIFY")
    solid.thickness = .012
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=solid.name)
    return obj

def flat_panel(name, points, material, joint, thickness=.014, bevel=.003):
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata([xyz(p) for p in points], [], [tuple(range(len(points)))])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    finish(obj, name, material, joint, smooth=False)
    solid = obj.modifiers.new("panel backing", "SOLIDIFY")
    solid.thickness = thickness
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=solid.name)
    if bevel:
        edge = obj.modifiers.new("panel edge", "BEVEL")
        edge.width = bevel
        edge.segments = 1
        bpy.ops.object.modifier_apply(modifier=edge.name)
    return obj

# The coat reads as one garment: a tapered shoulder line, open front, and
# separate split tails with a real overlap at the waist.
shell("tailored open coat body",
      [(.95, .215, .145), (1.10, .235, .16), (1.30, .275, .18),
       (1.47, .275, .17), (1.50, .24, .14), (1.545, .10, .09)], coat, "Spine",
      -math.pi / 2 + .24, 3 * math.pi / 2 - .24)
for side, start, end in [("R", -math.pi / 2 + .045, math.pi / 2 - .04),
                         ("L", math.pi / 2 + .04, 3 * math.pi / 2 - .045)]:
    shell("split tailored coat tail " + side,
          [(.44, .285, .20), (.66, .31, .205), (.88, .30, .18),
           (1.06, .255, .155)], coat, "Tail" + side, start, end, 28)

# Lower silhouette: close-fitting trousers, real ankle break, and boots with
# a separate toe/heel instead of flat shoe blocks.
for side, x in [("L", -.115), ("R", .115)]:
    connected_path("tailored trouser leg " + side,
                   [(x, .98, 0), (x, .55, .015), (x, .15, 0)],
                   [.15, .145, .13], trouser,
                   [{"Thigh" + side: 1.0},
                    {"Thigh" + side: .38, "Shin" + side: .62},
                    {"Shin" + side: 1.0}])
    ellipsoid("tailored knee seam " + side, (x, .54, -.005),
              (.092, .055, .083), trouser, "Shin" + side, 12, 8)
    boot_shape("shaped lace-up boot " + side, x, leather, "Foot" + side)
    bevel_box("boot sole " + side, (x, .035, -.10), (.205, .045, .32), leather, "Foot" + side, .018)
    for y in [.12, .16, .20]:
        bevel_box("boot lace " + side, (x, y, -.17), (.087, .014, .014), leather, "Foot" + side, .002)

# Shirt/waistcoat are visible through the front opening.  The lapels are
# tailored polygon strips with a notch, instead of two rectangular slabs.
bevel_box("shirt bib", (0, 1.405, -.157), (.19, .215, .025), shirt, "Spine", .008)
bevel_box("knitted waistcoat", (0, 1.285, -.174), (.255, .30, .038), knit, "Spine", .016)
bevel_box("black tie", (0, 1.39, -.188), (.032, .19, .014), leather, "Spine", .004)
for sign in (-1, 1):
    flat_panel("notched tailored lapel " + str(sign), [
        (sign * .17, 1.505, -.194), (sign * .035, 1.505, -.205),
        (sign * .09, 1.405, -.214), (sign * .16, 1.285, -.205),
        (sign * .215, 1.335, -.187),
    ], coat_dark, "Spine", .018, .004)
    bevel_box("shoulder epaulette " + str(sign), (sign * .25, 1.50, -.006),
               (.16, .028, .10), coat_dark, "Spine", .009)
    for y in [1.11, 1.22, 1.33]:
        ellipsoid("coat button " + str(sign) + str(y), (sign * .092, y, -.193),
                  (.016, .016, .010), steel, "Spine", 12, 8)

# Waist shaping and compact belt pouches follow the hips, with straps that
# visually connect them to the coat instead of reading as floating boxes.
ellipsoid("tailored hips", (0, .985, .005), (.215, .14, .135), trouser, "Hips")
shell("tailored belt", [(1.00, .232, .154), (1.055, .232, .154)], leather, "Spine", segments=28)
bevel_box("belt buckle", (0, 1.03, -.19), (.073, .06, .018), steel, "Spine", .006)
for sign in (-1, 1):
    bevel_box("belt pouch body " + str(sign), (sign * .225, 1.02, -.105),
              (.105, .14, .075), leather, "Hips", .015)
    bevel_box("belt pouch flap " + str(sign), (sign * .225, 1.095, -.148),
              (.11, .038, .082), coat_dark, "Hips", .008)

# Sleeves taper toward the wrists and gain visible cuffs, palms, and short
# fingerless glove segments.  The hand silhouette remains animation-friendly.
for side in ["L", "R"]:
    sign = -1 if side == "L" else 1
    shoulder = (sign * .265, 1.47, 0)
    elbow = (.31, 1.22, -.17) if side == "R" else (-.30, 1.19, -.19)
    # Match the authored Hand rest heads exactly.  This keeps the weapon
    # socket and glove aligned during the rifle/shotgun reach poses.
    wrist = (.19, 1.32, -.45) if side == "R" else (-.04, 1.29, -.61)
    # The first ring overlaps the torso shoulder so the sleeve has a continuous
    # seam instead of a visible hole at the deltoid.
    torso_shoulder = (sign * .205, 1.485, -.004)
    ellipsoid("tailored shoulder cap " + side,
              (sign * .262, 1.465, -.004), (.118, .105, .115), coat, "UpperArm" + side, 16, 10)
    connected_sleeve("tailored sleeve elbow blend " + side,
                     [shoulder, elbow, wrist], [.108, .092, .065],
                     "UpperArm" + side, "Forearm" + side)
    cuff_start = tuple(elbow[i] * .16 + wrist[i] * .84 for i in range(3))
    cuff_end = tuple(elbow[i] * .02 + wrist[i] * .98 for i in range(3))
    tapered_limb("leather cuff " + side, cuff_start, cuff_end, .072, .068,
                 leather, "Forearm" + side)
    ellipsoid("fingerless glove palm " + side, (wrist[0], wrist[1] - .012, wrist[2] - .04),
              (.066, .06, .091), leather, "Hand" + side)
    for finger in [-1, 0, 1]:
        ellipsoid("glove finger " + side + str(finger),
                  (wrist[0] + finger * .024, wrist[1] - .025, wrist[2] - .112),
                  (.019, .042, .026), skin, "Hand" + side, 10, 7)

# Neck coverage and angular noir face.  The high collar removes the exposed
# cylinder gap from the old model; cheek planes and stubble give a readable
# three-quarter face at the game's isometric camera distance.
shell("high coat collar", [(1.47, .095, .085), (1.56, .105, .09)], coat_dark, "Head", segments=20)
tapered_limb("neck bridge", (0, 1.49, 0), (0, 1.645, 0), .082, .066, skin, "Head")
face_form("angular face and jaw", skin, "Head")
ellipsoid("subtle stubble shadow", (0, 1.648, -.116), (.032, .016, .003), stubble, "Head", 16, 8)
ellipsoid("nose bridge", (0, 1.735, -.137), (.014, .028, .013), skin, "Head", 12, 8)
ellipsoid("nose tip", (0, 1.712, -.149), (.017, .014, .014), skin, "Head", 12, 8)
for sign in (-1, 1):
    ellipsoid("ear " + str(sign), (sign * .106, 1.73, -.01), (.025, .05, .032), skin, "Head")
    bevel_box("angular brow " + str(sign), (sign * .045, 1.774, -.126), (.061, .012, .009), hair, "Head", .004)
    ellipsoid("eye socket " + str(sign), (sign * .044, 1.748, -.128), (.023, .012, .008), stubble, "Head", 10, 7)
    bevel_box("sideburn " + str(sign), (sign * .102, 1.78, -.01), (.014, .075, .03), hair, "Head", .003)
ellipsoid("short hair", (0, 1.812, .02), (.126, .095, .10), hair, "Head")

# Fedora silhouette: low pinched crown, band, and broad downturned brim.
shell("pinched fedora crown", [(1.83, .146, .128), (1.88, .153, .134),
                               (1.965, .13, .116), (2.005, .085, .087)], coat_dark, "Head", segments=28)
ellipsoid("fedora crown cap", (0, 2.006, -.015), (.086, .022, .088), coat_dark, "Head", 20, 8)
bevel_box("fedora pinched crown", (0, 1.976, -.015), (.07, .025, .095), coat_dark, "Head", .009)
shell("fedora ribbon", [(1.858, .155, .136), (1.898, .153, .136)], leather, "Head", segments=28)
ellipsoid("broad downturned fedora brim", (0, 1.848, -.012), (.235, .018, .18), coat_dark, "Head", 24, 8)
bevel_box("fedora ribbon clasp", (.11, 1.879, -.141), (.035, .045, .012), steel, "Head", .004)

# Join the components into the same one-mesh skinned character contract used
# by the runtime.  Every component has one full-weight vertex group already.
bpy.ops.object.select_all(action="DESELECT")
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
body = bpy.context.object
body.name = "Noir tailored Team A character"
body.parent = rig
modifier = body.modifiers.new("Noir skeletal deformation", "ARMATURE")
modifier.object = rig

# Keep the original socket and animation data untouched.  Restore neutral rest
# pose for export and retain the exact action names expected by CharacterAnimator.
for pose_bone in rig.pose.bones:
    pose_bone.location = (0, 0, 0)
    pose_bone.rotation_mode = "QUATERNION"
    pose_bone.rotation_quaternion = (1, 0, 0, 0)
rig.animation_data.action = None

bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
body.select_set(True)
socket.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(
    filepath=ROOT + "/app/public/models/noir-character-team-a.glb",
    export_format="GLB", use_selection=True, use_active_scene=True,
    export_image_format="NONE", export_yup=True, export_animations=True,
    export_animation_mode="ACTIONS", export_force_sampling=True,
)
canonicalize_exported_glb(ROOT + "/app/public/models/noir-character-team-a.glb")
bpy.ops.file.make_paths_relative()
bpy.data.libraries.write(
    ROOT + "/assets/blender/noir-team-a.blend", {scene},
    path_remap="RELATIVE", fake_user=True,
)

result = {
    "blend": ROOT + "/assets/blender/noir-team-a.blend",
    "glb": ROOT + "/app/public/models/noir-character-team-a.glb",
    "bones": len(rig.data.bones),
    "clips": [action.name for action in bpy.data.actions if action.name in {
        "Idle", "Walk", "Run", "CrouchIdle", "CrouchWalk", "Jump", "Fall", "Land", "Death"
    }],
    "vertices": len(body.data.vertices),
    "triangles": sum(len(poly.loop_indices) - 2 for poly in body.data.polygons),
}
print(result)
