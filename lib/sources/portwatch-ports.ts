/*
 * IMF PortWatch *ports* transit source (server-only).
 *
 * Pulls full daily history (from 2019-01-01) of port calls + estimated
 * import/export volumes for each configured port from the public ArcGIS
 * FeatureServer, paginating 1000 rows at a time. Cached 6 hours in memory and
 * on disk (data/cache/portwatch-ports.json). If the live fetch fails we serve
 * the newest cached file, then the committed snapshot
 * (data/replay/portwatch-ports-snapshot.json).
 *
 * The committed snapshot stores each day as a compact tuple to keep the file
 * small; it is normalised back to objects on read.
 *
 * No API key required. Only ever called from the Next.js API route.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  PORTWATCH_ATTRIBUTION,
  PORTWATCH_PORT_IDS,
  type PortwatchPortDay,
  type PortwatchPortSeries,
  type PortwatchPortsSnapshot,
} from "@/lib/portwatch-map";

const QUERY_URL =
  "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/Daily_Ports_Data/FeatureServer/0/query";

const PAGE_SIZE = 1000;
/** ArcGIS pages are independent: fetch a bounded batch in parallel, not serially. */
const PAGE_CONCURRENCY = 4;
const MAX_OFFSET = 20_000; // hard safety stop
const REQUEST_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Full daily history starts 2019-01-01 in the PortWatch service.
const HISTORY_START = "2019-01-01";

const OUT_FIELDS =
  "date,portid,portname,portcalls,portcalls_container,portcalls_tanker,portcalls_dry_bulk,import,export";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "portwatch-ports.json");
const SNAPSHOT_FILE = path.join(process.cwd(), "data", "replay", "portwatch-ports-snapshot.json");

/** Snapshot without the transport "source" flag. */
type Payload = Omit<PortwatchPortsSnapshot, "source">;

/** Compact on-disk day: [date, portcalls, container, tanker, dryBulk, import, export]. */
type StoredDay = [string, number, number, number, number, number, number];
type StoredSeries = { portid: string; portname: string; days: StoredDay[] };
type StoredPayload = {
  fetchedAt: string;
  latestDate: string | null;
  attribution: string;
  series: Record<string, StoredSeries>;
};

type ArcGISResponse = {
  features?: { attributes?: Record<string, unknown> }[];
  exceededTransferLimit?: boolean;
  error?: { message?: string };
};

let memoryCache: { at: number; payload: Payload } | null = null;

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Round tonnage to the nearest 1000 t (keeps the snapshot compact). */
function roundTons(value: unknown): number {
  return Math.round(toNumber(value) / 1000) * 1000;
}

function toDay(attributes: Record<string, unknown>): PortwatchPortDay {
  return {
    date: String(attributes.date ?? "").slice(0, 10),
    portcalls: toNumber(attributes.portcalls),
    container: toNumber(attributes.portcalls_container),
    tanker: toNumber(attributes.portcalls_tanker),
    dryBulk: toNumber(attributes.portcalls_dry_bulk),
    import: roundTons(attributes["import"]),
    export: roundTons(attributes["export"]),
  };
}

async function queryPage(portid: string, offset: number): Promise<ArcGISResponse> {
  const params = new URLSearchParams({
    f: "json",
    where: `portid='${portid}' AND date >= timestamp '${HISTORY_START} 00:00:00'`,
    outFields: OUT_FIELDS,
    orderByFields: "date ASC",
    returnGeometry: "false",
    resultRecordCount: String(PAGE_SIZE),
    resultOffset: String(offset),
  });

  const response = await fetch(`${QUERY_URL}?${params.toString()}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`PortWatch ports query failed: HTTP ${response.status}`);
  }
  const json = (await response.json()) as ArcGISResponse;
  if (json.error) {
    throw new Error(`PortWatch ports query error: ${json.error.message ?? "unknown"}`);
  }
  return json;
}

async function fetchSeries(portid: string): Promise<PortwatchPortSeries> {
  const days: PortwatchPortDay[] = [];
  let portname = "";

  const collect = (features: { attributes?: Record<string, unknown> }[]) => {
    for (const feature of features) {
      if (!feature.attributes) continue;
      if (!portname && feature.attributes.portname) {
        portname = String(feature.attributes.portname);
      }
      days.push(toDay(feature.attributes));
    }
  };

  // Request up to PAGE_CONCURRENCY pages at once; stop at the first short or
  // empty page (ArcGIS signals "more rows" via exceededTransferLimit).
  let offset = 0;
  for (;;) {
    const offsets: number[] = [];
    for (let i = 0; i < PAGE_CONCURRENCY; i++) {
      const next = offset + i * PAGE_SIZE;
      if (next > MAX_OFFSET) break;
      offsets.push(next);
    }
    if (offsets.length === 0) break;

    const pages = await Promise.all(offsets.map((value) => queryPage(portid, value)));
    let done = false;
    for (const page of pages) {
      const features = page.features ?? [];
      collect(features);
      if (features.length === 0 || (features.length < PAGE_SIZE && !page.exceededTransferLimit)) {
        done = true;
        break;
      }
    }
    if (done) break;
    offset += offsets.length * PAGE_SIZE;
  }

  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { portid, portname, days };
}

/** Fetch every configured port's full history straight from PortWatch. */
export async function fetchLivePortsPayload(): Promise<Payload> {
  const entries = await Promise.all(
    PORTWATCH_PORT_IDS.map(async (portid) => [portid, await fetchSeries(portid)] as const),
  );
  const series: Record<string, PortwatchPortSeries> = {};
  let latestDate: string | null = null;
  for (const [portid, value] of entries) {
    series[portid] = value;
    const last = value.days[value.days.length - 1]?.date ?? null;
    if (last && (latestDate === null || last > latestDate)) latestDate = last;
  }
  return { fetchedAt: new Date().toISOString(), latestDate, series, attribution: PORTWATCH_ATTRIBUTION };
}

function toStored(payload: Payload): StoredPayload {
  const series: Record<string, StoredSeries> = {};
  for (const [portid, value] of Object.entries(payload.series)) {
    series[portid] = {
      portid: value.portid,
      portname: value.portname,
      days: value.days.map((day) => [
        day.date,
        day.portcalls,
        day.container,
        day.tanker,
        day.dryBulk,
        day.import,
        day.export,
      ]),
    };
  }
  return {
    fetchedAt: payload.fetchedAt,
    latestDate: payload.latestDate,
    attribution: payload.attribution,
    series,
  };
}

function fromStored(stored: StoredPayload): Payload {
  const series: Record<string, PortwatchPortSeries> = {};
  for (const [portid, value] of Object.entries(stored.series ?? {})) {
    series[portid] = {
      portid: value.portid,
      portname: value.portname,
      days: (value.days ?? []).map((day) => ({
        date: day[0],
        portcalls: day[1],
        container: day[2],
        tanker: day[3],
        dryBulk: day[4],
        import: day[5],
        export: day[6],
      })),
    };
  }
  return {
    fetchedAt: String(stored.fetchedAt ?? ""),
    latestDate: stored.latestDate ?? null,
    series,
    attribution: stored.attribution ?? PORTWATCH_ATTRIBUTION,
  };
}

async function readPayloadFile(file: string): Promise<Payload | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredPayload>;
    if (!parsed || typeof parsed !== "object" || !parsed.series) return null;
    return fromStored(parsed as StoredPayload);
  } catch {
    return null;
  }
}

async function writePayloadFile(file: string, payload: Payload): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(toStored(payload)), "utf8");
}

function isFresh(payload: Payload): boolean {
  const at = Date.parse(payload.fetchedAt);
  return Number.isFinite(at) && Date.now() - at < CACHE_TTL_MS;
}

/**
 * Main entry point: prefer the 6h cache, then a live fetch, then the last cache
 * on disk, then the committed snapshot.
 */
export async function getPortwatchPortsSnapshot(): Promise<PortwatchPortsSnapshot> {
  if (memoryCache && isFresh(memoryCache.payload)) {
    return { ...memoryCache.payload, source: "cache" };
  }

  const disk = await readPayloadFile(CACHE_FILE);
  if (disk && isFresh(disk)) {
    memoryCache = { at: Date.parse(disk.fetchedAt), payload: disk };
    return { ...disk, source: "cache" };
  }

  try {
    const payload = await fetchLivePortsPayload();
    memoryCache = { at: Date.now(), payload };
    await writePayloadFile(CACHE_FILE, payload);
    return { ...payload, source: "live" };
  } catch (error) {
    const fallback = disk ?? (await readPayloadFile(SNAPSHOT_FILE));
    if (fallback) {
      const source = disk ? "cache" : "snapshot";
      memoryCache = { at: Date.now(), payload: fallback };
      return { ...fallback, source };
    }
    throw error;
  }
}

/** Force a fresh fetch and persist both the disk cache and committed snapshot. */
export async function refreshPortwatchPortsCache(): Promise<PortwatchPortsSnapshot> {
  const payload = await fetchLivePortsPayload();
  memoryCache = { at: Date.now(), payload };
  await writePayloadFile(CACHE_FILE, payload);
  await writePayloadFile(SNAPSHOT_FILE, payload);
  return { ...payload, source: "live" };
}

export const PORTWATCH_PORTS_CACHE_FILE = CACHE_FILE;
export const PORTWATCH_PORTS_SNAPSHOT_FILE = SNAPSHOT_FILE;
