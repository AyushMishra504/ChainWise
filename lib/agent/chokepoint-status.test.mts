import test from "node:test";
import assert from "node:assert/strict";
import { getChokepointStatus } from "./chokepoint-status.ts";
import { agentErrorResponse } from "./errors.ts";
import type { PortwatchSnapshot } from "../portwatch-map.ts";

function snapshot(series: PortwatchSnapshot["series"]): PortwatchSnapshot {
  return {
    source: "live",
    fetchedAt: "2026-10-16T12:00:00.000Z",
    latestDate: "2026-10-16",
    series,
    attribution: "IMF PortWatch",
  };
}

test("returns measured status for a configured chokepoint", async () => {
  const result = await getChokepointStatus(
    { chokepointId: "suez-canal" },
    async () =>
      snapshot({
        chokepoint1: {
          portid: "chokepoint1",
          portname: "Suez Canal",
          days: Array.from({ length: 100 }, (_, index) => ({
            date: new Date(Date.UTC(2026, 6, index + 1)).toISOString().slice(0, 10),
            nTotal: 40,
          })),
        },
      }),
  );

  assert.equal(result.chokepointId, "suez-canal");
  assert.equal(result.name, "Suez Canal");
  assert.equal(result.dataSource, "live");
  assert.equal(result.measuredStatus, "normal");
  assert.equal(result.recent, 40);
  assert.equal(result.changePctPercent, 0);
  assert.equal(result.shortTermReference, "90-day median excluding the most recent 7 days");
  assert.equal(result.baseline2023, null);
  assert.equal(result.recent30DayAverage, 40);
  assert.equal(result.warnings.length, 0);
});

test("rejects unknown chokepoint IDs", async () => {
  await assert.rejects(
    getChokepointStatus({ chokepointId: "not-a-chokepoint" }, async () => snapshot({})),
    /Unknown configured chokepoint ID/,
  );
});

test("reports missing PortWatch data without fabricating metrics", async () => {
  const result = await getChokepointStatus(
    { chokepointId: "gulf-of-aden" },
    async () => snapshot({}),
  );

  assert.equal(result.displayStatus, "no-data");
  assert.equal(result.recent, null);
  assert.equal(result.baseline, null);
  assert.equal(result.changePct, null);
  assert.equal(result.changePctPercent, null);
  assert.match(result.warnings.join(" "), /No IMF PortWatch series/);
});

test("propagates source failures for the API to report", async () => {
  await assert.rejects(
    getChokepointStatus(
      { chokepointId: "suez-canal" },
      async () => {
        throw new Error("PortWatch unavailable");
      },
    ),
    /PortWatch unavailable/,
  );
});

test("classifies model quota errors as retryable rate-limit responses", () => {
  assert.deepEqual(
    agentErrorResponse(Object.assign(new Error("quota exceeded"), { statusCode: 429 })),
    { message: "Groq rate limit reached. Please try again shortly.", status: 429 },
  );
});

test("classifies provider failures as gateway errors", () => {
  assert.deepEqual(agentErrorResponse(new Error("Gemini unavailable")), {
    message: "Gemini unavailable",
    status: 502,
  });
});
