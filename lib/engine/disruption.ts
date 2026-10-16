/*
 * Pure disruption detection for a daily series of counts.
 *
 * Two independent measures:
 *  - short-term: last 7 days vs a 90-day baseline (median of days 8..90 back)
 *  - structural: last 30 days vs a reference window, either
 *      "calendar-year"  (chokepoints: vs calendar year 2023), or
 *      "year-ago-window" (ports: vs the same 30-day window one year earlier,
 *       which also cancels out seasonality)
 *
 * The display status is the short-term status, a low-volume guard, or a
 * structural overlay for sustained declines.
 *
 * The same core (computeFromSeries) powers both chokepoints and ports; the two
 * public wrappers only differ in the options they pass. Pure, no I/O.
 */

import type { PortwatchDay } from "../portwatch-map.ts";
import { daysBetween } from "./dates.ts";
import { prepareDense, denseEnd, denseMean, denseMedian, denseTailMean, quickSelectMedian, scratchBuffer, type DenseSeries } from './dense.ts';

export type DisruptionStatus = "normal" | "watch" | "disrupted" | "low-volume" | "no-data";

/** Short-term status plus long-term structural overlays. */
export type DisplayStatus = DisruptionStatus | "structurally-down" | "severely-disrupted";

export type TransitPoint = { date: string; total: number };

export type DisruptionResult = {
  /** Short-term status (last 7 days vs 90-day baseline). */
  status: DisruptionStatus;
  /** What the UI should colour by (may be "structurally-down"). */
  displayStatus: DisplayStatus;
  /** Median daily value over the baseline window (null if unavailable). */
  baseline: number | null;
  /** Mean daily value over the last 7 days. */
  recent: number | null;
  /** (recent - baseline) / baseline; null if not computable. */
  changePct: number | null;
  /** (mean last 30 days - reference mean) / reference mean; null if not computable. */
  structuralPct: number | null;
  /** Mean daily value over the last 30 days. */
  structuralRecent: number | null;
  /** Mean daily value over the structural reference window. */
  structuralReference: number | null;
  /** Human label for the reference basis, e.g. "2023" or "year-earlier". */
  structuralLabel: string;
  /** As-of date (latest date used). */
  latestDate: string | null;
  /** Ascending daily series up to the as-of date, for charting. */
  series: TransitPoint[];
};

export const RECENT_DAYS = 7;
export const BASELINE_MIN_AGE_DAYS = 8;
export const BASELINE_MAX_AGE_DAYS = 90;
export const STRUCTURAL_DAYS = 30;
export const STRUCTURAL_YEAR = 2023;
/** Baselines below this are too sparse for percentage-based alerting. */
export const LOW_VOLUME_THRESHOLD = 3;

/** change% at/below this is at least "watch" (i.e. -15%). */
export const WATCH_THRESHOLD = -0.15;
/** change% strictly below this is "disrupted" (i.e. below -30%). */
export const DISRUPTED_THRESHOLD = -0.3;
/** structural% strictly below this is "structurally down". */
export const STRUCTURAL_THRESHOLD = -0.3;
/** structural% strictly below this is a severe sustained decline. */
export const SEVERE_STRUCTURAL_THRESHOLD = -0.8;
/** Need at least this much history before a structural measure is meaningful. */
export const MIN_HISTORY_DAYS = 365;

export type StructuralOptions =
  | { mode: "calendar-year"; year: number }
  | { mode: "year-ago-window" };

export type SeriesOptions = {
  recentDays: number;
  baselineMinAgeDays: number;
  baselineMaxAgeDays: number;
  structuralDays: number;
  structural: StructuralOptions;
  minHistoryDays: number;
};

/** Chokepoint series: structural vs calendar year 2023. */
export const CHOKEPOINT_SERIES_OPTIONS: SeriesOptions = {
  recentDays: RECENT_DAYS,
  baselineMinAgeDays: BASELINE_MIN_AGE_DAYS,
  baselineMaxAgeDays: BASELINE_MAX_AGE_DAYS,
  structuralDays: STRUCTURAL_DAYS,
  structural: { mode: "calendar-year", year: STRUCTURAL_YEAR },
  minHistoryDays: MIN_HISTORY_DAYS,
};

/** Port series: structural vs the same 30-day window one year earlier. */
export const PORT_SERIES_OPTIONS: SeriesOptions = {
  recentDays: RECENT_DAYS,
  baselineMinAgeDays: BASELINE_MIN_AGE_DAYS,
  baselineMaxAgeDays: BASELINE_MAX_AGE_DAYS,
  structuralDays: STRUCTURAL_DAYS,
  structural: { mode: "year-ago-window" },
  minHistoryDays: MIN_HISTORY_DAYS,
};

/** Median via quickselect on a reused buffer — no copy-and-sort per call. */
export function median(values: number[]): number | null {
  const length = values.length;
  if (length === 0) return null;
  const buffer = scratchBuffer(length);
  for (let i = 0; i < length; i++) buffer[i] = values[i];
  return quickSelectMedian(buffer, length);
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Map a fractional change to a short-term status bucket. */
export function statusFor(changePct: number): DisruptionStatus {
  if (changePct < DISRUPTED_THRESHOLD) return "disrupted";
  if (changePct <= WATCH_THRESHOLD) return "watch";
  return "normal";
}

/** Overlay the structural decline on top of the short-term status. */
export function displayStatusFor(status: DisruptionStatus, structuralPct: number | null): DisplayStatus {
  if (status === "low-volume" || status === "no-data") return status;
  if (structuralPct !== null && structuralPct < SEVERE_STRUCTURAL_THRESHOLD) return "severely-disrupted";
  if (status === "disrupted" || status === "watch") return status;
  if (structuralPct !== null && structuralPct < STRUCTURAL_THRESHOLD) return "structurally-down";
  return status;
}

function structuralLabelFor(structural: StructuralOptions): string {
  return structural.mode === "calendar-year" ? String(structural.year) : "year-earlier";
}

/** The dates at which the structural reference window sits, as an age span. */
function referenceAgeSpan(latestDate: string, options: SeriesOptions): [number, number] | null {
  if (options.structural.mode === "calendar-year") return null;
  const yearAgo = `${Number(latestDate.slice(0, 4)) - 1}${latestDate.slice(4)}`;
  const ageStart = daysBetween(yearAgo, latestDate);
  return [ageStart, ageStart + options.structuralDays - 1];
}

function emptyResult(options: SeriesOptions): DisruptionResult {
  return {
    status: "no-data",
    displayStatus: "no-data",
    baseline: null,
    recent: null,
    changePct: null,
    structuralPct: null,
    structuralRecent: null,
    structuralReference: null,
    structuralLabel: structuralLabelFor(options.structural),
    latestDate: null,
    series: [],
  };
}

/** Index immediately after the latest point at or before `asOf`. */
function endIndexAt(points: TransitPoint[], asOf?: string): number {
  if (!asOf) return points.length;
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].date <= asOf) low = mid + 1;
    else high = mid;
  }
  return low;
}

function computePreparedSeries(
  all: TransitPoint[],
  options: SeriesOptions,
  asOf?: string,
): DisruptionResult {
  const series = all.slice(0, endIndexAt(all, asOf));
  if (series.length === 0) return emptyResult(options);

  const latestDate = series[series.length - 1].date;
  const recent = mean(series.slice(-options.recentDays).map((point) => point.total));

  const baselineValues = series
    .filter((point) => {
      const age = daysBetween(point.date, latestDate);
      return age >= options.baselineMinAgeDays && age <= options.baselineMaxAgeDays;
    })
    .map((point) => point.total);
  const baseline = median(baselineValues);

  const spanDays = daysBetween(series[0].date, latestDate);
  const structuralRecent = mean(
    series.slice(-options.structuralDays).map((point) => point.total),
  );

  let referenceValues: number[];
  if (options.structural.mode === "calendar-year") {
    const prefix = `${options.structural.year}-`;
    referenceValues = series
      .filter((point) => point.date.startsWith(prefix))
      .map((point) => point.total);
  } else {
    const span = referenceAgeSpan(latestDate, options);
    referenceValues = span
      ? series
          .filter((point) => {
            const age = daysBetween(point.date, latestDate);
            return age >= span[0] && age <= span[1];
          })
          .map((point) => point.total)
      : [];
  }
  const structuralReference = mean(referenceValues);

  let structuralPct: number | null = null;
  if (
    structuralReference !== null &&
    structuralReference > 0 &&
    structuralRecent !== null &&
    spanDays >= options.minHistoryDays
  ) {
    structuralPct = (structuralRecent - structuralReference) / structuralReference;
  }

  const base = {
    baseline,
    recent,
    structuralPct,
    structuralRecent,
    structuralReference,
    structuralLabel: structuralLabelFor(options.structural),
    latestDate,
    series,
  };

  return finishResult(base);
}

/** Shared classification: both reference and dense engines use exactly these rules. */
function finishResult(base: Omit<DisruptionResult, 'status' | 'displayStatus' | 'changePct'>): DisruptionResult {
  const { baseline, recent, structuralPct } = base;

  if (baseline === null) {
    return { ...base, status: "no-data", displayStatus: displayStatusFor("no-data", structuralPct), changePct: null };
  }

  if (baseline < LOW_VOLUME_THRESHOLD) {
    const changePct = baseline > 0 ? ((recent ?? 0) - baseline) / baseline : null;
    return { ...base, status: "low-volume", displayStatus: "low-volume", changePct };
  }

  const changePct = ((recent ?? 0) - baseline) / baseline;
  const status = statusFor(changePct);
  return { ...base, status, displayStatus: displayStatusFor(status, structuralPct), changePct };
}

/**
 * Fast path for immutable, ascending PortWatch series. Avoids repeated sorts
 * during replay while preserving `computeFromSeries` for arbitrary input.
 *
 * `includeSeries` defaults to true so the reference cross-checks keep comparing
 * the full result; bulk callers pass false to skip the per-id series slice.
 */
export function computeSortedFromSeries(
  points: TransitPoint[],
  options: SeriesOptions,
  asOf?: string,
  includeSeries = true,
): DisruptionResult {
  let dense = denseCache.get(points);
  if (!dense) {
    dense = prepareDense(points);
    denseCache.set(points, dense);
  }
  return computeDenseSeries(dense, options, asOf, includeSeries);
}

const denseCache = new WeakMap<TransitPoint[], DenseSeries>();

/** Shared empty series for results that are not asked to carry one. */
const EMPTY_SERIES: TransitPoint[] = [];

export function computeDenseSeries(
  data: DenseSeries,
  options: SeriesOptions,
  asOf?: string,
  includeSeries = true,
): DisruptionResult {
  const end = denseEnd(data, asOf);
  if (!end) return emptyResult(options);
  const day = data.days[end-1];
  const baseline = denseMedian(data, day-options.baselineMaxAgeDays, day-options.baselineMinAgeDays);
  const recent = denseTailMean(data,end,options.recentDays);
  const structuralRecent = denseTailMean(data,end,options.structuralDays);
  let structuralReference: number | null;
  if (options.structural.mode === 'calendar-year') {
    const start = data.yearStarts.get(options.structural.year);
    const next = data.yearStarts.get(options.structural.year+1);
    structuralReference = start === undefined || next === undefined ? null : denseMean(data,start,Math.min(day,next-1));
  } else {
    const previous = data.yearAgo[day];
    structuralReference = denseMean(data,previous-options.structuralDays+1,previous);
  }
  const structuralPct = structuralReference !== null && structuralReference > 0 && structuralRecent !== null && day-data.days[0] >= options.minHistoryDays
    ? (structuralRecent-structuralReference)/structuralReference : null;
  return finishResult({baseline,recent,structuralRecent,structuralReference,structuralPct,
    structuralLabel: structuralLabelFor(options.structural), latestDate: data.points[end-1].date,
    series: includeSeries ? data.points.slice(0,end) : EMPTY_SERIES});
}

/**
 * Core engine: compute a disruption result for `points`, optionally as of
 * `asOf` (YYYY-MM-DD) so the same function powers historical replay.
 */
export function computeFromSeries(
  points: TransitPoint[],
  options: SeriesOptions,
  asOf?: string,
): DisruptionResult {
  const all = [...points]
    .filter((point) => Number.isFinite(point.total))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return computePreparedSeries(all, options, asOf);
}

/** Chokepoint wrapper: operates on PortWatch chokepoint transit days. */
export function computeDisruption(days: PortwatchDay[], asOf?: string): DisruptionResult {
  const points: TransitPoint[] = days.map((day) => ({ date: day.date, total: day.nTotal }));
  return computeFromSeries(points, CHOKEPOINT_SERIES_OPTIONS, asOf);
}

/** Port wrapper: operates on a port's daily `portcalls` totals. */
export function computePortCalls(points: TransitPoint[], asOf?: string): DisruptionResult {
  return computeFromSeries(points, PORT_SERIES_OPTIONS, asOf);
}
