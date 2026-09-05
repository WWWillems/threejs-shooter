# Using generated textures in Blender

Run these through the Blender MCP's Python execution tool (the `blender` server in `.cursor/mcp.json`; Blender must be open with the MCP add-on running). Paste the helper once per session, then call it with the **absolute** paths `generate.mjs` prints.

Rules that keep Blender and the game reading the same files:

- Load with `bpy.data.images.load(path, check_existing=True)`. Never `image.pack()` and never *File → External Data → Pack Resources*; the `.blend` must reference `app/public/…` on disk.
- Colour spaces: basecolor `sRGB`; roughness, normal, height, AO `Non-Color`. Getting this wrong is the most common reason a material looks flat or plasticky.
- Normal maps are OpenGL convention (green = up), which is what Blender's Normal Map node expects. No flipping.

## Material from a texture set

```python
import bpy
import os


def _load(path, colorspace):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = colorspace
    return img


def material_from_texture_set(dir_path, name=None, repeat=1.0, displacement=False):
    """Principled BSDF from <dir>/<slug>_{basecolor,roughness,normal,height,ao}.*"""
    slug = os.path.basename(os.path.normpath(dir_path))
    name = name or slug
    path = lambda suffix: os.path.join(dir_path, f"{slug}_{suffix}")

    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    coords = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (repeat, repeat, 1.0)
    nt.links.new(coords.outputs["UV"], mapping.inputs["Vector"])

    def image_node(suffix, colorspace):
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = _load(path(suffix), colorspace)
        node.extension = "REPEAT"
        nt.links.new(mapping.outputs["Vector"], node.inputs["Vector"])
        return node

    base = image_node("basecolor.jpg", "sRGB")
    rough = image_node("roughness.jpg", "Non-Color")
    normal = image_node("normal.png", "Non-Color")
    ao = image_node("ao.jpg", "Non-Color")

    # AO multiplied into base colour. ShaderNodeMix in RGBA mode: inputs 6/7 are A/B (color), output 2 is Result (color).
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    nt.links.new(base.outputs["Color"], mix.inputs[6])
    nt.links.new(ao.outputs["Color"], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])

    nt.links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])

    normal_map = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(normal.outputs["Color"], normal_map.inputs["Color"])
    nt.links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])

    if displacement:
        height = image_node("height.png", "Non-Color")
        disp = nt.nodes.new("ShaderNodeDisplacement")
        disp.inputs["Scale"].default_value = 0.01
        nt.links.new(height.outputs["Color"], disp.inputs["Height"])
        nt.links.new(disp.outputs["Displacement"], out.inputs["Displacement"])
        mat.displacement_method = "BUMP"

    return mat


def assign(obj, mat):
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)
```

Example, after running the above:

```python
mat = material_from_texture_set("/Users/<you>/Projects/threejs-shooter/app/public/textures/wet-asphalt", repeat=15)
assign(bpy.context.active_object, mat)
```

`repeat` mirrors the Three.js `texture.repeat` value so Blender previews at the same scale the game renders (the ground uses 15).

## Decal plane

```python
import bpy
import os


def decal_plane(png_path, size=1.0, name=None):
    img = bpy.data.images.load(png_path, check_existing=True)
    img.colorspace_settings.name = "sRGB"
    name = name or os.path.splitext(os.path.basename(png_path))[0]

    bpy.ops.mesh.primitive_plane_add(size=size)
    obj = bpy.context.active_object
    obj.name = name

    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.surface_render_method = "BLENDED"
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    obj.data.materials.append(mat)
    return obj
```

Nudge the plane a few millimetres off the surface it sits on to avoid z-fighting, exactly as the game does for its impact marks.

## Checking the result

Ask Blender (via MCP) to render the viewport or a small camera render and look at it. Things to verify: tiling scale matches the game, no seam at the repeat boundary, normal detail reads as bumps rather than dents (if inverted, the derive step was wrong, not Blender: re-run `derive-maps.mjs`, do not flip in Blender).
