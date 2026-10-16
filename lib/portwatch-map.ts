/*
 * Shared, dependency-free model for the IMF PortWatch chokepoint transit feed.
 *
 * This file is safe to import from both the server (lib/sources/portwatch.ts)
 * and the browser (components / hooks): it contains only types and constants,
 * no Node built-ins.
 */

/** One day of chokepoint transits as published by IMF PortWatch. */
export type PortwatchDay = {
  /** Calendar date, YYYY-MM-DD (UTC). */
  date: string;
  /** Total vessel transits that day (PortWatch `n_total`). */
  nTotal: number;
};

export type PortwatchSeries = {
  portid: string;
  portname: string;
  /** Ascending by date. */
  days: PortwatchDay[];
};

/**
 * Where a snapshot came from:
 * - "live"     fetched from the ArcGIS service during this request
 * - "cache"    served from the 6h in-memory / on-disk cache
 * - "snapshot" served from the committed demo fallback (live fetch failed)
 */
export type PortwatchSource = "live" | "cache" | "snapshot";

export type PortwatchSnapshot = {
  source: PortwatchSource;
  /** When ChainWise retrieved/assembled the payload (ISO 8601). */
  fetchedAt: string;
  /** Latest date present across all series, YYYY-MM-DD (null when empty). */
  latestDate: string | null;
  /** Keyed by PortWatch portid. */
  series: Record<string, PortwatchSeries>;
  attribution: string;
};

export const PORTWATCH_ATTRIBUTION = "IMF PortWatch";

/** Our chokepoint id -> IMF PortWatch portid. */
export const PORTWATCH_BY_CHOKEPOINT: Record<string, string> = {
  "suez-canal": "chokepoint1",
  "panama-canal": "chokepoint2",
  "bosphorus": "chokepoint3",
  "bab-el-mandeb": "chokepoint4",
  "strait-of-malacca": "chokepoint5",
  "strait-of-hormuz": "chokepoint6",
  "cape-of-good-hope": "chokepoint7",
  "strait-of-gibraltar": "chokepoint8",
  "english-channel": "chokepoint9",
  "taiwan-strait": "chokepoint11",
  "lombok-strait": "chokepoint15",
  "sunda-strait": "chokepoint19",
};

/**
 * Chokepoints we display that have no PortWatch match. Never invent values
 * for these — they render as "no data".
 */
export const PORTWATCH_UNMATCHED_CHOKEPOINTS: string[] = [
  "dardanelles",
  "gulf-of-aden",
  "mozambique-channel",
  "singapore-strait",
];

export const PORTWATCH_PORTIDS: string[] = Object.values(PORTWATCH_BY_CHOKEPOINT);

// ---------------------------------------------------------------------------
// IMF PortWatch *ports* feed (Daily Ports Data)
// ---------------------------------------------------------------------------

/**
 * One day of port activity as published by IMF PortWatch.
 * `portcalls*` are counts of ships entering the port boundary; `import` and
 * `export` are estimated trade volumes in METRIC TONS.
 */
export type PortwatchPortDay = {
  /** Calendar date, YYYY-MM-DD (UTC). */
  date: string;
  /** Total ships entering the port that day (`portcalls`). */
  portcalls: number;
  /** Container ships entering (`portcalls_container`). */
  container: number;
  /** Tankers entering (`portcalls_tanker`). */
  tanker: number;
  /** Dry bulk carriers entering (`portcalls_dry_bulk`). */
  dryBulk: number;
  /** Estimated import volume in metric tons. */
  import: number;
  /** Estimated export volume in metric tons. */
  export: number;
};

export type PortwatchPortSeries = {
  portid: string;
  portname: string;
  /** Ascending by date. */
  days: PortwatchPortDay[];
};

export type PortwatchPortsSnapshot = {
  source: PortwatchSource;
  /** When ChainWise retrieved/assembled the payload (ISO 8601). */
  fetchedAt: string;
  /** Latest date present across all series, YYYY-MM-DD (null when empty). */
  latestDate: string | null;
  /** Keyed by PortWatch portid. */
  series: Record<string, PortwatchPortSeries>;
  attribution: string;
};

/** Our port id (data/ports.ts) -> IMF PortWatch portid. */
export const PORTWATCH_PORT_BY_ID: Record<string, string> = {
  jnpt: "port776",
  mundra: "port777",
  kandla: "port540",
  visakhapatnam: "port1367",
  chennai: "port235",
  haldia: "port442",
  paradip: "port883",
  tuticorin: "port1331",
  hazira: "port2039",
  "new-mangalore": "port811",
  cochin: "port583",
  krishnapatnam: "port599",
  pipavav: "port907",
  kolkata: "port207",
  mormugao: "port709",
  sikka: "port1199",
  vizhinjam: "port2150",
  shanghai: "port1188",
  singapore: "port1201",
  "jebel-ali": "port744",
  rotterdam: "port1114",
  "new-york": "port815",
  "ras-tanura": "port1091",
  novorossiysk: "port833",
};

export const PORTWATCH_PORT_IDS: string[] = Object.values(PORTWATCH_PORT_BY_ID);
