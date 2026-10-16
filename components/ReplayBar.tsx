"use client";

import type { Scenario } from "@/data/scenarios";

type ReplayBarProps = {
  scenario: Scenario;
  date: string;
  index: number;
  count: number;
  playing: boolean;
  /** Change vs the event's own 90-day pre-window baseline on `date`. */
  dropPct: number | null;
  onTogglePlay: () => void;
  onScrub: (index: number) => void;
  onExit: () => void;
};

function formatDrop(dropPct: number | null): string {
  if (dropPct === null) return "—";
  const pct = dropPct * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export default function ReplayBar({
  scenario,
  date,
  index,
  count,
  playing,
  dropPct,
  onTogglePlay,
  onScrub,
  onExit,
}: ReplayBarProps) {
  const last = Math.max(count - 1, 0);
  const dropTone =
    dropPct !== null && dropPct <= -0.3
      ? "text-app-red"
      : dropPct !== null && dropPct <= -0.15
        ? "text-app-amber"
        : "text-app-text";

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-30 w-[min(680px,calc(100%-2rem))] -translate-x-1/2 rounded-[4px] border border-app-border bg-app-panel shadow-panel">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className="shrink-0 rounded-[3px] border border-app-amber/30 px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-wider text-app-amber">
          Replay
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[12px] font-medium text-app-text">{scenario.name}</span>
            <span className="shrink-0 font-mono text-[12px] text-app-muted">{date}</span>
            <span className={`shrink-0 font-mono text-[12px] ${dropTone}`}>
              {formatDrop(dropPct)} vs baseline
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={last}
            value={index}
            onChange={(event) => onScrub(Number(event.target.value))}
            className="mt-1.5 h-1 w-full cursor-pointer appearance-none rounded-full bg-app-input accent-app-amber"
            aria-label="Replay date"
          />
        </div>

        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={playing ? "Pause replay" : "Play replay"}
          className="shrink-0 rounded-[4px] border border-app-border bg-app-input p-1.5 text-app-text transition hover:border-app-muted"
        >
          {playing ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M7 5l12 7-12 7z" />
            </svg>
          )}
        </button>

        <button
          type="button"
          onClick={onExit}
          className="shrink-0 text-[12px] text-app-muted transition hover:text-app-text hover:underline"
        >
          Back to live
        </button>
      </div>
    </div>
  );
}
