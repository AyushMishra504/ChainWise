import test from "node:test";
import assert from "node:assert/strict";
import {
  combineCorroboration,
  corroborateAll,
  isTransitDown,
  matchesAliases,
  newsSignal,
  recentHeadlines,
  CORROBORATION_LABEL,
  ELEVATED_MIN_MENTIONS,
  HEADLINE_LIMIT,
  NEWS_WINDOW_DAYS,
  type NewsSignal,
} from "./corroboration.ts";
import type { NewsItem } from "../../data/news-feeds.ts";
import type { NewsQuery } from "../../data/news-queries.ts";
import type { DisplayStatus } from "./disruption.ts";

const NOW = "2026-10-16";

function item(date: string, title: string, description = "", source = "Test Feed"): NewsItem {
  return { date, title, description, link: `https://example.com/${date}/${title.replace(/\W+/g, "-")}`, source };
}

/** A signal with N recent mentions. */
function signal(id: string, recentMentions: number): NewsSignal {
  return {
    chokepointId: id,
    recentMentions,
    elevated: recentMentions >= ELEVATED_MIN_MENTIONS,
    headlines: [],
  };
}

// ---- alias matching ----

test("matches aliases case-insensitively on title and description", () => {
  const aliases = ["Strait of Hormuz", "Hormuz"];
  assert.equal(matchesAliases(item(NOW, "STRAIT OF HORMUZ tension rises"), aliases), true);
  assert.equal(matchesAliases(item(NOW, "Tanker rerouted", "near the hormuz chokepoint"), aliases), true);
  assert.equal(matchesAliases(item(NOW, "Panama Canal drought"), aliases), false);
});

test("normalizes non-breaking spaces before matching", () => {
  assert.equal(matchesAliases(item(NOW, "Red\u00a0Sea shipping"), ["Red Sea"]), true);
});

test("aliases match as plain case-insensitive substrings", () => {
  assert.equal(matchesAliases(item(NOW, "Gibraltar tax rules"), ["Gibraltar"]), true);
  // Matching is substring-based, so a longer word containing the alias matches.
  assert.equal(matchesAliases(item(NOW, "Malaccan history"), ["Malacca"]), true);
  // An alias that is genuinely absent does not match.
  assert.equal(matchesAliases(item(NOW, "Malaccan history"), ["Malta"]), false);
});

// ---- 7-day window ----

test("recentHeadlines keeps only items within the window, newest first", () => {
  const aliases = ["Suez"];
  const items = [
    item("2026-10-16", "Suez update A"),
    item("2026-10-10", "Suez update B"),
    item("2026-10-09", "Suez update C"), // 7 days back boundary: 10-10..10-16 inclusive
    item("2026-09-01", "Suez update D"), // too old
  ];
  const matched = recentHeadlines(items, aliases, NOW);
  assert.deepEqual(
    matched.map((m) => m.date),
    ["2026-10-16", "2026-10-10"],
  );
  // Window is inclusive of (window-1) days back.
  const cutoff = recentHeadlines([item("2026-10-09", "Suez edge")], aliases, NOW);
  assert.equal(cutoff.length, 0);
  assert.equal(NEWS_WINDOW_DAYS, 7);
});

test("recentHeadlines ignores items dated after the as-of date", () => {
  const matched = recentHeadlines([item("2026-10-17", "Suez future")], ["Suez"], NOW);
  assert.equal(matched.length, 0);
});

// ---- elevated threshold ----

test("elevated requires at least the named minimum mentions", () => {
  const items = [
    item("2026-10-16", "Hormuz one"),
    item("2026-10-15", "Hormuz two"),
    item("2026-10-14", "Hormuz three"),
    item("2026-10-13", "Hormuz four"),
  ];
  const below = newsSignal("strait-of-hormuz", ["Hormuz"], items.slice(0, 2), NOW);
  assert.equal(below.recentMentions, 2);
  assert.equal(below.elevated, false);

  const at = newsSignal("strait-of-hormuz", ["Hormuz"], items.slice(0, 3), NOW);
  assert.equal(at.recentMentions, 3);
  assert.equal(at.elevated, true);
  assert.equal(ELEVATED_MIN_MENTIONS, 3);
});

test("newsSignal caps headlines but counts all recent mentions", () => {
  // 8 mentions inside the 7-day window (10-10..10-16); two share a date because
  // a mention is an item, not a distinct day.
  const items = [
    "2026-10-16",
    "2026-10-16",
    "2026-10-15",
    "2026-10-14",
    "2026-10-13",
    "2026-10-12",
    "2026-10-11",
    "2026-10-10",
  ].map((date) => item(date, "Hormuz"));
  const signal8 = newsSignal("strait-of-hormuz", ["Hormuz"], items, NOW);
  assert.equal(signal8.recentMentions, 8);
  assert.equal(signal8.headlines.length, HEADLINE_LIMIT);
});

// ---- combined status ----

test("combine: corroborated when transit down and news elevated", () => {
  assert.equal(combineCorroboration("disrupted", signal("x", 3), true), "corroborated");
  assert.equal(combineCorroboration("severely-disrupted", signal("x", 5), true), "corroborated");
  assert.equal(combineCorroboration("structurally-down", signal("x", 4), true), "corroborated");
});

test("combine: unconfirmed when transit down but news not elevated", () => {
  assert.equal(combineCorroboration("disrupted", signal("x", 2), true), "unconfirmed");
  assert.equal(combineCorroboration("structurally-down", signal("x", 0), true), "unconfirmed");
});

test("combine: early warning when news elevated but transit not down", () => {
  assert.equal(combineCorroboration("normal", signal("x", 3), true), "early-warning");
  assert.equal(combineCorroboration("watch", signal("x", 6), true), "early-warning");
});

test("combine: quiet when neither", () => {
  assert.equal(combineCorroboration("normal", signal("x", 1), true), "quiet");
  assert.equal(combineCorroboration("low-volume", signal("x", 0), true), "quiet");
  assert.equal(combineCorroboration("no-data", signal("x", 0), true), "quiet");
});

test("combine: no news data overrides everything when no items available", () => {
  assert.equal(combineCorroboration("disrupted", signal("x", 9), false), "no-news-data");
  assert.equal(combineCorroboration("normal", signal("x", 0), false), "no-news-data");
});

test("isTransitDown only flags the three down statuses", () => {
  const down: DisplayStatus[] = ["disrupted", "severely-disrupted", "structurally-down"];
  const notDown: DisplayStatus[] = ["normal", "watch", "low-volume", "no-data"];
  for (const s of down) assert.equal(isTransitDown(s), true, s);
  for (const s of notDown) assert.equal(isTransitDown(s), false, s);
});

test("every combined status has a plain-language label", () => {
  for (const status of ["corroborated", "unconfirmed", "early-warning", "quiet", "no-news-data"] as const) {
    assert.ok(CORROBORATION_LABEL[status].length > 0);
  }
});

// ---- corroborateAll / missing data ----

const queries: NewsQuery[] = [
  { chokepointId: "strait-of-hormuz", name: "Strait of Hormuz", aliases: ["Hormuz"] },
  { chokepointId: "suez-canal", name: "Suez Canal", aliases: ["Suez"] },
];

test("corroborateAll combines transit status with per-chokepoint mentions", () => {
  const items = [
    item("2026-10-16", "Hormuz tanker incident"),
    item("2026-10-15", "Hormuz closure fears"),
    item("2026-10-14", "Hormuz disruption"),
  ];
  const result = corroborateAll(queries, items, { "strait-of-hormuz": "disrupted", "suez-canal": "normal" }, NOW);
  assert.equal(result["strait-of-hormuz"].status, "corroborated");
  assert.equal(result["strait-of-hormuz"].signal.recentMentions, 3);
  assert.equal(result["suez-canal"].status, "quiet");
});

test("corroborateAll returns no-news-data for all chokepoints when there are no items", () => {
  const result = corroborateAll(queries, [], { "strait-of-hormuz": "disrupted" }, NOW);
  assert.equal(result["strait-of-hormuz"].status, "no-news-data");
  assert.equal(result["suez-canal"].status, "no-news-data");
});

test("corroborateAll handles a chokepoint with no transit entry (no-data)", () => {
  const items = [item("2026-10-16", "Mozambique channel piracy"), item("2026-10-15", "Mozambique report"), item("2026-10-14", "Mozambique alert")];
  const q: NewsQuery[] = [{ chokepointId: "mozambique-channel", name: "Mozambique Channel", aliases: ["Mozambique"] }];
  const result = corroborateAll(q, items, {}, NOW);
  // No transit data at all => news elevated but transit not down => early warning.
  assert.equal(result["mozambique-channel"].status, "early-warning");
  assert.equal(result["mozambique-channel"].signal.elevated, true);
});