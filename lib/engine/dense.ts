/** Immutable daily data, prepared once when a feed arrives. No dates are parsed by queries. */
const DAY_MS = 86_400_000;
const EPOCH = Date.UTC(2019, 0, 1);
export type DailyPoint = { date: string; total: number };
export type DenseSeries = {
  values: Float64Array;
  points: DailyPoint[];
  days: number[];
  /** Number of observed points through each integer day (gaps remain NaN). */
  ends: Int32Array;
  yearAgo: Int32Array;
  yearStarts: Map<number, number>;
};
const dayNumbers = new Map<string, number>();
let calendarEnd = -1;
const previousYears: number[] = [];
const starts = new Map<number, number>();

function prepareCalendar(end: number): void {
  for (let d = calendarEnd + 1; d <= end; d++) {
    const date = new Date(EPOCH + d * DAY_MS);
    dayNumbers.set(date.toISOString().slice(0, 10), d);
    const y = date.getUTCFullYear();
    starts.set(y, (Date.UTC(y, 0, 1) - EPOCH) / DAY_MS);
    starts.set(y + 1, (Date.UTC(y + 1, 0, 1) - EPOCH) / DAY_MS);
    // Match the reference engine's Date.parse normalization on leap day.
    previousYears[d] = (Date.UTC(y - 1, date.getUTCMonth(), date.getUTCDate()) - EPOCH) / DAY_MS;
  }
  calendarEnd = Math.max(calendarEnd, end);
}

export function prepareDense(input: DailyPoint[]): DenseSeries {
  const points = input.filter(p => Number.isFinite(p.total)).slice().sort((a,b) => a.date.localeCompare(b.date));
  const days = points.map(p => Math.round((Date.parse(p.date + 'T00:00:00Z') - EPOCH) / DAY_MS));
  const last = days.at(-1) ?? 0;
  prepareCalendar(last + 366);
  const values = new Float64Array(last + 1).fill(NaN);
  for (let i = 0; i < points.length; i++) values[days[i]] = points[i].total;
  const ends = new Int32Array(last + 1);
  let count = 0;
  for (let d = 0; d <= last; d++) {
    while (count < days.length && days[count] <= d) count++;
    ends[d] = count;
  }
  return {values, points, days, ends, yearAgo: Int32Array.from(previousYears.slice(0,last+1)), yearStarts: starts};
}

export function denseEnd(data: DenseSeries, asOf?: string): number {
  if (!asOf) return data.points.length;
  const d = dayNumbers.get(asOf);
  if (d !== undefined) return d >= data.ends.length ? data.points.length : data.ends[d];
  // Out-of-calendar requests: compare strings, never parse during playback.
  if (!data.points.length || asOf < data.points[0].date) return 0;
  return data.points.length;
}

/*
 * Allocation-free aggregates over a DenseSeries.
 *
 * `denseMean`/`denseMedian` cover the calendar window `first..last`, keeping
 * only observed (finite) days — the same value set the reference engine builds
 * by filtering `points` on date age. `denseTailMean` covers the last `count`
 * *observations* before `end`, which is the reference engine's last-N semantics
 * when days are missing. Both match the reference exactly, with no throwaway
 * array per call.
 */

let scratch = new Float64Array(256);

/** A reusable buffer of at least `length` values. Never held across calls. */
export function scratchBuffer(length: number): Float64Array {
  if (scratch.length < length) {
    scratch = new Float64Array(Math.max(length, scratch.length * 2));
  }
  return scratch;
}

/** Quickselect: partition `values[0..length)` so that `values[k]` is the k-th smallest. */
function selectInPlace(values: Float64Array, k: number, length: number): void {
  let left = 0;
  let right = length - 1;
  while (left < right) {
    const pivot = values[(left + right) >> 1];
    let i = left;
    let j = right;
    while (i <= j) {
      while (values[i] < pivot) i++;
      while (values[j] > pivot) j--;
      if (i <= j) {
        const swap = values[i];
        values[i] = values[j];
        values[j] = swap;
        i++;
        j--;
      }
    }
    if (k <= j) right = j;
    else if (k >= i) left = i;
    else return;
  }
}

/** Median of the first `length` values of `values`; matches `median()` exactly. */
export function quickSelectMedian(values: Float64Array, length: number): number | null {
  if (length === 0) return null;
  const mid = length >> 1;
  selectInPlace(values, mid, length);
  if (length % 2 === 1) return values[mid];
  let lower = values[0];
  for (let i = 1; i < mid; i++) if (values[i] > lower) lower = values[i];
  return (lower + values[mid]) / 2;
}

/** Mean of the observed days in the calendar window `first..last`. */
export function denseMean(data: DenseSeries, first: number, last: number): number | null {
  const lo = Math.max(0, first);
  const hi = Math.min(last, data.values.length - 1);
  let sum = 0;
  let count = 0;
  for (let d = lo; d <= hi; d++) {
    const value = data.values[d];
    if (Number.isFinite(value)) {
      sum += value;
      count++;
    }
  }
  return count === 0 ? null : sum / count;
}

/** Mean of the last `count` observations before `end`. */
export function denseTailMean(data: DenseSeries, end: number, count: number): number | null {
  const start = Math.max(0, end - count);
  let sum = 0;
  let seen = 0;
  for (let i = start; i < end; i++) {
    sum += data.values[data.days[i]];
    seen++;
  }
  return seen === 0 ? null : sum / seen;
}

/** Median of the observed days in the calendar window `first..last`. */
export function denseMedian(data: DenseSeries, first: number, last: number): number | null {
  const lo = Math.max(0, first);
  const hi = Math.min(last, data.values.length - 1);
  const buffer = scratchBuffer(Math.max(0, hi - lo + 1));
  let count = 0;
  for (let d = lo; d <= hi; d++) {
    const value = data.values[d];
    if (Number.isFinite(value)) buffer[count++] = value;
  }
  return quickSelectMedian(buffer, count);
}
