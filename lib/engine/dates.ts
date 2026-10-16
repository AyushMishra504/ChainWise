/** Small UTC date helpers shared by the analysis engine (YYYY-MM-DD strings). */

const DAY_MS = 86_400_000;

export function toEpoch(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  return new Date(toEpoch(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toEpoch(to) - toEpoch(from)) / DAY_MS);
}

/** Inclusive list of dates from `start` to `end`. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let epoch = toEpoch(start), last = toEpoch(end); epoch <= last; epoch += DAY_MS) {
    out.push(new Date(epoch).toISOString().slice(0, 10));
  }
  return out;
}
