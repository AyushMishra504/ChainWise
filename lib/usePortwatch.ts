"use client";

import { useEffect, useRef, useState } from "react";
import { chokepoints } from "@/data/chokepoints";
import type { PortwatchSnapshot } from "@/lib/portwatch-map";
import { analyzeSnapshot } from "@/lib/engine/analysis";
import type { ChokepointAnalysis } from "@/lib/engine/analysis";

export type PortwatchState = {
  snapshot: PortwatchSnapshot | null;
  analysis: ChokepointAnalysis | null;
  loading: boolean;
  error: string | null;
};

export type PortwatchLoaded = {
  snapshot: PortwatchSnapshot;
  analysis: ChokepointAnalysis;
};

const INITIAL: PortwatchState = {
  snapshot: null,
  analysis: null,
  loading: true,
  error: null,
};

/**
 * Load the PortWatch snapshot from our server route and derive per-chokepoint
 * disruption results. All fetching happens server-side; the browser only
 * consumes the resulting JSON.
 *
 * `onLoaded` fires once from the async path (not synchronously during render)
 * so callers can, e.g., seed the event log without triggering cascading render
 * lint errors.
 */
export function usePortwatch(onLoaded?: (loaded: PortwatchLoaded) => void): PortwatchState {
  const [state, setState] = useState<PortwatchState>(INITIAL);
  const onLoadedRef = useRef(onLoaded);

  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/portwatch");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const snapshot = (await response.json()) as PortwatchSnapshot;
        if (cancelled) return;
        const analysis = analyzeSnapshot(snapshot, chokepoints.map((c) => c.id));
        setState({ snapshot, analysis, loading: false, error: null });
        onLoadedRef.current?.({ snapshot, analysis });
      } catch (error) {
        if (cancelled) return;
        setState({ ...INITIAL, loading: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
