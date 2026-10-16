"use client";

import { useState } from "react";
import type { PortwatchSource } from "@/lib/portwatch-map";
import { NEWS_FEEDS } from "@/data/news-feeds";

export type SearchOption = {
  id: string;
  label: string;
  type: "port" | "route" | "chokepoint" | "scenario";
  detail: string;
};

type TopBarProps = {
  /** Latest PortWatch data date, shown in the live status chip. */
  dataAsOf: string | null;
  dataSource: PortwatchSource | null;
  /** Name of the scenario being replayed, or null while live. */
  replayName: string | null;
  searchOptions: SearchOption[];
  onSearchSelect: (option: SearchOption) => void;
};

const SOURCE_SUFFIX: Record<PortwatchSource, string> = {
  live: "",
  cache: " (cached)",
  snapshot: " (snapshot)",
};

export default function TopBar({
  dataAsOf,
  dataSource,
  replayName,
  searchOptions,
  onSearchSelect,
}: TopBarProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [query, setQuery] = useState("");
  const live = replayName === null;
  const matches = query.trim()
    ? searchOptions
        .filter((option) => `${option.label} ${option.detail}`.toLowerCase().includes(query.trim().toLowerCase()))
        .slice(0, 8)
    : [];

  return (
    <header className="z-40 col-span-full flex h-14 shrink-0 select-none items-center justify-between gap-4 border-b border-app-border bg-app-panel px-4">
      <div className="flex items-center gap-3">
        <span className="text-[14px] font-semibold tracking-tight text-app-text">ChainWise</span>
      </div>

      <div className="relative hidden w-80 max-w-sm md:block">
        <input
          type="text"
          placeholder="Search port, route, or chokepoint"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
            if (event.key === "Enter" && matches[0]) {
              onSearchSelect(matches[0]);
              setQuery("");
            }
          }}
          role="combobox"
          aria-label="Search ports, routes, chokepoints, and scenarios"
          aria-expanded={matches.length > 0}
          aria-controls="search-suggestions"
          className="w-full rounded-[4px] border border-app-border bg-app-input px-3 py-1.5 text-[14px] text-app-text placeholder-app-muted transition focus:border-app-muted focus:outline-none"
        />
        {matches.length > 0 ? (
          <ul
            id="search-suggestions"
            className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-[4px] border border-app-border bg-app-panel shadow-panel"
          >
            {matches.map((option) => (
              <li key={`${option.type}-${option.id}`}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-app-elevated"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onSearchSelect(option);
                    setQuery("");
                  }}
                >
                  <span className="min-w-0 truncate text-[12px] text-app-text">{option.label}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-app-muted">
                    {option.type}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setSourcesOpen(true)}
          className="rounded-[4px] border border-app-border bg-app-panel px-2.5 py-1.5 text-[12px] text-app-muted transition hover:border-app-muted hover:text-app-text"
        >
          Data sources
        </button>
        {live && dataAsOf ? (
          <span
            title="Live IMF PortWatch data"
            className="flex items-center gap-2 rounded-[4px] border border-app-border bg-app-panel px-2.5 py-1.5 text-[12px] text-app-text"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-app-route" />
            <span>
              Live, data to <span className="font-mono">{dataAsOf}</span>
              {dataSource ? SOURCE_SUFFIX[dataSource] : ""}
            </span>
          </span>
        ) : null}
        {replayName ? (
          <span
            title="Historical replay in progress"
            className="flex items-center gap-2 rounded-[4px] border border-app-amber/30 bg-app-panel px-2.5 py-1.5 text-[12px] text-app-text"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-app-amber" />
            <span>
              Replay: <span className="text-app-amber">{replayName}</span>
            </span>
          </span>
        ) : null}
      </div>

      {sourcesOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSourcesOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-[4px] border border-app-border bg-app-panel shadow-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-app-border px-4 py-3">
              <h2 className="text-[14px] font-semibold text-app-text">Data sources</h2>
              <button
                onClick={() => setSourcesOpen(false)}
                aria-label="Close data sources"
                className="rounded-[4px] p-1 text-app-muted transition hover:bg-app-input hover:text-app-text"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="space-y-4 p-4 text-[12px]">
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-wider text-app-muted">Transit &amp; trade data</div>
                <a
                  href="https://portwatch.imf.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block text-app-text transition hover:underline"
                >
                  IMF PortWatch
                </a>
                <p className="mt-0.5 text-app-muted">
                  Daily chokepoint transits and port calls / estimated trade volumes.
                </p>
              </div>
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-wider text-app-muted">Trade-news feeds</div>
                <ul className="mt-1 space-y-1">
                  {NEWS_FEEDS.map((feed) => (
                    <li key={feed.id}>
                      <a
                        href={feed.homepage}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-app-text transition hover:underline"
                      >
                        {feed.name}
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-app-muted">
                  Headlines are feed titles and short summaries only, shown with links back to the publisher. No full article
                  text is stored.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
