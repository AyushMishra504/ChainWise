import type { Chokepoint } from "@/data/chokepoints";
import type { Port } from "@/data/ports";
import {
  chokepointsOnRoute,
  findSeaPath,
  daysForKm,
  type SeaPath,
} from "@/lib/seaRouting";

export type Route = {
  id: string;
  name: string;
  /** Departure port id (see data/ports.ts). */
  from: string;
  /** Arrival port id (see data/ports.ts). */
  to: string;
  kind: "primary" | "alternate";
};

/*
 * Geometry is computed at runtime by lib/seaRouting.ts (Dijkstra over the
 * searoute-js maritime network); `passesThrough` is derived automatically
 * by proximity (~100 km) — nothing hand-placed here.
 */
export const routes: Route[] = [
  { id: "jnpt-rotterdam", name: "JNPT to Rotterdam", from: "nhava-sheva", to: "rotterdam", kind: "primary" },
  { id: "mundra-rotterdam", name: "Mundra to Rotterdam", from: "mundra", to: "rotterdam", kind: "primary" },
  { id: "chennai-shanghai", name: "Chennai to Shanghai", from: "chennai", to: "shanghai", kind: "primary" },
  { id: "jebel-ali-mundra", name: "Jebel Ali to Mundra", from: "jebel-ali", to: "mundra", kind: "primary" },
  { id: "cochin-singapore", name: "Cochin to Singapore", from: "cochin", to: "singapore", kind: "primary" },
];

export type ComputedRoute = {
  id: string;
  name: string;
  kind: "primary" | "alternate";
  from: string;
  to: string;
  /** Full water path [lng, lat]. */
  path: [number, number][];
  lengthKm: number;
  days: number;
  /** Chokepoint ids the line passes within ~100 km of. */
  passesThrough: string[];
};

export function computeRoute(
  route: Route,
  ports: Port[],
  chokepoints: Chokepoint[],
): ComputedRoute | null {
  const from = ports.find((p) => p.id === route.from);
  const to = ports.find((p) => p.id === route.to);
  if (!from || !to) return null;
  const sea: SeaPath | null = findSeaPath([from.lng, from.lat], [to.lng, to.lat]);
  if (!sea) return null;
  return {
    id: route.id,
    name: route.name,
    kind: route.kind,
    from: route.from,
    to: route.to,
    path: sea.coords,
    lengthKm: sea.lengthKm,
    days: daysForKm(sea.lengthKm),
    passesThrough: chokepointsOnRoute(sea.coords, chokepoints),
  };
}

export function computeAllRoutes(
  routeDefs: Route[],
  ports: Port[],
  chokepoints: Chokepoint[],
): ComputedRoute[] {
  return routeDefs
    .map((r) => computeRoute(r, ports, chokepoints))
    .filter((r): r is ComputedRoute => r !== null);
}
