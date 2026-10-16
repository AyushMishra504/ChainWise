"use client";

import type { TransitPoint } from "@/lib/engine/disruption";

type ChokepointChartProps = {
  /** The charted window (the event window while a replay is running). */
  series: TransitPoint[];
  /** Leading points the time bar has reached; the rest of the window stays blank. */
  visible?: number;
  baseline: number | null;
};

const W = 300;
const H = 80;
const PAD = 4;

function formatShort(date: string): string {
  // "2026-10-11" -> "11 Oct"
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return date;
  return new Date(parsed).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

export default function ChokepointChart({ series, visible, baseline }: ChokepointChartProps) {
  if (series.length < 2) {
    return (
      <div className="flex h-24 items-center justify-center text-[12px] text-app-muted">
        Not enough data to chart.
      </div>
    );
  }

  // Scales come from the whole window, so they hold still while the line grows.
  const values = series.map((point) => point.total);
  if (baseline !== null) values.push(baseline);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const x = (i: number) => PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  const count = Math.min(Math.max(visible ?? series.length, 1), series.length);
  const tipIndex = count - 1;
  const tip = series[tipIndex];
  const previous = count >= 2 ? series[count - 2] : null;
  // Everything already drawn bar the newest step, which draws itself in.
  const settled = series
    .slice(0, Math.max(count - 1, 1))
    .map((point, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(point.total).toFixed(2)}`)
    .join(" ");
  const baselineY = baseline !== null ? y(baseline) : null;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-24 w-full"
        role="img"
        aria-label="Daily chokepoint transits"
      >
        {baselineY !== null ? (
          <line
            x1={PAD}
            x2={W - PAD}
            y1={baselineY}
            y2={baselineY}
            stroke="#e8a33d"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <path
          d={settled}
          fill="none"
          stroke="#c2cee2"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        {previous ? (
          <path
            key={tip.date}
            d={`M${x(tipIndex - 1).toFixed(2)},${y(previous.total).toFixed(2)} L${x(tipIndex).toFixed(2)},${y(tip.total).toFixed(2)}`}
            fill="none"
            stroke="#c2cee2"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            pathLength={1}
            className="chart-draw"
          />
        ) : null}
        <circle
          key={`dot-${tip.date}`}
          cx={x(tipIndex)}
          cy={y(tip.total)}
          r={2}
          fill="#c2cee2"
          className="chart-dot"
        />
      </svg>
      <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-app-muted">
        <span>{formatShort(series[0].date)}</span>
        <span>{max.toLocaleString()} max</span>
        <span>{formatShort(tip.date)}</span>
      </div>
    </div>
  );
}
