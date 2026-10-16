/*
 * Pure helpers that turn historical PortWatch data into measured event
 * impacts, used by the scenario cards and the replay slider. Everything here
 * is derived from real daily numbers — nothing is invented.
 */

import type { PortwatchSnapshot } from "@/lib/portwatch-map";
import { PORTWATCH_BY_CHOKEPOINT } from "@/lib/portwatch-map";
import { median, type TransitPoint } from "@/lib/engine/disruption";
import { addDays } from "@/lib/engine/dates";
import type { Scenario } from "@/data/scenarios";

/** How many days before an event window we use to establish its baseline. */
export const PRE_WINDOW_DAYS = 90;
/** A window "shows a disruption" if it drops at least this far below baseline. */
export const EVENT_DISRUPTION_THRESHOLD = -0.15;
/** A detected event starts once this relative decline persists. */
export const SUSTAINED_DROP_THRESHOLD = -0.5;
/** Consecutive daily observations required for a detected event start. */
export const SUSTAINED_DROP_DAYS = 7;

export type EventImpact = {
  scenarioId: string;
  /** Measured replay start, including dynamically detected starts. */
  startDate: string | null;
  /** Measured replay end, including the snapshot's latest date for ongoing events. */
  endDate: string | null;
  /** Median daily (aggregate) transits over the 90 days before the window. */
  baseline: number | null;
  /** Aggregated daily totals inside the window. */
  series: TransitPoint[];
  /** Most negative change vs baseline inside the window (e.g. -0.78). */
  peakDropPct: number | null;
  peakDate: string | null;
  /** True only if the data actually shows a material drop. */
  hasDisruption: boolean;
};

/**
 * First date whose next seven days each fall below half of their own 90-day
 * preceding median. This avoids promoting a one-day reporting gap to an event.
 */
export function findSustainedDropStart(points: TransitPoint[]): string | null {
  for (let index = PRE_WINDOW_DAYS; index <= points.length - SUSTAINED_DROP_DAYS; index++) {
    const baseline = median(points.slice(index - PRE_WINDOW_DAYS, index).map((point) => point.total));
    if (baseline === null || baseline <= 0) continue;
    const sustained = points.slice(index, index + SUSTAINED_DROP_DAYS);
    if (sustained.every((point) => (point.total - baseline) / baseline < SUSTAINED_DROP_THRESHOLD)) {
      return points[index].date;
    }
  }
  return null;
}

/** Sum daily n_total across the scenario's chokepoints, per date. */
function aggregate(snapshot: PortwatchSnapshot, chokepointIds: string[]): TransitPoint[] {
  const byDate = new Map<string, number>();
  let matched = false;
  for (const id of chokepointIds) {
    const portid = PORTWATCH_BY_CHOKEPOINT[id];
    const series = portid ? snapshot.series[portid] : undefined;
    if (!series) continue;
    matched = true;
    for (const day of series.days) {
      byDate.set(day.date, (byDate.get(day.date) ?? 0) + day.nTotal);
    }
  }
  if (!matched) return [];
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, total]) => ({ date, total }));
}

export function measureScenario(snapshot: PortwatchSnapshot, scenario: Scenario): EventImpact {
  const all = aggregate(snapshot, scenario.chokepointIds);
  const startDate = scenario.start ?? findSustainedDropStart(all);
  const endDate = scenario.end ?? snapshot.latestDate ?? all[all.length - 1]?.date ?? null;
  if (!startDate || !endDate) {
    return {
      scenarioId: scenario.id,
      startDate,
      endDate,
      baseline: null,
      series: [],
      peakDropPct: null,
      peakDate: null,
      hasDisruption: false,
    };
  }
  const baselineStart = addDays(startDate, -PRE_WINDOW_DAYS);

  const baseline = median(
    all.filter((point) => point.date >= baselineStart && point.date < startDate).map((p) => p.total),
  );
  const series = all.filter((point) => point.date >= startDate && point.date <= endDate);

  let peakDropPct: number | null = null;
  let peakDate: string | null = null;
  if (baseline !== null && baseline > 0) {
    for (const point of series) {
      const change = (point.total - baseline) / baseline;
      if (peakDropPct === null || change < peakDropPct) {
        peakDropPct = change;
        peakDate = point.date;
      }
    }
  }

  return {
    scenarioId: scenario.id,
    startDate,
    endDate,
    baseline,
    series,
    peakDropPct,
    peakDate,
    hasDisruption: peakDropPct !== null && peakDropPct <= EVENT_DISRUPTION_THRESHOLD,
  };
}

/** Change vs the event baseline on a specific date (for the replay label). */
export function dropAt(impact: EventImpact, date: string): number | null {
  if (impact.baseline === null || impact.baseline <= 0) return null;
  const point = impact.series.find((p) => p.date === date);
  if (!point) return null;
  return (point.total - impact.baseline) / impact.baseline;
}
