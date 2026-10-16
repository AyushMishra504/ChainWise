import type { Chokepoint } from "@/data/chokepoints";
import type { Port } from "@/data/ports";
import {
  chokepointsOnRoute,
  findSeaPath,
  type SeaPath,
} from "@/lib/seaRouting";

/** Trade lanes shown in the left-panel filter. */
export type Lane = "Europe" | "Americas" | "Gulf energy" | "East Asia" | "Russia" | "Gulf trade";

export const LANES: Lane[] = [
  "Europe",
  "Americas",
  "Gulf energy",
  "East Asia",
  "Russia",
  "Gulf trade",
];

export type Route = {
  id: string;
  name: string;
  /** Departure port id (see data/ports.ts). */
  from: string;
  /** Arrival port id (see data/ports.ts). */
  to: string;
  kind: "primary" | "alternate";
  lane: Lane;
};

/*
 * Geometry is computed at runtime by lib/seaRouting.ts (Dijkstra over the
 * searoute-js maritime network); `passesThrough` is derived automatically
 * by proximity (~100 km) — nothing hand-placed here.
 */
export const routes: Route[] = [
  { id: "jnpt-rotterdam", name: "JNPT to Rotterdam", from: "jnpt", to: "rotterdam", kind: "primary", lane: "Europe" },
  { id: "mundra-rotterdam", name: "Mundra to Rotterdam", from: "mundra", to: "rotterdam", kind: "primary", lane: "Europe" },
  { id: "chennai-shanghai", name: "Chennai to Shanghai", from: "chennai", to: "shanghai", kind: "primary", lane: "East Asia" },
  { id: "jebel-ali-mundra", name: "Jebel Ali to Mundra", from: "jebel-ali", to: "mundra", kind: "primary", lane: "Gulf trade" },
  { id: "cochin-singapore", name: "Cochin to Singapore", from: "cochin", to: "singapore", kind: "primary", lane: "East Asia" },
  { id: "mundra-new-york", name: "Mundra to New York / New Jersey", from: "mundra", to: "new-york", kind: "primary", lane: "Americas" },
  { id: "ras-tanura-sikka", name: "Ras Tanura to Sikka", from: "ras-tanura", to: "sikka", kind: "primary", lane: "Gulf energy" },
  { id: "novorossiysk-sikka", name: "Novorossiysk to Sikka", from: "novorossiysk", to: "sikka", kind: "primary", lane: "Russia" },
];

/**
 * Lane "why it matters" lines. Text uses ONLY the sourced facts supplied for
 * this build; `source`/`period` are shown as a small line beneath.
 */
export type RouteFact = {
  why: string;
  source: string;
  period: string | null;
};

const LANE_FACTS: Partial<Record<Lane, RouteFact>> = {
  Europe: {
    why: "About 23% of India's exports go to Europe; the Suez Canal saves about 15 days versus the Cape route.",
    source: "ChainWise trade brief",
    period: null,
  },
  Americas: {
    why: "The US is India's largest export market (about $52B, Apr–Oct 2025).",
    source: "ChainWise trade brief",
    period: "Apr–Oct 2025",
  },
  "Gulf energy": {
    why: "About 40% of India's crude imports come from the Middle East.",
    source: "ChainWise trade brief",
    period: null,
  },
  "East Asia": {
    why: "China is India's largest import source (about $74B, Apr–Oct 2025).",
    source: "ChainWise trade brief",
    period: "Apr–Oct 2025",
  },
  Russia: {
    why: "Russia is among India's top 3 import sources (about $36B, Apr–Oct 2025).",
    source: "ChainWise trade brief",
    period: "Apr–Oct 2025",
  },
};

export type ComputedRoute = {
  id: string;
  name: string;
  kind: "primary" | "alternate";
  lane: Lane;
  from: string;
  to: string;
  /** Full water path [lng, lat]. */
  path: [number, number][];
  lengthKm: number;
  days: number;
  /** Chokepoint ids the line passes within ~100 km of. */
  passesThrough: string[];
  /** Lane "why it matters" fact (null when the lane has no sourced fact). */
  fact: RouteFact | null;
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
    lane: route.lane,
    from: route.from,
    to: route.to,
    path: sea.coords,
    lengthKm: sea.lengthKm,
    days: sea.days,
    passesThrough: chokepointsOnRoute(sea.coords, chokepoints),
    fact: LANE_FACTS[route.lane] ?? null,
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
