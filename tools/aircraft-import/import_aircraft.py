#!/usr/bin/env python3
"""Inspect, build and validate War Browser aircraft visual packages."""
import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from glb import optimize_textures, read_glb, survey, transform

HERE = Path(__file__).resolve().parent
RECIPE = HERE / "recipes" / "fa-18-hornet.json"
ATTRIBUTION = ("title", "author", "source", "license")


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def read_recipe(path):
    recipe = json.loads(path.read_text())
    frame = recipe["frame"]
    if len(frame["origin"]) != 3 or not frame["scale"] > 0:
        raise ValueError("Frame requires a three-component origin and positive uniform scale")
    identifiers = [recipe["root"], *[g["name"] for g in recipe["groups"]], *[a["name"] for a in recipe.get("anchors", [])]]
    generated = [g["name"] + "_Mesh" for g in recipe["groups"]]
    if not all(isinstance(n, str) and n and n.isascii() for n in identifiers) or len(set(identifiers + generated)) != len(identifiers + generated):
        raise ValueError("Group, anchor and root names must be unique nonempty ASCII names")
    if len(recipe["lods"]) != 3:
        raise ValueError("Exactly three LODs are required")
    previous = None
    for lod in recipe["lods"]:
        if not (0 < lod["ratio"] <= 1 and lod["distance"] >= 0 and lod["textureSize"] >= 64 and 1 <= lod["quality"] <= 100):
            raise ValueError(f"Invalid LOD settings: {lod}")
        if previous and not (lod["ratio"] < previous["ratio"] and lod["distance"] > previous["distance"] and lod["textureSize"] <= previous["textureSize"]):
            raise ValueError("LOD ratios must decrease as distances increase")
        previous = lod
    if recipe["lods"][0]["ratio"] != 1 or recipe["lods"][0]["distance"] != 0:
        raise ValueError("LOD 0 must begin at distance zero with no decimation")
    for group in recipe["groups"]:
        anim = group.get("animation")
        if not group["parts"]:
            raise ValueError(f"Empty geometry group {group['name']}")
        if anim and (len(group.get("pivot", [])) != 3 or len(anim["axis"]) != 3 or not math.hypot(*anim["axis"])):
            raise ValueError(f"Missing pivot or hinge axis for {group['name']}")
    return recipe


def validate_levels(directory, recipe):
    reference = None
    lod_results = []
    for i in range(len(recipe["lods"])):
        path = directory / f"lod{i}.glb"
        totals, parts, worlds, parents = survey(path, strict=True)
        document, _ = read_glb(path)
        nodes = {n["name"]: n for n in document["nodes"]}
        root = recipe["root"]
        expected = {root: None, **{g["name"]: root for g in recipe["groups"]}, **{
            a["name"]: root for a in recipe.get("anchors", [])
        }, **{g["name"] + "_Mesh": g["name"] for g in recipe["groups"]}}
        if parents != expected:
            raise ValueError(f"{path}: changed or incomplete hierarchy")
        for group in recipe["groups"]:
            name = group["name"]
            if parts[name] <= 0 or (group.get("animation") and "aircraftAnimation" not in nodes[name].get("extras", {})):
                raise ValueError(f"{path}: missing actual mesh or hinge for {name}")
        for anchor in recipe.get("anchors", []):
            name = anchor["name"]
            if parts[name] or math.dist(worlds[name][12:15], anchor["position"]) > .001:
                raise ValueError(f"{path}: invalid socket position at {name}")
            direction = anchor.get("direction", [0, 0, 1])
            normal = [c / math.hypot(*direction) for c in direction]
            world = worlds[name]
            actual = [v - t for v, t in zip(transform(world, [0, 0, 1]), world[12:15])]
            if math.dist(actual, normal) > .001:
                raise ValueError(f"{path}: invalid socket axis at {name}")
        lo, hi = totals["bounds"]
        span, _, length = [b - a for a, b in zip(lo, hi)]
        if not reference:
            for name, value in (("spanMeters", span), ("lengthMeters", length)):
                if name in recipe["frame"] and not recipe["frame"][name][0] <= value <= recipe["frame"][name][1]:
                    raise ValueError(f"{path}: {name} out of range ({value:.3f})")
            reference = {n: (worlds[n], nodes[n].get("extras")) for n in expected}
        else:
            if any(reference[n] != (worlds[n], nodes[n].get("extras")) for n in expected):
                raise ValueError(f"{path}: animation pivot, node metadata or socket changed between LODs")
            if totals["triangles"] >= lod_results[-1]["triangles"]:
                raise ValueError(f"{path}: no triangle reduction at LOD {i}")
            first_bounds = lod_results[0]["bounds"]
            if any(abs(a-b) > .03 * max(span, length) for actual, first in zip(totals["bounds"], first_bounds)
                   for a, b in zip(actual, first)):
                raise ValueError(f"{path}: reduction changed the model silhouette bounds")
        totals["groups"] = {g["name"]: parts[g["name"]] for g in recipe["groups"]}
        lod_results.append(totals)
    return lod_results


def make_package(args, recipe):
    source, out = args.source.resolve(), args.output.resolve()
    original, _, _, _ = survey(source)
    data, _ = read_glb(source)
    if original["animationClips"] or original["skins"] or any(
        "targets" in p for m in data.get("meshes", []) for p in m["primitives"]
    ):
        raise ValueError("Source contains animation, skins or morph targets. Bake a reviewed static copy to create a new rig.")
    attribution = {**original["attribution"], **recipe.get("attribution", {})}
    if any(not isinstance(attribution.get(field), str) or not attribution[field].strip() for field in ATTRIBUTION):
        raise ValueError("Attribution requires title, author, source URL and a redistribution license")
    attribution["modifications"] = recipe.get("modifications", "Adapted for War Browser: normalized frame, mesh cleanup, rig and sockets, texture compression and LOD generation.")
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="aircraft-import-", dir=out.parent) as work:
        staging = Path(work)
        raw = staging / "raw"
        raw.mkdir()
        subprocess.run([
            args.blender, "--background", "--factory-startup", "--python-exit-code", "1",
            "--python", str(HERE / "blender_import.py"), "--", str(source), str(args.recipe.resolve()), str(raw),
        ], check=True)
        for i, lod in enumerate(recipe["lods"]):
            optimize_textures(raw / f"lod{i}.glb", staging / f"lod{i}.glb", lod, attribution)
        metrics = validate_levels(staging, recipe)
        write_json(staging / "report.json", {
            "original": original, "levels": metrics, "clearance": json.loads((raw / "clearance.json").read_text()),
        })
        write_json(staging / "manifest.json", {
            "schema": 1, "id": recipe["id"], "title": recipe["title"], "root": recipe["root"],
            "attribution": attribution, "attachments": recipe.get("anchors", []),
            "levels": [dict(file=f"lod{i}.glb", distance=lod["distance"], triangles=metrics[i]["triangles"],
                            bytes=metrics[i]["bytes"], primitives=metrics[i]["primitives"]) for i, lod in enumerate(recipe["lods"])],
        })
        (staging / "ATTRIBUTION.txt").write_text("\n".join(attribution[field] for field in ATTRIBUTION) +
                                                "\n\n" + attribution["modifications"] + "\n")
        out.mkdir(exist_ok=True)
        for name in ("lod0.glb", "lod1.glb", "lod2.glb", "report.json", "ATTRIBUTION.txt", "manifest.json"):
            (staging / name).replace(out / name)
    print(f"Prepared {recipe['title']} at {out}")
    for i, row in enumerate(metrics):
        print(f"LOD {i}: {row['triangles']:,} triangles, {row['primitives']} primitives, {row['bytes']:,} bytes")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="command", required=True)
    inspect = subs.add_parser("inspect", help="Survey the input without running Blender")
    inspect.add_argument("source", type=Path)
    inspect.add_argument("--parts", action="store_true")
    build = subs.add_parser("build", help="Create a validated three-LOD package")
    build.add_argument("source", type=Path)
    build.add_argument("--output", type=Path, required=True)
    build.add_argument("--blender", default=shutil.which("blender") or "blender")
    validate = subs.add_parser("validate", help="Verify a generated package")
    validate.add_argument("directory", type=Path)
    for p in (build, validate):
        p.add_argument("--recipe", type=Path, default=RECIPE)
    args = parser.parse_args()
    if args.command == "inspect":
        report, parts, _, parents = survey(args.source)
        if args.parts:
            report["nodesByName"] = {name: {"triangles": count, "parent": parents[name]} for name, count in parts.items()}
        print(json.dumps(report, indent=2))
        return
    recipe = read_recipe(args.recipe)
    if args.command == "build":
        make_package(args, recipe)
    else:
        print(json.dumps(validate_levels(args.directory, recipe), indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, RuntimeError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
