/*
 * Historical disruption replays, driven entirely by real IMF PortWatch data.
 * Window dates are the documented event periods; the measured impact shown on
 * each card (see lib/engine/replay.ts) is computed from the data itself.
 */

export type Scenario = {
  id: string;
  name: string;
  kind: "historical" | "ongoing";
  /** Chokepoints affected by the event. */
  chokepointIds: string[];
  /** Replay start; null means detect it from the PortWatch series. */
  start: string | null;
  /** Replay end; null means use the latest PortWatch date. */
  end: string | null;
  /** Only shown when supplied by the source scenario. */
  blurb: string | null;
};

export const scenarios: Scenario[] = [
  {
    id: "ever-given-2021",
    name: "Ever Given Suez blockage",
    kind: "historical",
    chokepointIds: ["suez-canal"],
    start: "2021-03-15",
    end: "2021-04-15",
    blurb: "Container ship grounded across the Suez Canal, halting transits.",
  },
  {
    id: "red-sea-2023",
    name: "Red Sea crisis",
    kind: "historical",
    chokepointIds: ["bab-el-mandeb", "suez-canal"],
    start: "2023-11-01",
    end: "2024-03-31",
    blurb: "Attacks on shipping pushed carriers away from the Bab-el-Mandeb.",
  },
  {
    id: "panama-drought-2023",
    name: "Panama drought",
    kind: "historical",
    chokepointIds: ["panama-canal"],
    start: "2023-08-01",
    end: "2024-02-28",
    blurb: "Drought cut the Panama Canal's daily transit slots.",
  },
  {
    id: "hormuz-crisis-2026",
    name: "Hormuz crisis 2026",
    kind: "ongoing",
    chokepointIds: ["strait-of-hormuz"],
    start: null,
    end: null,
    blurb: null,
  },
];

export const scenarioById = (id: string | null): Scenario | null =>
  id ? scenarios.find((scenario) => scenario.id === id) ?? null : null;
