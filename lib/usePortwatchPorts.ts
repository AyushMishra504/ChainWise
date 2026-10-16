"use client";

import { useEffect, useRef, useState } from "react";
import { ports } from "@/data/ports";
import type { PortwatchPortsSnapshot } from "@/lib/portwatch-map";
import { analyzePorts } from "@/lib/engine/portAnalysis";
import type { PortAnalysis } from "@/lib/engine/portAnalysis";

export type PortwatchPortsState = {
  snapshot: PortwatchPortsSnapshot | null;
  analysis: Record<string, PortAnalysis> | null;
  loading: boolean;
  error: string | null;
};

export type PortwatchPortsLoaded = {
  snapshot: PortwatchPortsSnapshot;
  analysis: Record<string, PortAnalysis>;
};

const INITIAL: PortwatchPortsState = {
  snapshot: null,
  analysis: null,
  loading: true,
  error: null,
};

/**
 * Load the PortWatch ports snapshot from our server route and derive per-port
 * analysis. Mirrors lib/usePortwatch.ts: fetching is server-side; `onLoaded`
 * fires once from the async path so callers can seed the event log.
 */
export function usePortwatchPorts(
  onLoaded?: (loaded: PortwatchPortsLoaded) => void,
): PortwatchPortsState {
  const [state, setState] = useState<PortwatchPortsState>(INITIAL);
  const onLoadedRef = useRef(onLoaded);

  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/portwatch-ports");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const snapshot = (await response.json()) as PortwatchPortsSnapshot;
        if (cancelled) return;
        const analysis = analyzePorts(snapshot, ports.map((port) => port.id));
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
