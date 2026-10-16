"use client";

import type { LogEvent } from "@/components/BottomStrip";

type EventLogOverlayProps = {
  events: LogEvent[];
  onClose: () => void;
};

export default function EventLogOverlay({ events, onClose }: EventLogOverlayProps) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-40 max-h-[40dvh] overflow-y-auto border-t border-app-border bg-app-panel shadow-panel">
      <div className="mx-auto max-w-7xl px-4 py-2.5">
        <div className="mb-2 flex items-center justify-between border-b border-app-divider pb-2">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-app-muted">
            Event log
          </span>
          <button
            onClick={onClose}
            className="text-[12px] text-app-muted transition hover:text-app-text hover:underline"
          >
            Close ✕
          </button>
        </div>
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-app-divider text-app-muted">
              <th className="w-24 pb-1 font-normal">Time</th>
              <th className="w-40 pb-1 font-normal">Source</th>
              <th className="pb-1 font-normal">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-divider">
            {events.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-2 text-app-muted">
                  No events yet — the log fills as live feeds land.
                </td>
              </tr>
            ) : (
              events.map((event) => (
                <tr key={event.id}>
                  <td className="py-1.5 font-mono text-app-muted">{event.time}</td>
                  <td className="py-1.5 text-app-text">{event.source}</td>
                  <td className="py-1.5 text-app-muted">{event.message}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
