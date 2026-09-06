import bpy
print({"file": bpy.data.filepath, "scenes": [s.name for s in bpy.data.scenes], "active": bpy.context.scene.name,
       "objects": [(o.name, o.type, o.parent.name if o.parent else None) for o in bpy.context.scene.objects]})
