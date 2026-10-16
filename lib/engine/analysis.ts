/*
 * Pure helpers that turn a PortWatch snapshot into per-chokepoint disruption
 * results for the risk monitor.
 */

import {
  PORTWATCH_BY_CHOKEPOINT,
  type PortwatchSnapshot,
} from "../portwatch-map.ts";
import {
  CHOKEPOINT_SERIES_OPTIONS,
  computeSortedFromSeries,
  type DisruptionResult,
  type TransitPoint,
} from "./disruption.ts";

const NO_DATA: DisruptionResult = {
  status: "no-data",
  displayStatus: "no-data",
  baseline: null,
  recent: null,
  changePct: null,
  structuralPct: null,
  structuralRecent: null,
  structuralReference: null,
  structuralLabel: "2023",
  latestDate: null,
  series: [],
};

/** Disruption results keyed by *our* chokepoint id. */
export type ChokepointAnalysis = Record<string, DisruptionResult>;

const pointsCache = new WeakMap<PortwatchSnapshot, Map<string, TransitPoint[]>>();

function sortedPointsFor(snapshot: PortwatchSnapshot, portid: string): TransitPoint[] | null {
  let byPort = pointsCache.get(snapshot);
  if (!byPort) {
    byPort = new Map();
    pointsCache.set(snapshot, byPort);
  }
  const cached = byPort.get(portid);
  if (cached) return cached;
  const days = snapshot.series[portid]?.days;
  if (!days) return null;
  // PortWatch feeds are fetched in ascending date order and snapshots retain it.
  const points = days.map((day) => ({ date: day.date, total: day.nTotal }));
  byPort.set(portid, points);
  return points;
}

/**
 * Compute a result for every supplied chokepoint id. Ids without a PortWatch
 * match (or with no rows) become "no-data" — never invented. Pass `asOf` to
 * evaluate historical replay dates with the same pure engine.
 *
 * Bulk callers leave `includeSeries` false: the daily series is only needed for
 * a single selected chokepoint, and slicing it for all of them every replay
 * tick dominated the frame.
 */
export function analyzeSnapshot(
  snapshot: PortwatchSnapshot,
  chokepointIds: string[],
  asOf?: string,
  includeSeries = false,
): ChokepointAnalysis {
  const result: ChokepointAnalysis = {};
  for (const id of chokepointIds) {
    const portid = PORTWATCH_BY_CHOKEPOINT[id];
    const points = portid ? sortedPointsFor(snapshot, portid) : null;
    result[id] = points ? computeSortedFromSeries(points, CHOKEPOINT_SERIES_OPTIONS, asOf, includeSeries) : { ...NO_DATA };
  }
  return result;
}

export { NO_DATA };
