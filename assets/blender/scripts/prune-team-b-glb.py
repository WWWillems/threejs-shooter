"""Keep exactly one canonical animation clip per Team B GLB action name."""
import json, struct
from pathlib import Path

path = Path("/Users/wwwillems/Projects/threejs-shooter/app/public/models/noir-character-team-b.glb")
raw = path.read_bytes()
json_len = struct.unpack_from("<I", raw, 12)[0]
doc = json.loads(raw[20:20 + json_len])
chunks = raw[20 + json_len:]

wanted = {"Idle", "Walk", "Run", "CrouchIdle", "CrouchWalk", "Jump", "Fall", "Land", "Death"}
chosen = {}
for animation in doc.get("animations", []):
    base = animation.get("name", "").split(".")[0]
    if base in wanted and base not in chosen:
        animation["name"] = base
        chosen[base] = animation
missing = wanted - set(chosen)
if missing:
    raise RuntimeError("Team B GLB is missing clips: " + ", ".join(sorted(missing)))
doc["animations"] = [chosen[name] for name in ("Idle", "Walk", "Run", "CrouchIdle", "CrouchWalk", "Jump", "Fall", "Land", "Death")]

json_data = json.dumps(doc, separators=(",", ":")).encode("utf-8")
json_data += b" " * ((-len(json_data)) % 4)
out = struct.pack("<III", 0x46546C67, 2, 20 + len(json_data) + len(chunks))
out += struct.pack("<II", len(json_data), 0x4E4F534A) + json_data + chunks
path.write_bytes(out)
print({"path": str(path), "animations": [a["name"] for a in doc["animations"]], "materials": len(doc.get("materials", [])), "meshes": len(doc.get("meshes", []))})
