/*
 * Port-level analysis: runs the shared disruption engine on a port's daily
 * `portcalls`, and derives import/export trends. Pure; shared by the hook and
 * the UI.
 */

import type { PortwatchPortDay, PortwatchPortsSnapshot } from "../portwatch-map.ts";
import { PORTWATCH_PORT_BY_ID } from "../portwatch-map.ts";
import {
  computeFromSeries,
  computeSortedFromSeries,
  PORT_SERIES_OPTIONS,
  RECENT_DAYS,
  BASELINE_MIN_AGE_DAYS,
  BASELINE_MAX_AGE_DAYS,
  type DisruptionResult,
  type TransitPoint,
} from "./disruption.ts";
import { prepareDense, denseEnd, denseMedian, denseTailMean, type DenseSeries } from './dense.ts';

export type PortPoint = {
  date: string;
  portcalls: number;
  container: number;
  tanker: number;
  dryBulk: number;
  /** Estimated import volume in metric tons. */
  import: number;
  /** Estimated export volume in metric tons. */
  export: number;
};

export type MetricTrend = {
  recent: number | null;
  baseline: number | null;
  changePct: number | null;
};

export type PortAnalysis = {
  portid: string;
  portname: string;
  /** Portcalls status via the shared engine (structural = year-earlier window). */
  disruption: DisruptionResult;
  /** Ascending daily breakdown up to the as-of date, for charting. */
  series: PortPoint[];
  /** Import volume trend (metric tons). */
  importTrend: MetricTrend;
  /** Export volume trend (metric tons). */
  exportTrend: MetricTrend;
};

/** Shared empty breakdown for ports whose series was not requested. */
const EMPTY_POINTS: PortPoint[] = [];

/**
 * Frozen no-data result for ports without a PortWatch feed. Hoisted so the
 * per-tick bulk path never re-runs the engine for every missing port; callers
 * spread it to attach the requested port's own id.
 */
export const PORT_ANALYSIS_NO_DATA: PortAnalysis = Object.freeze({
  portid: "",
  portname: "",
  disruption: computeFromSeries([], PORT_SERIES_OPTIONS),
  series: EMPTY_POINTS,
  importTrend: { recent: null, baseline: null, changePct: null },
  exportTrend: { recent: null, baseline: null, changePct: null },
});

type PreparedPortSeries = {
  points: PortPoint[];
  transit: TransitPoint[];
  imports: DenseSeries;
  exports: DenseSeries;
};

const preparedSeriesCache = new WeakMap<PortwatchPortDay[], PreparedPortSeries>();

function preparedSeries(days: PortwatchPortDay[]): PreparedPortSeries {
  const cached = preparedSeriesCache.get(days);
  if (cached) return cached;
  // PortWatch data is fetched with date ASC; convert it only once per feed.
  const points = days.map((day) => ({
    date: day.date,
    portcalls: day.portcalls,
    container: day.container,
    tanker: day.tanker,
    dryBulk: day.dryBulk,
    import: day.import,
    export: day.export,
  }));
  const prepared = {
    points,
    transit: points.map((point) => ({ date: point.date, total: point.portcalls })),
    imports: prepareDense(points.map(p => ({date:p.date,total:p.import}))),
    exports: prepareDense(points.map(p => ({date:p.date,total:p.export}))),
  };
  preparedSeriesCache.set(days, prepared);
  return prepared;
}

function endIndexAt(series: PortPoint[], asOf?: string): number {
  if (!asOf) return series.length;
  let low = 0;
  let high = series.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (series[mid].date <= asOf) low = mid + 1;
    else high = mid;
  }
  return low;
}

function metricTrend(data: DenseSeries, asOf?: string): MetricTrend {
  const end = denseEnd(data, asOf);
  if (!end) return { recent: null, baseline: null, changePct: null };
  const day = data.days[end-1];
  const recent = denseTailMean(data,end,RECENT_DAYS);
  const baseline = denseMedian(data, day-BASELINE_MAX_AGE_DAYS, day-BASELINE_MIN_AGE_DAYS);
  const changePct =
    baseline !== null && baseline > 0 && recent !== null ? (recent - baseline) / baseline : null;
  return { recent, baseline, changePct };
}

/**
 * Analyze one port's daily series, optionally as of a replay date.
 * `includeSeries` defaults to false: the daily breakdown is a chart input that
 * only the selected port needs, and slicing it for all 24 ports every tick is
 * wasted work.
 */
export function analyzePort(
  portid: string,
  portname: string,
  days: PortwatchPortDay[],
  asOf?: string,
  includeSeries = false,
): PortAnalysis {
  const prepared = preparedSeries(days);
  const series = includeSeries ? prepared.points.slice(0, endIndexAt(prepared.points, asOf)) : EMPTY_POINTS;
  const disruption = computeSortedFromSeries(prepared.transit, PORT_SERIES_OPTIONS, asOf, includeSeries);

  return {
    portid,
    portname,
    disruption,
    series,
    importTrend: metricTrend(prepared.imports, asOf),
    exportTrend: metricTrend(prepared.exports, asOf),
  };
}

/** Analysis for every supplied *our* port id. Missing feeds become no-data. */
export function analyzePorts(
  snapshot: PortwatchPortsSnapshot,
  portIds: string[],
  asOf?: string,
  includeSeries = false,
): Record<string, PortAnalysis> {
  const out: Record<string, PortAnalysis> = {};
  for (const id of portIds) {
    const portid = PORTWATCH_PORT_BY_ID[id];
    const feed = portid ? snapshot.series[portid] : undefined;
    out[id] = feed
      ? analyzePort(feed.portid, feed.portname, feed.days, asOf, includeSeries)
      : { ...PORT_ANALYSIS_NO_DATA, portid: portid ?? id };
  }
  return out;
}
