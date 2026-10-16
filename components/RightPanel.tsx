"use client";

import { memo } from "react";
import type { ReactNode } from "react";
import type { Chokepoint } from "@/data/chokepoints";
import type { Port } from "@/data/ports";
import type { ComputedRoute } from "@/data/routes";
import type { Reroute } from "@/lib/seaRouting";
import type { DisruptionResult, DisplayStatus, TransitPoint } from "@/lib/engine/disruption";
import type { PortAnalysis, PortPoint } from "@/lib/engine/portAnalysis";
import { CORROBORATION_DETAIL, CORROBORATION_LABEL, type ChokepointNews } from "@/lib/engine/corroboration";
import ChokepointChart from "@/components/ChokepointChart";
import PortChart from "@/components/PortChart";
import AgentAnalysis from "@/components/AgentAnalysis";

type RightPanelProps = {
  chokepoints: Chokepoint[];
  ports: Port[];
  selectedRoute: ComputedRoute | null;
  blockedCpIds: string[];
  reroute: Reroute | null;
  onBlockToggle: (chokepoint: Chokepoint) => void;
  onChokepointHover: (chokepointId: string | null) => void;
  selectedChokepoint: Chokepoint | null;
  chokepointResult: DisruptionResult | null;
  /** Charted window for the selected chokepoint (event window during a replay). */
  chokepointChartSeries: TransitPoint[];
  /** Points of that window the time bar has reached. */
  chokepointChartVisible: number;
  selectedPort: Port | null;
  portResult: PortAnalysis | null;
  /** Charted window for the selected port (event window during a replay). */
  portChartSeries: PortPoint[];
  /** Points of that window the time bar has reached. */
  portChartVisible: number;
  /** Live per-port analysis, used for a route's origin/destination status. */
  portAnalysis: Record<string, PortAnalysis> | null;
  dataAsOf: string | null;
  news: ChokepointNews | null;
  newsLoading: boolean;
  newsError: string | null;
  onResizeStart: (clientX: number) => void;
  onClear: () => void;
};

const STATUS_LABEL: Record<DisplayStatus, string> = {
  normal: "Normal",
  watch: "Watch",
  disrupted: "Disrupted",
  "severely-disrupted": "Severe structural decline",
  "structurally-down": "Structurally down",
  "low-volume": "Low volume",
  "no-data": "No data",
};

const STATUS_TONE: Record<DisplayStatus, string> = {
  normal: "text-app-muted",
  watch: "text-app-amber",
  disrupted: "text-app-red",
  "severely-disrupted": "text-app-red",
  "structurally-down": "text-app-amber",
  "low-volume": "text-app-muted",
  "no-data": "text-app-muted",
};

export function formatChange(changePct: number | null): string {
  if (changePct === null) return "—";
  const pct = changePct * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function toneFor(status: DisplayStatus): "text" | "amber" | "red" | "muted" {
  if (status === "disrupted" || status === "severely-disrupted") return "red";
  if (status === "watch" || status === "structurally-down") return "amber";
  return "muted";
}

function newsTone(status: ChokepointNews["status"]): string {
  if (status === "corroborated") return "text-app-red";
  if (status === "unconfirmed" || status === "early-warning") return "text-app-amber";
  return "text-app-muted";
}

function Stat({
  value,
  label,
  tone = "text",
}: {
  value: string;
  label: string;
  tone?: "text" | "amber" | "red" | "muted";
}) {
  const color =
    tone === "amber"
      ? "text-app-amber"
      : tone === "red"
        ? "text-app-red"
        : tone === "muted"
          ? "text-app-muted"
          : "text-app-text";
  return (
    <div>
      <div className={`font-mono text-[14px] font-medium ${color}`}>{value}</div>
      <div className="mt-0.5 text-[12px] text-app-muted">{label}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[12px] font-semibold uppercase tracking-wider text-app-muted">{children}</h3>
  );
}

export default memo(function RightPanel({
  chokepoints,
  ports,
  selectedRoute,
  blockedCpIds,
  reroute,
  onBlockToggle,
  onChokepointHover,
  selectedChokepoint,
  chokepointResult,
  chokepointChartSeries,
  chokepointChartVisible,
  selectedPort,
  portResult,
  portChartSeries,
  portChartVisible,
  portAnalysis,
  dataAsOf,
  news,
  newsLoading,
  newsError,
  onResizeStart,
  onClear,
}: RightPanelProps) {
  if (!selectedChokepoint && !selectedPort && !selectedRoute) return null;

  const showingChokepoint = selectedChokepoint !== null;
  const showingPort = !showingChokepoint && selectedPort !== null;
  const showingRoute = !showingChokepoint && !showingPort && selectedRoute !== null;

  const eyebrow = showingChokepoint ? "Chokepoint" : showingPort ? "Port" : "Route";
  const title = showingChokepoint
    ? selectedChokepoint.name
    : showingPort
      ? selectedPort.name
      : selectedRoute?.name ?? "";

  const chokepointStatus: DisplayStatus = chokepointResult?.displayStatus ?? "no-data";
  const portStatus: DisplayStatus = portResult?.disruption.displayStatus ?? "no-data";

  const routeChokepoints = showingRoute
    ? chokepoints.filter((cp) => selectedRoute?.passesThrough.includes(cp.id))
    : [];
  const originPort = showingRoute ? ports.find((p) => p.id === selectedRoute?.from) ?? null : null;
  const destinationPort = showingRoute
    ? ports.find((p) => p.id === selectedRoute?.to) ?? null
    : null;

  return (
    <aside className="relative flex h-full min-h-0 flex-col overflow-hidden border-l border-app-border bg-app-panel">
      <div
        role="separator"
        aria-label="Resize details panel"
        aria-orientation="vertical"
        onPointerDown={(event) => onResizeStart(event.clientX)}
        className="group absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none"
      >
        <div className="mx-auto h-full w-px bg-transparent transition group-hover:bg-app-amber/70" />
      </div>
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-app-border p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-app-muted">
              {eyebrow}
            </span>
            {showingRoute && blockedCpIds.length > 0 ? (
              <span className="rounded-[4px] border border-app-amber/30 px-1.5 py-0.5 text-[12px] font-medium text-app-amber">
                Blocked chokepoint
              </span>
            ) : null}
            {showingChokepoint ? (
              <span className={`text-[12px] font-medium ${STATUS_TONE[chokepointStatus]}`}>
                {STATUS_LABEL[chokepointStatus]}
              </span>
            ) : null}
            {showingPort ? (
              <span className={`text-[12px] font-medium ${STATUS_TONE[portStatus]}`}>
                {STATUS_LABEL[portStatus]}
              </span>
            ) : null}
          </div>
          <h2 className="mt-1 text-[18px] font-semibold text-app-text">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Close details"
          className="rounded-[4px] p-1 text-app-muted transition hover:bg-app-input hover:text-app-text"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="h-4 w-4"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-app-border px-4 py-2">
        <span className="rounded-[4px] bg-app-elevated px-3 py-1.5 text-[12px] font-medium text-app-text">
          Impact
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {showingRoute && selectedRoute ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <Stat value={`${Math.round(selectedRoute.lengthKm).toLocaleString()} km`} label="Distance" />
              <Stat value={selectedRoute.days.toFixed(1)} label="Transit days (14 kn)" />
            </div>

            {reroute ? (
              <div className="rounded-[4px] border border-app-amber/30 p-3">
                <SectionTitle>Detour around the block</SectionTitle>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <Stat
                    value={`+${Math.round(reroute.extraKm).toLocaleString()} km`}
                    label="Extra distance"
                    tone="amber"
                  />
                  <Stat value={`+${reroute.extraDays.toFixed(1)}`} label="Extra days" tone="amber" />
                </div>
              </div>
            ) : null}

            <section>
              <SectionTitle>Chokepoints on this route</SectionTitle>
              {routeChokepoints.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {routeChokepoints.map((chokepoint) => {
                    const blocked = blockedCpIds.includes(chokepoint.id);
                    return (
                      <li
                        key={chokepoint.id}
                        className="group flex items-center justify-between gap-2"
                        onMouseEnter={() => onChokepointHover(chokepoint.id)}
                        onMouseLeave={() => onChokepointHover(null)}
                      >
                        <span className="min-w-0 truncate text-[14px] text-app-text group-hover:underline">
                          {chokepoint.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => onBlockToggle(chokepoint)}
                          className={`shrink-0 rounded-[4px] px-2 py-1 text-[12px] font-medium transition ${
                            blocked
                              ? "text-app-amber hover:bg-app-amber/10"
                              : "text-app-muted hover:bg-app-elevated hover:text-app-text"
                          }`}
                          aria-label={`${blocked ? "Unblock" : "Block"} ${chokepoint.name}`}
                        >
                          {blocked ? "Unblock" : "Block"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-[14px] text-app-muted">
                  None within 100 km of this route.
                </p>
              )}
            </section>

            <section>
              <SectionTitle>Why it matters · {selectedRoute.lane}</SectionTitle>
              {selectedRoute.fact ? (
                <>
                  <p className="mt-2 text-[14px] text-app-text">{selectedRoute.fact.why}</p>
                  <p className="mt-1 text-[12px] text-app-muted">
                    {selectedRoute.fact.source}
                    {selectedRoute.fact.period ? ` · ${selectedRoute.fact.period}` : ""}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-[14px] text-app-muted">
                  No sourced brief for this lane yet.
                </p>
              )}
            </section>

            <section>
              <div className="flex items-center justify-between gap-2">
                <SectionTitle>Port status</SectionTitle>
                {dataAsOf ? (
                  <span className="shrink-0 font-mono text-[12px] text-app-muted">
                    to {dataAsOf}
                  </span>
                ) : null}
              </div>
              <ul className="mt-2 space-y-2">
                <li className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] text-app-text">
                      {originPort?.name ?? selectedRoute.from}
                    </span>
                    <span className="text-[12px] text-app-muted">Origin</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={`block font-mono text-[14px] ${
                        STATUS_TONE[portAnalysis?.[selectedRoute.from]?.disruption.displayStatus ?? "no-data"]
                      }`}
                    >
                      {formatChange(portAnalysis?.[selectedRoute.from]?.disruption.changePct ?? null)}
                    </span>
                    <span className="text-[12px] text-app-muted">vs baseline</span>
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] text-app-text">
                      {destinationPort?.name ?? selectedRoute.to}
                    </span>
                    <span className="text-[12px] text-app-muted">Destination</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={`block font-mono text-[14px] ${
                        STATUS_TONE[portAnalysis?.[selectedRoute.to]?.disruption.displayStatus ?? "no-data"]
                      }`}
                    >
                      {formatChange(portAnalysis?.[selectedRoute.to]?.disruption.changePct ?? null)}
                    </span>
                    <span className="text-[12px] text-app-muted">vs baseline</span>
                  </span>
                </li>
              </ul>
            </section>
          </div>
        ) : showingChokepoint && selectedChokepoint ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <Stat
                value={
                  chokepointResult && chokepointResult.recent !== null
                    ? Math.round(chokepointResult.recent).toLocaleString()
                    : "—"
                }
                label="7d avg transits"
              />
              <Stat
                value={
                  chokepointResult && chokepointResult.baseline !== null
                    ? Math.round(chokepointResult.baseline).toLocaleString()
                    : "—"
                }
                label="Baseline (median)"
              />
            </div>
            <Stat
              value={formatChange(chokepointResult?.changePct ?? null)}
              label="vs baseline"
              tone={toneFor(chokepointStatus)}
            />
            <AgentAnalysis key={selectedChokepoint.id} chokepointId={selectedChokepoint.id} />
            <section>
              <SectionTitle>Daily transits</SectionTitle>
              <div className="mt-2">
                <ChokepointChart
                  series={chokepointChartSeries}
                  visible={chokepointChartVisible}
                  baseline={chokepointResult?.baseline ?? null}
                />
              </div>
            </section>
            <section>
              <SectionTitle>Trade-news signal</SectionTitle>
              <div className="mt-2 space-y-2">
                {newsLoading ? <p className="text-[12px] text-app-muted">Loading trade-news…</p> : null}
                {newsError ? <p className="text-[12px] text-app-red">Trade-news unavailable: {newsError}</p> : null}
                {!newsLoading && !newsError && news ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[14px] font-medium ${newsTone(news.status)}`}>
                        {CORROBORATION_LABEL[news.status]}
                      </span>
                      <span className="font-mono text-[12px] text-app-muted">
                        {news.signal.recentMentions} mention{news.signal.recentMentions === 1 ? "" : "s"} / 7d
                      </span>
                    </div>
                    <p className="text-[12px] text-app-muted">{CORROBORATION_DETAIL[news.status]}</p>
                    {news.status === "no-news-data" ? (
                      <p className="border-t border-app-divider pt-2 text-[12px] text-app-muted">
                        No trade-news feed items are available right now.
                      </p>
                    ) : news.signal.headlines.length > 0 ? (
                      <ul className="space-y-2 border-t border-app-divider pt-2">
                        {news.signal.headlines.slice(0, 3).map((headline) => (
                          <li key={headline.link}>
                            <a
                              href={headline.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-[12px] text-app-text hover:underline"
                            >
                              {headline.title}
                            </a>
                            <span className="text-[10px] text-app-muted">
                              {headline.source} · {headline.date}
                            </span>
                          </li>
                        ))}
                        {news.signal.headlines.length > 3 ? (
                          <li className="pt-1 text-[10px] text-app-muted">
                            Showing the three most recent matching headlines.
                          </li>
                        ) : null}
                      </ul>
                    ) : (
                      <p className="border-t border-app-divider pt-2 text-[12px] text-app-muted">
                        No matching headlines in the last seven days.
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            </section>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onBlockToggle(selectedChokepoint)}
                className={`rounded-[4px] border px-2.5 py-1.5 text-[12px] transition ${
                  blockedCpIds.includes(selectedChokepoint.id)
                    ? "border-app-amber/40 text-app-amber hover:border-app-amber"
                    : "border-app-border text-app-muted hover:border-app-muted hover:text-app-text"
                }`}
              >
                {blockedCpIds.includes(selectedChokepoint.id)
                  ? "Restore chokepoint"
                  : "Block chokepoint"}
              </button>
            </div>
            {dataAsOf ? (
              <p className="font-mono text-[12px] text-app-muted">IMF PortWatch, to {dataAsOf}</p>
            ) : null}
          </div>
        ) : showingPort && selectedPort ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <Stat
                value={
                  portResult && portResult.disruption.recent !== null
                    ? portResult.disruption.recent.toFixed(1)
                    : "—"
                }
                label="7d avg port calls"
              />
              <Stat
                value={
                  portResult && portResult.disruption.baseline !== null
                    ? Math.round(portResult.disruption.baseline).toLocaleString()
                    : "—"
                }
                label="Baseline (median)"
              />
            </div>
            <Stat
              value={formatChange(portResult?.disruption.changePct ?? null)}
              label="vs baseline"
              tone={toneFor(portStatus)}
            />
            <section>
              <SectionTitle>Daily port calls</SectionTitle>
              <div className="mt-2">
                <PortChart
                  series={portChartSeries}
                  visible={portChartVisible}
                  baseline={portResult?.disruption.baseline ?? null}
                />
              </div>
            </section>
            <div className="grid grid-cols-2 gap-3">
              <Stat
                value={formatChange(portResult?.importTrend.changePct ?? null)}
                label="Import trend"
              />
              <Stat
                value={formatChange(portResult?.exportTrend.changePct ?? null)}
                label="Export trend"
              />
            </div>
            {dataAsOf ? (
              <p className="font-mono text-[12px] text-app-muted">IMF PortWatch, to {dataAsOf}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
});
