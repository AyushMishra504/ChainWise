import marnet from "searoute-js/data/marnet_densified.json";
import type { FeatureCollection, LineString } from "geojson";
import type { Chokepoint } from "@/data/chokepoints";

/*
 * Sea routing over the maritime network shipped with searoute-js
 * (marnet_densified.json, ~6k nodes / ~7.6k edges). We build our own graph
 * rather than calling searoute() directly because the library exposes no way
 * to block an edge — and blocking chokepoints is the point here.
 */

export type SeaPath = {
  /** Ordered [lng, lat] waypoints along water. */
  coords: [number, number][];
  /** Great-circle route length in km. */
  lengthKm: number;
  /** Travel time at 14 knots, in days. */
  days: number;
};

const KNOTS = 14;
const KM_PER_NM = 1.852;
// Ports can sit well inland of the nearest sea-network vertex (e.g. Mundra is
// ~280 km from the densified network), so allow a generous snap radius.
// Snap ports to the nearest network segment; the nearest segment can be a few
// hundred km away on the coarse bundled network (e.g. Mundra ≈ 300 km).
const PORT_SNAP_KM = 600;
const H3 = (c: [number, number]) => c[0].toFixed(5) + "|" + c[1].toFixed(5);

// Chord length between two lon/lat points, in km. Good enough for short edges.
function chordKm(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const φ1 = a[1] * rad;
  const φ2 = b[1] * rad;
  const Δφ = φ2 - φ1;
  const Δλ = (b[0] - a[0]) * rad;
  const h =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLengthKm(coords: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += chordKm(coords[i - 1], coords[i]);
  return total;
}

export function daysForKm(km: number): number {
  return km / (KNOTS * KM_PER_NM * 24);
}

/**
 * Prepend/append the real port coordinates to a snapped sea path so the drawn
 * line visibly connects to the port dot (nearest network node can be far).
 */
export function connectEndpoints(
  coords: [number, number][],
  start: [number, number],
  end: [number, number],
): [number, number][] {
  const out: [number, number][] = [];
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (!first || first[0] !== start[0] || first[1] !== start[1]) out.push(start);
  out.push(...coords);
  if (last && (last[0] !== end[0] || last[1] !== end[1])) out.push(end);
  return out;
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

type Graph = {
  /** node key -> [lng, lat] */
  coords: Map<string, [number, number]>;
  /** adjacency: key -> { to: key; edgeId: string; km: number }[] */
  adj: Map<string, { to: string; edgeId: string; km: number }[]>;
  /** every undirected segment as [nodeA, nodeB] (for edge snapping) */
  segments: [string, string][];
};

let graph: Graph | null = null;

function buildGraph(): Graph {
  const g: Graph = { coords: new Map(), adj: new Map(), segments: [] };
  const ensure = (c: [number, number]): string => {
    const k = H3(c);
    if (!g.coords.has(k)) g.coords.set(k, c);
    return k;
  };
  const net = marnet as FeatureCollection<LineString>;
  let edgeId = 0;
  for (const feature of net.features) {
    const cs = feature.geometry.coordinates as [number, number][];
    let prev = ensure(cs[0]);
    for (let i = 1; i < cs.length; i++) {
      const k = ensure(cs[i]);
      const km = chordKm(g.coords.get(prev)!, g.coords.get(k)!);
      const id = "e" + edgeId++;
      if (!g.adj.has(prev)) g.adj.set(prev, []);
      if (!g.adj.has(k)) g.adj.set(k, []);
      g.adj.get(prev)!.push({ to: k, edgeId: id, km });
      g.adj.get(k)!.push({ to: prev, edgeId: id, km });
      g.segments.push([prev, k]);
      prev = k;
    }
  }
  return g;
}

function getGraph(): Graph {
  if (!graph) graph = buildGraph();
  return graph;
}

/**
 * Snap a point to the network the way searoute-js does: find the nearest
 * segment by perpendicular distance, then take that segment's nearer endpoint.
 * (Using the nearest *node* instead sends routes on odd coastal detours.)
 */
function snapToVertex(c: [number, number], maxKm: number): string | null {
  const g = getGraph();
  let bestKm = maxKm;
  let bestA: string | null = null;
  let bestB: string | null = null;
  for (const [a, b] of g.segments) {
    const d = pointToSegmentKm(c, g.coords.get(a)!, g.coords.get(b)!);
    if (d < bestKm) {
      bestKm = d;
      bestA = a;
      bestB = b;
    }
  }
  if (!bestA || !bestB) return null;
  const da = chordKm(c, g.coords.get(bestA)!);
  const db = chordKm(c, g.coords.get(bestB)!);
  return da <= db ? bestA : bestB;
}

// ---------------------------------------------------------------------------
// Dijkstra
// ---------------------------------------------------------------------------

export function findSeaPath(
  from: [number, number],
  to: [number, number],
  blockedEdges: Set<string> = new Set(),
): SeaPath | null {
  const g = getGraph();
  const s = snapToVertex(from, PORT_SNAP_KM);
  const t = snapToVertex(to, PORT_SNAP_KM);
  if (!s || !t) return null;

  const dist = new Map<string, number>([[s, 0]]);
  const prevNode = new Map<string, string>();
  const queue = new Set<string>([s]);

  while (queue.size > 0) {
    // pick min (linear scan; graph is small enough)
    let u = "";
    let uDist = Infinity;
    for (const k of queue) {
      const d = dist.get(k) ?? Infinity;
      if (d < uDist) {
        uDist = d;
        u = k;
      }
    }
    queue.delete(u);
    if (u === t) break;

    for (const edge of g.adj.get(u) ?? []) {
      if (blockedEdges.has(edge.edgeId)) continue;
      const nd = uDist + edge.km;
      if (nd < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nd);
        prevNode.set(edge.to, u);
        queue.add(edge.to);
      }
    }
  }

  if (!dist.has(t)) return null;

  const chain: string[] = [t];
  let cur = t;
  while (cur !== s) {
    const p = prevNode.get(cur);
    if (!p) return null;
    chain.push(p);
    cur = p;
  }
  chain.reverse();

  const coords = connectEndpoints(chain.map((k) => g.coords.get(k)!), from, to);
  const lengthKm = pathLengthKm(coords);
  return { coords, lengthKm, days: daysForKm(lengthKm) };
}

// ---------------------------------------------------------------------------
// Chokepoints
// ---------------------------------------------------------------------------

/** Within ~100 km of the line = the route "passes through" it. */
const CHOKEPOINT_RADIUS_KM = 100;

function pointToSegmentKm(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  // Project on a planar approximation fine at these distances.
  const latRad = ((p[1] + a[1] + b[1]) / 3) * (Math.PI / 180);
  const ax = a[0] * Math.cos(latRad);
  const bx = b[0] * Math.cos(latRad);
  const px = p[0] * Math.cos(latRad);
  const ay = a[1];
  const by = b[1];
  const py = p[1];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return chordKm(p, a);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  // Undo the cos(lat) scaling on the projected x before measuring in real lon/lat.
  const projLng = (ax + t * dx) / Math.cos(latRad);
  const projLat = ay + t * dy;
  return chordKm(p, [projLng, projLat]);
}

export function chokepointsOnRoute(
  coords: [number, number][],
  chokepoints: Chokepoint[],
): string[] {
  const hits: string[] = [];
  for (const cp of chokepoints) {
    const p: [number, number] = [cp.lng, cp.lat];
    for (let i = 1; i < coords.length; i++) {
      if (pointToSegmentKm(p, coords[i - 1], coords[i]) <= CHOKEPOINT_RADIUS_KM) {
        hits.push(cp.id);
        break;
      }
    }
  }
  return hits;
}

/** Edge ids belonging to segments within `radiusKm` of a chokepoint. */
export function edgesNearChokepoint(
  chokepoint: Chokepoint,
  radiusKm = CHOKEPOINT_RADIUS_KM,
): Set<string> {
  const g = getGraph();
  const p: [number, number] = [chokepoint.lng, chokepoint.lat];
  const blocked = new Set<string>();
  for (const [k, edges] of g.adj) {
    const a = g.coords.get(k)!;
    for (const edge of edges) {
      // Each undirected edge appears twice (in both adj lists); fine to add twice.
      const b = g.coords.get(edge.to)!;
      if (pointToSegmentKm(p, a, b) <= radiusKm) blocked.add(edge.edgeId);
    }
  }
  return blocked;
}

// ---------------------------------------------------------------------------
// Public API used by the app
// ---------------------------------------------------------------------------

export type ComputedRoute = {
  id: string;
  name: string;
  kind: "primary" | "alternate";
  path: [number, number][];
  lengthKm: number;
  days: number;
  passesThrough: string[];
};

export type Reroute = {
  path: [number, number][];
  /** Rerouted length in km. */
  lengthKm: number;
  /** Rerouted travel time in days. */
  days: number;
  /** Simple distance delta vs the original route, km (positive = longer). */
  extraKm: number;
  /** Time delta vs the original route, days (positive = slower). */
  extraDays: number;
};

/**
 * Reroute a computed path avoiding all edges near any of `avoidChokepoints`
 * (their blocked-edge sets are unioned). Returns null if no water path exists.
 */
export function rerouteAvoidingMany(
  original: SeaPath,
  avoidChokepoints: Chokepoint[],
): Reroute | null {
  if (avoidChokepoints.length === 0) return null;
  const blocked = new Set<string>();
  for (const chokepoint of avoidChokepoints) {
    for (const edgeId of edgesNearChokepoint(chokepoint)) blocked.add(edgeId);
  }
  const first = original.coords[0];
  const last = original.coords[original.coords.length - 1];
  const detour = findSeaPath(first, last, blocked);
  if (!detour) return null;
  return {
    path: detour.coords,
    lengthKm: detour.lengthKm,
    days: detour.days,
    extraKm: detour.lengthKm - original.lengthKm,
    extraDays: detour.days - original.days,
  };
}

/**
 * Reroute a computed path avoiding all edges near `avoidChokepoint`.
 * Returns null if no water path exists without it.
 */
export function rerouteAvoiding(
  original: SeaPath,
  avoidChokepoint: Chokepoint,
): Reroute | null {
  return rerouteAvoidingMany(original, [avoidChokepoint]);
}
