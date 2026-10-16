"use client";

import { useEffect, useRef, useState } from "react";
import type { NewsSnapshot } from "@/data/news-feeds";

export type NewsState = {
  snapshot: NewsSnapshot | null;
  loading: boolean;
  error: string | null;
};

const INITIAL: NewsState = { snapshot: null, loading: true, error: null };

export function useNews(): NewsState {
  const [state, setState] = useState<NewsState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/news");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const snapshot = (await response.json()) as NewsSnapshot;
        if (cancelled) return;
        setState({ snapshot, loading: false, error: null });
      } catch (error) {
        if (cancelled) return;
        setState({ ...INITIAL, loading: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}
