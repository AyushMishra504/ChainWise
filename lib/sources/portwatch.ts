/*
 * IMF PortWatch chokepoint transit source (server-only).
 *
 * Pulls the full daily history (from 2019-01-01) of vessel transits for each
 * PortWatch-matched chokepoint from the public ArcGIS FeatureServer,
 * paginating 1000 rows at a time. Results are cached for 6 hours in memory and
 * on disk (data/cache/portwatch.json). If the live fetch fails we serve the
 * newest cached file, and failing that the committed demo snapshot
 * (data/replay/portwatch-snapshot.json).
 *
 * No API key required. Only ever called from the Next.js API route, never the
 * browser.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  PORTWATCH_ATTRIBUTION,
  PORTWATCH_PORTIDS,
  type PortwatchDay,
  type PortwatchSeries,
  type PortwatchSnapshot,
} from "@/lib/portwatch-map";

const QUERY_URL =
  "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";

const PAGE_SIZE = 1000;
/** ArcGIS pages are independent: fetch a bounded batch in parallel, not serially. */
const PAGE_CONCURRENCY = 4;
const MAX_OFFSET = 20_000; // hard safety stop
const REQUEST_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Full daily history starts 2019-01-01 in the PortWatch service.
const HISTORY_START = "2019-01-01";

const OUT_FIELDS = "date,portid,portname,n_total";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "portwatch.json");
const SNAPSHOT_FILE = path.join(process.cwd(), "data", "replay", "portwatch-snapshot.json");

/** Snapshot without the transport "source" flag. */
type Payload = Omit<PortwatchSnapshot, "source">;

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

function toDay(attributes: Record<string, unknown>): PortwatchDay {
  return {
    date: String(attributes.date ?? "").slice(0, 10),
    nTotal: toNumber(attributes.n_total),
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
    throw new Error(`PortWatch query failed: HTTP ${response.status}`);
  }
  const json = (await response.json()) as ArcGISResponse;
  if (json.error) {
    throw new Error(`PortWatch query error: ${json.error.message ?? "unknown"}`);
  }
  return json;
}

async function fetchSeries(portid: string): Promise<PortwatchSeries> {
  const days: PortwatchDay[] = [];
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

/** Fetch every matched chokepoint's full history straight from PortWatch. */
export async function fetchLivePayload(): Promise<Payload> {
  const entries = await Promise.all(
    PORTWATCH_PORTIDS.map(async (portid) => [portid, await fetchSeries(portid)] as const),
  );
  const series: Record<string, PortwatchSeries> = {};
  let latestDate: string | null = null;
  for (const [portid, value] of entries) {
    series[portid] = value;
    const last = value.days[value.days.length - 1]?.date ?? null;
    if (last && (latestDate === null || last > latestDate)) latestDate = last;
  }
  return { fetchedAt: new Date().toISOString(), latestDate, series, attribution: PORTWATCH_ATTRIBUTION };
}

async function readPayloadFile(file: string): Promise<Payload | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as ParceledPayload;
    if (!parsed || typeof parsed !== "object" || !parsed.series) return null;
    return {
      fetchedAt: String(parsed.fetchedAt ?? ""),
      latestDate: parsed.latestDate ?? null,
      series: parsed.series,
      attribution: parsed.attribution ?? PORTWATCH_ATTRIBUTION,
    };
  } catch {
    return null;
  }
}

type ParceledPayload = Partial<Payload> & { series?: Record<string, PortwatchSeries> };

async function writeCacheFile(payload: Payload): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(payload), "utf8");
  } catch {
    // Disk cache is best-effort (e.g. read-only fs); never fail the request.
  }
}

function isFresh(payload: Payload): boolean {
  const at = Date.parse(payload.fetchedAt);
  return Number.isFinite(at) && Date.now() - at < CACHE_TTL_MS;
}

/**
 * Main entry point: return a snapshot, preferring the 6h cache, then a live
 * fetch, then the last cache on disk, then the committed demo snapshot.
 */
export async function getPortwatchSnapshot(): Promise<PortwatchSnapshot> {
  if (memoryCache && isFresh(memoryCache.payload)) {
    return { ...memoryCache.payload, source: "cache" };
  }

  const disk = await readPayloadFile(CACHE_FILE);
  if (disk && isFresh(disk)) {
    memoryCache = { at: Date.parse(disk.fetchedAt), payload: disk };
    return { ...disk, source: "cache" };
  }

  try {
    const payload = await fetchLivePayload();
    memoryCache = { at: Date.now(), payload };
    await writeCacheFile(payload);
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

/** Force a fresh fetch (bypasses cache) and persist it. Used to build the committed snapshot. */
export async function refreshPortwatchCache(): Promise<PortwatchSnapshot> {
  const payload = await fetchLivePayload();
  memoryCache = { at: Date.now(), payload };
  await writeCacheFile(payload);
  await fs.mkdir(path.dirname(SNAPSHOT_FILE), { recursive: true });
  await fs.writeFile(SNAPSHOT_FILE, JSON.stringify(payload, null, 2), "utf8");
  return { ...payload, source: "live" };
}

export const PORTWATCH_CACHE_FILE = CACHE_FILE;
export const PORTWATCH_SNAPSHOT_FILE = SNAPSHOT_FILE;
