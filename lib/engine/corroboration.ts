/*
 * Corroboration: combine the IMF PortWatch transit status with independent
 * trade-news coverage. Pure and dependency-free (no runtime "@/..." imports), so
 * Node can load it directly for the unit tests.
 *
 *   recentMentions = matching news items dated within the last 7 days.
 *   elevated       = recentMentions >= ELEVATED_MIN_MENTIONS.
 *
 * Combined status:
 *   corroborated   transit down AND news elevated
 *   unconfirmed    transit down, news not elevated
 *   early warning  news elevated, transit not down
 *   quiet          neither
 *   no news data   no news items available at all
 */

import { addDays } from "./dates.ts";
import type { NewsItem } from "../../data/news-feeds.ts";
import type { NewsQuery } from "../../data/news-queries.ts";
import type { DisplayStatus } from "./disruption.ts";

/** How many days back "recent" coverage reaches (inclusive of the as-of day). */
export const NEWS_WINDOW_DAYS = 7;
/** Minimum recent mentions for coverage to count as elevated. */
export const ELEVATED_MIN_MENTIONS = 3;
/** Headlines surfaced per chokepoint in the UI. */
export const HEADLINE_LIMIT = 5;

export type CorroborationStatus =
  | "corroborated"
  | "unconfirmed"
  | "early-warning"
  | "quiet"
  | "no-news-data";

export type NewsSignal = {
  chokepointId: string;
  /** Matching items within the 7-day window. */
  recentMentions: number;
  elevated: boolean;
  /** Newest-first matching headlines (up to HEADLINE_LIMIT). */
  headlines: NewsItem[];
};

export type ChokepointNews = {
  chokepointId: string;
  status: CorroborationStatus;
  signal: NewsSignal;
};

export const CORROBORATION_LABEL: Record<CorroborationStatus, string> = {
  corroborated: "Corroborated",
  unconfirmed: "Unconfirmed",
  "early-warning": "Early warning",
  quiet: "Quiet",
  "no-news-data": "No news data",
};

/** Plain-language description of the combined status (no cause text). */
export const CORROBORATION_DETAIL: Record<CorroborationStatus, string> = {
  corroborated: "Transits down and trade-news coverage elevated.",
  unconfirmed: "Transits down but trade-news coverage not elevated.",
  "early-warning": "Trade-news coverage elevated while transits are normal.",
  quiet: "No elevated coverage and transits normal.",
  "no-news-data": "No trade-news items available.",
};

function normalize(text: string): string {
  return text.replace(/\u00a0/g, " ").toLowerCase();
}

/** True when any alias appears in the item's title or description. */
export function matchesAliases(item: NewsItem, aliases: string[]): boolean {
  const text = normalize(`${item.title} ${item.description}`);
  return aliases.some((alias) => text.includes(normalize(alias)));
}

/** Newest-first matching items within `windowDays` up to and including `nowDate`. */
export function recentHeadlines(
  items: NewsItem[],
  aliases: string[],
  nowDate: string,
  windowDays: number = NEWS_WINDOW_DAYS,
): NewsItem[] {
  const cutoff = addDays(nowDate, -(windowDays - 1));
  return items
    .filter((item) => item.date >= cutoff && item.date <= nowDate && matchesAliases(item, aliases))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Compute the news signal for one chokepoint. */
export function newsSignal(
  chokepointId: string,
  aliases: string[],
  items: NewsItem[],
  nowDate: string,
): NewsSignal {
  const matched = recentHeadlines(items, aliases, nowDate);
  return {
    chokepointId,
    recentMentions: matched.length,
    elevated: matched.length >= ELEVATED_MIN_MENTIONS,
    headlines: matched.slice(0, HEADLINE_LIMIT),
  };
}

/** Transit statuses that count as "down" for corroboration. */
export function isTransitDown(status: DisplayStatus): boolean {
  return status === "disrupted" || status === "severely-disrupted" || status === "structurally-down";
}

/** Combine a transit status with a news signal into the corroboration status. */
export function combineCorroboration(
  transit: DisplayStatus,
  signal: NewsSignal,
  hasNewsData: boolean,
): CorroborationStatus {
  if (!hasNewsData) return "no-news-data";
  const down = isTransitDown(transit);
  if (down && signal.elevated) return "corroborated";
  if (down) return "unconfirmed";
  if (signal.elevated) return "early-warning";
  return "quiet";
}

/**
 * Compute the corroboration status for every supplied chokepoint. `hasNewsData`
 * is false when no news items are available (feeds unavailable), which makes the
 * whole set "no news data" rather than inventing a quiet reading.
 */
export function corroborateAll(
  queries: NewsQuery[],
  items: NewsItem[],
  transitByChokepoint: Record<string, DisplayStatus | undefined>,
  nowDate: string,
): Record<string, ChokepointNews> {
  const hasNewsData = items.length > 0;
  const out: Record<string, ChokepointNews> = {};
  for (const query of queries) {
    const signal = newsSignal(query.chokepointId, query.aliases, items, nowDate);
    const transit = transitByChokepoint[query.chokepointId] ?? "no-data";
    out[query.chokepointId] = {
      chokepointId: query.chokepointId,
      status: combineCorroboration(transit, signal, hasNewsData),
      signal,
    };
  }
  return out;
}