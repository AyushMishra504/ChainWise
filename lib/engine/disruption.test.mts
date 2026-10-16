import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from 'node:fs';
import {
  computeDisruption,
  computePortCalls,
  computeSortedFromSeries,
  CHOKEPOINT_SERIES_OPTIONS,
  PORT_SERIES_OPTIONS,
  computeFromSeries,
  median,
  mean,
  statusFor,
  displayStatusFor,
  type DisruptionResult,
} from "./disruption.ts";
import { addDays } from "./dates.ts";
import type { PortwatchDay } from "../portwatch-map.ts";
import { prepareDense } from './dense.ts';
import { computeDenseSeries } from './disruption.ts';

/** Build a daily series ending at `latest`, one value per day. */
function makeDays(values: number[], latest = "2026-06-30"): PortwatchDay[] {
  const start = addDays(latest, -(values.length - 1));
  return values.map((nTotal, i) => ({ date: addDays(start, i), nTotal }));
}

/** Concatenate constant-value segments into one daily series. */
function build(segments: { start: string; days: number; value: number }[]): PortwatchDay[] {
  const out: PortwatchDay[] = [];
  for (const segment of segments) {
    for (let i = 0; i < segment.days; i++) {
      out.push({ date: addDays(segment.start, i), nTotal: segment.value });
    }
  }
  return out;
}

/** A 60-day steady baseline of 100 followed by `recent` values. */
function steadyThen(recent: number[]): PortwatchDay[] {
  return makeDays([...Array(60).fill(100), ...recent]);
}

function approx(actual: number | null, expected: number, eps = 1e-9) {
  assert.ok(actual !== null, "expected a number, got null");
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);
}

// ---- primitives ----

test("median handles odd, even and empty inputs", () => {
  assert.equal(median([5]), 5);
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test("mean returns null on empty", () => {
  assert.equal(mean([]), null);
  approx(mean([2, 4, 6]), 4);
});

test("statusFor maps the thresholds (boundaries are watch)", () => {
  assert.equal(statusFor(-0.01), "normal");
  assert.equal(statusFor(0), "normal");
  assert.equal(statusFor(-0.1499), "normal");
  assert.equal(statusFor(-0.15), "watch");
  assert.equal(statusFor(-0.3), "watch");
  assert.equal(statusFor(-0.3001), "disrupted");
});

test("displayStatusFor: severe structural decline overrides normal/watch/disrupted", () => {
  assert.equal(displayStatusFor("normal", -0.5), "structurally-down");
  assert.equal(displayStatusFor("normal", -0.8), "structurally-down");
  assert.equal(displayStatusFor("normal", -0.8001), "severely-disrupted");
  assert.equal(displayStatusFor("watch", -0.9), "severely-disrupted");
  assert.equal(displayStatusFor("disrupted", -0.9), "severely-disrupted");
  assert.equal(displayStatusFor("normal", -0.29), "normal");
  assert.equal(displayStatusFor("normal", null), "normal");
  assert.equal(displayStatusFor("low-volume", -0.9), "low-volume");
  assert.equal(displayStatusFor("no-data", null), "no-data");
});

// ---- short-term ----

test("empty input is no-data", () => {
  const result = computeDisruption([]);
  assert.equal(result.status, "no-data");
  assert.equal(result.baseline, null);
  assert.equal(result.changePct, null);
  assert.deepEqual(result.series, []);
});

test("normal when the last week matches the baseline", () => {
  const result = computeDisruption(steadyThen([100, 100, 100, 100, 100, 100, 100]));
  approx(result.baseline, 100);
  approx(result.recent, 100);
  approx(result.changePct, 0);
  assert.equal(result.status, "normal");
});

test("watch at ~20% decline", () => {
  const result = computeDisruption(steadyThen([80, 80, 80, 80, 80, 80, 80]));
  approx(result.changePct, -0.2);
  assert.equal(result.status, "watch");
});

test("disrupted below 30% decline", () => {
  const result = computeDisruption(steadyThen([50, 50, 50, 50, 50, 50, 50]));
  approx(result.changePct, -0.5);
  assert.equal(result.status, "disrupted");
});

test("recent window excludes the baseline window", () => {
  const result = computeDisruption(makeDays([...Array(60).fill(100), ...Array(7).fill(1000)]));
  approx(result.baseline, 100);
  approx(result.recent, 1000);
  approx(result.changePct, 9);
  assert.equal(result.status, "normal");
});

test("zero baseline is low volume and does not divide by zero", () => {
  const result = computeDisruption(makeDays([...Array(60).fill(0), ...Array(7).fill(5)]));
  approx(result.baseline, 0);
  assert.equal(result.changePct, null);
  assert.equal(result.status, "low-volume");
  assert.equal(result.displayStatus, "low-volume");
});

test("chokepoint baselines under three transits per day are low volume", () => {
  const result = computeDisruption(makeDays([...Array(60).fill(2), ...Array(7).fill(0)]));
  approx(result.baseline, 2);
  assert.equal(result.status, "low-volume");
  assert.equal(result.displayStatus, "low-volume");
  approx(result.changePct, -1);
});

test("short history (fewer than 8 days) is no-data", () => {
  const result = computeDisruption(makeDays([100, 100, 100, 100, 100]));
  assert.equal(result.baseline, null);
  assert.equal(result.changePct, null);
  assert.equal(result.status, "no-data");
  assert.equal(result.series.length, 5);
  assert.equal(result.latestDate, "2026-06-30");
});

test("median baseline is robust to an outlier inside the window", () => {
  const baseline = Array(60).fill(100);
  baseline[10] = 10_000;
  const result = computeDisruption(makeDays([...baseline, ...Array(7).fill(100)]));
  approx(result.baseline, 100);
  assert.equal(result.status, "normal");
});

test("series is returned ascending regardless of input order", () => {
  const days = makeDays([10, 20, 30, 40, 50]);
  const shuffled = [days[3], days[0], days[4], days[1], days[2]];
  const result = computeDisruption(shuffled);
  assert.deepEqual(
    result.series.map((p) => p.total),
    [10, 20, 30, 40, 50],
  );
  assert.equal(result.latestDate, "2026-06-30");
});

test("sorted replay fast path matches the general engine", () => {
  const days = steadyThen([70, 70, 70, 70, 70, 70, 70]);
  const expected = computeDisruption(days);
  const actual = computeSortedFromSeries(
    days.map((day) => ({ date: day.date, total: day.nTotal })),
    CHOKEPOINT_SERIES_OPTIONS,
  );
  assert.equal(actual.status, expected.status);
  assert.equal(actual.displayStatus, expected.displayStatus);
  approx(actual.baseline, expected.baseline!);
  approx(actual.changePct, expected.changePct!);
});

// ---- structural (last 30 days vs calendar 2023) ----

test("structural is skipped when there is less than a year of history", () => {
  const result = computeDisruption(build([{ start: "2023-01-01", days: 300, value: 100 }]));
  assert.equal(result.structuralPct, null);
  assert.equal(result.structuralReference, 100); // 2023 present, but span too short
});

test("structural is skipped when 2023 has no data", () => {
  const result = computeDisruption(build([{ start: "2024-01-01", days: 800, value: 100 }]));
  assert.equal(result.structuralReference, null);
  assert.equal(result.structuralPct, null);
});

test("structurally down: 30d well below 2023 while short-term is normal", () => {
  const result = computeDisruption(
    build([
      { start: "2023-01-01", days: 365, value: 100 },
      { start: "2024-01-01", days: 911, value: 50 },
    ]),
  );
  assert.equal(result.status, "normal");
  assert.equal(result.displayStatus, "structurally-down");
  approx(result.structuralPct, -0.5);
  approx(result.structuralReference, 100);
  approx(result.structuralRecent, 50);
});

test("severely disrupted: 30d more than 80% below the structural reference", () => {
  const result = computeDisruption(
    build([
      { start: "2023-01-01", days: 365, value: 100 },
      { start: "2024-01-01", days: 911, value: 5 },
    ]),
  );
  assert.equal(result.status, "normal");
  assert.equal(result.displayStatus, "severely-disrupted");
  approx(result.structuralPct, -0.95);
});

test("short-term status takes precedence over a structural overlay", () => {
  const base = build([
    { start: "2023-01-01", days: 365, value: 100 },
    { start: "2024-01-01", days: 911, value: 100 },
  ]);
  const days = base.map((day, i) => (i >= base.length - 7 ? { date: day.date, nTotal: 20 } : day));
  const result = computeDisruption(days);
  assert.equal(result.status, "disrupted");
  assert.equal(result.displayStatus, "disrupted");
  // structural is only mildly down (~-19%), so it does not override attacked precedence
  assert.ok(result.structuralPct !== null && result.structuralPct > -0.3);
});

// ---- ports: structural vs the same window one year earlier ----

const toPoints = (days: PortwatchDay[]) => days.map((day) => ({ date: day.date, total: day.nTotal }));

test("port: structurally down vs the same 30-day window a year earlier", () => {
  const result = computePortCalls(
    toPoints(
      build([
        { start: "2024-01-01", days: 366, value: 100 },
        { start: "2025-01-01", days: 181, value: 50 },
      ]),
    ),
  );
  assert.equal(result.status, "normal");
  assert.equal(result.displayStatus, "structurally-down");
  assert.equal(result.structuralLabel, "year-earlier");
  approx(result.structuralPct, -0.5);
  approx(result.structuralReference, 100);
  approx(result.structuralRecent, 50);
});

test("port: baselines under three calls per day are low volume", () => {
  const result = computePortCalls(
    toPoints(makeDays([...Array(60).fill(2), ...Array(7).fill(0)])),
  );
  approx(result.baseline, 2);
  assert.equal(result.status, "low-volume");
  assert.equal(result.displayStatus, "low-volume");
});

test("port: structural is skipped without a year-ago window", () => {
  const result = computePortCalls(toPoints(build([{ start: "2025-01-01", days: 200, value: 100 }])));
  assert.equal(result.structuralReference, null);
  assert.equal(result.structuralPct, null);
});

test("port: seasonality cancels out in the year-ago comparison", () => {
  const days = build([{ start: "2023-01-01", days: 1095, value: 100 }]).map((day, i) => ({
    date: day.date,
    nTotal: 100 + 40 * Math.sin((2 * Math.PI * i) / 365),
  }));
  const result = computePortCalls(toPoints(days));
  assert.ok(result.structuralPct !== null);
  assert.ok(Math.abs(result.structuralPct) < 0.1, `expected small structural, got ${result.structuralPct}`);
});

// ---- as-of (replay) ----

test("asOf truncates the series and sets latestDate", () => {
  const days = build([{ start: "2024-01-01", days: 500, value: 100 }]);
  const result = computeDisruption(days, "2024-06-01");
  assert.equal(result.latestDate, "2024-06-01");
  assert.equal(result.series[result.series.length - 1].date, "2024-06-01");
  assert.ok(result.series.every((point) => point.date <= "2024-06-01"));
});

test("returned result has the documented shape", () => {
  const result: DisruptionResult = computeDisruption(steadyThen([70, 70, 70, 70, 70, 70, 70]));
  assert.equal(result.status, "watch");
  assert.equal(result.displayStatus, "watch");
  assert.equal(typeof result.baseline, "number");
  assert.equal(typeof result.recent, "number");
  assert.equal(typeof result.changePct, "number");
  assert.equal(typeof result.latestDate, "string");
  assert.ok(Array.isArray(result.series));
});

test('dense replay matches the reference exactly for 20 seeded random dates across every snapshot series', () => {
  const cp = JSON.parse(readFileSync(new URL('../../data/replay/portwatch-snapshot.json', import.meta.url), 'utf8'));
  const ports = JSON.parse(readFileSync(new URL('../../data/replay/portwatch-ports-snapshot.json', import.meta.url), 'utf8'));
  let seed = 20261016;
  const dates = Array.from({length:20}, () => {
    seed = (Math.imul(seed,1664525)+1013904223) >>> 0;
    return addDays('2019-01-01', seed % 2839);
  });
  for (const snapshot of [cp,ports]) {
    for (const [id,raw] of Object.entries(snapshot.series)) {
      const feed = raw as {days: (PortwatchDay | [string,number,number,number,number,number,number])[]};
      const points = feed.days.map(day => Array.isArray(day) ? {date:day[0],total:day[1]} : {date:day.date,total:day.nTotal});
      const dense = prepareDense(points);
      const options = snapshot === cp ? CHOKEPOINT_SERIES_OPTIONS : PORT_SERIES_OPTIONS;
      for (const date of dates) {
        assert.deepEqual(computeDenseSeries(dense,options,date), computeFromSeries(points,options,date), `${id} at ${date}`);
      }
    }
  }
});

test('dense replay preserves missing-day and leap-day reference semantics', () => {
  const points = toPoints(build([{start:'2019-01-01',days:2200,value:20}]))
    .filter((_,i)=>i%11!==0).map((p,i)=>({...p,total:i%30}));
  const dense = prepareDense(points);
  assert.ok(Number.isNaN(dense.values[0]));
  for (const date of ['2020-02-29','2024-02-29','2024-03-01']) {
    assert.deepEqual(computeDenseSeries(dense,PORT_SERIES_OPTIONS,date),computeFromSeries(points,PORT_SERIES_OPTIONS,date));
  }
});
