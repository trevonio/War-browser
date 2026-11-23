#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_a10c.py  -  Procedural A-10C Thunderbolt II (game-ready, rigged, GLB/Blender)
=================================================================================
Two ways to run it (same geometry, same hierarchy):

  1) Standalone (no Blender needed, needs numpy):
        python build_a10c.py --out ./export
     -> writes A10C.glb (LOD0), A10C_LOD1.glb, A10C_LOD2.glb, textures, rig tables.

  2) Inside Blender 3.6+ / 4.x:
        blender --background --python build_a10c.py -- --out ./export
     -> additionally builds the scene with bpy, saves A10C.blend and exports
        A10C_blender.glb through Blender's own glTF exporter.

Coordinate convention of the exported GLB (glTF native):
   +X = aircraft right (starboard)   +Y = up   -Z = forward (nose)   units = metres
   Origin ~ centre of gravity (mid fuselage, between wing and canopy).
   Every animated node has an identity rotation in its neutral pose.
"""
import math, json, struct, zlib, sys, os
import numpy as np

try:
    import bpy  # noqa
    IN_BLENDER = True
except ImportError:
    IN_BLENDER = False

pi = math.pi
# ----------------------------------------------------------------- vector maths
def add(a, b): return (a[0]+b[0], a[1]+b[1], a[2]+b[2])
def sub(a, b): return (a[0]-b[0], a[1]-b[1], a[2]-b[2])
def mul(a, k): return (a[0]*k, a[1]*k, a[2]*k)
def dot(a, b): return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
def cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def norm(a):
    l = math.sqrt(dot(a, a))
    return (a[0]/l, a[1]/l, a[2]/l) if l > 1e-12 else (0.0, 0.0, 0.0)
def dist(a, b): return math.sqrt(dot(sub(a, b), sub(a, b)))
def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def sgn(x): return -1.0 if x < 0 else 1.0
def centroid(pts):
    n = len(pts)
    return (sum(p[0] for p in pts)/n, sum(p[1] for p in pts)/n, sum(p[2] for p in pts)/n)
def lerp(a, b, t): return a+(b-a)*t

# frames: R = (X, Y, Z) column vectors (local axes expressed in parent space)
def frame_x(xdir, yhint):
    X = norm(xdir); Y = norm(sub(yhint, mul(X, dot(yhint, X)))); return (X, Y, cross(X, Y))
def frame_y(ydir, xhint):
    Y = norm(ydir); X = norm(sub(xhint, mul(Y, dot(xhint, Y)))); return (X, Y, cross(X, Y))
def to_local(R, v): return (dot(R[0], v), dot(R[1], v), dot(R[2], v))
def from_local(R, v): return add(add(mul(R[0], v[0]), mul(R[1], v[1])), mul(R[2], v[2]))
IDENT = ((1, 0, 0), (0, 1, 0), (0, 0, 1))
def mirror_frame(O, R):
    m = lambda v: (-v[0], v[1], v[2])
    return m(O), (mul(m(R[0]), -1.0), m(R[1]), m(R[2]))
def quat_from_frame(R):
    m00, m01, m02 = R[0][0], R[1][0], R[2][0]
    m10, m11, m12 = R[0][1], R[1][1], R[2][1]
    m20, m21, m22 = R[0][2], R[1][2], R[2][2]
    tr = m00+m11+m22
    if tr > 0:
        s = math.sqrt(tr+1)*2; w = .25*s; x = (m21-m12)/s; y = (m02-m20)/s; z = (m10-m01)/s
    elif m00 > m11 and m00 > m22:
        s = math.sqrt(1+m00-m11-m22)*2; w = (m21-m12)/s; x = .25*s; y = (m01+m10)/s; z = (m02+m20)/s
    elif m11 > m22:
        s = math.sqrt(1+m11-m00-m22)*2; w = (m02-m20)/s; x = (m01+m10)/s; y = .25*s; z = (m12+m21)/s
    else:
        s = math.sqrt(1+m22-m00-m11)*2; w = (m10-m01)/s; x = (m02+m20)/s; y = (m12+m21)/s; z = .25*s
    n = math.sqrt(x*x+y*y+z*z+w*w); return (x/n, y/n, z/n, w/n)

# ----------------------------------------------------------------- mesh
class Mesh:
    def __init__(s): s.P = []; s.UV = []; s.F = []; s.M = []
    def vert(s, p, uv=(0.0, 0.0)):
        s.P.append((float(p[0]), float(p[1]), float(p[2]))); s.UV.append((float(uv[0]), float(uv[1]))); return len(s.P)-1
    def tri(s, a, b, c, m): s.F.append((a, b, c)); s.M.append(m)
    def merge(s, o):
        off = len(s.P); s.P += o.P; s.UV += o.UV
        s.F += [(a+off, b+off, c+off) for a, b, c in o.F]; s.M += o.M; return s
    def xform(s, fn): s.P = [fn(p) for p in s.P]; return s
    def flip(s): s.F = [(a, c, b) for a, b, c in s.F]; return s
    def copy(s):
        m = Mesh(); m.P = list(s.P); m.UV = list(s.UV); m.F = list(s.F); m.M = list(s.M); return m
    def mirrored(s):
        m = s.copy(); m.P = [(-x, y, z) for x, y, z in s.P]; m.flip(); return m
    def volume(s):
        v = 0.0
        for a, b, c in s.F:
            v += dot(s.P[a], cross(s.P[b], s.P[c]))
        return v/6.0
    def flat(s):
        m = Mesh()
        for (a, b, c), mt in zip(s.F, s.M):
            i = m.vert(s.P[a], s.UV[a]); j = m.vert(s.P[b], s.UV[b]); k = m.vert(s.P[c], s.UV[c]); m.tri(i, j, k, mt)
        s.P, s.UV, s.F, s.M = m.P, m.UV, m.F, m.M; return s
    def retag(s, fn):
        """fn(centroid)->material name or None"""
        for i, (a, b, c) in enumerate(s.F):
            r = fn(centroid([s.P[a], s.P[b], s.P[c]]))
            if r: s.M[i] = r
        return s

def _orient(m, orient):
    if orient is None: return
    if orient == 'volume':
        sgnv = m.volume()
    else:
        sgnv = 0.0
        for a, b, c in m.F:
            A, B, C = m.P[a], m.P[b], m.P[c]
            n = cross(sub(B, A), sub(C, A)); cen = centroid([A, B, C])
            if orient[0] == 'pt':
                d = sub(cen, orient[1])
            else:
                ax, ctr, sg = orient[1], orient[2], orient[3]
                d = list(sub(cen, ctr)); d[{'x': 0, 'y': 1, 'z': 2}[ax]] = 0.0; d = mul(tuple(d), sg)
            sgnv += dot(n, d)
    if sgnv < 0: m.flip()

def ring_loft(rings, mat, closed=True, caps=True, orient='volume', uvs=4.0, flat=False):
    """Loft a list of equal-length point rings into a mesh (quads->tris), optional end caps."""
    m = Mesh(); n = len(rings[0])
    U = [0.0]
    for i in range(1, len(rings)): U.append(U[-1]+dist(centroid(rings[i-1]), centroid(rings[i])))
    idx = []
    for i, r in enumerate(rings):
        pts = r+[r[0]] if closed else r
        row = []; acc = 0.0
        for j, p in enumerate(pts):
            if j > 0: acc += dist(p, pts[j-1])
            row.append(m.vert(p, (U[i]/uvs, acc/uvs)))
        idx.append(row)
    nq = n if closed else n-1
    for i in range(len(rings)-1):
        for j in range(nq):
            a, b, c, d = idx[i][j], idx[i][j+1], idx[i+1][j+1], idx[i+1][j]
            m.tri(a, b, c, mat); m.tri(a, c, d, mat)
    if caps and closed:
        for ring, first in ((rings[0], True), (rings[-1], False)):
            c = centroid(ring); ci = m.vert(c, (0.5, 0.5))
            vi = [m.vert(p, (0.5+(p[0]-c[0])/uvs, 0.5+(p[2]-c[2])/uvs)) for p in ring]
            for j in range(n):
                a, b = vi[j], vi[(j+1) % n]
                if first: m.tri(ci, b, a, mat)
                else: m.tri(ci, a, b, mat)
    _orient(m, orient)
    if flat: m.flat()
    return m

def revolve(profile, segs, mat, axis='z', center=(0, 0, 0), sg=1, uvs=4.0):
    """Surface of revolution. profile = [(axial, radius)...]. sg=+1 normals outward, -1 inward."""
    rings = []
    for a, r in profile:
        ring = []
        for k in range(segs):
            th = 2*pi*k/segs; c = math.cos(th)*r; s = math.sin(th)*r
            p = (c, s, a) if axis == 'z' else ((a, c, s) if axis == 'x' else (c, a, s))
            ring.append(add(p, center))
        rings.append(ring)
    return ring_loft(rings, mat, closed=True, caps=False, orient=('axis', axis, center, sg), uvs=uvs)

BOXF = [((0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)), ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)),
        ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)), ((0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)),
        ((0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)), ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1))]
def box(c, s, mat):
    m = Mesh()
    for f in BOXF:
        ids = []
        for (a, b, d) in f:
            p = (c[0]+(a-.5)*s[0], c[1]+(b-.5)*s[1], c[2]+(d-.5)*s[2])
            ids.append(m.vert(p, (p[0]+p[2], p[1]+p[2])))
        m.tri(ids[0], ids[1], ids[2], mat); m.tri(ids[0], ids[2], ids[3], mat)
    return m

def rot_axis(mesh, axis, ang, about=(0, 0, 0)):
    c, s = math.cos(ang), math.sin(ang)
    def f(p):
        x, y, z = sub(p, about)
        if axis == 'x': y, z = y*c - z*s, y*s + z*c
        elif axis == 'y': x, z = x*c + z*s, -x*s + z*c
        else: x, y = x*c - y*s, x*s + y*c
        return add((x, y, z), about)
    return mesh.xform(f)
def translate(mesh, d): return mesh.xform(lambda p: add(p, d))

def circle_ring(c, axis, r, segs, ref=None):
    a = norm(axis); h = (0, 1, 0) if abs(a[1]) < .9 else (1, 0, 0)
    u = norm(cross(a, h)); v = cross(a, u)
    return [add(c, add(mul(u, r*math.cos(2*pi*k/segs)), mul(v, r*math.sin(2*pi*k/segs)))) for k in range(segs)]
def cyl(p0, p1, r0, r1, segs, mat, caps=True):
    ax = sub(p1, p0)
    return ring_loft([circle_ring(p0, ax, r0, segs), circle_ring(p1, ax, r1, segs)], mat, caps=caps)
def tube(path, r, segs, mat):
    rings = []
    for i, p in enumerate(path):
        t = sub(path[min(i+1, len(path)-1)], path[max(i-1, 0)])
        rings.append(circle_ring(p, t, r, segs))
    return ring_loft(rings, mat)
def sphere(c, r, segs, mat):
    prof = [(r*math.cos(a), r*math.sin(a)) for a in [pi*k/6 for k in range(7)]]
    return revolve(prof, segs, mat, axis='y', center=c)

# ----------------------------------------------------------------- scene graph
class Node:
    def __init__(s, name, parent=None, t=(0, 0, 0), q=(0, 0, 0, 1), mesh=None, extras=None):
        s.name = name; s.parent = parent; s.t = tuple(t); s.q = tuple(q); s.mesh = mesh
        s.extras = extras or {}; s.children = []
        if parent is not None: parent.children.append(s)
    def walk(s):
        yield s
        for c in s.children: yield from c.walk()

# ----------------------------------------------------------------- materials / textures
MATS = {
 'Paint_Gray':    dict(color=(0.43, 0.46, 0.48, 1), metal=0.05, rough=0.62, tex=True),
 'Paint_Dark':    dict(color=(0.27, 0.29, 0.30, 1), metal=0.05, rough=0.66, tex=True),
 'Metal_Steel':   dict(color=(0.56, 0.57, 0.59, 1), metal=0.90, rough=0.34),
 'Metal_Dark':    dict(color=(0.16, 0.17, 0.18, 1), metal=0.85, rough=0.45),
 'Rubber':        dict(color=(0.025, 0.025, 0.027, 1), metal=0.0, rough=0.92),
 'Glass':         dict(color=(0.52, 0.70, 0.76, 0.20), metal=0.0, rough=0.04, blend=True, double=True),
 'HUD_Glass':     dict(color=(0.55, 0.85, 0.65, 0.14), metal=0.0, rough=0.05, blend=True, double=True),
 'Intake_Dark':   dict(color=(0.012, 0.012, 0.014, 1), metal=0.2, rough=0.9, double=True),
 'Exhaust':       dict(color=(0.11, 0.095, 0.085, 1), metal=0.75, rough=0.55, double=True),
 'Interior':      dict(color=(0.085, 0.09, 0.095, 1), metal=0.0, rough=0.8, double=True),
 'Seat':          dict(color=(0.13, 0.145, 0.11, 1), metal=0.0, rough=0.9),
 'Vent_Dark':     dict(color=(0.05, 0.055, 0.06, 1), metal=0.3, rough=0.7),
 'Marking_Blue':  dict(color=(0.07, 0.11, 0.30, 1), metal=0.0, rough=0.6),
 'Marking_Red':   dict(color=(0.50, 0.05, 0.04, 1), metal=0.0, rough=0.6),
 'Marking_Yellow':dict(color=(0.75, 0.58, 0.04, 1), metal=0.0, rough=0.6),
 'Light_Red':     dict(color=(0.6, 0.02, 0.02, 1), metal=0.0, rough=0.3, emissive=(1.0, 0.05, 0.05)),
 'Light_Green':   dict(color=(0.02, 0.5, 0.05, 1), metal=0.0, rough=0.3, emissive=(0.05, 1.0, 0.1)),
 'Light_White':   dict(color=(0.8, 0.8, 0.8, 1), metal=0.0, rough=0.3, emissive=(1.0, 1.0, 0.95)),
}

def png_bytes(arr):
    h, w = arr.shape[:2]
    raw = b''.join(b'\x00'+arr[y].tobytes() for y in range(h))
    def chunk(t, d):
        c = struct.pack('>I', len(d))+t+d; return c+struct.pack('>I', zlib.crc32(t+d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))+chunk(b'IEND', b''))

def make_textures(S=512, seed=11):
    """Tileable panel-line / rivet / grime albedo + matching tangent-space normal map (1 tile = 4 m)."""
    rng = np.random.default_rng(seed)
    groove = np.zeros((S, S), np.float32); rivet = np.zeros((S, S), np.float32)
    tone = np.ones((S, S), np.float32)
    def splits(total, lo, hi):
        out = []; rem = total
        while rem > hi+lo:
            v = int(rng.integers(lo, hi)); out.append(v); rem -= v
        out.append(rem); return out
    y = 0
    for rh in splits(S, 70, 120):
        groove[y % S, :] = 1; groove[(y+1) % S, :] = 0.6
        x = int(rng.integers(0, 60))
        for cw in splits(S, 80, 170):
            x0 = x; x1 = x+cw
            xs = np.arange(x0, x1) % S; ys = np.arange(y, y+rh) % S
            tone[np.ix_(ys, xs)] = 1.0+rng.uniform(-0.045, 0.045)
            groove[ys, x0 % S] = 1; groove[ys, (x0+1) % S] = 0.6
            for k in range(x0+8, x1-4, 11): rivet[(y+5) % S, k % S] = 1; rivet[(y+rh-5) % S, k % S] = 1
            for k in range(y+8, y+rh-4, 11): rivet[k % S, (x0+5) % S] = 1
            if rng.random() < 0.22 and cw > 60 and rh > 50:     # access panel with 4 screws
                a0, b0, a1, b1 = x0+12, y+12, x0+cw-14, y+rh-14
                for k in range(a0, a1): groove[b0 % S, k % S] = 0.8; groove[b1 % S, k % S] = 0.8
                for k in range(b0, b1): groove[k % S, a0 % S] = 0.8; groove[k % S, a1 % S] = 0.8
                for (ax_, by_) in ((a0+4, b0+4), (a1-4, b0+4), (a0+4, b1-4), (a1-4, b1-4)): rivet[by_ % S, ax_ % S] = 1
            x = x1
        y += rh
    k = np.ones(3)/3
    def blur(a, n=1):
        for _ in range(n):
            a = (np.roll(a, 1, 0)+a+np.roll(a, -1, 0))/3; a = (np.roll(a, 1, 1)+a+np.roll(a, -1, 1))/3
        return a
    streak = blur(np.tile(rng.random((1, S)), (S, 1)), 3)*0.5+blur(rng.random((S, S)), 14)*0.5
    streak = (streak-streak.min())/(streak.max()-streak.min()+1e-6)
    albedo = tone*(1-0.42*np.clip(groove, 0, 1))*(1-0.22*rivet)*(0.90+0.10*streak)
    albedo = np.clip(albedo, 0, 1.0)
    h = -groove*0.9+rivet*0.6; h = blur(h, 1)
    dx = (np.roll(h, -1, 1)-np.roll(h, 1, 1))*0.5; dy = (np.roll(h, -1, 0)-np.roll(h, 1, 0))*0.5
    nrm = np.stack([-dx*3.0, dy*3.0, np.ones_like(h)], -1); nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    bc = np.repeat((albedo*255).astype(np.uint8)[..., None], 3, -1)
    return {'A10_Panels_BC': png_bytes(bc), 'A10_Panels_N': png_bytes(((nrm*0.5+0.5)*255).astype(np.uint8))}

# ----------------------------------------------------------------- GLB writer
def mesh_normals(m):
    P = np.array(m.P, float); F = np.array(m.F, int); n = np.zeros_like(P)
    if len(F):
        fn = np.cross(P[F[:, 1]]-P[F[:, 0]], P[F[:, 2]]-P[F[:, 0]])
        for k in range(3): np.add.at(n, F[:, k], fn)
    l = np.linalg.norm(n, axis=1); bad = l < 1e-12; l[bad] = 1; n /= l[:, None]; n[bad] = (0, 1, 0)
    return n

def write_glb(root, path, textures, asset_extras=None):
    nodes_l = list(root.walk()); index = {id(n): i for i, n in enumerate(nodes_l)}
    blob = bytearray(); views = []; accs = []; meshes = []; mesh_of = {}
    used = []
    for n in nodes_l:
        if n.mesh:
            for mt in set(n.mesh.M):
                if mt not in used: used.append(mt)
    mat_index = {m: i for i, m in enumerate(used)}
    def view(data, target=None):
        while len(blob) % 4: blob.append(0)
        v = {'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data)}
        if target: v['target'] = target
        blob.extend(data); views.append(v); return len(views)-1
    def acc(arr, ctype, atype, target, minmax=False):
        a = {'bufferView': view(arr.tobytes(), target), 'componentType': ctype, 'count': int(arr.shape[0]), 'type': atype}
        if minmax: a['min'] = [float(x) for x in arr.min(0)]; a['max'] = [float(x) for x in arr.max(0)]
        accs.append(a); return len(accs)-1
    for n in nodes_l:
        if not n.mesh or not n.mesh.F: continue
        m = n.mesh; nor = mesh_normals(m); P = np.array(m.P, np.float32); UV = np.array(m.UV, np.float32)
        groups = {}
        for f, mt in zip(m.F, m.M): groups.setdefault(mt, []).append(f)
        prims = []
        for mt, fs in groups.items():
            ids = sorted({i for f in fs for i in f}); rm = {o: k for k, o in enumerate(ids)}
            sel = np.array(ids)
            F = np.array([[rm[a], rm[b], rm[c]] for a, b, c in fs], np.uint32)
            big = len(ids) > 65535
            F = F.astype(np.uint32 if big else np.uint16).reshape(-1)
            prims.append({'attributes': {
                'POSITION': acc(P[sel], 5126, 'VEC3', 34962, True), 'NORMAL': acc(nor[sel].astype(np.float32), 5126, 'VEC3', 34962),
                'TEXCOORD_0': acc(UV[sel], 5126, 'VEC2', 34962)},
                'indices': acc(F, 5125 if big else 5123, 'SCALAR', 34963),
                'material': mat_index[mt], 'mode': 4})
        meshes.append({'name': n.name+'_mesh', 'primitives': prims}); mesh_of[id(n)] = len(meshes)-1
    imgs = []; texs = []
    for name, data in textures.items():
        imgs.append({'name': name, 'mimeType': 'image/png', 'bufferView': view(data)}); texs.append({'sampler': 0, 'source': len(imgs)-1})
    gm = []
    for mt in used:
        s = MATS[mt]; pbr = {'baseColorFactor': list(s['color']), 'metallicFactor': s['metal'], 'roughnessFactor': s['rough']}
        d = {'name': mt, 'pbrMetallicRoughness': pbr}
        if s.get('tex'):
            pbr['baseColorTexture'] = {'index': 0}; d['normalTexture'] = {'index': 1, 'scale': 0.8}
        if s.get('emissive'): d['emissiveFactor'] = list(s['emissive'])
        if s.get('blend'): d['alphaMode'] = 'BLEND'
        if s.get('double'): d['doubleSided'] = True
        gm.append(d)
    gn = []
    for n in nodes_l:
        d = {'name': n.name}
        if any(abs(x) > 1e-9 for x in n.t): d['translation'] = [round(x, 6) for x in n.t]
        if any(abs(a-b) > 1e-9 for a, b in zip(n.q, (0, 0, 0, 1))): d['rotation'] = [round(x, 8) for x in n.q]
        if n.children: d['children'] = [index[id(c)] for c in n.children]
        if id(n) in mesh_of: d['mesh'] = mesh_of[id(n)]
        if n.extras: d['extras'] = n.extras
        gn.append(d)
    gltf = {'asset': {'version': '2.0', 'generator': 'build_a10c.py', 'extras': asset_extras or {}},
            'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': gn, 'meshes': meshes, 'materials': gm,
            'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}],
            'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]}
    if texs: gltf['textures'] = texs; gltf['images'] = imgs
    js = json.dumps(gltf, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    while len(blob) % 4: blob.append(0)
    out = struct.pack('<III', 0x46546C67, 2, 12+8+len(js)+8+len(blob))+struct.pack('<II', len(js), 0x4E4F534A)+js \
        + struct.pack('<II', len(blob), 0x004E4942)+bytes(blob)
    with open(path, 'wb') as f: f.write(out)
    return len(out)

# =============================================================================
#                               A-10C  DEFINITION
# =============================================================================
LODQ = {
 0: dict(fus=32, af=14, rev=32, blades=18, tube=8, dome=21, interior=True,  detail=True,  step=0.55),
 1: dict(fus=20, af=8,  rev=16, blades=0,  tube=5, dome=11, interior=False, detail=False, step=1.2),
 2: dict(fus=10, af=5,  rev=8,  blades=0,  tube=4, dome=7,  interior=False, detail=False, step=2.6),
}

def ulist(a, b, step, extra=()):
    n = max(1, int(math.ceil((b-a)/step))); pts = [a+(b-a)*i/n for i in range(n+1)]
    pts += [e for e in extra if a+1e-6 < e < b-1e-6]
    return sorted(set(round(p, 5) for p in pts))

# ---- fuselage ---------------------------------------------------------------
FUS = [  # z, half-width, y-top, y-bottom
 (-7.62, 0.16, -0.18, -0.52), (-7.45, 0.30, -0.06, -0.55), (-7.10, 0.48, 0.08, -0.62), (-6.50, 0.68, 0.28, -0.72),
 (-5.60, 0.84, 0.40, -0.80), (-4.60, 0.92, 0.42, -0.86), (-3.50, 0.98, 0.42, -0.90), (-2.50, 1.05, 0.50, -0.92),
 (-1.20, 1.10, 0.72, -0.92), (0.20, 1.10, 0.86, -0.88), (1.60, 1.02, 0.95, -0.80), (3.20, 0.86, 0.88, -0.58),
 (5.00, 0.66, 0.74, -0.32), (6.60, 0.46, 0.60, -0.06), (7.60, 0.28, 0.45, 0.10), (7.98, 0.10, 0.36, 0.22)]
FN = 2.4
def fus_params(z):
    zs = [r[0] for r in FUS]; z = clamp(z, zs[0], zs[-1])
    i = max(0, min(len(zs)-2, next(k for k in range(len(zs)-1) if zs[k] <= z <= zs[k+1])))
    t = (z-zs[i])/(zs[i+1]-zs[i]); out = []
    for c in (1, 2, 3):
        p0 = FUS[max(i-1, 0)][c]; p1 = FUS[i][c]; p2 = FUS[i+1][c]; p3 = FUS[min(i+2, len(FUS)-1)][c]
        out.append(.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t**3))
    return tuple(out)
def fus_ring(z, N):
    w, yt, yb = fus_params(z); yc = (yt+yb)/2; h = (yt-yb)/2; pts = []
    for j in range(N):
        th = 2*pi*j/N; c = math.cos(th); s = math.sin(th)
        pts.append((w*sgn(c)*abs(c)**(2/FN), yc+h*sgn(s)*abs(s)**(2/FN), z))
    return pts
def fus_y(z, x, top=True):
    w, yt, yb = fus_params(z); a = min(abs(x)/w, 0.999); yc = (yt+yb)/2; h = (yt-yb)/2
    return yc+(h if top else -h)*(1-a**FN)**(1/FN)

# ---- wing -------------------------------------------------------------------
UK, DIH, HALF, YREF = 4.4, math.radians(7.0), 8.75, -0.35
HF, HA, HE, HR = 0.74, 0.70, 0.70, 0.64          # hinge chord fractions: flap, aileron, elevator, rudder
CAMB = (0.02, 0.40)
def th_u(u):
    a = clamp((u-(UK-0.15))/0.30); a = a*a*(3-2*a); return DIH*a
_wyc = {}
def wy(u):
    k = round(u, 3)
    if k in _wyc: return _wyc[k]
    n = int(u/0.02); y = YREF
    for i in range(n): y += math.tan(th_u((i+.5)*0.02))*0.02
    y += math.tan(th_u(u))*(u-n*0.02); _wyc[k] = y; return y
def le_z(u): return -1.50+0.12*clamp((u-UK)/(HALF-UK))
def chord_u(u):
    return 3.45-0.45*(u-0.5)/(UK-0.5) if u <= UK else 3.0-1.0*(u-UK)/(HALF-UK)
def tc_u(u): return 0.165-0.055*u/HALF
def wing_st(u):
    t = th_u(u); return (u, wy(u), le_z(u)), (-math.sin(t), math.cos(t), 0.0), chord_u(u), tc_u(u), CAMB
def stab_st(u): return (u, 0.30, 6.35+0.20*u/3.0), (0, 1, 0), 1.85-0.30*u/3.0, 0.10, (0.0, 0.4)
CANT = math.radians(5.0); FIN_H = 2.10
def fin_st(h):
    a = (math.sin(CANT), math.cos(CANT), 0.0)
    return ((2.95+a[0]*h, 0.30+a[1]*h, 6.0+0.85*h/FIN_H), (math.cos(CANT), -math.sin(CANT), 0.0),
            2.05-0.85*h/FIN_H, 0.085, (0.0, 0.4))

def camber_y(x, m, p):
    if m == 0: return 0.0
    return m/p**2*(2*p*x-x*x) if x < p else m/(1-p)**2*((1-2*p)+2*p*x-x*x)
def thick_y(x, t): return 5*t*(0.2969*math.sqrt(x)-0.1260*x-0.3516*x*x+0.2843*x**3-0.1015*x**4)
def af2d(x0, x1, t, m, p, n, kind='solid', skin=0.0):
    xs = [x0+(x1-x0)*0.5*(1-math.cos(pi*k/(n-1))) for k in range(n)]
    def sk(x): return min(skin, 0.45*thick_y(x, t))
    up = [(x, camber_y(x, m, p)+thick_y(x, t)) for x in xs]; lo = [(x, camber_y(x, m, p)-thick_y(x, t)) for x in xs]
    if kind == 'solid':
        ring = lo+list(reversed(up))
        return ring[:-1] if x0 == 0 else ring
    if kind == 'upper': return up+[(x, y-sk(x)) for x, y in reversed(up)]
    if kind == 'lower': return lo+[(x, y+sk(x)) for x, y in reversed(lo)]
    # core wedge between the two skins
    return [(x, y-sk(x)) for x, y in up]+[(x, y+sk(x)) for x, y in reversed(lo)]
def place(r2, st, kind_scale=1.0, skin=0.0):
    le, td, c, t, cm = st
    pts = [(le[0]+td[0]*y*c, le[1]+td[1]*y*c, le[2]+x*c+td[2]*y*c) for x, y in r2]
    if kind_scale != 1.0:
        cc = centroid(pts); pts = [add(cc, mul(sub(p, cc), kind_scale)) for p in pts]
    return pts

def surf_pt(st, xc, where='mid'):
    le, td, c, t, (m, p) = st; y = camber_y(xc, m, p)+{'mid': 0, 'up': 1, 'low': -1}[where]*(thick_y(xc, t) if where != 'mid' else 0)
    return (le[0]+td[0]*y*c, le[1]+td[1]*y*c, le[2]+xc*c+td[2]*y*c)

def anim(group, axis, pos, mn, mx, **kw):
    d = dict(group=group, axis=axis, positive=pos, min=mn, max=mx, neutral=0.0); d.update(kw); return {'anim': d}

def make_part(name, parent, wmesh, O, R, left=False, extras=None, parent_frame=(( 0, 0, 0), IDENT)):
    """Create <name>_Pivot (static) -> <name> (animated, identity at neutral). Geometry given in RIGHT-side world space.
       Returns (node, (O,R) of the right-side frame) so children can be chained."""
    loc = wmesh.copy().xform(lambda p: to_local(R, sub(p, O)))
    Op, Rp = parent_frame
    if left:
        loc = loc.mirrored(); O2, R2 = mirror_frame(O, R); Op2, Rp2 = mirror_frame(Op, Rp)
    else:
        O2, R2, Op2, Rp2 = O, R, Op, Rp
    Rrel = (to_local(Rp2, R2[0]), to_local(Rp2, R2[1]), to_local(Rp2, R2[2]))
    piv = Node(name+'_Pivot', parent, t=to_local(Rp2, sub(O2, Op2)), q=quat_from_frame(Rrel))
    return Node(name, piv, mesh=loc, extras=extras), (O, R)

def wing_right(Q):
    m = Mesh(); step = Q['step']; kz = (UK-0.15, UK, UK+0.15)
    def seg(us, x0, x1, scales=None, flat=False):
        rings = []
        for k, u in enumerate(us):
            s = scales[k] if scales else 1.0
            rings.append(place(af2d(x0, x1, tc_u(u), CAMB[0], CAMB[1], Q['af']), wing_st(u), s))
        m.merge(ring_loft(rings, 'Paint_Gray'))
    us = ulist(0.55, 1.15, 0.6); seg(us, 0, 1, [1.10-0.10*(u-0.55)/0.6 for u in us])
    seg(ulist(1.15, 4.15, step, kz), 0, HF)
    seg(ulist(4.15, 4.62, 0.3, kz), 0, 1)
    seg(ulist(4.62, 8.05, step), 0, HA)
    us = ulist(8.05, 8.45, 0.4); sc = [1.0]*len(us)
    for a in (0.35, 0.7, 1.0, 1.25, 1.42):
        us.append(8.45+0.30*math.sin(a)); sc.append(math.cos(a)**0.9)
    seg(us, 0, 1, sc)
    return m

def build_aircraft(lod=0):
    Q = LODQ[lod]; root = Node('A10C_ROOT', extras={'a10c': {'coordinateSystem': '+X right, +Y up, -Z forward, metres',
        'lod': lod, 'groundY': -2.1, 'note': 'rotate the animated node (not *_Pivot). See A10C_animation_table.md'}})
    # ---------------- fuselage + nose ----------------
    fz = ulist(-6.5, 7.98, 0.9 if lod == 0 else 2.0, [z for z, *_ in FUS if -6.5 < z < 7.98])
    fus = ring_loft([fus_ring(z, Q['fus']) for z in fz], 'Paint_Gray')
    def cockpit_floor(c):
        return 'Interior' if (-5.3 < c[2] < -2.6 and abs(c[0]) < 0.62 and c[1] > fus_params(c[2])[1]-0.06) else None
    Node('Fuselage', root, mesh=fus)
    nz = ulist(-7.62, -6.5, 0.28, [z for z, *_ in FUS if -7.62 < z < -6.5])
    Node('Nose', root, mesh=ring_loft([fus_ring(z, Q['fus']) for z in nz], 'Paint_Gray'))

    # ---------------- details: vents, antennas, pitot ----------------
    if Q['detail']:
        d = Mesh()
        for sx in (-1, 1):
            for z, ln in ((-6.15, 0.40), (-1.4, 0.55), (0.9, 0.55)):
                x = sx*0.46; d.merge(box((x, fus_y(z, x)+0.004, z), (0.20, 0.014, ln), 'Vent_Dark'))
            d.merge(box((sx*0.98, fus_y(-3.0, 0.98, False)+0.45, -3.0), (0.014, 0.16, 0.50), 'Vent_Dark'))
        for z, y0 in ((-0.6, fus_y(-0.6, 0, True)), (1.4, fus_y(1.4, 0, True)), (-2.2, fus_y(-2.2, 0, False))):
            sg = 1 if y0 > 0 else -1
            d.merge(box((0, y0+sg*0.11, z), (0.014, 0.24, 0.18), 'Metal_Dark'))
        d.merge(cyl((0.0, -0.02, -7.60), (0.0, -0.04, -8.00), 0.014, 0.008, 6, 'Metal_Steel'))
        d.merge(box((0, fus_y(-5.85, 0, True)+0.01, -5.85), (0.30, 0.02, 0.40), 'Interior'))  # refuel slipway
        Node('Fuselage_Details', root, mesh=d)

    # ---------------- canopy / cockpit ----------------
    CAN = [(-5.45, 0.00, 0.50), (-5.25, 0.30, 0.62), (-4.95, 0.62, 0.78), (-4.50, 0.80, 0.86), (-3.90, 0.90, 0.90),
           (-3.30, 0.84, 0.90), (-2.85, 0.62, 0.86), (-2.55, 0.30, 0.74), (-2.38, 0.08, 0.60)]
    nd = Q['dome']
    def dome(z, hc, wf):
        w, yt, _ = fus_params(z); wc = w*wf*0.97; base = yt-0.03; pts = []
        for k in range(nd):
            ph = pi*k/(nd-1); c = math.cos(ph); s = math.sin(ph)
            pts.append((wc*sgn(c)*abs(c)**(2/2.6), base+hc*abs(s)**(2/2.6), z))
        return pts
    glass = ring_loft([dome(*c) for c in CAN], 'Glass', closed=False, caps=False, orient=('pt', (0, 0.55, -3.9)))
    fr = Mesh()
    if lod < 2:
        for i in (2, 4, 6, 8):
            fr.merge(tube(dome(*CAN[i]), 0.02, Q['tube'], 'Metal_Dark'))
        for sx in (-1, 1):
            fr.merge(tube([(sx*dome(*c)[0 if sx > 0 else -1][0], dome(*c)[0][1]+0.005, c[0]) for c in CAN[1:]], 0.022, Q['tube'], 'Metal_Dark'))
        fr.merge(tube([(0.0, dome(*c)[nd//2][1], c[0]) for c in CAN[1:5]], 0.02, Q['tube'], 'Metal_Dark'))
    rear_z = -2.38; yb_r = fus_params(rear_z)[1]-0.03
    cpiv = Node('Canopy_Pivot', root, t=(0, yb_r, rear_z))
    can = Node('Canopy', cpiv, extras=anim('canopy', 'x', 'front edge lifts (opens)', 0, 55, hinge='rear'))
    off = lambda p: sub(p, (0, yb_r, rear_z))
    Node('Canopy_Glass', can, mesh=glass.xform(off)); 
    if fr.F: Node('Canopy_Frame', can, mesh=fr.xform(off))
    y0 = fus_params(-3.7)[1]
    cp = Node('Cockpit', root)
    ci = Mesh()
    ci.merge(box((0, y0+0.26, -4.78), (0.92, 0.34, 0.30), 'Interior'))           # instrument panel
    ci.merge(box((0, y0+0.44, -4.95), (0.95, 0.05, 0.42), 'Interior'))           # glare shield
    ci.merge(box((0, y0+0.10, -3.62), (0.46, 0.07, 0.50), 'Seat'))               # seat pan
    ci.merge(rot_axis(box((0, y0+0.40, -3.42), (0.46, 0.58, 0.08), 'Seat'), 'x', math.radians(-10), (0, y0+0.1, -3.42)))
    ci.merge(box((0, y0+0.68, -3.38), (0.26, 0.17, 0.09), 'Seat'))               # head rest
    ci.merge(box((0, y0+0.28, -3.55), (0.05, 0.03, 0.05), 'Marking_Yellow'))     # ejection handle
    if Q['interior']:
        ci.merge(cyl((0, y0, -4.22), (0, y0+0.30, -4.14), 0.016, 0.012, 6, 'Metal_Dark'))
        for sx in (-1, 1):
            ci.merge(box((sx*0.40, y0+0.07, -3.9), (0.10, 0.14, 0.80), 'Interior'))
            ci.merge(cyl((sx*0.18, y0, -3.36), (sx*0.18, y0+0.80, -3.36), 0.018, 0.018, 6, 'Metal_Dark'))
        ci.merge(box((0, y0+0.17, -4.60), (0.80, 0.015, 0.012), 'Vent_Dark'))
    xs_ = [-0.56+1.12*k/8 for k in range(9)]
    ci.merge(ring_loft([[(x, fus_y(z, x, True)+0.004, z) for x in xs_] for z in (-5.2, -4.6, -4.0, -3.4, -2.8, -2.62)],
                       'Interior', closed=False, caps=False, orient=None))
    Node('Cockpit_Interior', cp, mesh=ci)
    hud = rot_axis(box((0, y0+0.64, -4.80), (0.20, 0.14, 0.006), 'HUD_Glass'), 'x', math.radians(-35), (0, y0+0.64, -4.80))
    Node('HUD_Glass', cp, mesh=hud)

    # ---------------- wings ----------------
    wr = wing_right(Q)
    Node('Wing_Right', root, mesh=wr); Node('Wing_Left', root, mesh=wr.mirrored())
    ups = (0.0, 1.0)

    def surface_mesh(stfun, us, x0, x1, kind, mat, skin=0.0, n=None):
        rings = [place(af2d(x0, x1, stfun(u)[3], stfun(u)[4][0], stfun(u)[4][1], n or Q['af'], kind, skin/stfun(u)[2]), stfun(u)) for u in us]
        return ring_loft(rings, mat)

    # flaps (slotted flap approximated as plain hinged flap on lower-surface hinge)
    fu = (1.20, 4.10)
    O = surf_pt(wing_st(fu[0]), HF, 'low'); Xd = sub(surf_pt(wing_st(fu[1]), HF, 'low'), O)
    Rf = frame_x(Xd, (0, 1, 0)); fl = surface_mesh(wing_st, ulist(*fu, 1.5), HF+0.004, 1.0, 'solid', 'Paint_Gray')
    for left in (False, True):
        make_part('Flap_'+('Left' if left else 'Right'), root, fl, O, Rf, left,
                  anim('flap', 'x', 'trailing edge down (deploy)', 0, 40, steps='0/10/20/40 (up/take-off/approach/land)'))

    # ailerons + decelerons (split aileron/speed-brake)
    au = (4.66, 8.02); sk = 0.022
    O = surf_pt(wing_st(au[0]), HA, 'mid'); Xd = sub(surf_pt(wing_st(au[1]), HA, 'mid'), O)
    Ra = frame_x(Xd, (-math.sin(DIH), math.cos(DIH), 0))
    ausl = ulist(*au, 1.2)
    core = surface_mesh(wing_st, ausl, HA+0.004, 1.0, 'core', 'Paint_Gray', sk)
    up_m = surface_mesh(wing_st, ausl, HA+0.004, 1.0, 'upper', 'Paint_Gray', sk)
    lo_m = surface_mesh(wing_st, ausl, HA+0.004, 1.0, 'lower', 'Paint_Gray', sk)
    Ou = surf_pt(wing_st(au[0]), HA+0.004, 'up'); Ol = surf_pt(wing_st(au[0]), HA+0.004, 'low')
    for left in (False, True):
        s = 'Left' if left else 'Right'
        node, fr_a = make_part('Aileron_'+s, root, core, O, Ra, left,
                               anim('aileron', 'x', 'trailing edge down', -25, 20, roll='right roll: right aileron up(-), left aileron down(+)'))
        make_part('Deceleron_%s_Upper' % s, node, up_m, Ou, Ra, left,
                  anim('speedbrake', 'x', 'NEGATIVE angle opens (trailing edge up)', -55, 0, openSign=-1), parent_frame=(O, Ra))
        make_part('Deceleron_%s_Lower' % s, node, lo_m, Ol, Ra, left,
                  anim('speedbrake', 'x', 'positive angle opens (trailing edge down)', 0, 55, openSign=1), parent_frame=(O, Ra))

    # ---------------- horizontal tail + elevators ----------------
    sm = Mesh()
    sm.merge(ring_loft([place(af2d(0, 1, 0.10, 0, .4, Q['af']), stab_st(u)) for u in (0.15, 0.55)], 'Paint_Gray'))
    sm.merge(ring_loft([place(af2d(0, HE, 0.10, 0, .4, Q['af']), stab_st(u)) for u in ulist(0.55, 2.88, 1.2)], 'Paint_Gray'))
    sm.merge(ring_loft([place(af2d(0, 1, 0.10, 0, .4, Q['af']), stab_st(u)) for u in (2.88, 3.02)], 'Paint_Gray'))
    Node('HorizontalTail_Right', root, mesh=sm); Node('HorizontalTail_Left', root, mesh=sm.mirrored())
    eu = (0.60, 2.84); O = surf_pt(stab_st(eu[0]), HE); Xd = sub(surf_pt(stab_st(eu[1]), HE), O)
    Re = frame_x(Xd, (0, 1, 0)); em = surface_mesh(stab_st, ulist(*eu, 1.2), HE+0.004, 1.0, 'solid', 'Paint_Gray')
    for left in (False, True):
        make_part('Elevator_'+('Left' if left else 'Right'), root, em, O, Re, left,
                  anim('elevator', 'x', 'trailing edge down (nose-down command)', -30, 20, pitch='pitch-up: both negative'))

    # ---------------- vertical tails + rudders ----------------
    fm = Mesh()
    fm.merge(ring_loft([place(af2d(0, 1, 0.085, 0, .4, Q['af']), fin_st(h)) for h in (-0.12, 0.18)], 'Paint_Gray'))
    fm.merge(ring_loft([place(af2d(0, HR, 0.085, 0, .4, Q['af']), fin_st(h)) for h in ulist(0.18, 1.96, 0.9)], 'Paint_Gray'))
    tipr = []; 
    for h, s in ((1.96, 1), (2.04, .96), (2.09, .8), (2.125, .5), (2.14, .2)):
        tipr.append(place(af2d(0, 1, 0.085, 0, .4, Q['af']), fin_st(h), s))
    fm.merge(ring_loft(tipr, 'Paint_Gray'))
    fm.retag(lambda c: 'Marking_Blue' if c[1] > 1.95 else None)
    Node('VerticalTail_Right', root, mesh=fm); Node('VerticalTail_Left', root, mesh=fm.mirrored())
    hb = (0.20, 1.94)
    O = add(fin_st(hb[0])[0], (0, 0, HR*fin_st(hb[0])[2])); Top = add(fin_st(hb[1])[0], (0, 0, HR*fin_st(hb[1])[2]))
    Rr = frame_y(sub(Top, O), (math.cos(CANT), -math.sin(CANT), 0))
    rm = ring_loft([place(af2d(HR+0.004, 1, 0.085, 0, .4, Q['af']), fin_st(h)) for h in ulist(hb[0], hb[1], 0.9)], 'Paint_Gray')
    for left in (False, True):
        make_part('Rudder_'+('Left' if left else 'Right'), root, rm, O, Rr, left,
                  anim('rudder', 'y', 'trailing edge toward +X (starboard)', -30, 30))

    # ---------------- engines ----------------
    EX, EY, EZ = 1.95, 0.90, 2.15
    nq = Q['rev']
    skin = [(-0.58, .545), (-0.66, .545), (-0.72, .56), (-0.745, .60), (-0.72, .64), (-0.66, .665), (-0.55, .675), (-0.2, .685),
            (0.5, .69), (1.4, .685), (2.3, .66), (2.9, .60), (3.25, .54), (3.35, .50)]
    en = revolve(skin, nq, 'Paint_Gray', sg=1)
    en.merge(revolve([(-0.58, .545), (-0.3, .53), (0.0, .52), (0.12, .52), (0.12, .05), (0.12, 0.0)], nq, 'Intake_Dark', sg=-1))
    en.merge(revolve([(3.35, .50), (3.35, .455), (3.0, .43), (2.6, .40), (2.3, .30), (2.3, 0.0)], nq, 'Exhaust', sg=-1))
    en.merge(revolve([(2.3, .20), (2.6, .14), (3.05, 0.0)], nq, 'Exhaust', sg=1))
    py = ring_loft([[(-1.30, -0.55, 0.25), (-1.30, -0.02, 0.25), (-1.30, -0.02, 3.1), (-1.30, -0.55, 3.1)],
                    [(-0.55, -0.34, 0.5), (-0.55, -0.10, 0.5), (-0.55, -0.10, 3.0), (-0.55, -0.34, 3.0)]], 'Paint_Gray', flat=True)
    py.M = ['Paint_Dark']*len(py.M); en.merge(py)
    en.merge(revolve([(z, r+0.004) for z, r in skin[3:6]], nq, 'Marking_Red', sg=1))
    fan = revolve([(-0.14, 0.0), (-0.10, .07), (-0.02, .12), (0.04, .13), (0.06, 0.0)], nq, 'Metal_Steel', sg=1)
    if Q['blades']:
        for k in range(Q['blades']):
            b = box((0.0, 0.32, 0.0), (0.012, 0.40, 0.075), 'Metal_Dark')
            rot_axis(b, 'y', math.radians(32), (0, 0.32, 0)); rot_axis(b, 'z', 2*pi*k/Q['blades']); fan.merge(b)
    else:
        fan.merge(revolve([(0.0, 0.52), (0.0, 0.14)], nq, 'Metal_Dark', sg=1))
    for sx, s in ((1, 'Right'), (-1, 'Left')):
        em_ = en if sx > 0 else en.mirrored(); fm_ = fan if sx > 0 else fan.mirrored()
        eng = Node('Engine_'+s, root, t=(sx*EX, EY, EZ), mesh=em_, extras={'a10c': {'type': 'TF34-GE-100 nacelle (no afterburner)'}})
        fp = Node('EngineFan_%s_Pivot' % s, eng, t=(0, 0, 0))
        Node('EngineFan_'+s, fp, mesh=fm_, extras=anim('fan', 'z', 'right-hand about +Z (continuous spin)', -1e9, 1e9, continuous=True))

    # ---------------- landing gear ----------------
    PX, PCY, PR = 2.35, -0.82, 0.37
    pod = revolve([(-2.55, 0.0), (-2.45, .18), (-2.2, .28), (-1.6, .35), (-0.6, PR), (0.6, PR), (1.3, .30), (1.7, .10), (1.8, 0.0)], Q['rev'], 'Paint_Gray', axis='z', sg=1)
    pod.merge(box((0, -PR-0.004, -0.30), (0.22, 0.012, 0.96), 'Intake_Dark'))            # gear bay recess
    ang = math.radians(-45)
    Hn = (PR*math.cos(ang), PR*math.sin(ang))
    def tire(r_o, r_i, w, segs, mat='Rubber'):
        prof = [(-w/2, r_i), (-w/2, r_o*.88), (-w*.38, r_o*.985), (-w*.15, r_o), (w*.15, r_o), (w*.38, r_o*.985), (w/2, r_o*.88), (w/2, r_i)]
        return revolve(prof, segs, mat, axis='x', sg=1)
    def hub(r, w, segs):
        return revolve([(-w/2, 0.0), (-w/2, r*.95), (-w*.35, r), (w*.35, r), (w/2, r*.95), (w/2, 0.0)], segs, 'Metal_Steel', axis='x', sg=1)
    sg_ = max(8, Q['rev']//2)
    main_leg = Mesh()
    main_leg.merge(cyl((0, 0, 0), (0, -0.20, 0), 0.10, 0.10, sg_, 'Metal_Steel'))
    main_leg.merge(cyl((0, -0.20, 0), (0, -0.52, 0), 0.075, 0.075, sg_, 'Metal_Steel'))
    main_leg.merge(cyl((0, -0.52, 0), (0, -0.74, 0), 0.052, 0.052, sg_, 'Metal_Dark'))
    main_leg.merge(cyl((-0.26, -0.75, 0), (0.26, -0.75, 0), 0.04, 0.04, 6, 'Metal_Dark'))
    if Q['detail']:
        for sx in (-1, 1): main_leg.merge(cyl((0, -0.45, 0), (sx*0.2, -0.75, 0), 0.025, 0.025, 6, 'Metal_Dark'))
        main_leg.merge(cyl((0, -0.15, 0.06), (0, -0.50, -0.26), 0.028, 0.028, 6, 'Metal_Steel'))
        main_leg.merge(box((0, -0.60, 0.08), (0.03, 0.14, 0.05), 'Metal_Dark'))
    main_wheel = tire(0.45, 0.22, 0.30, Q['rev']).merge(hub(0.22, 0.28, sg_))
    GX, GY, GZ = PX, -0.90, -0.30
    for sx, s in ((1, 'Right'), (-1, 'Left')):
        podm = pod if sx > 0 else pod.mirrored()
        Node('Sponson_'+s, root, t=(sx*PX, PCY, 0), mesh=podm)
        piv = Node('LandingGear_%s_Pivot' % s, root, t=(sx*GX, GY, GZ))
        leg = Node('LandingGear_'+s, piv, mesh=main_leg if sx > 0 else main_leg.mirrored(),
                   extras=anim('gear', 'x', 'POSITIVE = retract (leg swings forward/up into sponson)', 0, 86, retractDeg=86, extended=0))
        wp = Node('Wheel_%s_Pivot' % s, leg, t=(0, -0.75, 0))
        Node('Wheel_'+s, wp, mesh=main_wheel if sx > 0 else main_wheel.mirrored(), extras=anim('wheel', 'x', 'spin (rolling forward = negative)', -1e9, 1e9, continuous=True, radius=0.45))
    # main gear doors (hinge along Z on the sponson, open outward)
    L_door, W_door = 0.92, 0.30
    dmesh = rot_axis(box((0.5*W_door, 0, 0), (W_door, 0.018, L_door), 'Paint_Gray'), 'z', math.radians(225))
    gdoors = Node('GearDoors', root)
    for sx, s in ((1, 'Right'), (-1, 'Left')):
        H = (sx*(PX+Hn[0]), PCY+Hn[1], -0.10)
        piv = Node('GearDoor_Main_%s_Pivot' % s, gdoors, t=H)
        dm = dmesh if sx > 0 else dmesh.mirrored()
        Node('GearDoor_Main_'+s, piv, mesh=dm, extras=anim('geardoor', 'z', 'Right: +Z opens; Left: -Z opens (swing outboard/down)', (0 if sx > 0 else -80), (80 if sx > 0 else 0), openDeg=80*sx, openSign=sx))
    # nose gear (offset to starboard, retracts rearward)
    NGX, NGY, NGZ = 0.34, -0.55, -4.85
    nose_leg = Mesh()
    nose_leg.merge(cyl((0, 0, 0), (0, -0.45, 0), 0.085, 0.085, sg_, 'Metal_Steel'))
    nose_leg.merge(cyl((0, -0.45, 0), (0, -1.00, 0), 0.055, 0.055, sg_, 'Metal_Dark'))
    nose_leg.merge(cyl((-0.24, -1.25, 0), (0.24, -1.25, 0), 0.035, 0.035, 6, 'Metal_Dark'))
    for sx in (-1, 1): nose_leg.merge(cyl((0, -0.95, 0), (sx*0.2, -1.25, 0), 0.025, 0.025, 6, 'Metal_Dark'))
    if Q['detail']:
        nose_leg.merge(cyl((0, -0.25, 0.04), (0, -0.85, 0.30), 0.025, 0.025, 6, 'Metal_Steel'))
        nose_leg.merge(box((0, -0.55, -0.07), (0.04, 0.28, 0.03), 'Metal_Dark'))
    nose_wheel = Mesh()
    for ox in (-0.12, 0.12):
        nose_wheel.merge(translate(tire(0.30, 0.15, 0.115, Q['rev']).merge(hub(0.15, 0.12, sg_)), (ox, 0, 0)))
    npiv = Node('LandingGear_Nose_Pivot', root, t=(NGX, NGY, NGZ))
    nleg = Node('LandingGear_Nose', npiv, mesh=nose_leg, extras=anim('gear', 'x', 'NEGATIVE = retract (leg swings rearward into fuselage)', -90, 0, retractDeg=-90, extended=0))
    wp = Node('Wheel_Nose_Pivot', nleg, t=(0, -1.25, 0))
    Node('Wheel_Nose', wp, mesh=nose_wheel, extras=anim('wheel', 'x', 'spin', -1e9, 1e9, continuous=True, radius=0.30))
    for sx, s, hx in ((1, 'Right', NGX+0.30), (-1, 'Left', NGX-0.30)):
        yb = fus_y(NGZ, hx, False)
        piv = Node('GearDoor_Nose_%s_Pivot' % s, gdoors, t=(hx, yb-0.01, NGZ+0.15))
        dm = box((-sx*0.14, 0, 0), (0.28, 0.016, 1.15), 'Paint_Gray')
        Node('GearDoor_Nose_'+s, piv, mesh=dm, extras=anim('geardoor', 'z', 'Right: +Z opens; Left: -Z opens', (0 if sx > 0 else -80), (80 if sx > 0 else 0), openDeg=80*sx, openSign=sx))

    # ---------------- pylons + hardpoints ----------------
    HPX = [-7.35, -6.25, -5.15, -4.05, -3.15, 0.0, 3.15, 4.05, 5.15, 6.25, 7.35]
    pyl = Mesh(); hp = Node('WeaponHardpoints', root); hpn = []
    for i, x in enumerate(HPX):
        ux = abs(x)
        if ux < 0.01:
            z0 = -0.5; yb = fus_y(z0, 0, False); ytop = yb+0.08
            ztop = (z0-0.55, z0+0.65); zbot = (z0-0.40, z0+0.55)
        else:
            st = wing_st(ux); yl = surf_pt(st, 0.30, 'low')[1]; zc = le_z(ux)+0.22*chord_u(ux); ytop = yl+0.06
            ztop = (zc-0.55, zc+0.75); zbot = (zc-0.35, zc+0.65)
        ybot = ytop-0.38 if ux < 0.01 else ytop-0.36
        ring = lambda y, zr, hw: [(x-hw, y, zr[0]), (x+hw, y, zr[0]), (x+hw, y, zr[1]), (x-hw, y, zr[1])]
        if x <= 0.01 and ux > 0.01:
            pass
        pyl.merge(ring_loft([ring(ytop, ztop, 0.07), ring(ybot+0.14, zbot, 0.06), ring(ybot, zbot, 0.05)], 'Paint_Gray', flat=True))
        hpn.append((i+1, (x, ybot, (zbot[0]+zbot[1])/2)))
    Node('Pylons', root, mesh=pyl)
    for i, p in hpn:
        Node('HP_%02d' % i, hp, t=p, extras={'a10c': {'station': i, 'side': 'left' if p[0] < -0.01 else ('right' if p[0] > 0.01 else 'centerline'),
             'attach': 'weapon model origin = this node; weapon nose along -Z, up +Y'}})

    # ---------------- GAU-8 ----------------
    cg = Node('CannonMuzzle', root)
    GY0 = -0.60
    gp = Node('GAU8_Barrels_Pivot', cg, t=(0, GY0, -7.70))
    gm = Mesh(); gm.merge(cyl((0, 0, 0.45), (0, 0, -0.05), 0.15, 0.13, Q['rev']//2, 'Metal_Dark'))   # shroud
    for k in range(7):
        a = 2*pi*k/7; ctr = (0.075*math.cos(a), 0.075*math.sin(a))
        gm.merge(cyl((ctr[0], ctr[1], 0.12), (ctr[0], ctr[1], -0.43), 0.031, 0.027, 6, 'Metal_Steel', True))
    gm.merge(cyl((0, 0, -0.30), (0, 0, -0.36), 0.115, 0.115, 12, 'Metal_Dark'))
    Node('GAU8_Barrels', gp, mesh=gm, extras=anim('gau8', 'z', 'barrel cluster spin (optional, continuous)', -1e9, 1e9, continuous=True))
    Node('HP_GAU8_Muzzle', cg, t=(0, GY0, -8.15), extras={'a10c': {'fire': 'projectiles/effects spawn here, travel along local -Z'}})

    # ---------------- lights ----------------
    nl = Node('NavigationLights', root)
    ut = 8.55
    for sx, mt, nm in ((-1, 'Light_Red', 'Nav_Left_Red'), (1, 'Light_Green', 'Nav_Right_Green')):
        c = (sx*ut, wy(ut)+0.02, le_z(ut)+0.35)
        Node(nm, nl, t=c, mesh=sphere((0, 0, 0), 0.055, 8, mt))
    Node('Nav_Tail_White', nl, t=(0, 0.32, 8.02), mesh=sphere((0, 0, 0), 0.05, 8, 'Light_White'))
    Node('Nav_Beacon_Top', nl, t=(0, fus_y(-1.0, 0, True)+0.04, -1.0), mesh=sphere((0, 0, 0), 0.05, 8, 'Light_Red'))
    return root

# =============================================================================
#                      DOCUMENTATION / RIG TABLE GENERATION
# =============================================================================
def tree_text(root):
    out = []
    def rec(n, d):
        tag = ''
        if 'anim' in n.extras: tag = '   <-- ANIMATED (%s, axis %s)' % (n.extras['anim']['group'], n.extras['anim']['axis'].upper())
        elif n.name.endswith('_Pivot'): tag = '   (static pivot)'
        elif n.name.startswith('HP_'): tag = '   (attachment empty)'
        out.append('  '*d+n.name+(' [mesh]' if n.mesh else '')+tag)
        for c in n.children: rec(c, d+1)
    rec(root, 0); return '\n'.join(out)

def rig_table(root):
    rows = []
    for n in root.walk():
        if 'anim' not in n.extras: continue
        a = n.extras['anim']; p = n.parent; static = p if p.name.endswith('_Pivot') else None
        rows.append({'node': n.name, 'static_pivot': static.name if static else None,
                     'pivot_parent': (static.parent.name if static and static.parent else p.name),
                     'pivot_translation_m': [round(x, 4) for x in (static.t if static else n.t)],
                     'pivot_rotation_quat_xyzw': [round(x, 5) for x in (static.q if static else n.q)],
                     'rotate_about_local_axis': a['axis'].upper(), 'positive_direction': a['positive'],
                     'limit_min_deg': a['min'], 'limit_max_deg': a['max'], 'neutral_deg': 0, 'group': a['group'],
                     'extra': {k: v for k, v in a.items() if k not in ('group', 'axis', 'positive', 'min', 'max', 'neutral')}})
    return rows

def rig_markdown(rows, root):
    L = ['# A-10C animation mapping table (auto-generated)\n',
         'All angles in **degrees**, applied as `node.rotation.<axis> = radians(angle)` on the **named** node.',
         'The `*_Pivot` parent is static: it carries the hinge position/orientation, so the animated node is at identity (0°) in its neutral pose.',
         'Left/right pairs share the same sign convention (e.g. positive aileron/elevator/flap angle = trailing edge DOWN on both sides).\n',
         '| Node | Static pivot (parent) | Pivot pos (m) | Axis | Positive direction | Min | Max | Neutral |', '|---|---|---|---|---|---|---|---|']
    for r in rows:
        lim = lambda v: 'continuous' if abs(v) > 1e8 else str(v)
        L.append('| `%s` | `%s` (in `%s`) | %s | %s | %s | %s | %s | 0 |' % (r['node'], r['static_pivot'] or '-', r['pivot_parent'],
                 tuple(r['pivot_translation_m']), r['rotate_about_local_axis'], r['positive_direction'], lim(r['limit_min_deg']), lim(r['limit_max_deg'])))
    L += ['\n## Gear sequencing\n', '`g` = retraction 0..1 (0 = down & locked, 1 = up & locked)\n',
          '- Main legs: `rotation.x = +86° * g` (swing forward into the sponsons; wheels stay partly exposed like the real jet)',
          '- Nose leg: `rotation.x = -90° * g` (swings rearward into the fuselage)',
          '- Doors: open fraction `d = clamp((1-g)*1.6, 0, 1)`; right doors `rotation.z = +80°*d`, left doors `rotation.z = -80°*d`',
          '- Wheel spin: `Wheel_*` rotation.x -= groundSpeed*dt/radius (radius 0.45 m main, 0.30 m nose)\n',
          '## Speed-brake (deceleron) mixing\n',
          'For roll command `r` (-1..1, +1 = roll right) and brake `b` (0..1): `Aileron_Right.rotation.x = -r*20°` (up), `Aileron_Left.rotation.x = +r*20°` (down);',
          'upper skins `rotation.x = -55°*b`, lower skins `rotation.x = +55°*b` (they are children of the aileron, so roll and braking add).\n',
          '## Hierarchy\n', '```', tree_text(root), '```']
    return '\n'.join(L)

def bounds(root):
    mn = [1e9]*3; mx = [-1e9]*3
    def rec(n, off):
        o = add(off, n.t)  # translation-only approximation (pivots carry rotation only for hinge frames, small)
        if n.mesh:
            for p in n.mesh.P:
                q = n.parent and p
        for c in n.children: rec(c, o)
    return mn, mx

# =============================================================================
#                      BLENDER BACKEND  (bpy)  -- optional
# =============================================================================
def build_in_blender(root, textures, outdir):
    import bpy, mathutils
    from mathutils import Matrix, Vector, Quaternion
    bpy.ops.wm.read_factory_settings(use_empty=True)
    C3 = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0))); C4 = C3.to_4x4()       # glTF(Y-up, -Z fwd) -> Blender(Z-up, -Y fwd)
    imgs = {}
    for name, data in textures.items():
        p = os.path.join(outdir, name+'.png'); open(p, 'wb').write(data)
        im = bpy.data.images.load(p); im.pack(); imgs[name] = im
    mats = {}
    def mk_mat(name):
        s = MATS[name]; m = bpy.data.materials.new(name); m.use_nodes = True
        nt = m.node_tree; b = nt.nodes.get('Principled BSDF')
        b.inputs['Base Color'].default_value = s['color']; b.inputs['Metallic'].default_value = s['metal']
        b.inputs['Roughness'].default_value = s['rough']; b.inputs['Alpha'].default_value = s['color'][3]
        if s.get('emissive'):
            k = 'Emission Color' if 'Emission Color' in b.inputs else 'Emission'
            b.inputs[k].default_value = (*s['emissive'], 1); 
            if 'Emission Strength' in b.inputs: b.inputs['Emission Strength'].default_value = 3.0
        if s.get('blend'):
            try: m.blend_method = 'BLEND'
            except Exception: pass
            try: m.surface_render_method = 'BLENDED'
            except Exception: pass
        if s.get('double'): m.use_backface_culling = False
        else: m.use_backface_culling = True
        if s.get('tex'):
            t1 = nt.nodes.new('ShaderNodeTexImage'); t1.image = imgs['A10_Panels_BC']; t1.extension = 'REPEAT'
            t2 = nt.nodes.new('ShaderNodeTexImage'); t2.image = imgs['A10_Panels_N']; t2.image.colorspace_settings.name = 'Non-Color'
            nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = 0.8
            mixn = nt.nodes.new('ShaderNodeMix') if hasattr(bpy.types, 'ShaderNodeMix') else nt.nodes.new('ShaderNodeMixRGB')
            mixn.data_type = 'RGBA' if hasattr(mixn, 'data_type') else None
            mixn.blend_type = 'MULTIPLY'
            ia, ib, io = (6, 7, 2) if mixn.bl_idname == 'ShaderNodeMix' else (1, 2, 0)
            mixn.inputs[0].default_value = 1.0; mixn.inputs[ia].default_value = s['color']
            nt.links.new(t1.outputs['Color'], mixn.inputs[ib]); nt.links.new(mixn.outputs[io], b.inputs['Base Color'])
            nt.links.new(t2.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
        return m
    objs = {}
    def make(node, parent_obj):
        if node.mesh and node.mesh.F:
            me = bpy.data.meshes.new(node.name+'_mesh')
            me.from_pydata([tuple(C3 @ Vector(p)) for p in node.mesh.P], [], [list(f) for f in node.mesh.F]); me.update()
            names = []
            for mt in node.mesh.M:
                if mt not in names: names.append(mt)
            for mt in names:
                if mt not in mats: mats[mt] = mk_mat(mt)
                me.materials.append(mats[mt])
            uv = me.uv_layers.new(name='UVMap')
            for poly in me.polygons:
                poly.material_index = names.index(node.mesh.M[poly.index]); poly.use_smooth = True
                for li in poly.loop_indices:
                    u, v = node.mesh.UV[me.loops[li].vertex_index]; uv.data[li].uv = (u, 1.0-v)
            obj = bpy.data.objects.new(node.name, me)
        else:
            obj = bpy.data.objects.new(node.name, None); obj.empty_display_type = 'PLAIN_AXES'; obj.empty_display_size = 0.15
        bpy.context.scene.collection.objects.link(obj); obj.parent = parent_obj
        x, y, z, w = node.q
        Mg = Matrix.Translation(Vector(node.t)) @ Quaternion((w, x, y, z)).to_matrix().to_4x4()
        obj.matrix_basis = C4 @ Mg @ C4.inverted()
        for k, v in node.extras.items(): obj[k] = v
        objs[node.name] = obj
        for c in node.children: make(c, obj)
    make(root, None)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(outdir, 'A10C.blend'))
    bpy.ops.export_scene.gltf(filepath=os.path.join(outdir, 'A10C_blender.glb'), export_format='GLB', export_yup=True,
                              export_apply=True, export_extras=True, export_cameras=False, export_lights=False)

# =============================================================================
#                                    MAIN
# =============================================================================
def main(argv):
    out = './export'; lods = [0, 1, 2]
    if '--out' in argv: out = argv[argv.index('--out')+1]
    if '--lod' in argv: lods = [int(argv[argv.index('--lod')+1])]
    os.makedirs(out, exist_ok=True)
    tex = make_textures()
    for name, data in tex.items(): open(os.path.join(out, name+'.png'), 'wb').write(data)
    for lod in lods:
        root = build_aircraft(lod); fn = 'A10C.glb' if lod == 0 else 'A10C_LOD%d.glb' % lod
        size = write_glb(root, os.path.join(out, fn), tex, {'lod': lod, 'units': 'metres', 'forward': '-Z', 'right': '+X', 'up': '+Y'})
        tris = sum(len(n.mesh.F) for n in root.walk() if n.mesh)
        print('%-16s %8.1f KB  %6d triangles  %3d nodes' % (fn, size/1024, tris, len(list(root.walk()))))
        if lod == 0:
            rows = rig_table(root)
            json.dump(rows, open(os.path.join(out, 'A10C_rig.json'), 'w'), indent=1)
            open(os.path.join(out, 'A10C_animation_table.md'), 'w').write(rig_markdown(rows, root))
            if IN_BLENDER: build_in_blender(root, tex, out)

if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:]
    main(args)