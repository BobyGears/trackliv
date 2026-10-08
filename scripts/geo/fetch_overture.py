#!/usr/bin/env python3
"""
Download the raw Overture Maps layers TrackLiv needs, straight from the public S3 bucket.

  python3 scripts/geo/fetch_overture.py            # everything
  python3 scripts/geo/fetch_overture.py hq_building region_roads

Only the parquet row groups whose bbox statistics intersect the area are read, so this pulls
a few hundred MB instead of the whole planet. Output: scripts/geo/.cache/*.geojson

Requires: pip install pyarrow shapely
Data: Overture Maps Foundation (ODbL for OSM-derived layers, CDLA-Permissive-2.0 etc.), Hessen
address register via OpenAddresses (DL-DE-ZERO-2.0). See README "Geodata & licences".
"""
import concurrent.futures as cf
import json
import os
import sys
import time

import pyarrow as pa
import pyarrow.fs as fs
import pyarrow.parquet as pq
from shapely import wkb
from shapely.geometry import mapping

RELEASE = os.environ.get('OVERTURE_RELEASE', '2026-09-23.1')
# same data, used for single files S3 refuses to serve from RELEASE
FALLBACK_RELEASES = ['2026-09-23.0']
ROOT = f'overturemaps-us-west-2/release/{RELEASE}'
CACHE = os.path.join(os.path.dirname(__file__), '.cache')

# Full-detail areas around the sites: Schieferstein 4 + Hafenstraße 18 (Flörsheim am Main),
# Neben dem Mühlweg 20-30 (Bischofsheim/Bauschheim).
HQ_BBOXES = [
    (8.4035, 49.9975, 8.4235, 50.0120),
    (8.3760, 49.9672, 8.3960, 49.9812),
]
# Rhein-Main region where projects are.
REGION_BBOX = (7.95, 49.75, 9.05, 50.35)
# Germany: only the roads long trips use, for routes/ETAs to projects outside Rhein-Main.
DE_BBOX = (5.86, 47.27, 15.05, 55.06)


def _s3():
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    kw = dict(anonymous=True, region='us-west-2')
    if proxy:
        from urllib.parse import urlparse
        u = urlparse(proxy)
        kw['proxy_options'] = {'scheme': u.scheme or 'http', 'host': u.hostname, 'port': u.port or 80}
    return fs.S3FileSystem(**kw)


S3 = _s3()


def retry(fn, n=25):
    for k in range(n):
        try:
            return fn()
        except OSError:
            if k == n - 1:
                raise
            time.sleep(min(5, 0.5 * (k + 1)))


def files(theme, typ):
    sel = fs.FileSelector(f'{ROOT}/theme={theme}/type={typ}', recursive=False)
    return retry(lambda: [i.path for i in S3.get_file_info(sel)])


def row_groups_hitting(path, bbox):
    xmin, ymin, xmax, ymax = bbox

    def meta():
        with S3.open_input_file(path) as f:
            return pq.ParquetFile(f).metadata

    md = retry(meta)
    idx = {md.schema.column(i).path: i for i in range(md.num_columns)}
    hits = []
    for r in range(md.num_row_groups):
        rg = md.row_group(r)
        st = {c: rg.column(idx[c]).statistics for c in ('bbox.xmin', 'bbox.ymin', 'bbox.xmax', 'bbox.ymax')}
        if any(s is None or not s.has_min_max for s in st.values()):
            hits.append(r)
        elif st['bbox.xmin'].min <= xmax and st['bbox.xmax'].max >= xmin and st['bbox.ymin'].min <= ymax and st['bbox.ymax'].max >= ymin:
            hits.append(r)
    return path, hits


def read_chunk(path, chunk, columns):
    """Read row groups; if S3 keeps failing for this release's file, use the same file of an earlier release."""
    alternatives = [path] + [path.replace(f'/release/{RELEASE}/', f'/release/{r}/') for r in FALLBACK_RELEASES]
    last = None
    for alt in alternatives:
        for attempt in range(4):
            try:
                with S3.open_input_file(alt) as f:
                    return pq.ParquetFile(f).read_row_groups(chunk, columns=columns)
            except OSError as e:
                last = e
                time.sleep(2 * (attempt + 1))
        print(f'  ! {alt.rsplit("/", 1)[-1]} not readable, trying an earlier release', file=sys.stderr)
    raise last


def query(theme, typ, bbox, columns=None, where=None, parts=None):
    """where: optional (column, allowed values) – applied while reading, so large areas fit in memory.
    parts: directory to keep each finished chunk in, so an interrupted download resumes."""
    xmin, ymin, xmax, ymax = bbox
    with cf.ThreadPoolExecutor(8) as ex:
        res = list(ex.map(lambda p: row_groups_hitting(p, bbox), files(theme, typ)))
    tables = []
    todo = [(path, hits[i:i + 4]) for path, hits in res for i in range(0, len(hits), 4)]
    for n, (path, chunk) in enumerate(todo):
        part = os.path.join(parts, f"{path.rsplit('/', 1)[-1]}-{chunk[0]}.parquet") if parts else None
        if part and os.path.exists(part):
            t = pq.read_table(part)
            if t.num_rows:
                tables.append(t)
            continue
        t = read_chunk(path, chunk, columns)
        bb = t.column('bbox').to_pylist()
        mask = [b['xmin'] <= xmax and b['xmax'] >= xmin and b['ymin'] <= ymax and b['ymax'] >= ymin for b in bb]
        if where:
            col, allowed = where
            mask = [m and v in allowed for m, v in zip(mask, t.column(col).to_pylist())]
        t = t.filter(pa.array(mask))
        if part:
            os.makedirs(parts, exist_ok=True)
            pq.write_table(t, part + '.tmp')
            os.replace(part + '.tmp', part)
        if t.num_rows:
            tables.append(t)
        if len(todo) > 20 and n % 10 == 0:
            print(f'  {typ}: {n + 1}/{len(todo)} chunks, {sum(x.num_rows for x in tables)} rows', file=sys.stderr)
    return pa.concat_tables(tables, promote_options='default') if tables else None


def dump(name, theme, typ, bboxes, columns=None, keep=lambda r: True, where=None, resumable=False):
    """bboxes: one bbox or a list of them (features in several are kept once)."""
    rows, seen = [], set()
    for bbox in (bboxes if isinstance(bboxes, list) else [bboxes]):
        t = query(theme, typ, bbox, columns=(columns + ['geometry', 'bbox']) if columns else None, where=where,
                  parts=os.path.join(CACHE, f'{name}.parts') if resumable else None)
        for r in (t.to_pylist() if t is not None else []):
            if r.get('id') in seen:
                continue
            seen.add(r.get('id'))
            rows.append(r)
    feats = []
    for r in rows:
        if not keep(r):
            continue
        g = wkb.loads(r.pop('geometry'))
        r.pop('bbox', None)
        feats.append({'type': 'Feature', 'geometry': mapping(g), 'properties': r})
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, f'{name}.geojson'), 'w') as f:
        json.dump({'type': 'FeatureCollection', 'features': feats}, f, default=str)
    print(f'{name}: {len(feats)} features', file=sys.stderr)


DE_ROAD_CLASSES = {'motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link', 'primary_link'}

REGION_ROAD_CLASSES = {
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
    'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'standard_gauge',
}

JOBS = {
    'hq_address': lambda: dump('hq_address', 'addresses', 'address', HQ_BBOXES),
    'hq_building': lambda: dump('hq_building', 'buildings', 'building', HQ_BBOXES),
    'hq_segment': lambda: dump('hq_segment', 'transportation', 'segment', HQ_BBOXES),
    'hq_water': lambda: dump('hq_water', 'base', 'water', HQ_BBOXES),
    'hq_land_use': lambda: dump('hq_land_use', 'base', 'land_use', HQ_BBOXES),
    'hq_land_cover': lambda: dump('hq_land_cover', 'base', 'land_cover', HQ_BBOXES),
    'hq_infrastructure': lambda: dump('hq_infrastructure', 'base', 'infrastructure', HQ_BBOXES),
    'hq_place': lambda: dump('hq_place', 'places', 'place', HQ_BBOXES),
    'region_roads': lambda: dump('region_roads', 'transportation', 'segment', REGION_BBOX,
                                 ['id', 'names', 'subtype', 'class', 'connectors', 'road_flags'],
                                 lambda r: r['class'] in REGION_ROAD_CLASSES),
    'de_roads': lambda: dump('de_roads', 'transportation', 'segment', DE_BBOX,
                             ['id', 'subtype', 'class', 'connectors'], where=('class', DE_ROAD_CLASSES), resumable=True),
    'region_water': lambda: dump('region_water', 'base', 'water', REGION_BBOX,
                                 ['id', 'names', 'subtype', 'class'],
                                 lambda r: r['subtype'] in ('river', 'lake', 'reservoir', 'canal', 'water', 'pond')),
    # land_cover is published at several generalisations; keep the one meant for ~z10-11.
    'region_cover': lambda: dump('region_cover', 'base', 'land_cover', REGION_BBOX, ['id', 'subtype', 'cartography'],
                                 lambda r: r['subtype'] in ('urban', 'forest', 'crop', 'grass')
                                 and (r.get('cartography') or {}).get('min_zoom', 0) <= 10 <= (r.get('cartography') or {}).get('max_zoom', 99)),
    'region_places': lambda: dump('region_places', 'divisions', 'division', REGION_BBOX,
                                  ['id', 'names', 'subtype', 'class', 'population'],
                                  lambda r: r['subtype'] in ('locality', 'county')),
}

if __name__ == '__main__':
    wanted = sys.argv[1:] or list(JOBS)
    for name in wanted:
        JOBS[name]()
