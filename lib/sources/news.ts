/*
 * Trade-news RSS source (server-only).
 *
 * Polls the verified trade-press feeds, parses RSS 2.0 into lightweight items
 * (title, link, date, source, short feed summary — never full article text),
 * and keeps a rolling deduped log so news history builds up over time.
 *
 * Caching mirrors lib/sources/portwatch-ports.ts: a fresh 30-minute cache is
 * served without touching the network; otherwise a live fetch is attempted, then
 * the on-disk cache, then the committed snapshot (data/replay/news-snapshot.json).
 *
 * Only ever called from the Next.js API route.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  NEWS_ATTRIBUTION,
  NEWS_FEEDS,
  type NewsFeed,
  type NewsFeedStatus,
  type NewsItem,
  type NewsSnapshot,
} from "@/data/news-feeds";

const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const LOG_RETENTION_DAYS = 90;
const LOG_MAX_ITEMS = 2000;
const DESCRIPTION_MAX = 280;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "news.json");
const LOG_FILE = path.join(CACHE_DIR, "news-log.json");
const SNAPSHOT_FILE = path.join(process.cwd(), "data", "replay", "news-snapshot.json");

/** Snapshot without the transport "source" flag. */
type Payload = Omit<NewsSnapshot, "source">;

let memoryCache: { at: number; payload: Payload } | null = null;

// ---------------------------------------------------------------------------
// RSS parsing
// ---------------------------------------------------------------------------

function decodeEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(Number(dec)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&hellip;/gi, "…")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–");
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function stripTags(input: string): string {
  return input.replace(/<[^>]*>/g, " ");
}

function cleanText(input: string, max = DESCRIPTION_MAX): string {
  const text = stripTags(decodeEntities(input)).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function tagText(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return match ? match[1] : null;
}

function parseItemDate(raw: string | null): string {
  const fallback = new Date().toISOString().slice(0, 10);
  if (!raw) return fallback;
  const parsed = Date.parse(decodeEntities(raw).trim());
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : fallback;
}

/** Extract items from an RSS 2.0 document. Tolerant of CDATA and entities. */
export function parseRss(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks) {
    const titleRaw = tagText(block, "title");
    const linkRaw = tagText(block, "link");
    const title = titleRaw ? cleanText(titleRaw, 400) : "";
    const link = linkRaw ? decodeEntities(linkRaw).trim() : "";
    if (!title || !link) continue;
    const descRaw = tagText(block, "description") ?? tagText(block, "content:encoded");
    items.push({
      title,
      link,
      date: parseItemDate(tagText(block, "pubDate")),
      source,
      description: descRaw ? cleanText(descRaw) : "",
    });
  }
  return items;
}

async function fetchFeed(feed: NewsFeed): Promise<{ status: NewsFeedStatus; items: NewsItem[] }> {
  const base: NewsFeedStatus = { id: feed.id, name: feed.name, url: feed.url, ok: false, items: 0, error: null };
  try {
    const response = await fetch(feed.url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/xml, text/xml, */*" },
    });
    if (!response.ok) return { status: { ...base, error: `HTTP ${response.status}` }, items: [] };
    const xml = await response.text();
    const items = parseRss(xml, feed.name);
    if (items.length === 0) return { status: { ...base, error: "no items" }, items: [] };
    return { status: { ...base, ok: true, items: items.length }, items };
  } catch (error) {
    return { status: { ...base, error: error instanceof Error ? error.message : String(error) }, items: [] };
  }
}

// ---------------------------------------------------------------------------
// Dedupe / rolling log
// ---------------------------------------------------------------------------

function dedupeByLink(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of items) {
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    out.push(item);
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function pruneLog(items: NewsItem[]): NewsItem[] {
  const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
  return dedupeByLink(items.filter((item) => item.date >= cutoff)).slice(0, LOG_MAX_ITEMS);
}

async function readLog(): Promise<NewsItem[]> {
  try {
    const raw = await fs.readFile(LOG_FILE, "utf8");
    const parsed = JSON.parse(raw) as NewsItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendLog(items: NewsItem[]): Promise<NewsItem[]> {
  const merged = pruneLog([...items, ...(await readLog())]);
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify(merged), "utf8");
  return merged;
}

// ---------------------------------------------------------------------------
// Fetch + cache
// ---------------------------------------------------------------------------

/** Fetch every feed in parallel and merge into one deduped payload. */
export async function fetchLiveNews(): Promise<Payload> {
  const results = await Promise.all(NEWS_FEEDS.map((feed) => fetchFeed(feed)));
  const items = dedupeByLink(results.flatMap((result) => result.items));
  const statuses = results.map((result) => result.status);
  if (items.length === 0) {
    const failures = statuses
      .map((status) => `${status.name}: ${status.error ?? "no items"}`)
      .join("; ");
    throw new Error(`No trade-news feeds returned usable items (${failures})`);
  }
  return {
    fetchedAt: new Date().toISOString(),
    items,
    feeds: statuses,
    attribution: NEWS_ATTRIBUTION,
  };
}

async function readPayloadFile(file: string): Promise<Payload | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<Payload>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) return null;
    return {
      fetchedAt: typeof parsed.fetchedAt === "string" ? parsed.fetchedAt : null,
      items: parsed.items as NewsItem[],
      feeds: Array.isArray(parsed.feeds) ? (parsed.feeds as NewsFeedStatus[]) : [],
      attribution: parsed.attribution ?? NEWS_ATTRIBUTION,
    };
  } catch {
    return null;
  }
}

async function writePayloadFile(file: string, payload: Payload): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(payload), "utf8");
}

function isFresh(payload: Payload): boolean {
  const at = payload.fetchedAt ? Date.parse(payload.fetchedAt) : NaN;
  return Number.isFinite(at) && Date.now() - at < CACHE_TTL_MS;
}

function hasUsableItems(payload: Payload): boolean {
  return payload.items.length > 0;
}

function emptyPayload(): Payload {
  return {
    fetchedAt: null,
    items: [],
    feeds: NEWS_FEEDS.map((feed) => ({ id: feed.id, name: feed.name, url: feed.url, ok: false, items: 0, error: null })),
    attribution: NEWS_ATTRIBUTION,
  };
}

/**
 * Main entry point: fresh 30-minute cache, else a live fetch (which also updates
 * the rolling log), else the stale on-disk cache, else the committed snapshot.
 */
export async function getNewsSnapshot(): Promise<NewsSnapshot> {
  if (memoryCache && isFresh(memoryCache.payload) && hasUsableItems(memoryCache.payload)) {
    return { ...memoryCache.payload, source: "cache" };
  }

  const disk = await readPayloadFile(CACHE_FILE);
  if (disk && isFresh(disk) && hasUsableItems(disk)) {
    memoryCache = { at: Date.parse(disk.fetchedAt!), payload: disk };
    return { ...disk, source: "cache" };
  }

  try {
    const live = await fetchLiveNews();
    // Serve history when it exists; merge this fetch into the rolling log.
    const logged = await appendLog(live.items);
    const payload: Payload = { ...live, items: logged.length > 0 ? logged : live.items };
    memoryCache = { at: Date.now(), payload };
    await writePayloadFile(CACHE_FILE, payload);
    return { ...payload, source: "live" };
  } catch {
    const fallback = disk ?? (await readPayloadFile(SNAPSHOT_FILE));
    if (fallback) {
      memoryCache = { at: Date.now(), payload: fallback };
      return { ...fallback, source: disk ? "cache" : "snapshot" };
    }
    return { ...emptyPayload(), source: "snapshot" };
  }
}

/** Force a fresh fetch and persist the disk cache, rolling log and committed snapshot. */
export async function refreshNewsSnapshot(): Promise<NewsSnapshot> {
  const live = await fetchLiveNews();
  const logged = await appendLog(live.items);
  const payload: Payload = { ...live, items: logged.length > 0 ? logged : live.items };
  memoryCache = { at: Date.now(), payload };
  await writePayloadFile(CACHE_FILE, payload);
  await writePayloadFile(SNAPSHOT_FILE, payload);
  return { ...payload, source: "live" };
}

export const NEWS_CACHE_FILE = CACHE_FILE;
export const NEWS_LOG_FILE = LOG_FILE;
export const NEWS_SNAPSHOT_FILE = SNAPSHOT_FILE;