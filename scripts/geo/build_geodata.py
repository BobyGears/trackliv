#!/usr/bin/env python3
"""
Turn the raw Overture layers (scripts/geo/.cache, see fetch_overture.py) into the compact
files TrackLiv serves from data/geo/:

  region-*.geojson   offline Rhein-Main basemap (water, urban/forest, roads, rail, towns)
  hq-*.geojson       full-detail surroundings of both HQs (buildings with heights, streets, yards …)
  sites.json         HQ definitions: address point, building footprint, yard slots, gate
  road-graph.json    routable road graph (largest connected component) for the simulator/ETAs

  python3 scripts/geo/build_geodata.py
"""
import json
import math
import os
import sys
from collections import defaultdict

from shapely.geometry import LineString, Point, Polygon, MultiPolygon, box, mapping, shape
import warnings
from shapely.ops import linemerge, substring, transform, unary_union

warnings.filterwarnings('ignore', category=DeprecationWarning)

HERE = os.path.dirname(__file__)
CACHE = os.path.join(HERE, '.cache')
OUT = os.path.join(HERE, '..', '..', 'data', 'geo')

# keep in sync with fetch_overture.py
HQ_BBOXES = [
    (8.4035, 49.9975, 8.4235, 50.0120),
    (8.3760, 49.9672, 8.3960, 49.9812),
]
SITE_HEIGHT = {}

SITES = [
    {
        'id': 'hq-schieferstein',
        'code': 'HQ-SCH',
        'name': 'Lager Schieferstein',
        'street': 'Schieferstein',
        'number': '4',
        'address': 'Schieferstein 4, 65439 Flörsheim am Main',
        'color': '#2f6bff',
    },
    {
        'id': 'hq-hafen',
        'code': 'HQ-HAF',
        'name': 'Lager Hafenstraße',
        'street': 'Hafenstraße',
        'number': '18',
        'address': 'Hafenstraße 18, 65439 Flörsheim am Main',
        'color': '#00a3a3',
    },
    {
        'id': 'hq-bischofsheim',
        'code': 'HQ-BIS',
        'name': 'Lager Bischofsheim',
        'street': 'Neben dem Mühlweg',
        'number': '20',
        'address': 'Neben dem Mühlweg 20-30, 65474 Bischofsheim',
        'color': '#7c5cff',
        # OSM/Nominatim point of no. 20, used if the address register has no entry for it
        'point': (8.3858971, 49.9741381),
    },
]

DRIVABLE = {
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
    'service', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
}

DEFAULT_HEIGHT = {'industrial': 9.0, 'commercial': 8.0, 'office': 12.0, 'retail': 7.0, 'warehouse': 9.0,
                  'house': 7.5, 'residential': 9.0, 'apartments': 12.0, 'garage': 3.0, 'garages': 3.0,
                  'shed': 3.0, 'storage_tank': 10.0, 'silo': 18.0}


def load(name):
    with open(os.path.join(CACHE, f'{name}.geojson')) as f:
        return json.load(f)['features']


def props(f):
    p = f['properties']
    for k, v in list(p.items()):
        if isinstance(v, str) and v[:1] in '[{' and v[-1:] in ']}':
            try:
                p[k] = eval(v, {'__builtins__': {}}, {'None': None, 'True': True, 'False': False})  # cached repr
            except Exception:
                pass
        if v == 'None':
            p[k] = None
    return p


def name_of(p):
    n = p.get('names')
    if isinstance(n, dict):
        return n.get('primary')
    return None


def rnd(geom, nd):
    def r(x, y, z=None):
        return (round(x, nd), round(y, nd))
    return transform(r, geom)


def write(name, data):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, 'w') as f:
        json.dump(data, f, separators=(',', ':'), ensure_ascii=False)
    print(f'{name}: {os.path.getsize(path) / 1024:.0f} KB', file=sys.stderr)


def fc(features):
    return {'type': 'FeatureCollection', 'features': features}


def feat(geom, **p):
    return {'type': 'Feature', 'geometry': mapping(geom), 'properties': {k: v for k, v in p.items() if v is not None}}


# --- local metric projection ---------------------------------------------------------------
def local_proj(lng0, lat0):
    la = math.radians(lat0)
    my = 111132.92 - 559.82 * math.cos(2 * la) + 1.175 * math.cos(4 * la)
    mx = 111412.84 * math.cos(la) - 93.5 * math.cos(3 * la)
    fwd = lambda x, y, z=None: ((x - lng0) * mx, (y - lat0) * my)
    inv = lambda x, y, z=None: (lng0 + x / mx, lat0 + y / my)
    return fwd, inv


def haversine(a, b):
    R = 6371008.8
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dla = la2 - la1
    dlo = math.radians(b[0] - a[0])
    s = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * R * math.asin(min(1, math.sqrt(s)))


def line_len(coords):
    return sum(haversine(coords[i - 1], coords[i]) for i in range(1, len(coords)))


# =============================================================================================
# Region basemap
# =============================================================================================
def build_region():
    # Water: rivers/lakes; drop tiny ponds.
    water = []
    for f in load('region_water'):
        p = props(f)
        g = shape(f['geometry'])
        if g.geom_type in ('Polygon', 'MultiPolygon'):
            area_m2 = g.area * 111000 * 71500
            if area_m2 < 15000 and p.get('subtype') not in ('river', 'canal'):
                continue
            g = g.simplify(0.00008, preserve_topology=True)
            if g.is_empty:
                continue
            water.append(feat(rnd(g, 5), kind='area', sub=p.get('subtype'), name=name_of(p)))
        elif g.geom_type in ('LineString', 'MultiLineString') and p.get('subtype') in ('river', 'canal'):
            water.append(feat(rnd(g.simplify(0.0001), 5), kind='line', sub=p.get('subtype'), name=name_of(p)))
    write('region-water.geojson', fc(water))

    # Land cover: urban + forest, dissolved per class and generalised.
    by = defaultdict(list)
    region = box(7.95, 49.75, 9.05, 50.35)
    for f in load('region_cover'):
        p = props(f)
        if p.get('subtype') not in ('urban', 'forest'):
            continue
        g = shape(f['geometry'])
        if not g.is_valid:
            g = g.buffer(0)
        g = g.intersection(region)
        if g.is_empty:
            continue
        by[p.get('subtype')].append(g)
    cover = []
    for sub, geoms in by.items():
        merged = unary_union([g.buffer(0.0002) for g in geoms]).buffer(-0.0002)
        merged = merged.simplify(0.0004, preserve_topology=True)
        polys = list(merged.geoms) if isinstance(merged, MultiPolygon) else [merged]
        for poly in polys:
            if poly.area * 111000 * 71500 < 150000:
                continue
            cover.append(feat(rnd(poly, 5), sub=sub))
    write('region-landcover.geojson', fc(cover))

    # Roads & rail for display (merged per class+name to cut feature count).
    groups = defaultdict(list)
    rail = []
    for f in load('region_roads'):
        p = props(f)
        g = shape(f['geometry'])
        cls = p.get('class')
        if cls == 'standard_gauge':
            rail.append(g)
            continue
        if cls in ('tertiary', 'tertiary_link'):
            continue  # routable (road-graph.json) but too dense for the offline basemap
        groups[(cls, name_of(p))].append(g)
    roads = []
    for (cls, nm), geoms in groups.items():
        merged = linemerge(geoms)
        lines = list(merged.geoms) if merged.geom_type == 'MultiLineString' else [merged]
        for ln in lines:
            ln = ln.simplify(0.0001)
            roads.append(feat(rnd(ln, 5), cls=cls, name=nm))
    write('region-roads.geojson', fc(roads))
    merged = linemerge(rail)
    lines = list(merged.geoms) if merged.geom_type == 'MultiLineString' else [merged]
    write('region-rail.geojson', fc([feat(rnd(l.simplify(0.00015), 5)) for l in lines]))

    # Towns.
    places = []
    for f in load('region_places'):
        p = props(f)
        if p.get('subtype') != 'locality':
            continue
        cls = p.get('class') or 'village'
        if cls not in ('city', 'town', 'village'):
            continue
        pop = p.get('population') or 0
        try:
            pop = int(pop)
        except (TypeError, ValueError):
            pop = 0
        rank = 1 if cls == 'city' or pop > 90000 else 2 if cls == 'town' or pop > 15000 else 3
        places.append(feat(rnd(shape(f['geometry']), 5), name=name_of(p), cls=cls, pop=pop, rank=rank))
    places.sort(key=lambda f: -f['properties']['pop'])
    write('region-places.geojson', fc(places))


# =============================================================================================
# HQ surroundings (full detail)
# =============================================================================================
def build_hq():
    clip = unary_union([box(*b) for b in HQ_BBOXES])
    addresses = [props(f) | {'_g': f['geometry']} for f in load('hq_address')]
    site_points = {}
    for s in SITES:
        hit = [a for a in addresses if a.get('street') == s['street'] and str(a.get('number')) == s['number']]
        if not hit and s.get('point'):
            print(f"{s['id']}: address not in the register, using the fixed point", file=sys.stderr)
            site_points[s['id']] = s['point']
            continue
        if not hit:
            sys.exit(f"address not found: {s['address']}")
        site_points[s['id']] = tuple(hit[0]['_g']['coordinates'])

    # Buildings
    buildings = []
    site_buildings = {}
    raw_buildings = []
    for f in load('hq_building'):
        p = props(f)
        g = shape(f['geometry'])
        if not g.intersects(clip):
            continue
        cls = p.get('class') or p.get('subtype')
        h = p.get('height')
        try:
            h = float(h) if h is not None else None
        except ValueError:
            h = None
        if h is None:
            floors = p.get('num_floors')
            h = float(floors) * 3.2 if floors not in (None, 'None') else DEFAULT_HEIGHT.get(cls or '', None)
        area = g.area * 111000 * 71500
        if h is None:
            h = 3.2 if area < 60 else 7.0
        site = None
        for sid, pt in site_points.items():
            if g.contains(Point(pt)) or g.distance(Point(pt)) < 0.00002:
                site = sid
                site_buildings[sid] = g
                SITE_HEIGHT[sid] = round(h, 1)
        raw_buildings.append(g)
        buildings.append(feat(rnd(g, 6), h=round(h, 1), mh=p.get('min_height'), cls=cls, site=site))
    write('hq-buildings.geojson', fc(buildings))

    # Streets, paths, rail
    roads, rail = [], []
    for f in load('hq_segment'):
        p = props(f)
        g = shape(f['geometry']).intersection(clip)
        if g.is_empty:
            continue
        if p.get('subtype') == 'rail':
            rail.append(feat(rnd(g, 6), cls=p.get('class')))
        else:
            roads.append(feat(rnd(g, 6), cls=p.get('class'), name=name_of(p)))
    write('hq-roads.geojson', fc(roads))
    write('hq-rail.geojson', fc(rail))

    # Ground areas: land use + land cover + parking + water
    areas = []
    for f in load('hq_land_use'):
        p = props(f)
        g = shape(f['geometry']).intersection(clip)
        if g.is_empty or g.geom_type not in ('Polygon', 'MultiPolygon'):
            continue
        areas.append(feat(rnd(g, 6), layer='landuse', sub=p.get('subtype'), cls=p.get('class')))
    for f in load('hq_land_cover'):
        p = props(f)
        g = shape(f['geometry']).intersection(clip)
        if g.is_empty or g.geom_type not in ('Polygon', 'MultiPolygon'):
            continue
        g = g.simplify(0.00002)
        areas.append(feat(rnd(g, 6), layer='cover', sub=p.get('subtype')))
    for f in load('hq_infrastructure'):
        p = props(f)
        g = shape(f['geometry']).intersection(clip)
        if g.is_empty:
            continue
        cls = p.get('class')
        if g.geom_type in ('Polygon', 'MultiPolygon') and cls in ('parking', 'parking_space', 'bridge', 'pier'):
            areas.append(feat(rnd(g, 6), layer='infra', cls=cls))
    water = []
    for f in load('hq_water'):
        p = props(f)
        g = shape(f['geometry']).intersection(clip)
        if g.is_empty:
            continue
        water.append(feat(rnd(g, 6), sub=p.get('subtype'), name=name_of(p)))
    write('hq-areas.geojson', fc(areas))
    write('hq-water.geojson', fc(water))

    barriers = []
    for f in load('hq_infrastructure'):
        p = props(f)
        g = shape(f['geometry']).intersection(clip)
        if g.is_empty:
            continue
        if p.get('subtype') == 'barrier' and g.geom_type in ('LineString', 'MultiLineString'):
            barriers.append(feat(rnd(g, 6), cls=p.get('class')))
        if p.get('subtype') == 'power' and p.get('class') == 'power_line':
            barriers.append(feat(rnd(g, 6), cls='power_line'))
    write('hq-barriers.geojson', fc(barriers))

    return site_points, site_buildings, raw_buildings, roads


# =============================================================================================
# Sites: footprint, yard slots, gate
# =============================================================================================
def build_sites(site_points, site_buildings, raw_buildings, roads):
    out = []
    for s in SITES:
        pt = site_points[s['id']]
        bld = site_buildings[s['id']]
        fwd, inv = local_proj(*pt)
        b = transform(fwd, bld)
        others = [transform(fwd, g) for g in raw_buildings if g is not bld and g.distance(bld) < 0.001]
        obstacles = unary_union(others) if others else Polygon()
        public_roads = unary_union([
            transform(fwd, shape(r['geometry'])).buffer(3.5)
            for r in roads
            if r['properties'].get('cls') in ('primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'trunk')
        ])

        rect = b.minimum_rotated_rectangle
        c = list(rect.exterior.coords)[:4]
        cen = b.centroid
        candidates = []
        for i in range(4):
            a, bb = c[i], c[(i + 1) % 4]
            ex, ey = bb[0] - a[0], bb[1] - a[1]
            L = math.hypot(ex, ey)
            ux, uy = ex / L, ey / L
            nx, ny = -uy, ux
            mx, my = (a[0] + bb[0]) / 2, (a[1] + bb[1]) / 2
            if (mx + nx - cen.x) ** 2 + (my + ny - cen.y) ** 2 < (mx - cen.x) ** 2 + (my - cen.y) ** 2:
                nx, ny = -nx, -ny
            for row in range(2):
                off0 = 5.0 + row * 13.0
                slots = []
                n = int((L + 6) // 4.2)
                for k in range(n):
                    t = -3 + 2.1 + k * 4.2
                    px = a[0] + ux * t + nx * (off0 + 4.0)
                    py = a[1] + uy * t + ny * (off0 + 4.0)
                    fp = Polygon([
                        (px - ux * 1.5 - nx * 3.6, py - uy * 1.5 - ny * 3.6),
                        (px + ux * 1.5 - nx * 3.6, py + uy * 1.5 - ny * 3.6),
                        (px + ux * 1.5 + nx * 3.6, py + uy * 1.5 + ny * 3.6),
                        (px - ux * 1.5 + nx * 3.6, py - uy * 1.5 + ny * 3.6),
                    ])
                    if fp.intersects(obstacles) or fp.intersects(b) or fp.intersects(public_roads):
                        continue
                    heading = (math.degrees(math.atan2(nx, ny)) + 360) % 360  # nose away from the wall
                    slots.append((px, py, heading))
                candidates.append((len(slots) - row * 0.5, i, row, slots))
        candidates.sort(key=lambda x: -x[0])
        yard = []
        used = set()
        for score, side, row, slots in candidates:
            if len(yard) >= 10:
                break
            if (side, row) in used:
                continue
            used.add((side, row))
            for px, py, hd in slots:
                if all(math.hypot(px - q[0], py - q[1]) > 3.9 for q in yard):
                    yard.append((px, py, hd))
        yard = yard[:12]

        # Gate: closest drivable road point to the building.
        best = None
        for r in roads:
            if r['properties'].get('cls') not in DRIVABLE:
                continue
            ln = transform(fwd, shape(r['geometry']))
            d = ln.distance(b)
            if best is None or d < best[0]:
                best = (d, ln.interpolate(ln.project(b.centroid)))
        gate = inv(best[1].x, best[1].y)

        ring = [list(map(lambda v: round(v, 7), inv(x, y))) for x, y in b.exterior.coords]
        out.append({
            'id': s['id'],
            'code': s['code'],
            'name': s['name'],
            'address': s['address'],
            'color': s['color'],
            'location': {'lng': round(pt[0], 7), 'lat': round(pt[1], 7)},
            # big sites: the yard must lie inside the geofence, or parked vehicles count as "away"
            'geofenceRadiusM': max(110, math.ceil(max([math.hypot(x, y) for x, y, _ in yard] + [0]) + 30)),
            'heightM': SITE_HEIGHT.get(s['id']),
            'footprint': ring,
            'yard': [
                {'lng': round(inv(x, y)[0], 7), 'lat': round(inv(x, y)[1], 7), 'heading': round(h, 1)}
                for x, y, h in yard
            ],
            'gate': {'lng': round(gate[0], 7), 'lat': round(gate[1], 7)},
        })
        print(f"{s['id']}: footprint {b.area:.0f} m², {len(yard)} yard slots", file=sys.stderr)
    write('sites.json', out)


# =============================================================================================
# Road graph (connector topology)
# =============================================================================================
def build_graph():
    classes = sorted(DRIVABLE)
    cidx = {c: i for i, c in enumerate(classes)}
    node_of = {}
    node_xy = []
    edges = []

    def node(cid, xy):
        if cid not in node_of:
            node_of[cid] = len(node_xy)
            node_xy.append(xy)
        return node_of[cid]

    def add_segments(features, keep):
        for f in features:
            p = props(f)
            if p.get('subtype') == 'rail' or p.get('class') not in DRIVABLE or not keep(f):
                continue
            conns = p.get('connectors') or []
            if not isinstance(conns, list) or len(conns) < 2:
                continue
            g = shape(f['geometry'])
            if g.geom_type != 'LineString':
                continue
            conns = sorted(conns, key=lambda c: float(c['at']))
            for c0, c1 in zip(conns, conns[1:]):
                a0, a1 = float(c0['at']), float(c1['at'])
                if a1 <= a0:
                    continue
                part = substring(g, a0, a1, normalized=True)
                if part.geom_type != 'LineString' or part.length == 0:
                    continue
                coords = list(part.coords)
                na = node(c0['connector_id'], coords[0])
                nb = node(c1['connector_id'], coords[-1])
                if na == nb:
                    continue
                length = line_len(coords)
                simp = LineString(coords).simplify(0.00003).coords
                interior = [v for xy in list(simp)[1:-1] for v in (round(xy[0], 6), round(xy[1], 6))]
                edges.append((na, nb, round(length, 1), cidx[p['class']], interior))

    add_segments(load('region_roads'), lambda f: True)
    add_segments(load('hq_segment'), lambda f: True)

    # de-duplicate edges that came from both downloads
    uniq = {}
    for e in edges:
        key = (min(e[0], e[1]), max(e[0], e[1]), e[2])
        uniq[key] = e
    edges = list(uniq.values())

    # largest connected component
    parent = list(range(len(node_xy)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b, *_ in edges:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    sizes = defaultdict(int)
    for i in range(len(node_xy)):
        sizes[find(i)] += 1
    main = max(sizes, key=sizes.get)
    keep_nodes = [i for i in range(len(node_xy)) if find(i) == main]
    remap = {old: new for new, old in enumerate(keep_nodes)}
    nodes = []
    for old in keep_nodes:
        x, y = node_xy[old]
        nodes += [round(x, 6), round(y, 6)]
    out_edges = []
    for a, b, length, cls, interior in edges:
        if a in remap and b in remap:
            e = [remap[a], remap[b], length, cls]
            if interior:
                e.append(interior)
            out_edges.append(e)
    print(f'graph: {len(keep_nodes)} nodes / {len(out_edges)} edges (of {len(node_xy)} nodes)', file=sys.stderr)
    write('road-graph.json', {'classes': classes, 'nodes': nodes, 'edges': out_edges})


if __name__ == '__main__':
    only = set(sys.argv[1:])
    if not only or 'region' in only:
        build_region()
    if not only or 'hq' in only or 'sites' in only:
        sp, sb, rb, roads = build_hq()
        build_sites(sp, sb, rb, roads)
    if not only or 'graph' in only:
        build_graph()
