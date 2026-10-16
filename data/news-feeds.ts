/*
 * Trade-news RSS feeds used as the independent second source.
 *
 * Only feeds that were verified to return valid RSS with items and to be
 * allowed by their site's robots.txt are listed here. Google News RSS is
 * deliberately excluded (robots disallows it). This file is dependency-free so
 * it can be imported by both the server source and the browser.
 */

export type NewsFeed = {
  id: string;
  /** Display name, used as the item "source" and in the Data sources modal. */
  name: string;
  /** RSS endpoint that is polled. */
  url: string;
  /** Site homepage linked from the Data sources modal. */
  homepage: string;
};

export const NEWS_FEEDS: NewsFeed[] = [
  { id: "gcaptain", name: "gCaptain", url: "https://gcaptain.com/feed/", homepage: "https://gcaptain.com/" },
  { id: "splash247", name: "Splash 247", url: "https://splash247.com/feed/", homepage: "https://splash247.com/" },
  {
    id: "hellenic",
    name: "Hellenic Shipping News",
    url: "https://www.hellenicshippingnews.com/feed/",
    homepage: "https://www.hellenicshippingnews.com/",
  },
  { id: "loadstar", name: "The Loadstar", url: "https://theloadstar.com/feed/", homepage: "https://theloadstar.com/" },
];

/** One headline kept from a feed. Only metadata + the short feed summary. */
export type NewsItem = {
  title: string;
  link: string;
  /** Publication date, YYYY-MM-DD (UTC). */
  date: string;
  /** Feed name, e.g. "gCaptain". */
  source: string;
  /** Short feed summary (HTML stripped, truncated). Never the full article. */
  description: string;
};

export type NewsFeedStatus = {
  id: string;
  name: string;
  url: string;
  ok: boolean;
  items: number;
  error: string | null;
};

/**
 * Where a news payload came from:
 * - "live"     fetched from the feeds during this request
 * - "cache"    served from the 30-minute in-memory / on-disk cache
 * - "snapshot" served from the committed offline fallback
 */
export type NewsSource = "live" | "cache" | "snapshot";

export type NewsSnapshot = {
  source: NewsSource;
  /** When ChainWise retrieved/assembled the payload (ISO 8601). */
  fetchedAt: string | null;
  /** Deduped (by link) items, newest first. */
  items: NewsItem[];
  /** Per-feed fetch outcome for the Data sources modal / diagnostics. */
  feeds: NewsFeedStatus[];
  attribution: string;
};

export const NEWS_ATTRIBUTION = "Trade-news RSS";