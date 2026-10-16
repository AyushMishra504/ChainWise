"use client";

import type { Scenario } from "@/data/scenarios";
import type { EventImpact } from "@/lib/engine/replay";

type ScenarioCardProps = {
  scenario: Scenario;
  impact: EventImpact | null;
  /** True when this scenario is the one loaded in the replay bar. */
  active: boolean;
  /** True only while the replay clock is actually running. */
  playing: boolean;
  onReplay: (scenario: Scenario) => void;
};

function formatPct(value: number): string {
  const pct = value * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

export default function ScenarioCard({ scenario, impact, active, playing, onReplay }: ScenarioCardProps) {
  const drop = impact?.peakDropPct ?? null;
  const action = active ? (playing ? "Playing" : "Paused") : "Replay";

  return (
    <li className={`relative px-4 py-3 ${active ? "bg-app-elevated/40" : ""}`}>
      {active ? (
        <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-app-amber" />
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className={`text-[14px] text-app-text ${active ? "font-semibold" : "font-normal"}`}>
            {scenario.name}
          </h4>
          {scenario.blurb ? <p className="mt-0.5 text-[12px] text-app-muted">{scenario.blurb}</p> : null}
          <p className="mt-1.5 font-mono text-[12px] text-app-muted">
            {impact?.startDate ?? scenario.start ?? "Measuring"} → {impact?.endDate ?? scenario.end ?? "ongoing"}
          </p>
          {impact === null ? null : drop === null ? (
            <p className="mt-0.5 text-[12px] text-app-muted">No measured baseline</p>
          ) : (
            <p className="mt-0.5 text-[12px]">
              <span className={impact.hasDisruption ? "text-app-red" : "text-app-muted"}>
                {formatPct(drop)} peak
              </span>
              <span className="text-app-muted"> · {impact.peakDate}</span>
            </p>
          )}
        </div>
        <button
          onClick={() => onReplay(scenario)}
          className={`shrink-0 text-[12px] transition ${
            active
              ? "text-app-amber hover:underline"
              : "text-app-muted hover:text-app-text hover:underline"
          }`}
        >
          {action}
        </button>
      </div>
    </li>
  );
}
