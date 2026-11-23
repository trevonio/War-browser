"""Self-contained glTF binary inspection, image packing and validation."""
import io
import json
import math
import struct
from collections import Counter
from pathlib import Path

JSON_CHUNK = b"JSON"
BIN_CHUNK = b"BIN\0"
IDENTITY = (1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
FORMATS = {5121: "B", 5123: "H", 5125: "I", 5126: "f"}
COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path):
    raw = Path(path).read_bytes()
    if len(raw) < 20 or struct.unpack_from("<4sII", raw) != (b"glTF", 2, len(raw)):
        raise ValueError(f"{path}: invalid glTF 2 binary header")
    chunks = {}
    offset = 12
    while offset < len(raw):
        size, kind = struct.unpack_from("<I4s", raw, offset)
        offset += 8
        if size % 4 or offset + size > len(raw) or kind in chunks:
            raise ValueError(f"{path}: invalid glTF binary chunk")
        chunks[kind] = raw[offset:offset + size]
        offset += size
    return json.loads(chunks[JSON_CHUNK]), chunks.get(BIN_CHUNK, b"")


def append(data, payload):
    data.extend(b"\0" * (-len(data) % 4))
    offset = len(data)
    data.extend(payload)
    return offset


def write_glb(path, document, data):
    content = json.dumps(document, separators=(",", ":"), allow_nan=False).encode()
    content += b" " * (-len(content) % 4)
    data = bytes(data) + b"\0" * (-len(data) % 4)
    header = struct.pack("<4sIII4s", b"glTF", 2, 28 + len(content) + len(data), len(content), JSON_CHUNK)
    Path(path).write_bytes(header + content + struct.pack("<I4s", len(data), BIN_CHUNK) + data)


def view_bytes(document, blob, index):
    view = document["bufferViews"][index]
    offset = view.get("byteOffset", 0)
    size = view["byteLength"]
    if view["buffer"] or offset < 0 or size < 0 or offset + size > len(blob):
        raise ValueError(f"bufferView {index} outside the GLB")
    return blob[offset:offset + size]


def accessor(document, blob, index):
    item = document["accessors"][index]
    if "sparse" in item:
        raise ValueError("Sparse accessors are unsupported in pipeline inspection")
    view = document["bufferViews"][item["bufferView"]]
    values = view_bytes(document, blob, item["bufferView"])
    size = COMPONENTS[item["type"]]
    unpack = struct.Struct("<" + FORMATS[item["componentType"]] * size)
    stride = view.get("byteStride", unpack.size)
    start = item.get("byteOffset", 0)
    count = item["count"]
    if count < 1 or start < 0 or stride < unpack.size or start + (count - 1) * stride + unpack.size > len(values):
        raise ValueError(f"invalid accessor {index}")
    return [unpack.unpack_from(values, start + j * stride) for j in range(count)]


def matrix(node):
    if "matrix" in node:
        return node["matrix"]
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    sx, sy, sz = node.get("scale", [1, 1, 1])
    return (
        sx * (1-2*y*y-2*z*z), sx * (2*x*y+2*z*w), sx * (2*x*z-2*y*w), 0,
        sy * (2*x*y-2*z*w), sy * (1-2*x*x-2*z*z), sy * (2*y*z+2*x*w), 0,
        sz * (2*x*z+2*y*w), sz * (2*y*z-2*x*w), sz * (1-2*x*x-2*y*y), 0,
        *node.get("translation", [0, 0, 0]), 1,
    )


def multiply(left, right):
    return tuple(
        sum(left[k * 4 + row] * right[col * 4 + k] for k in range(4))
        for col in range(4) for row in range(4)
    )


def transform(m, point):
    return tuple(sum(m[col * 4 + row] * point[col] for col in range(3)) + m[12 + row] for row in range(3))


def bounds(points):
    axes = list(zip(*points))
    if not axes:
        raise ValueError("model has no geometry")
    return [[round(f(v), 6) for v in axes] for f in (min, max)]


def survey(path, *, strict=False):
    d, b = read_glb(path)
    nodes = d.get("nodes", [])
    seen = set()
    meshes = {}
    parts = {}
    worlds = {}
    all_points = []
    parents = {}
    total = Counter()
    duplicates = set()
    names = Counter(node.get("name", "") for node in nodes)

    def walk(index, parent, parent_name):
        if index in seen:
            raise ValueError(f"cycle or shared scene node at {index}")
        seen.add(index)
        node = nodes[index]
        world = multiply(parent, matrix(node))
        if not all(map(math.isfinite, world)):
            raise ValueError(f"non-finite transform at {index}")
        name = node.get("name", f"node_{index}")
        key = f"{name} [{index}]" if names[name] > 1 else name
        parents[key] = parent_name
        worlds[key] = world
        tri_count = 0
        if "mesh" in node:
            mid = node["mesh"]
            if mid not in meshes:
                points, stats = [], Counter()
                for p in d["meshes"][mid]["primitives"]:
                    if p.get("mode", 4) != 4:
                        raise ValueError("only triangle mesh primitives are supported")
                    positions = accessor(d, b, p["attributes"]["POSITION"])
                    if not all(math.isfinite(v) for point in positions for v in point):
                        raise ValueError(f"non-finite vertices in {name}")
                    indices = [i[0] for i in accessor(d, b, p["indices"])] if "indices" in p else list(range(len(positions)))
                    if len(indices) % 3 or any(i >= len(positions) for i in indices):
                        raise ValueError(f"invalid triangle indices in {name}")
                    if strict:
                        for attr in ("NORMAL", "TEXCOORD_0"):
                            if attr in p["attributes"]:
                                values = accessor(d, b, p["attributes"][attr])
                                if len(values) != len(positions) or not all(math.isfinite(v) for row in values for v in row):
                                    raise ValueError(f"invalid {attr} in {name}")
                        if "material" in p and not 0 <= p["material"] < len(d.get("materials", [])):
                            raise ValueError(f"invalid material in {name}")
                    for i in range(0, len(indices), 3):
                        a, q, r = (positions[j] for j in indices[i:i+3])
                        u = [q[k] - a[k] for k in range(3)]
                        v = [r[k] - a[k] for k in range(3)]
                        stats["degenerate"] += sum((u[k-2]*v[k-1] - u[k-1]*v[k-2])**2 for k in range(3)) < 1e-22
                    points.extend(positions)
                    stats.update(triangles=len(indices)//3, primitives=1, vertices=len(positions))
                meshes[mid] = points, stats
            points, stats = meshes[mid]
            all_points.extend(transform(world, p) for p in points)
            total.update(stats)
            tri_count += stats["triangles"]
        for child in node.get("children", []):
            tri_count += walk(child, world, key)
        parts[key] = tri_count
        if names[name] > 1:
            duplicates.add(name)
        return tri_count

    for root in d["scenes"][d.get("scene", 0)]["nodes"]:
        walk(root, IDENTITY, None)
    if strict and (duplicates or len(seen) != len(nodes) or total["degenerate"]):
        raise ValueError(f"invalid hierarchy or topology in {path}: duplicate names={duplicates}, orphan nodes={len(nodes)-len(seen)}, degenerate triangles={total['degenerate']}")
    images = []
    for image in d.get("images", []):
        content = view_bytes(d, b, image["bufferView"]) if "bufferView" in image else None
        info = {"mimeType": image.get("mimeType"), "bytes": len(content) if content else None}
        if content and content.startswith(b"\x89PNG\r\n\x1a\n"):
            info["size"] = list(struct.unpack_from(">2I", content, 16))
        elif content and content[8:12] == b"WEBP":
            from PIL import Image
            with Image.open(io.BytesIO(content)) as webp:
                info["size"] = list(webp.size)
        images.append(info)
    report = {
        "bytes": Path(path).stat().st_size, "triangles": total["triangles"],
        "primitives": total["primitives"], "vertices": total["vertices"], "degenerate": total["degenerate"],
        "nodes": len(seen), "meshDefinitions": len(meshes), "materials": len(d.get("materials", [])), "images": images,
        "animationClips": [a.get("name", "") for a in d.get("animations", [])],
        "skins": len(d.get("skins", [])), "bounds": bounds(all_points), "attribution": d["asset"].get("extras", {}),
    }
    return report, parts, worlds, parents


def optimize_textures(path, destination, settings, attribution):
    try:
        from PIL import Image
    except ImportError as error:
        raise RuntimeError("Install Pillow with python -m pip install -r tools/aircraft-import/requirements.txt") from error
    d, b = read_glb(path)
    if len(d.get("buffers", [])) != 1 or d["buffers"][0].get("uri"):
        raise ValueError("Expected an embedded, single-buffer GLB")
    images = d.get("images", [])
    textures = d.get("textures", [])
    # Eliminate maps whose emissive RGB is entirely black. Do not sample only
    # part of the image, which could discard small navigation lights.
    decoded = {}
    for i, desc in enumerate(images):
        decoded[i] = Image.open(io.BytesIO(view_bytes(d, b, desc["bufferView"])))
    roles = {}
    for m in d.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        emissive = m.get("emissiveTexture")
        if emissive:
            image = decoded[textures[emissive["index"]]["source"]]
            if not image.convert("RGB").getbbox():
                m.pop("emissiveTexture")
                m.pop("emissiveFactor", None)
        for role, target in (
            ("color", pbr.get("baseColorTexture")), ("packed", pbr.get("metallicRoughnessTexture")),
            ("packed", m.get("occlusionTexture")), ("normal", m.get("normalTexture")),
            ("color", m.get("emissiveTexture")),
        ):
            if target:
                i = textures[target["index"]]["source"]
                roles.setdefault(i, set()).add(role)

    used_textures = set()
    # Preserve supported extension texture inputs as well as core material slots.
    def collect(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key.endswith("Texture") and isinstance(child, dict) and "index" in child:
                    used_textures.add(child["index"])
                collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)

    collect(d.get("materials", []))
    used_images = sorted({textures[i]["source"] for i in used_textures})
    raw_views = [view_bytes(d, b, i) for i in range(len(d.get("bufferViews", [])))]
    omitted = {img["bufferView"] for i, img in enumerate(images) if i not in used_images}
    for i in used_images:
        image = decoded[i]
        image.thumbnail((settings["textureSize"], settings["textureSize"]), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        lossless = bool(roles.get(i, {"packed"}) - {"color"})
        image.save(output, "WEBP", lossless=lossless, quality=settings["quality"], method=6, exact=True)
        raw_views[images[i]["bufferView"]] = output.getvalue()
        images[i]["mimeType"] = "image/webp"

    data = bytearray()
    for i, (view, raw) in enumerate(zip(d["bufferViews"], raw_views)):
        # These pruned image views are left as valid minimal views so accessor
        # indices and any extension references retain their original values.
        payload = b"\0" if i in omitted else raw
        view.update(byteOffset=append(data, payload), byteLength=len(payload))
    d["buffers"][0]["byteLength"] = len(data)
    remap = {old: new for new, old in enumerate(used_images)}
    texture_remap = {old: new for new, old in enumerate(sorted(used_textures))}
    for i in used_textures:
        t = textures[i]
        t.setdefault("extensions", {})["EXT_texture_webp"] = {"source": remap[t.pop("source")]}
    if used_textures:
        for field in ("extensionsUsed", "extensionsRequired"):
            d[field] = sorted(set(d.get(field, [])) | {"EXT_texture_webp"})

    def rewrite(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key.endswith("Texture") and isinstance(child, dict) and "index" in child:
                    child["index"] = texture_remap[child["index"]]
                rewrite(child)
        elif isinstance(value, list):
            for child in value:
                rewrite(child)

    rewrite(d.get("materials", []))
    if textures:
        d["textures"] = [textures[i] for i in sorted(used_textures)]
        d["images"] = [images[i] for i in used_images]
    d["asset"]["extras"] = attribution
    write_glb(destination, d, data)
