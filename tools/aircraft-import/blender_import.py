"""Apply a reviewed aircraft recipe to static GLB mesh geometry in Blender."""
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

# glTF Y-up to Blender Z-up, without changing handedness.
TO_BLENDER = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
TO_GLTF = TO_BLENDER.transposed()


def load_sources(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path), import_pack_images=True)
    sources = {}
    for obj in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
        for name in {obj.name, obj.parent.name if obj.parent else obj.name}:
            sources.setdefault(name, []).append(obj)
    return sources


def empty(name, parent=None, position=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    if position is not None:
        obj.location = position
    return obj


def clip_mesh(mesh, planes, weld):
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        if weld:
            bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=weld)
        for plane in planes:
            normal = TO_BLENDER @ Vector(plane["normal"])
            point = TO_BLENDER @ Vector(plane["point"])
            bmesh.ops.bisect_plane(
                bm, geom=[*bm.verts, *bm.edges, *bm.faces], dist=1e-6,
                plane_co=point, plane_no=normal, clear_inner=True, clear_outer=False,
            )
        bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=1e-7)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_area() < 1e-12], context="FACES_ONLY")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        if not bm.faces:
            raise ValueError(f"{mesh.name}: clipping left no geometry")
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
    finally:
        bm.free()
    mesh.validate()


def set_opaque(mesh, variants, names):
    for index, material in enumerate(mesh.materials):
        if material is None or (names is not None and material.name not in names):
            continue
        if material.name not in variants:
            opaque = material.copy()
            opaque.name = material.name + "_Opaque"
            if opaque.use_nodes:
                for node in opaque.node_tree.nodes:
                    if node.type == "BSDF_PRINCIPLED":
                        alpha = node.inputs["Alpha"]
                        for link in list(alpha.links):
                            opaque.node_tree.links.remove(link)
                        alpha.default_value = 1
            variants[material.name] = opaque
        mesh.materials[index] = variants[material.name]


def join_parts(parts, name):
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    obj = parts[0]
    bpy.context.view_layer.objects.active = obj
    if len(parts) > 1:
        bpy.ops.object.join()
    obj.name = name
    obj.data.name = name
    return obj


def normalized_geometry(imported, recipe):
    frame = recipe["frame"]
    yaw = Matrix.Rotation(math.radians(frame.get("yawDegrees", 0)), 3, "Y")
    pitch = Matrix.Rotation(math.radians(frame.get("pitchDegrees", 0)), 3, "X")
    roll = Matrix.Rotation(math.radians(frame.get("rollDegrees", 0)), 3, "Z")
    rotation = TO_BLENDER @ yaw @ pitch @ roll @ TO_GLTF
    origin = TO_BLENDER @ Vector(frame["origin"])
    names = set(imported)
    included = {obj for group in recipe["groups"] for part in group["parts"]
                for obj in imported.get(part["source"], [])}
    dropped = set(recipe.get("drop", []))
    missing = dropped - names
    if missing:
        raise ValueError(f"Missing excluded source objects: {sorted(missing)}")
    excluded = {item for name in dropped for item in imported[name]}
    if included & excluded:
        raise ValueError("A source mesh is both included and dropped")
    unassigned = set().union(*imported.values()) - included - excluded
    if unassigned:
        raise ValueError(f"Unassigned source meshes: {sorted(o.name for o in unassigned)}")
    original = set(bpy.context.scene.objects)
    frozen = {obj: (obj.matrix_world.copy(), obj.data) for obj in included}
    for obj in original:
        # Blender imports all source objects into the active glTF collection;
        # remove any remaining scene links without freeing vertex data yet.
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)

    root = empty(recipe["root"])
    root["aircraftImportVersion"] = 1
    root["forward"] = "+Z"
    root["up"] = "+Y"
    root["left"] = "+X"
    variants = {}
    groups = {}
    for group in recipe["groups"]:
        name = group["name"]
        pivot = group.get("pivot")
        anchor = (rotation @ ((TO_BLENDER @ Vector(pivot)) - origin)) * frame["scale"] if pivot is not None else Vector((0, 0, 0))
        owner = empty(name, root, anchor)
        groups[name] = owner
        if "animation" in group:
            anim = dict(group["animation"])
            axis = rotation @ (TO_BLENDER @ Vector(anim["axis"]))
            anim["axis"] = list(TO_GLTF @ axis.normalized())
            owner["aircraftAnimation"] = json.dumps(anim, separators=(",", ":"))
        if "component" in group:
            owner["damageComponent"] = group["component"]
        parts = []
        for spec in group["parts"]:
            source_name = spec["source"]
            matches = imported.get(source_name, [])
            if len(matches) != 1:
                raise ValueError(f"{source_name}: expected one source mesh, got {len(matches)}")
            world, data = frozen[matches[0]]
            mesh = data.copy()
            mesh.transform(world)
            clip_mesh(mesh, spec.get("clip", []), recipe.get("weld", 0))
            pose = (rotation * frame["scale"]).to_4x4()
            pose.translation = -(rotation @ origin) * frame["scale"] - anchor
            mesh.transform(pose)
            set_opaque(mesh, variants, None if spec.get("opaque") else recipe.get("opaqueMaterials", []))
            part = bpy.data.objects.new(name + "_Part", mesh)
            bpy.context.collection.objects.link(part)
            parts.append(part)
        geometry = join_parts(parts, name + "_Mesh")
        geometry.parent = owner
        geometry["lodFloor"] = group.get("lodFloor", 16)
        geometry["preserve"] = group.get("preserve", False)
    for obj in original:
        bpy.data.objects.remove(obj, do_unlink=True)
    for item in recipe.get("anchors", []):
        obj = empty(item["name"], root, TO_BLENDER @ Vector(item["position"]))
        if item.get("direction"):
            obj.rotation_mode = "QUATERNION"
            obj.rotation_quaternion = (TO_BLENDER @ Vector((0, 0, 1))).rotation_difference(
                TO_BLENDER @ Vector(item["direction"]).normalized())
        obj["attachmentKind"] = item["kind"]
        obj["approximate"] = item.get("approximate", False)
    bpy.context.view_layer.update()
    return root, groups


def set_pose(groups, recipe, value):
    for group in recipe["groups"]:
        node = groups[group["name"]]
        info = node.get("aircraftAnimation")
        if not info:
            continue
        anim = json.loads(info)
        angle = value(group["name"], anim)
        node.rotation_mode = "QUATERNION"
        node.rotation_quaternion = Quaternion(TO_BLENDER @ Vector(anim["axis"]), math.radians(angle))
    bpy.context.view_layer.update()


def pose_sweep(groups, recipe):
    """Count crossing triangle pairs at neutral and sampled rig extremes."""
    specs = recipe.get("clearance", [])
    results = []
    def smooth(progress, start, end):
        t = max(0, min(1, (progress - start) / (end - start)))
        return t * t * (3 - 2 * t)

    def gear_angle(animation, progress):
        rest = animation.get("rest", 0)
        end = animation.get("end", rest)
        if animation["control"] == "gear":
            return rest + (end - rest) * smooth(progress, .12, .78)
        delta = animation.get("clearanceOpen", 0)
        return rest + delta * smooth(progress, 0, .12) + (end - rest - delta) * smooth(progress, .78, 1)

    variants = [
        ("neutral", lambda _, a: a.get("rest", 0)),
        ("surfaces minimum", lambda _, a: a.get("min", a.get("rest", 0))),
        ("surfaces maximum", lambda _, a: a.get("max", a.get("rest", 0))),
        *((f"retraction {step * 10}%", lambda _, a, t=step / 10: gear_angle(a, t)) for step in range(1, 11)),
    ]
    for pose, angles in variants:
        set_pose(groups, recipe, angles)
        bvhs = {}
        for pair in specs:
            for name in pair:
                if name not in bvhs:
                    vertices, faces = [], []
                    for mesh in groups[name].children:
                        start = len(vertices)
                        vertices.extend(mesh.matrix_world @ v.co for v in mesh.data.vertices)
                        faces.extend([start + i for i in poly.vertices] for poly in mesh.data.polygons)
                    bvhs[name] = BVHTree.FromPolygons(vertices, faces, all_triangles=True)
        counts = [len(bvhs[a].overlap(bvhs[b])) for a, b in specs]
        results.append({"pose": pose, "pairs": dict(zip((" / ".join(pair) for pair in specs), counts))})
    set_pose(groups, recipe, lambda _, a: 0)
    return results


def make_lod(meshes, ratio):
    for obj in meshes:
        if ratio == 1 or obj["preserve"]:
            continue
        triangles = len(obj.data.polygons)
        target = round(triangles * ratio)
        if "aircraftAnimation" in obj.parent:
            target = max(target, obj["lodFloor"])
        if target >= triangles:
            continue
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new("Aircraft LOD", "DECIMATE")
        modifier.ratio = max(target, 4) / triangles
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        # Keep decimation local to the moving mesh and clean any collapsed faces.
        clip_mesh(obj.data, [], 0)


def run(source, recipe_path, output):
    recipe = json.loads(recipe_path.read_text())
    _, groups = normalized_geometry(load_sources(source), recipe)
    (output / "clearance.json").write_text(json.dumps(pose_sweep(groups, recipe), indent=2))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    full = [(obj, obj.data) for obj in meshes]
    for index, lod in enumerate(recipe["lods"]):
        for obj, data in full:
            obj.data = data.copy()
        make_lod(meshes, lod["ratio"])
        bpy.ops.export_scene.gltf(
            filepath=str(output / f"lod{index}.glb"), export_format="GLB", export_yup=True,
            export_materials="EXPORT", export_image_format="AUTO",
            export_animations=False, export_extras=True, export_cameras=False, export_lights=False,
        )
        for obj, data in full:
            reduced = obj.data
            obj.data = data
            bpy.data.meshes.remove(reduced)


if __name__ == "__main__":
    run(*(Path(arg) for arg in sys.argv[sys.argv.index("--") + 1:]))
