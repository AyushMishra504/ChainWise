"use client";

import type { ReactNode } from "react";
import type { PortwatchSource } from "@/lib/portwatch-map";

export type LogEvent = {
  id: string;
  time: string;
  source: string;
  message: string;
  tone: "info" | "warn";
};

type BottomStripProps = {
  events: LogEvent[];
  eventLogOpen: boolean;
  onToggleEventLog: () => void;
  controls?: ReactNode;
  /** Live count of monitored chokepoints that are flagged (watch or worse). */
  risk: { flagged: number; total: number } | null;
  dataAsOf: string | null;
  dataSource: PortwatchSource | null;
  /** True while a historical replay is driving the strip. */
  replaying?: boolean;
};

const SOURCE_SUFFIX: Record<PortwatchSource, string> = {
  live: "",
  cache: " (cached)",
  snapshot: " (snapshot)",
};

export default function BottomStrip({
  events,
  eventLogOpen,
  onToggleEventLog,
  controls,
  risk,
  dataAsOf,
  dataSource,
  replaying = false,
}: BottomStripProps) {
  const latest = events[0];
  const asOfLabel = dataAsOf ? `to ${dataAsOf}` : "no data";
  const sourceNote = replaying
    ? `IMF PortWatch · replay ${asOfLabel}`
    : dataSource
      ? `IMF PortWatch · ${asOfLabel}${SOURCE_SUFFIX[dataSource]}`
      : "IMF PortWatch";
  const riskTone = risk && risk.flagged > 0 ? "text-app-amber" : "text-app-muted";

  return (
    <footer className="z-40 col-span-full flex h-11 shrink-0 select-none items-center justify-between gap-3 border-t border-app-border bg-app-panel px-4 text-[12px]">
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-app-muted">Risk monitor</span>
        <span className={`font-mono ${riskTone}`} title="Monitored chokepoints flagged (watch or worse)">
          {risk ? `${risk.flagged}/${risk.total}` : "—"}
        </span>
        <span className="text-[12px] text-app-muted">{sourceNote}</span>
      </div>

      <div className="hidden min-w-0 flex-1 truncate text-center text-app-muted sm:block">
        {latest ? (
          <span>
            {latest.time} — {latest.message}
          </span>
        ) : (
          <span>No events yet</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {controls}
        <button
          onClick={onToggleEventLog}
          className="text-app-muted transition hover:text-app-text hover:underline"
        >
          {eventLogOpen ? "Event log ↓" : "Event log ↑"}
        </button>
      </div>
    </footer>
  );
}
