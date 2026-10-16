"use client";

import { useRef, useState } from "react";

type AgentAnalysisProps = {
  chokepointId: string;
};

type ChokepointEvidence = {
  name: string;
  measuredStatus: string;
  displayStatus: string;
  displayStatusReason: string;
  baseline: number | null;
  recent: number | null;
  changePctPercent: number | null;
  structuralPctPercent: number | null;
  structuralReference: string | null;
  structuralReferencePeriod: string;
  shortTermReference: string;
  shortTermReferencePeriod: string;
  baseline2023: number | null;
  recent30DayAverage: number | null;
  latestDate: string | null;
  fetchedAt: string | null;
  dataSource: string;
  warnings: string[];
};

type AgentEvent =
  | { type: "investigation_started"; chokepointId: string }
  | { type: "tool_started"; toolName: string; input: unknown }
  | { type: "tool_completed"; toolName: string; output: ChokepointEvidence }
  | { type: "tool_failed"; toolName: string; error: string }
  | { type: "text_delta"; text: string }
  | {
      type: "analysis_completed";
      text: string;
      interpretation: {
        executiveSummary: string;
        currentTraffic: string;
        structuralTrend: string;
        nextSteps: string[];
      } | null;
      interpretationError?: string;
      steps: number;
      toolCalls: { toolName: string; input: unknown }[];
      toolResults: { toolName: string; output: unknown }[];
    }
  | { type: "error"; error: string };

type CachedAnalysis = {
  event: Extract<AgentEvent, { type: "analysis_completed" }>;
  evidence: ChokepointEvidence | null;
  cachedAt: number;
};

const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000;
const analysisCache = new Map<string, CachedAnalysis>();

function getCachedAnalysis(chokepointId: string): CachedAnalysis | null {
  const cached = analysisCache.get(chokepointId);
  if (!cached || Date.now() - cached.cachedAt >= ANALYSIS_CACHE_TTL_MS) {
    if (cached) analysisCache.delete(chokepointId);
    return null;
  }
  return cached;
}

function cacheAge(cachedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - cachedAt) / 1000));
  return seconds < 60 ? "just now" : `${Math.floor(seconds / 60)}m ago`;
}

function analysisTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function percent(value: number | null): string {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function evidenceSummary(evidence: ChokepointEvidence): string {
  const measured =
    evidence.measuredStatus === "normal"
      ? "Short-term traffic is normal."
      : `Short-term traffic is ${evidence.measuredStatus}.`;
  const metrics = `${percent(evidence.changePctPercent)} vs baseline`;
  const structural =
    evidence.structuralPctPercent === null
      ? "No structural comparison is available."
      : `${percent(evidence.structuralPctPercent)} vs ${evidence.structuralReference ?? "structural reference"}.`;
  return `${measured} Recent traffic is ${metrics}. ${structural}`;
}

export default function AgentAnalysis({ chokepointId }: AgentAnalysisProps) {
  const cached = getCachedAnalysis(chokepointId);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(
    cached ? "done" : "idle",
  );
  const [events, setEvents] = useState<AgentEvent[]>(
    cached?.evidence
      ? [
          { type: "investigation_started", chokepointId },
          { type: "tool_completed", toolName: "getChokepointStatus", output: cached.evidence },
          cached.event,
        ]
      : [],
  );
  const [cachedAt, setCachedAt] = useState<number | null>(cached?.cachedAt ?? null);
  const [servedFromCache, setServedFromCache] = useState(cached?.evidence !== null && cached !== null);
  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  async function analyze(forceRefresh = false): Promise<void> {
    if (!forceRefresh) {
      const cachedResult = getCachedAnalysis(chokepointId);
      if (cachedResult?.evidence) {
        setEvents([
          { type: "investigation_started", chokepointId },
          { type: "tool_completed", toolName: "getChokepointStatus", output: cachedResult.evidence },
          cachedResult.event,
        ]);
        setCachedAt(cachedResult.cachedAt);
        setServedFromCache(true);
        setState("done");
        return;
      }
    }

    const runId = runRef.current + 1;
    runRef.current = runId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState("loading");
    setEvents([{ type: "investigation_started", chokepointId }]);
    setCachedAt(null);
    setServedFromCache(false);

    try {
      const result = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chokepointId }),
        signal: controller.signal,
      });
      if (!result.ok || !result.body) {
        const body = (await result.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${result.status}`);
      }

      const reader = result.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed: Extract<AgentEvent, { type: "analysis_completed" }> | null = null;
      let evidence: ChokepointEvidence | null = null;

      const consume = (event: AgentEvent) => {
        if (runRef.current !== runId) return;
        if (event.type === "tool_completed") evidence = event.output;
        if (event.type === "analysis_completed") completed = event;
        setEvents((previous) => [...previous, event]);
        if (event.type === "error") throw new Error(event.error);
      };

      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) consume(JSON.parse(line) as AgentEvent);
        }
        if (done) break;
      }
      if (buffer.trim()) consume(JSON.parse(buffer) as AgentEvent);

      if (!completed) throw new Error("The investigation ended without a final report.");
      const receivedAt = Date.now();
      analysisCache.set(chokepointId, { event: completed, evidence, cachedAt: receivedAt });
      setCachedAt(receivedAt);
      setServedFromCache(false);
      setState("done");
    } catch (error) {
      if (controller.signal.aborted) {
        if (runRef.current === runId) setState("idle");
        return;
      }
      const message = error instanceof Error ? error.message : "Agent analysis failed.";
      setEvents((previous) => [...previous, { type: "error", error: message }]);
      setState("error");
    }

  }

  function cancel(): void {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setState("idle");
  }

  const completed = [...events].reverse().find(
    (event): event is Extract<AgentEvent, { type: "analysis_completed" }> =>
      event.type === "analysis_completed",
  );
  const evidence = [...events].reverse().find(
    (event): event is Extract<AgentEvent, { type: "tool_completed" }> =>
      event.type === "tool_completed",
  )?.output;

  return (
    <section className="rounded-[4px] border border-app-border bg-app-elevated/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-app-muted">
            Disruption investigation
          </h3>
          <p className="mt-1 text-[12px] text-app-muted">
            {evidence?.name ?? "Selected chokepoint"} · {state === "loading" ? "Investigating now" : "Evidence-grounded"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => analyze()}
            disabled={state === "loading"}
            className="rounded-[4px] border border-app-amber/40 px-2.5 py-1.5 text-[12px] font-medium text-app-amber transition hover:border-app-amber disabled:cursor-wait disabled:opacity-60"
          >
            {state === "loading" ? "Investigating…" : "Analyze disruption"}
          </button>
          {state === "loading" ? (
            <button
              type="button"
              onClick={cancel}
              className="text-[11px] text-app-muted underline-offset-2 transition hover:text-app-text hover:underline"
            >
              Cancel
            </button>
          ) : null}
          {state === "done" ? (
            <button
              type="button"
              onClick={() => analyze(true)}
              className="text-[11px] text-app-muted underline-offset-2 transition hover:text-app-text hover:underline"
            >
              Refresh
            </button>
          ) : null}
        </div>
      </div>

      {servedFromCache && cachedAt !== null && state === "done" ? (
        <p className="mt-2 text-[11px] text-app-muted">
          Served from cache · {cacheAge(cachedAt)} · expires after 5 minutes
        </p>
      ) : null}

      {events.length > 0 ? (
        <div className="mt-3 space-y-2 border-t border-app-divider pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">
            Investigation timeline
          </div>
          {events
            .filter((event) => event.type !== "analysis_completed" && event.type !== "text_delta")
            .map((event, index) => (
              <div key={`${event.type}-${index}`} className="flex gap-2 text-[12px]">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                  event.type === "error"
                    ? "bg-app-red"
                    : event.type === "tool_failed"
                      ? "bg-app-red"
                    : event.type === "tool_completed"
                      ? "bg-app-green"
                      : event.type === "tool_started"
                        ? "bg-app-amber"
                        : "bg-app-muted"
                }`} />
                <div className="min-w-0">
                  {event.type === "investigation_started" ? (
                    <>
                      <div className="text-app-text">Gathering evidence</div>
                      <div className="text-app-muted">Checking maritime traffic and current data quality.</div>
                    </>
                  ) : null}
                  {event.type === "tool_started" ? (
                    <>
                      <div className="text-app-text">Checking maritime traffic · Running</div>
                      <div className="text-app-muted">Retrieving transit metrics and baseline comparison.</div>
                    </>
                  ) : null}
                  {event.type === "tool_completed" ? (
                    <>
                      <div className="text-app-text">Checking maritime traffic · Completed · PortWatch</div>
                      <div className="text-app-muted">{evidenceSummary(event.output)}</div>
                    </>
                  ) : null}
                  {event.type === "tool_failed" ? (
                    <>
                      <div className="text-app-red">Checking maritime traffic · Failed</div>
                      <div className="text-app-red">{event.error}</div>
                    </>
                  ) : null}
                  {event.type === "error" ? <div className="text-app-red">{event.error}</div> : null}
                </div>
              </div>
            ))}
        </div>
      ) : null}

      {completed ? (
        <div className="mt-3 space-y-3 border-t border-app-divider pt-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">
              {completed ? "Investigation report" : "Preliminary finding"}
            </div>
            {cachedAt !== null ? (
              <div className="mt-1 text-[11px] text-app-muted">
                Analyzed {analysisTimestamp(cachedAt)}
              </div>
            ) : null}
            {evidence ? (
              <div className="mt-2 rounded-[4px] border border-app-border bg-app-input/60 p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] text-app-muted">Short-term status</div>
                    <div className="mt-0.5 text-[14px] font-medium capitalize text-app-text">
                      {evidence.measuredStatus.replace("-", " ")}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-app-muted">Display signal</div>
                    <div className="mt-0.5 text-[14px] font-medium text-app-amber">
                      {evidence.displayStatus.replaceAll("-", " ")}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-app-muted">Recent vs baseline</div>
                    <div className="mt-0.5 font-mono text-[13px] text-app-text">
                      {percent(evidence.changePctPercent)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-app-muted">
                      Structural vs {evidence.structuralReference ?? "reference"}
                    </div>
                    <div className="mt-0.5 font-mono text-[13px] text-app-text">
                      {percent(evidence.structuralPctPercent)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-app-muted">Recent 30-day average</div>
                    <div className="mt-0.5 font-mono text-[13px] text-app-text">
                      {evidence.recent30DayAverage == null ? "—" : evidence.recent30DayAverage.toFixed(2)} transits/day
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-app-muted">Structural reference</div>
                    <div className="mt-0.5 font-mono text-[13px] text-app-text">
                      {evidence.baseline2023 == null ? "—" : evidence.baseline2023.toFixed(2)} transits/day
                    </div>
                  </div>
                </div>
                <p className="mt-3 border-t border-app-divider pt-2 text-[12px] leading-relaxed text-app-muted">
                  {evidence.displayStatusReason}
                </p>
                <p className="mt-2 text-[11px] text-app-muted">
                  Short-term reference: {evidence.shortTermReferencePeriod}. Structural reference: {evidence.structuralReferencePeriod}.
                  {" "}Source: {evidence.dataSource}; latest data: {evidence.latestDate ?? "unavailable"}.
                </p>
                {evidence.warnings.length > 0 ? (
                  <div className="mt-2 border-t border-app-divider pt-2 text-[11px] text-app-amber">
                    <div className="font-semibold">Data-quality warnings</div>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {evidence.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">
                Executive interpretation
              </div>
              {completed.interpretation ? (
                <div className="mt-2 space-y-3 text-[13px] leading-relaxed text-app-text">
                  <p>{completed.interpretation.executiveSummary}</p>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">
                      Current traffic
                    </div>
                    <p className="mt-1">{completed.interpretation.currentTraffic}</p>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">
                      Structural trend
                    </div>
                    <p className="mt-1">{completed.interpretation.structuralTrend}</p>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">
                      Suggested next steps
                    </div>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {completed.interpretation.nextSteps.map((step) => <li key={step}>{step}</li>)}
                    </ul>
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-[12px] text-app-muted">
                  {completed.interpretationError ?? "No validated interpretation was returned. Verified metrics remain available."}
                </p>
              )}
            </div>
          </div>
          {completed ? <details className="text-[11px] text-app-muted">
            <summary className="cursor-pointer hover:text-app-text">Technical details</summary>
            <div className="mt-2 space-y-2 font-mono">
              {completed.toolCalls.map((call, index) => (
                <div key={`${call.toolName}-${index}`} className="rounded-[3px] bg-app-input p-2">
                  <div className="text-app-amber">{call.toolName}</div>
                  <div>input: {JSON.stringify(call.input)}</div>
                  {completed.toolResults[index] ? (
                    <div className="mt-1 break-words">result: {JSON.stringify(completed.toolResults[index].output)}</div>
                  ) : null}
                </div>
              ))}
            </div>
          </details> : null}
        </div>
      ) : null}
    </section>
  );
}
