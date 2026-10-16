'use client'

import { useMemo, useState } from 'react'
import Map from '@/components/Map'
import { chokepoints } from '@/data/chokepoints'
import type { Chokepoint } from '@/data/chokepoints'
import { ports } from '@/data/ports'
import { routes as routeDefs, computeAllRoutes } from '@/data/routes'
import type { ComputedRoute } from '@/data/routes'
import { rerouteAvoiding, daysForKm } from '@/lib/seaRouting'
import type { Reroute } from '@/lib/seaRouting'

export default function Home() {
  const [selectedRoute, setSelectedRoute] = useState<ComputedRoute | null>(null)
  const [blockedCpId, setBlockedCpId] = useState<string | null>(null)
  const [reroute, setReroute] = useState<Reroute | null>(null)

  // Sea paths are computed once from the static port/chokepoint data.
  const computedRoutes = useMemo(() => computeAllRoutes(routeDefs, ports, chokepoints), [])

  // When a chokepoint is blocked, recompute the selected route avoiding it.
  const handleBlockToggle = (chokepoint: Chokepoint) => {
    if (!selectedRoute) return

    // Toggle off if this chokepoint is already the blocked one.
    if (blockedCpId === chokepoint.id) {
      setBlockedCpId(null)
      setReroute(null)
      return
    }

    // Build the original SeaPath for rerouteAvoiding, using the route's
    // computed geometry (never the on-screen detour).
    const original = {
      coords: selectedRoute.path,
      lengthKm: selectedRoute.lengthKm,
      days: daysForKm(selectedRoute.lengthKm),
    }
    setBlockedCpId(chokepoint.id)
    setReroute(rerouteAvoiding(original, chokepoint))
  }

  // Routes drawn on the map: when a chokepoint is blocked and the selected route
  // has a detour, replace its path with the detour.
  const displayRoutes = useMemo(() => {
    if (!blockedCpId || !reroute || !selectedRoute) return computedRoutes
    return computedRoutes.map((r) =>
      r.id === selectedRoute.id
        ? {
            ...r,
            path: reroute.path,
            lengthKm: reroute.lengthKm,
            days: reroute.days,
          }
        : r,
    )
  }, [computedRoutes, blockedCpId, reroute, selectedRoute])

  const selectedChokepointName = blockedCpId
    ? chokepoints.find((c) => c.id === blockedCpId)?.name
    : null

  return (
    <main className="flex h-dvh w-dvw overflow-hidden bg-neutral-950 text-neutral-100">
      <div className="relative h-full flex-1">
        <Map
          chokepoints={chokepoints}
          ports={ports}
          routes={displayRoutes}
          selectedRouteId={selectedRoute?.id ?? null}
          onSelectRoute={setSelectedRoute}
          blockedChokepointIds={blockedCpId ? [blockedCpId] : []}
          onBlockToggle={handleBlockToggle}
          onClearSelection={() => {
            setSelectedRoute(null)
            setBlockedCpId(null)
            setReroute(null)
          }}
        />
      </div>

      <aside className="w-80 shrink-0 overflow-y-auto border-l border-neutral-800 bg-neutral-900 p-6">
        <h1 className="text-lg font-semibold tracking-wide">ChainWise</h1>
        <p className="mt-1 text-xs uppercase tracking-[0.2em] text-neutral-500">Routing</p>

        {selectedRoute ? (
          <div className="mt-6">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-xl font-semibold text-emerald-300">{selectedRoute.name}</h2>
              <button
                onClick={() => {
                  setSelectedRoute(null)
                  setBlockedCpId(null)
                  setReroute(null)
                }}
                className="rounded px-2 py-0.5 text-lg leading-none text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                aria-label="Close details"
              >
                ×
              </button>
            </div>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between border-b border-neutral-800 pb-2">
                <dt className="text-neutral-400">Distance</dt>
                <dd className="font-mono">{Math.round(selectedRoute.lengthKm).toLocaleString()} km</dd>
              </div>
              <div className="flex justify-between border-b border-neutral-800 pb-2">
                <dt className="text-neutral-400">Transit (14 kn)</dt>
                <dd className="font-mono">{selectedRoute.days.toFixed(1)} days</dd>
              </div>
            </dl>

            <div className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Passes through
              </h3>
              <ul className="mt-2 space-y-1">
                {selectedRoute.passesThrough.map((id, index) => {
                  const cp = chokepoints.find((c) => c.id === id)
                  const isBlockedCurrently = blockedCpId === id
                  return (
                    <li
                      key={id}
                      className="flex items-center justify-between gap-2 border-b border-neutral-800 py-2 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs text-neutral-600">{index + 1}</span>
                        <span>{cp ? cp.name : id}</span>
                      </span>
                      <button
                        onClick={() => cp && handleBlockToggle(cp)}
                        className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:border-amber-400 hover:text-amber-300"
                      >
                        {isBlockedCurrently ? 'Unblock' : 'Block this chokepoint'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>

            {reroute ? (
              <div className="mt-4 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium text-amber-300">Rerouted around {selectedChokepointName}</p>
                <p className="mt-1 font-mono text-xs text-neutral-300">
                  +{Math.round(reroute.extraKm).toLocaleString()} km · +
                  {reroute.extraDays.toFixed(1)} days
                </p>
                <button
                  onClick={() => {
                    setBlockedCpId(null)
                    setReroute(null)
                  }}
                  className="mt-2 text-xs text-neutral-400 underline hover:text-neutral-200"
                >
                  Restore original route
                </button>
              </div>
            ) : blockedCpId && !reroute ? (
              <div className="mt-4 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm">
                <p className="text-red-300">
                  No water detour found around {selectedChokepointName}.
                </p>
                <button
                  onClick={() => setBlockedCpId(null)}
                  className="mt-2 text-xs text-neutral-400 underline hover:text-neutral-200"
                >
                  Unblock
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-6 text-sm text-neutral-500">
            Click a green route line to see distance, transit time, and chokepoints. Then
            block one to see the detour.
          </p>
        )}
      </aside>
    </main>
  )
}
