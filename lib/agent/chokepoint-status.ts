import { tool } from "ai";
import { z } from "zod";
import { chokepoints } from "../../data/chokepoints.ts";
import { analyzeSnapshot } from "../engine/analysis.ts";
import { getPortwatchSnapshot } from "../sources/portwatch.ts";
import type { PortwatchSnapshot } from "../portwatch-map.ts";

export const chokepointStatusInputSchema = z.object({
  chokepointId: z.string().min(1, "chokepointId is required"),
});

export const analystInterpretationSchema = z.object({
  executiveSummary: z.string().min(1).max(600),
  currentTraffic: z.string().min(1).max(400),
  structuralTrend: z.string().min(1).max(400),
  nextSteps: z.array(z.string().min(1).max(240)).max(3),
});

export type AnalystInterpretation = z.infer<typeof analystInterpretationSchema>;

export type ChokepointStatus = {
  chokepointId: string;
  name: string;
  /** Short-term status from the recent-vs-baseline calculation. */
  measuredStatus: string;
  /** UI status, which may include a structural long-term overlay. */
  displayStatus: string;
  displayStatusReason: string;
  baseline: number | null;
  recent: number | null;
  changePct: number | null;
  changePctPercent: number | null;
  shortTermReference: string;
  shortTermReferencePeriod: string;
  baseline2023: number | null;
  recent30DayAverage: number | null;
  structuralPct: number | null;
  structuralPctPercent: number | null;
  structuralReference: string | null;
  structuralReferencePeriod: string;
  latestDate: string | null;
  fetchedAt: string | null;
  dataSource: PortwatchSnapshot["source"] | "unavailable";
  warnings: string[];
};

export function isConfiguredChokepointId(chokepointId: string): boolean {
  return chokepoints.some((chokepoint) => chokepoint.id === chokepointId);
}

export async function getChokepointStatus(
  input: unknown,
  loadSnapshot: () => Promise<PortwatchSnapshot> = getPortwatchSnapshot,
): Promise<ChokepointStatus> {
  const { chokepointId } = chokepointStatusInputSchema.parse(input);
  const chokepoint = chokepoints.find((item) => item.id === chokepointId);
  if (!chokepoint) {
    throw new Error(`Unknown configured chokepoint ID: ${chokepointId}`);
  }

  const snapshot = await loadSnapshot();
  const result = analyzeSnapshot(snapshot, [chokepointId])[chokepointId];
  const warnings: string[] = [];

  if (result.displayStatus === "no-data") {
    warnings.push("No IMF PortWatch series is available for this configured chokepoint.");
  }
  if (result.baseline === null || result.recent === null) {
    warnings.push("One or more measured metrics are unavailable because the series is incomplete.");
  }
  if (snapshot.source !== "live") {
    warnings.push(`Data is served from the ${snapshot.source} PortWatch state.`);
  }
  if (result.baseline !== null && result.baseline < 5) {
    warnings.push("Short-term traffic volume is low; percentage changes can be sensitive to small count differences.");
  }

  const displayStatusReason =
    result.displayStatus === "severely-disrupted" && result.status === "normal"
      ? `Short-term traffic is normal, but the last 30 days are substantially below the ${result.structuralLabel} structural reference.`
      : result.displayStatus === "structurally-down"
        ? `Short-term traffic is not currently disrupted, but the last 30 days are below the ${result.structuralLabel} structural reference.`
        : `Display status follows the ${result.status} short-term measured status.`;

  return {
    chokepointId,
    name: chokepoint.name,
    measuredStatus: result.status,
    displayStatus: result.displayStatus,
    displayStatusReason,
    baseline: result.baseline,
    recent: result.recent,
    changePct: result.changePct,
    changePctPercent: result.changePct === null ? null : result.changePct * 100,
    shortTermReference: "90-day median excluding the most recent 7 days",
    shortTermReferencePeriod: result.latestDate
      ? `${result.latestDate} minus 8–90 days`
      : "unavailable",
    baseline2023: result.structuralReference,
    recent30DayAverage: result.structuralRecent,
    structuralPct: result.structuralPct,
    structuralPctPercent: result.structuralPct === null ? null : result.structuralPct * 100,
    structuralReference: result.structuralLabel,
    structuralReferencePeriod:
      result.structuralLabel === "2023" ? "all available daily observations in calendar year 2023" : "same 30-day window one year earlier",
    latestDate: result.latestDate ?? snapshot.latestDate,
    fetchedAt: snapshot.fetchedAt ?? null,
    dataSource: snapshot.source,
    warnings,
  };
}

export function createGetChokepointStatusTool(
  onEvent?: (event: {
    type: "tool_started" | "tool_completed" | "tool_failed";
    input?: { chokepointId: string };
    output?: ChokepointStatus;
    error?: string;
  }) => void,
) {
  return tool({
    description:
      "Read-only measured IMF PortWatch status for one configured ChainWise chokepoint. Use this before making any disruption claim.",
    inputSchema: chokepointStatusInputSchema,
    execute: async ({ chokepointId }) => {
      onEvent?.({ type: "tool_started", input: { chokepointId } });
      try {
        const output = await getChokepointStatus({ chokepointId });
        onEvent?.({ type: "tool_completed", output });
        return output;
      } catch (error) {
        onEvent?.({
          type: "tool_failed",
          error: error instanceof Error ? error.message : "Tool execution failed.",
        });
        throw error;
      }
    },
  });
}

export const getChokepointStatusTool = createGetChokepointStatusTool();
