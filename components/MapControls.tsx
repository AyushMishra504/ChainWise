"use client";

import { useState } from "react";

export type LayerKey = "routes" | "chokepoints" | "ports";

const LAYER_ROWS: { key: LayerKey; label: string }[] = [
  { key: "routes", label: "Routes" },
  { key: "chokepoints", label: "Chokepoints" },
  { key: "ports", label: "Ports" },
];

type MapControlsProps = {
  layers: Record<LayerKey, boolean>;
  onToggleLayer: (key: LayerKey) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenterIndia: () => void;
};

export default function MapControls({
  layers,
  onToggleLayer,
  onZoomIn,
  onZoomOut,
  onCenterIndia,
}: MapControlsProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="pointer-events-auto flex select-none items-center gap-1.5">
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex h-8 items-center gap-1.5 rounded-[4px] border border-app-border bg-app-surface px-2.5 text-[12px] text-app-text transition hover:border-app-muted"
        >
          <span>Layers</span>
          <svg
            className={`h-3 w-3 text-app-muted transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
          </svg>
        </button>

        {open ? (
          <div className="absolute bottom-full right-0 z-40 mb-1.5 w-36 divide-y divide-app-divider rounded-[4px] border border-app-border bg-app-panel py-1 text-[12px] shadow-panel">
            {LAYER_ROWS.map(({ key, label }) => (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-app-text hover:bg-app-elevated"
              >
                <input
                  type="checkbox"
                  checked={layers[key]}
                  onChange={() => onToggleLayer(key)}
                  className="h-3.5 w-3.5 accent-app-muted"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex items-center overflow-hidden rounded-[4px] border border-app-border bg-app-surface">
        <button
          onClick={onZoomIn}
          title="Zoom in"
          className="flex h-8 w-8 items-center justify-center border-r border-app-border text-app-text transition hover:bg-app-elevated"
        >
          +
        </button>
        <button
          onClick={onZoomOut}
          title="Zoom out"
          className="flex h-8 w-8 items-center justify-center text-app-text transition hover:bg-app-elevated"
        >
          −
        </button>
      </div>

      <button
        onClick={onCenterIndia}
        className="h-8 rounded-[4px] border border-app-border bg-app-surface px-2.5 text-[12px] text-app-text transition hover:border-app-muted"
      >
        Center India
      </button>
    </div>
  );
}
