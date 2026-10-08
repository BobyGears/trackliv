import { haversineM, polylineLengthM } from './geo.ts';
import type { LngLat } from './types.ts';

/**
 * Compact road graph produced by scripts/geo/build_geodata.py from Overture Maps segments
 * (largest connected component only).
 *   nodes: flat [lng, lat, lng, lat, …]
 *   edges: [a, b, lengthM, classIndex, flat interior coords?]
 */
export interface RoadGraphData {
  classes: string[];
  nodes: number[];
  edges: [number, number, number, number, number[]?][];
}

export interface Route {
  coords: [number, number][];
  lengthM: number;
  durationMin: number;
}

const SPEED_KMH: Record<string, number> = {
  motorway: 105,
  motorway_link: 60,
  trunk: 85,
  trunk_link: 55,
  primary: 60,
  primary_link: 45,
  secondary: 52,
  secondary_link: 40,
  tertiary: 45,
  tertiary_link: 35,
  unclassified: 35,
  residential: 30,
  living_street: 10,
  service: 15,
};

interface Adj {
  to: number;
  edge: number;
  forward: boolean;
}

class MinHeap {
  private items: [number, number][] = [];
  get size() {
    return this.items.length;
  }
  push(node: number, prio: number) {
    const a = this.items;
    a.push([node, prio]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][1] <= a[i][1]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0][0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][1] < a[m][1]) m = l;
        if (r < a.length && a[r][1] < a[m][1]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export class RoadGraph {
  readonly nodeCount: number;
  private adj: Adj[][];
  private grid = new Map<string, number[]>();
  private static CELL = 0.01;

  constructor(private data: RoadGraphData) {
    this.nodeCount = data.nodes.length / 2;
    this.adj = Array.from({ length: this.nodeCount }, () => []);
    data.edges.forEach(([a, b], i) => {
      this.adj[a].push({ to: b, edge: i, forward: true });
      this.adj[b].push({ to: a, edge: i, forward: false });
    });
    for (let i = 0; i < this.nodeCount; i++) {
      const key = this.cellKey(data.nodes[2 * i], data.nodes[2 * i + 1]);
      let bucket = this.grid.get(key);
      if (!bucket) this.grid.set(key, (bucket = []));
      bucket.push(i);
    }
  }

  private cellKey(lng: number, lat: number) {
    return `${Math.floor(lng / RoadGraph.CELL)}:${Math.floor(lat / RoadGraph.CELL)}`;
  }

  node(i: number): LngLat {
    return { lng: this.data.nodes[2 * i], lat: this.data.nodes[2 * i + 1] };
  }

  nearestNode(p: LngLat): { node: number; distM: number } | null {
    const cx = Math.floor(p.lng / RoadGraph.CELL);
    const cy = Math.floor(p.lat / RoadGraph.CELL);
    let best: { node: number; distM: number } | null = null;
    for (let ring = 0; ring < 30; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          for (const n of this.grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
            const d = haversineM(p, this.node(n));
            if (!best || d < best.distM) best = { node: n, distM: d };
          }
        }
      }
      // A found node can't be beaten by anything more than one ring further out.
      if (best && ring >= 1) break;
    }
    return best;
  }

  private edgeCoords(edgeIdx: number, forward: boolean): [number, number][] {
    const [a, b, , , interior] = this.data.edges[edgeIdx];
    const pts: [number, number][] = [[this.data.nodes[2 * a], this.data.nodes[2 * a + 1]]];
    if (interior) for (let i = 0; i < interior.length; i += 2) pts.push([interior[i], interior[i + 1]]);
    pts.push([this.data.nodes[2 * b], this.data.nodes[2 * b + 1]]);
    return forward ? pts : pts.reverse();
  }

  private edgeCost(edgeIdx: number): number {
    const [, , len, cls] = this.data.edges[edgeIdx];
    const speed = SPEED_KMH[this.data.classes[cls]] ?? 30;
    return len / ((speed * 1000) / 3600); // seconds
  }

  /** Fastest route between two arbitrary points (A*), including straight first/last legs. */
  route(from: LngLat, to: LngLat): Route | null {
    const s = this.nearestNode(from);
    const t = this.nearestNode(to);
    if (!s || !t) return null;
    const goal = this.node(t.node);
    const maxSpeed = (110 * 1000) / 3600;
    const g = new Float64Array(this.nodeCount).fill(Infinity);
    const prev = new Int32Array(this.nodeCount).fill(-1);
    const prevEdge = new Int32Array(this.nodeCount).fill(-1);
    const prevFwd = new Uint8Array(this.nodeCount);
    const closed = new Uint8Array(this.nodeCount);
    const heap = new MinHeap();
    g[s.node] = 0;
    heap.push(s.node, haversineM(this.node(s.node), goal) / maxSpeed);
    let found = false;
    while (heap.size) {
      const u = heap.pop()!;
      if (closed[u]) continue;
      closed[u] = 1;
      if (u === t.node) {
        found = true;
        break;
      }
      for (const e of this.adj[u]) {
        if (closed[e.to]) continue;
        const ng = g[u] + this.edgeCost(e.edge);
        if (ng < g[e.to]) {
          g[e.to] = ng;
          prev[e.to] = u;
          prevEdge[e.to] = e.edge;
          prevFwd[e.to] = e.forward ? 1 : 0;
          heap.push(e.to, ng + haversineM(this.node(e.to), goal) / maxSpeed);
        }
      }
    }
    if (!found) return null;

    const pieces: [number, number][][] = [];
    for (let v = t.node; v !== s.node; v = prev[v]) {
      pieces.push(this.edgeCoords(prevEdge[v], prevFwd[v] === 1));
    }
    pieces.reverse();
    const coords: [number, number][] = [[from.lng, from.lat]];
    for (const piece of pieces) {
      for (const c of piece) {
        const last = coords[coords.length - 1];
        if (last[0] !== c[0] || last[1] !== c[1]) coords.push(c);
      }
    }
    if (!pieces.length) coords.push([this.node(s.node).lng, this.node(s.node).lat]);
    coords.push([to.lng, to.lat]);
    const lengthM = polylineLengthM(coords);
    const roadSeconds = g[t.node];
    const offRoadSeconds = (s.distM + t.distM) / ((20 * 1000) / 3600);
    return { coords, lengthM, durationMin: Math.max(1, Math.round((roadSeconds + offRoadSeconds) / 60)) };
  }
}
