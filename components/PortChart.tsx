"use client";

import type { PortPoint } from "@/lib/engine/portAnalysis";

type PortChartProps = {
  /** The charted window (the event window while a replay is running). */
  series: PortPoint[];
  /** Leading points the time bar has reached; the rest of the window stays blank. */
  visible?: number;
  baseline: number | null;
};

const W = 300;
const H = 90;
const PAD = 4;

function formatShort(date: string): string {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return date;
  return new Date(parsed).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

const ACCESSORS: { key: keyof PortPoint; color: string; width: number }[] = [
  { key: "portcalls", color: "#c2cee2", width: 1.5 },
  { key: "container", color: "#6a80a0", width: 1 },
  { key: "tanker", color: "#e8a33d", width: 1 },
  { key: "dryBulk", color: "#8c93a4", width: 1 },
];

export default function PortChart({ series, visible, baseline }: PortChartProps) {
  if (series.length < 2) {
    return (
      <div className="flex h-24 items-center justify-center text-[12px] text-app-muted">
        Not enough data to chart.
      </div>
    );
  }

  // Scales come from the whole window, so they hold still while the line grows.
  const all: number[] = [];
  for (const point of series) for (const { key } of ACCESSORS) all.push(Number(point[key]));
  if (baseline !== null) all.push(baseline);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;

  const x = (i: number) => PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  const count = Math.min(Math.max(visible ?? series.length, 1), series.length);
  const tipIndex = count - 1;
  const tip = series[tipIndex];
  const previous = count >= 2 ? series[count - 2] : null;
  // Everything already drawn bar the newest step, which draws itself in.
  const settled = series.slice(0, Math.max(count - 1, 1));
  const baselineY = baseline !== null ? y(baseline) : null;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[90px] w-full"
        role="img"
        aria-label="Daily port calls by vessel type"
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
        {ACCESSORS.map(({ key, color, width }) => (
          <path
            key={key}
            d={`M${settled
              .map((point, i) => `${x(i).toFixed(2)},${y(Number(point[key])).toFixed(2)}`)
              .join(" L")}`}
            fill="none"
            stroke={color}
            strokeWidth={width}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {previous
          ? ACCESSORS.map(({ key, color, width }) => (
              <path
                key={`${key}-${tip.date}`}
                d={`M${x(tipIndex - 1).toFixed(2)},${y(Number(previous[key])).toFixed(2)} L${x(tipIndex).toFixed(2)},${y(Number(tip[key])).toFixed(2)}`}
                fill="none"
                stroke={color}
                strokeWidth={width}
                vectorEffect="non-scaling-stroke"
                pathLength={1}
                className="chart-draw"
              />
            ))
          : null}
        <circle
          key={`dot-${tip.date}`}
          cx={x(tipIndex)}
          cy={y(tip.portcalls)}
          r={2}
          fill="#c2cee2"
          className="chart-dot"
        />
      </svg>
      <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-app-muted">
        <span>{formatShort(series[0].date)}</span>
        <span>{max.toLocaleString()} max calls</span>
        <span>{formatShort(tip.date)}</span>
      </div>
    </div>
  );
}
