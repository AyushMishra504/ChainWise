"use client";

import { memo, useState } from "react";
import type { ReactNode } from "react";
import ScenarioCard from "@/components/ScenarioCard";
import { scenarios } from "@/data/scenarios";
import type { Scenario } from "@/data/scenarios";
import { LANES } from "@/data/routes";
import type { ComputedRoute, Lane } from "@/data/routes";
import type { EventImpact } from "@/lib/engine/replay";

type Tab = "scenarios" | "lanes" | "business";

type LeftPanelProps = {
  activeScenarioId: string | null;
  /** True only while the replay clock is running (drives the card label). */
  playing: boolean;
  impacts: Record<string, EventImpact> | null;
  onReplay: (scenario: Scenario) => void;
  onClearSelection: () => void;
  /** Collapsed to the 56px icon rail. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  // Lane filter
  selectedLane: Lane | null;
  laneCounts: Record<string, number>;
  onSelectLane: (lane: Lane | null) => void;
  // My business route
  routes: ComputedRoute[];
  selectedRouteId: string | null;
  onSelectRoute: (route: ComputedRoute) => void;
};

const TABS: { key: Tab; label: string }[] = [
  { key: "scenarios", label: "Scenarios" },
  { key: "lanes", label: "Lanes" },
  { key: "business", label: "My business" },
];

const TAB_ICONS: Record<Tab, ReactNode> = {
  scenarios: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </svg>
  ),
  lanes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M4 18c4 0 4-12 8-12s4 12 8 12" />
      <circle cx="4" cy="18" r="1.4" />
      <circle cx="20" cy="18" r="1.4" />
    </svg>
  ),
  business: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  ),
};

export default memo(function LeftPanel({
  activeScenarioId,
  playing,
  impacts,
  onReplay,
  onClearSelection,
  collapsed,
  onToggleCollapsed,
  selectedLane,
  laneCounts,
  onSelectLane,
  routes,
  selectedRouteId,
  onSelectRoute,
}: LeftPanelProps) {
  const [tab, setTab] = useState<Tab>("scenarios");
  const historical = scenarios.filter((s) => s.kind === "historical").length;

  if (collapsed) {
    return (
      <aside className="flex h-full min-h-0 w-14 flex-col items-center gap-1 border-r border-app-border bg-app-panel py-2">
        <button
          onClick={onToggleCollapsed}
          aria-label="Expand panel"
          title="Expand panel"
          className="flex h-9 w-9 items-center justify-center rounded-[4px] text-app-muted transition hover:bg-app-elevated hover:text-app-text"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        <div className="my-1 h-px w-6 bg-app-divider" />
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => {
              setTab(key);
              onToggleCollapsed();
            }}
            aria-label={label}
            title={label}
            className={`flex h-9 w-9 items-center justify-center rounded-[4px] transition ${
              tab === key ? "bg-app-elevated text-app-text" : "text-app-muted hover:bg-app-elevated hover:text-app-text"
            }`}
          >
            {TAB_ICONS[key]}
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-r border-app-border bg-app-panel">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-app-border px-2">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-current={tab === key}
            className={`rounded-[4px] px-3 py-1.5 text-[12px] transition ${
              tab === key
                ? "bg-app-elevated font-medium text-app-text"
                : "text-app-muted hover:text-app-text"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={onToggleCollapsed}
          aria-label="Collapse panel"
          title="Collapse panel"
          className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-app-muted transition hover:bg-app-elevated hover:text-app-text"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
      </div>

      {tab === "scenarios" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-app-muted">
              Scenarios
            </span>
            <span className="text-[12px] text-app-muted">{historical} historical</span>
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-app-divider overflow-y-auto">
            {scenarios.map((scenario) => (
              <ScenarioCard
                key={scenario.id}
                scenario={scenario}
                impact={impacts?.[scenario.id] ?? null}
                active={activeScenarioId === scenario.id}
                playing={playing}
                onReplay={onReplay}
              />
            ))}
          </ul>
        </div>
      ) : tab === "lanes" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-4 pb-2 pt-3 text-[12px] font-semibold uppercase tracking-wider text-app-muted">
            Trade lanes
          </div>
          <ul className="divide-y divide-app-divider">
            <li>
              <button
                onClick={() => onSelectLane(null)}
                className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-[14px] transition ${
                  selectedLane === null ? "text-app-text" : "text-app-muted hover:text-app-text"
                }`}
              >
                <span className={selectedLane === null ? "font-medium" : ""}>All lanes</span>
                <span className="font-mono text-[12px] text-app-muted">{routes.length}</span>
              </button>
            </li>
            {LANES.map((lane) => {
              const active = selectedLane === lane;
              return (
                <li key={lane}>
                  <button
                    onClick={() => onSelectLane(active ? null : lane)}
                    className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-[14px] transition ${
                      active ? "bg-app-elevated text-app-text" : "text-app-muted hover:text-app-text"
                    }`}
                  >
                    <span className={active ? "font-medium" : ""}>{lane}</span>
                    <span className="font-mono text-[12px] text-app-muted">
                      {laneCounts[lane] ?? 0}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="px-4 py-3 text-[12px] text-app-muted">
            Selecting a lane highlights its routes at full opacity and dims the rest.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-[14px] text-app-muted">
          <p className="text-[12px] font-semibold uppercase tracking-wider">My business route</p>
          <select
            value={selectedRouteId ?? ""}
            onChange={(event) => {
              const route = routes.find((r) => r.id === event.target.value);
              if (route) onSelectRoute(route);
            }}
            className="w-full rounded-[4px] border border-app-border bg-app-input px-2.5 py-2 text-[14px] text-app-text focus:border-app-muted focus:outline-none"
          >
            <option value="" disabled>
              Select a route…
            </option>
            {routes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.name} · {route.lane}
              </option>
            ))}
          </select>
          <p>Ports on this route report their status in the Impact section on the right.</p>
        </div>
      )}

      <div className="shrink-0 border-t border-app-border p-3 text-center">
        <button
          onClick={onClearSelection}
          className="text-[12px] text-app-muted transition hover:text-app-text hover:underline"
        >
          Clear selection
        </button>
      </div>
    </aside>
  );
});
