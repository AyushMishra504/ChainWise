/** Opt-in browser instrumentation: open /?profileReplay=1. Times are milliseconds. */
type Tick = { analysis: number; map: number; render: number };
const ticks: Record<string, Tick> = {};
let activeDate: string | null = null;
export function profileEnabled(): boolean {
  return typeof window !== 'undefined' && window.location.search.includes('profileReplay=1');
}
export function profileDate(date: string | null): void {
  if (profileEnabled()) activeDate = date;
}
export function recordReplayTime(kind: keyof Tick, elapsed: number, date = activeDate): void {
  if (!profileEnabled() || !date) return;
  const tick = ticks[date] ??= { analysis: 0, map: 0, render: 0 };
  tick[kind] += elapsed;
  Object.assign(window, { replayProfile: ticks });
}
export function measureReplay<T>(date: string | null, kind: keyof Tick, operation: () => T): T {
  if (!profileEnabled() || !date) return operation();
  const start = performance.now();
  try { return operation(); }
  finally { recordReplayTime(kind, performance.now() - start, date); }
}
