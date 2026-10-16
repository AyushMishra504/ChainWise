'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AttributionControl,
  Map as MapLibreMap,
  MapGeoJSONFeature,
  Marker,
  setWorkerUrl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { LineLayerSpecification } from 'maplibre-gl'
import type { Chokepoint } from '@/data/chokepoints'
import type { Port } from '@/data/ports'
import type { ComputedRoute } from '@/data/routes'
import type { Reroute } from '@/lib/seaRouting'
import type { ChokepointAnalysis } from '@/lib/engine/analysis'
import type { PortAnalysis } from '@/lib/engine/portAnalysis'
import { PORTWATCH_BY_CHOKEPOINT } from '@/lib/portwatch-map'
import { type DisplayStatus } from '@/lib/engine/disruption'
import { CORROBORATION_LABEL, type CorroborationStatus } from '@/lib/engine/corroboration'
import { recordReplayTime } from '@/lib/replayPerformance'

// MapLibre v6 is ESM-only: point it at its web worker (Next.js emits it as an asset).
setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString())

// Self-contained raster style: no style-JSON fetch, no sprite, no fonts to load.
const ESRI_BASE = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
const ESRI_LABELS = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'

const MAP_STYLE = {
  version: 8 as const,
  sources: {
    esriBase: {
      type: 'raster' as const,
      tiles: [ESRI_BASE],
      tileSize: 256,
      maxzoom: 16,
      attribution: 'Esri, HERE, Garmin, OpenStreetMap contributors',
    },
    esriLabels: {
      type: 'raster' as const,
      tiles: [ESRI_LABELS],
      tileSize: 256,
      maxzoom: 16,
    },
  },
  layers: [
    { id: 'esri-base', type: 'raster' as const, source: 'esriBase' },
    // Place labels stay hidden below zoom 5 and faded above it, so only the
    // major cities and country names show through at working zooms.
    {
      id: 'esri-labels',
      type: 'raster' as const,
      source: 'esriLabels',
      minzoom: 5,
      paint: { 'raster-opacity': 0.45 },
    },
  ],
}

// Austere palette: muted grey-blue route lines (no glow), hollow grey
// chokepoints, small status-coloured port dots. Selected/hovered routes brighter.
const ROUTE_COLOR = '#6a80a0'
const ROUTE_SELECTED_COLOR = '#c2cee2'
const ROUTE_WIDTH = 1
const ROUTE_ACTIVE_WIDTH = 2.5
const ROUTE_OPACITY = 0.3
const ROUTE_LANE_IN_OPACITY = 0.85
const ROUTE_LANE_OUT_OPACITY = 0.12

const routesLineLayerSpec: LineLayerSpecification = {
  id: 'routes-line',
  type: 'line',
  source: 'routes',
  paint: {
    'line-color': ROUTE_COLOR,
    'line-width': ROUTE_WIDTH,
    'line-opacity': ROUTE_OPACITY,
  },
}

const routeHitLayerSpec: LineLayerSpecification = {
  id: 'routes-hit',
  type: 'line',
  source: 'routes',
  paint: { 'line-color': 'transparent', 'line-width': 14 },
}

const rerouteLineLayerSpec: LineLayerSpecification = {
  id: 'reroute-line',
  type: 'line',
  source: 'reroute',
  paint: {
    'line-color': '#e8a33d',
    'line-width': 2.5,
    'line-opacity': 0.95,
    'line-dasharray': [2, 1.5],
  },
}

const routeCollection = (routes: ComputedRoute[]) => ({
  type: 'FeatureCollection' as const,
  features: routes.map((route) => ({
    type: 'Feature' as const,
    properties: { id: route.id },
    geometry: {
      type: 'LineString' as const,
      coordinates: route.path,
    },
  })),
})

const rerouteCollection = (reroute: Reroute | null) => ({
  type: 'FeatureCollection' as const,
  features: reroute
    ? [{
        type: 'Feature' as const,
        properties: { id: 'reroute' },
        geometry: { type: 'LineString' as const, coordinates: reroute.path },
      }]
    : [],
})

type PaintValue = Parameters<MapLibreMap['setPaintProperty']>[2]

/** Build data-driven paint expressions from the current route focus state. */
function routePaintExpressions(
  routes: ComputedRoute[],
  selectedRouteId: string | null,
  focusedIds: Set<string> | null,
  hoveredId: string | null,
): { color: PaintValue; width: PaintValue; opacity: PaintValue } {
  const color: unknown[] = ['match', ['get', 'id']]
  const width: unknown[] = ['match', ['get', 'id']]
  const opacity: unknown[] = ['match', ['get', 'id']]
  for (const route of routes) {
    const active = route.id === selectedRouteId || route.id === hoveredId
    const inLane = !focusedIds || focusedIds.has(route.id)
    let o = focusedIds ? (inLane ? ROUTE_LANE_IN_OPACITY : ROUTE_LANE_OUT_OPACITY) : ROUTE_OPACITY
    if (active) o = 1
    color.push(route.id, active ? ROUTE_SELECTED_COLOR : ROUTE_COLOR)
    width.push(route.id, active ? ROUTE_ACTIVE_WIDTH : ROUTE_WIDTH)
    opacity.push(route.id, o)
  }
  color.push(ROUTE_COLOR)
  width.push(ROUTE_WIDTH)
  opacity.push(ROUTE_OPACITY)
  return { color: color as PaintValue, width: width as PaintValue, opacity: opacity as PaintValue }
}

// ---- chokepoint markers (fill = PortWatch status; hollow = no data) ----

const CP_STATUS_DOT: Record<DisplayStatus, string> = {
  normal: 'h-2 w-2 rounded-full bg-app-muted',
  watch: 'h-2.5 w-2.5 rounded-full bg-app-amber',
  disrupted: 'h-2.5 w-2.5 rounded-full bg-app-red',
  'severely-disrupted': 'h-2.5 w-2.5 rounded-full bg-app-red ring-2 ring-app-red/80',
  'structurally-down': 'h-2 w-2 rounded-full bg-app-muted ring-2 ring-app-amber/70',
  'low-volume': 'h-2 w-2 rounded-full bg-app-muted',
  'no-data': 'h-2 w-2 rounded-full border border-app-route bg-transparent',
}

const STATUS_LABEL: Record<DisplayStatus, string> = {
  normal: 'Normal',
  watch: 'Watch',
  disrupted: 'Disrupted',
  'severely-disrupted': 'Severe structural decline',
  'structurally-down': 'Structurally down',
  'low-volume': 'Low volume',
  'no-data': 'No data',
}

const STATUS_TONE: Record<DisplayStatus, string> = {
  normal: 'text-app-muted',
  watch: 'text-app-amber',
  disrupted: 'text-app-red',
  'severely-disrupted': 'text-app-red',
  'structurally-down': 'text-app-amber',
  'low-volume': 'text-app-muted',
  'no-data': 'text-app-muted',
}

const cpLabelClass =
  'pointer-events-none absolute right-full top-1/2 mr-2 w-max max-w-[220px] -translate-y-1/2 select-none rounded-[4px] border border-app-border bg-app-surface/95 px-2 py-1.5 text-[10px] leading-tight text-app-text opacity-0 shadow-panel transition-opacity'

function formatChangePct(changePct: number | null): string {
  if (changePct === null) return '—'
  const pct = changePct * 100
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
}

type ChokepointLabelInput = {
  name: string
  country: string
  status: DisplayStatus
  baseline: number | null
  changePct: number | null
  structuralPct: number | null
  matched: boolean
  blocked: boolean
  dataAsOf: string | null
  newsStatus: CorroborationStatus | null
}

function renderChokepointLabel(label: HTMLElement, input: ChokepointLabelInput): void {
  const name = document.createElement('div')
  name.className = 'font-medium text-app-text'
  name.textContent = input.name

  const country = document.createElement('div')
  country.className = 'text-[9px] uppercase tracking-wide text-app-muted'
  country.textContent = input.country

  const status = document.createElement('div')
  status.className = `mt-0.5 ${STATUS_TONE[input.status]}`
  status.textContent = input.matched
    ? `${STATUS_LABEL[input.status]} · ${formatChangePct(input.changePct)} vs baseline${input.blocked ? ' · Blocked' : ''}`
    : `No data${input.blocked ? ' · Blocked' : ''}`

  const children: HTMLElement[] = [name, country, status]

  if (input.status === 'low-volume' && input.baseline !== null) {
    const volume = document.createElement('div')
    volume.className = 'mt-0.5 text-app-muted'
    volume.textContent = `Baseline: ${input.baseline.toFixed(1)} transits/day`
    children.push(volume)
  }

  if (input.matched && input.structuralPct !== null) {
    const structural = document.createElement('div')
    structural.className = 'mt-0.5 text-app-muted'
    structural.textContent = `Last 30d vs 2023: ${formatChangePct(input.structuralPct)}`
    children.push(structural)
  }

  const source = document.createElement('div')
  source.className = 'mt-0.5 font-mono text-app-muted'
  source.textContent = input.matched
    ? `Source: IMF PortWatch · data to ${input.dataAsOf ?? '—'}`
    : 'Not covered by IMF PortWatch'
  children.push(source)

  if (input.newsStatus) {
    const news = document.createElement('div')
    news.className = 'mt-0.5 text-app-muted'
    news.textContent = `News: ${CORROBORATION_LABEL[input.newsStatus]}`
    children.push(news)
  }

  label.replaceChildren(...children)
}

/** Everything that changes the rendered label DOM. */
function chokepointLabelSignature(input: ChokepointLabelInput): string {
  return [
    input.name,
    input.country,
    input.status,
    input.baseline,
    input.changePct,
    input.structuralPct,
    input.matched,
    input.blocked,
    input.dataAsOf,
    input.newsStatus,
  ].join('|')
}

/**
 * Per-marker label bookkeeping. Kept in a ref (written with `Map.set`) so the
 * status effect can memoise inputs without touching the DOM every tick: the
 * tooltip DOM is only rebuilt when it is hovered and something changed.
 */
type ChokepointLabelState = {
  input: ChokepointLabelInput
  /** Signature of the DOM currently inside the label (null = not built yet). */
  rendered: string | null
  /** Class currently applied to the status dot. */
  dotClass: string
}

// ---- port markers (sized by unique vessels, coloured by status) ----

const PORT_STATUS_DOT: Record<DisplayStatus, string> = {
  normal: 'bg-app-route',
  watch: 'bg-app-amber',
  disrupted: 'bg-app-red',
  'severely-disrupted': 'bg-app-red ring-2 ring-app-red/80',
  'structurally-down': 'bg-app-route ring-2 ring-app-amber/70',
  'low-volume': 'bg-app-muted',
  'no-data': 'border border-app-route bg-transparent',
}

/** Dot diameter in px from PortWatch unique-vessel count (5–18px). */
function portSize(vesselCount: number): number {
  return Math.max(5, Math.min(18, Math.round(Math.sqrt(vesselCount) * 0.12 + 4)))
}

const portLabelClass =
  'pointer-events-none absolute left-full top-1/2 ml-1.5 -translate-y-1/2 w-max max-w-[230px] select-none rounded-[4px] border border-app-border bg-app-surface/95 px-2 py-1.5 text-[10px] leading-tight text-app-text opacity-0 shadow-panel transition-opacity'

type PortLabelInput = {
  name: string
  status: DisplayStatus
  baseline: number | null
  recent: number | null
  changePct: number | null
  importChange: number | null
  exportChange: number | null
  matched: boolean
  dataAsOf: string | null
}

function renderPortLabel(label: HTMLElement, input: PortLabelInput): void {
  const name = document.createElement('div')
  name.className = 'font-medium text-app-text'
  name.textContent = input.name

  const status = document.createElement('div')
  status.className = `mt-0.5 ${STATUS_TONE[input.status]}`
  status.textContent = input.matched
    ? `${STATUS_LABEL[input.status]} · ${formatChangePct(input.changePct)} vs baseline`
    : 'No data'

  const children: HTMLElement[] = [name, status]

  if (input.matched) {
    if (input.status === 'low-volume' && input.baseline !== null) {
      const volume = document.createElement('div')
      volume.className = 'mt-0.5 text-app-muted'
      volume.textContent = `Baseline: ${input.baseline.toFixed(1)} calls/day`
      children.push(volume)
    }

    const calls = document.createElement('div')
    calls.className = 'mt-0.5 text-app-muted'
    calls.textContent = `Port calls 7d avg: ${input.recent === null ? '—' : input.recent.toFixed(1)}`
    children.push(calls)

    const trade = document.createElement('div')
    trade.className = 'mt-0.5 text-app-muted'
    trade.textContent = `Import ${formatChangePct(input.importChange)} · Export ${formatChangePct(input.exportChange)} (metric tons)`
    children.push(trade)
  }

  const source = document.createElement('div')
  source.className = 'mt-0.5 font-mono text-app-muted'
  source.textContent = input.matched
    ? `Source: IMF PortWatch · data to ${input.dataAsOf ?? '—'}`
    : 'Not covered by IMF PortWatch'
  children.push(source)

  label.replaceChildren(...children)
}

/** Everything that changes the rendered port label DOM. */
function portLabelSignature(input: PortLabelInput): string {
  return [
    input.name,
    input.status,
    input.baseline,
    input.recent,
    input.changePct,
    input.importChange,
    input.exportChange,
    input.matched,
    input.dataAsOf,
  ].join('|')
}

/** Per-marker label bookkeeping for ports; see `ChokepointLabelState`. */
type PortLabelState = {
  input: PortLabelInput
  /** Signature of the DOM currently inside the label (null = not built yet). */
  rendered: string | null
  /** Class currently applied to the status dot. */
  dotClass: string
}

const markerHitboxClass =
  'relative flex h-3 w-3 cursor-pointer items-center justify-center'

export type MapApi = {
  zoomIn: () => void
  zoomOut: () => void
  centerIndia: () => void
}

const scenarioBannerClass =
  'pointer-events-none w-max select-none whitespace-nowrap rounded-[4px] border border-app-red bg-app-surface px-1.5 py-0.5 text-[10px] font-medium text-app-red shadow-panel'

const ROUTE_HOVER_CHOKEPOINT_CLASS = 'route-hover-chokepoint'

type MapProps = {
  chokepoints: Chokepoint[]
  ports: Port[]
  routes: ComputedRoute[]
  /** Alternate geometry for the selected route while one or more chokepoints are blocked. */
  reroute?: Reroute | null
  selectedRouteId?: string | null
  onSelectRoute?: (route: ComputedRoute) => void
  /** Chokepoint ids whose edges the current routes must avoid (drawn as blocked). */
  blockedChokepointIds?: string[]
  /** Per-chokepoint PortWatch disruption results (drives dot color + tooltip). */
  chokepointAnalysis?: ChokepointAnalysis | null
  /** Per-chokepoint combined news status (adds a tooltip line). */
  newsByChokepoint?: Record<string, CorroborationStatus> | null
  /** Per-port PortWatch analysis (drives dot size/color + tooltip). */
  portAnalysis?: Record<string, PortAnalysis> | null
  /** Latest PortWatch data date, shown in tooltips. */
  dataAsOf?: string | null
  /** Currently selected chokepoint (highlighted, shown in the right panel). */
  selectedChokepointId?: string | null
  /** Chokepoint being hovered in the route details panel. */
  highlightedChokepointId?: string | null
  /** Currently selected port (highlighted, shown in the right panel). */
  selectedPortId?: string | null
  /** Route ids in the focused lane; others are dimmed (null = no lane focus). */
  focusedRouteIds?: Set<string> | null
  /** Layer visibility toggles (driven by the map controls). */
  showRoutes?: boolean
  showChokepoints?: boolean
  showPorts?: boolean
  onSelectChokepoint?: (chokepoint: Chokepoint) => void
  onSelectPort?: (port: Port) => void
  /** Fired whenever the user clicks empty water (used to clear selection). */
  onClearSelection?: () => void
  /** Imperative controls for the zoom / recenter buttons. */
  onReady?: (api: MapApi) => void
  /** Scenario being replayed, shown in a red banner above its primary chokepoint. */
  scenarioName?: string | null
  /** Primary chokepoint of the active scenario (the banner's anchor). */
  scenarioChokepointId?: string | null
}

export default function MapView({
  chokepoints,
  ports,
  routes,
  reroute = null,
  selectedRouteId = null,
  onSelectRoute,
  blockedChokepointIds = [],
  chokepointAnalysis = null,
  newsByChokepoint = null,
  portAnalysis = null,
  dataAsOf = null,
  selectedChokepointId = null,
  highlightedChokepointId = null,
  selectedPortId = null,
  focusedRouteIds = null,
  showRoutes = true,
  showChokepoints = true,
  showPorts = true,
  onSelectChokepoint,
  onSelectPort,
  onClearSelection,
  onReady,
  scenarioName = null,
  scenarioChokepointId = null,
}: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [declutter, setDeclutter] = useState(true) // true below zoom 4

  const onSelectRouteRef = useRef(onSelectRoute)
  const onSelectChokepointRef = useRef(onSelectChokepoint)
  const onSelectPortRef = useRef(onSelectPort)
  const onClearSelectionRef = useRef(onClearSelection)
  const onReadyRef = useRef(onReady)
  const routesRef = useRef(routes)
  const routeFocusRef = useRef<{ selectedRouteId: string | null; focusedIds: Set<string> | null }>({
    selectedRouteId,
    focusedIds: focusedRouteIds,
  })
  const hoveredRouteRef = useRef<string | null>(null)

  // O(1) port lookup for the per-marker visibility pass (40 markers × ticks).
  const portById = useMemo(() => new Map(ports.map((port) => [port.id, port])), [ports])

  // The 8 busiest Indian ports stay visible when zoomed out.
  const topIndianIds = useMemo(() => {
    const indian = ports
      .filter((port) => port.country === 'IN')
      .sort((a, b) => b.vesselCount - a.vesselCount)
    return new Set(indian.slice(0, 8).map((port) => port.id))
  }, [ports])

  useEffect(() => {
    routesRef.current = routes
  }, [routes])

  useEffect(() => {
    onSelectRouteRef.current = onSelectRoute
    onSelectChokepointRef.current = onSelectChokepoint
    onSelectPortRef.current = onSelectPort
    onClearSelectionRef.current = onClearSelection
    onReadyRef.current = onReady
  }, [onSelectRoute, onSelectChokepoint, onSelectPort, onClearSelection, onReady])

  const chokepointMarkersRef = useRef(
    new Map<string, { marker: Marker; label: HTMLElement; dot: HTMLElement; name: string; country: string }>(),
  )
  const portMarkersRef = useRef(
    new Map<string, { marker: Marker; label: HTMLElement; dot: HTMLElement; name: string }>(),
  )
  const chokepointLabelStateRef = useRef(new Map<string, ChokepointLabelState>())
  const portLabelStateRef = useRef(new Map<string, PortLabelState>())

  const highlightRouteChokepoints = (routeId: string | null) => {
    const route = routeId ? routesRef.current.find((item) => item.id === routeId) : null
    const routeChokepoints = new Set(route?.passesThrough ?? [])
    for (const [id, { dot }] of chokepointMarkersRef.current) {
      dot.classList.toggle(ROUTE_HOVER_CHOKEPOINT_CLASS, routeChokepoints.has(id))
    }
  }

  const applyRoutePaint = () => {
    const map = mapRef.current
    if (!map || !map.getLayer('routes-line')) return
    const { selectedRouteId: selected, focusedIds } = routeFocusRef.current
    const paint = routePaintExpressions(
      routesRef.current,
      selected,
      focusedIds,
      hoveredRouteRef.current,
    )
    map.setPaintProperty('routes-line', 'line-color', paint.color as never)
    map.setPaintProperty('routes-line', 'line-width', paint.width as never)
    map.setPaintProperty('routes-line', 'line-opacity', paint.opacity as never)
  }

  // Create the map once; it persists across renders.
  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false

    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE,
      attributionControl: false,
      center: [75, 15], // India
      zoom: 3.2,
      renderWorldCopies: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    })
    mapRef.current = map

    onReadyRef.current?.({
      zoomIn: () => map.zoomIn(),
      zoomOut: () => map.zoomOut(),
      centerIndia: () => map.easeTo({ center: [75, 15], zoom: 3.2 }),
    })

    map.addControl(new AttributionControl({ compact: false }), 'bottom-right')

    map.on('load', () => {
      if (cancelled) return
      setMapReady(true)

      map.addSource('routes', {
        type: 'geojson',
        data: routeCollection(routesRef.current),
      })
      map.addLayer(routesLineLayerSpec)
      map.addLayer(routeHitLayerSpec)
      map.addSource('reroute', {
        type: 'geojson',
        data: rerouteCollection(null),
      })
      map.addLayer(rerouteLineLayerSpec)

      map.on('click', 'routes-hit', (e) => {
        const feature = e.features?.[0] as MapGeoJSONFeature | undefined
        const id = feature?.properties?.id
        if (!id) return
        const route = routesRef.current.find((r) => r.id === id)
        if (route) onSelectRouteRef.current?.(route)
      })
      map.on('mousemove', 'routes-hit', (e) => {
        const feature = e.features?.[0] as MapGeoJSONFeature | undefined
        const id = (feature?.properties?.id as string | undefined) ?? null
        if (id !== hoveredRouteRef.current) {
          hoveredRouteRef.current = id
          applyRoutePaint()
          highlightRouteChokepoints(id)
        }
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'routes-hit', () => {
        if (hoveredRouteRef.current !== null) {
          hoveredRouteRef.current = null
          applyRoutePaint()
          highlightRouteChokepoints(null)
        }
        map.getCanvas().style.cursor = ''
      })
      map.on('click', (e) => {
        // Click on empty water (no route under cursor) clears selection.
        const hits = map.queryRenderedFeatures(e.point, { layers: ['routes-hit'] })
        if (hits.length === 0) onClearSelectionRef.current?.()
      })
    })

    const onZoom = () => {
      const next = map.getZoom() < 4
      setDeclutter((current) => (current === next ? current : next))
    }
    map.on('zoom', onZoom)

    return () => {
      cancelled = true
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  // Scenario banner: a small red label pinned above the replay's primary
  // chokepoint, so the active scenario is identifiable on the map itself.
  // The camera is deliberately left where the user put it.
  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map || !scenarioName || !scenarioChokepointId) return
    const primary = chokepoints.find((cp) => cp.id === scenarioChokepointId)
    if (!primary) return
    const el = document.createElement('div')
    el.className = scenarioBannerClass
    el.textContent = scenarioName
    const marker = new Marker({ element: el, offset: [0, -22] })
      .setLngLat([primary.lng, primary.lat])
      .addTo(map)
    return () => {
      marker.remove()
    }
  }, [scenarioName, scenarioChokepointId, chokepoints, mapReady])

  // Re-add route data whenever it changes (cheap: setData).
  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current
    if (!map) return
    const source = map.getSource('routes')
    if (source && 'setData' in source) {
      (source as { setData: (data: ReturnType<typeof routeCollection>) => void }).setData(
        routeCollection(routes),
      )
    }
  }, [routes, mapReady])

  // Keep the alternate path separate from the canonical route so the user can
  // compare the original lane with the detour at a glance.
  useEffect(() => {
    if (!mapReady) return
    const source = mapRef.current?.getSource('reroute')
    if (source && 'setData' in source) {
      (source as { setData: (data: ReturnType<typeof rerouteCollection>) => void }).setData(
        rerouteCollection(reroute),
      )
    }
  }, [reroute, mapReady])

  // Route colour/width/opacity: selection + hover + lane focus.
  useEffect(() => {
    if (!mapReady) return
    routeFocusRef.current = { selectedRouteId, focusedIds: focusedRouteIds }
    applyRoutePaint()
  }, [selectedRouteId, focusedRouteIds, routes, mapReady])

  // Layer visibility for the route GeoJSON layers.
  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current
    if (!map) return
    const visibility = showRoutes ? 'visible' : 'none'
    for (const layerId of ['routes-line', 'routes-hit', 'reroute-line']) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visibility)
    }
  }, [showRoutes, mapReady])

  // Chokepoint markers: hollow rings + hover labels + select handler.
  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current
    if (!map) return
    const markers = chokepointMarkersRef.current

    for (const cp of chokepoints) {
      if (markers.has(cp.id)) continue
      const el = document.createElement('div')
      el.className = markerHitboxClass
      const dot = document.createElement('div')
      dot.className = CP_STATUS_DOT['no-data']
      const label = document.createElement('div')
      label.className = cpLabelClass
      el.append(dot, label)

      // The tooltip DOM is built on first hover from the latest memoised input,
      // instead of being rebuilt for every marker on every replay tick.
      const showTooltip = () => {
        const state = chokepointLabelStateRef.current.get(cp.id)
        if (state) {
          const signature = chokepointLabelSignature(state.input)
          if (signature !== state.rendered) {
            renderChokepointLabel(label, state.input)
            chokepointLabelStateRef.current.set(cp.id, { ...state, rendered: signature })
          }
        }
        label.style.opacity = '1'
      }
      el.addEventListener('mouseenter', showTooltip)
      el.addEventListener('mouseleave', () => {
        label.style.opacity = ''
      })
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onSelectChokepointRef.current?.(cp)
      })

      const marker = new Marker({ element: el }).setLngLat([cp.lng, cp.lat]).addTo(map)
      markers.set(cp.id, { marker, label, dot, name: cp.name, country: cp.country })
    }

    return () => {
      for (const { marker } of markers.values()) marker.remove()
      markers.clear()
    }
  }, [chokepoints, mapReady])

  // Reflect PortWatch status, selection and blocked state on the dots + labels.
  useEffect(() => {
    if (!mapReady) return
    const profileStart = performance.now()
    const blocked = new Set(blockedChokepointIds)
    const labelStates = chokepointLabelStateRef.current
    for (const [id, { dot, name, country }] of chokepointMarkersRef.current) {
      const result = chokepointAnalysis?.[id]
      const displayStatus: DisplayStatus = result?.displayStatus ?? 'no-data'
      const matched = id in PORTWATCH_BY_CHOKEPOINT
      const isBlocked = blocked.has(id)

      const ring =
        id === selectedChokepointId
          ? 'ring-2 ring-app-text'
          : isBlocked
            ? 'ring-2 ring-app-red/80'
            : ''
      const hoveredRoute = hoveredRouteRef.current
        ? routesRef.current.find((route) => route.id === hoveredRouteRef.current)
        : null
      const routeHighlighted = hoveredRoute?.passesThrough.includes(id) ?? false
      const panelHighlighted = id === highlightedChokepointId
      const dotClass =
        `${CP_STATUS_DOT[displayStatus]} ${ring} ${
          routeHighlighted || panelHighlighted ? ROUTE_HOVER_CHOKEPOINT_CLASS : ''
        }`.trim()
      const previous = labelStates.get(id)
      if (previous?.dotClass !== dotClass) dot.setAttribute('class', dotClass)
      const input: ChokepointLabelInput = {
        name,
        country,
        status: displayStatus,
        baseline: result?.baseline ?? null,
        changePct: result?.changePct ?? null,
        structuralPct: result?.structuralPct ?? null,
        matched,
        blocked: isBlocked,
        dataAsOf,
        newsStatus: newsByChokepoint?.[id] ?? null,
      }
      const rendered = chokepointLabelSignature(input)
      if (panelHighlighted) {
        const marker = chokepointMarkersRef.current.get(id)
        if (marker && previous?.rendered !== rendered) {
          renderChokepointLabel(marker.label, input)
        }
        marker?.label.style.setProperty('opacity', '1')
      } else {
        chokepointMarkersRef.current.get(id)?.label.style.removeProperty('opacity')
      }

      // Only memoise the inputs; the tooltip DOM is rebuilt lazily on hover.
      labelStates.set(id, {
        dotClass,
        rendered: panelHighlighted ? rendered : previous?.rendered ?? null,
        input,
      })
    }
    recordReplayTime('map', performance.now() - profileStart, dataAsOf)
  }, [
    chokepointAnalysis,
    newsByChokepoint,
    dataAsOf,
    blockedChokepointIds,
    selectedChokepointId,
    highlightedChokepointId,
    mapReady,
  ])

  // Toggle chokepoint marker visibility.
  useEffect(() => {
    if (!mapReady) return
    for (const { marker } of chokepointMarkersRef.current.values()) {
      marker.getElement().style.display = showChokepoints ? '' : 'none'
    }
  }, [showChokepoints, mapReady])

  // Port markers: sized by unique vessels, coloured by status, hover labels.
  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current
    if (!map) return
    const markers = portMarkersRef.current

    for (const port of ports) {
      if (markers.has(port.id)) continue
      const size = portSize(port.vesselCount)
      const el = document.createElement('div')
      el.className = 'relative flex cursor-pointer items-center justify-center'
      el.style.width = `${size}px`
      el.style.height = `${size}px`
      const dot = document.createElement('div')
      dot.className = `h-full w-full rounded-full ${PORT_STATUS_DOT['no-data']}`
      const label = document.createElement('div')
      label.className = portLabelClass
      label.style.opacity = '0'
      el.append(dot, label)

      // The tooltip DOM is built on first hover from the latest memoised input,
      // instead of being rebuilt for every marker on every replay tick.
      const showTooltip = () => {
        const state = portLabelStateRef.current.get(port.id)
        if (state) {
          const signature = portLabelSignature(state.input)
          if (signature !== state.rendered) {
            renderPortLabel(label, state.input)
            portLabelStateRef.current.set(port.id, { ...state, rendered: signature })
          }
        }
        label.style.opacity = '1'
      }
      el.addEventListener('mouseenter', showTooltip)
      el.addEventListener('mouseleave', () => {
        label.style.opacity = '0'
      })
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onSelectPortRef.current?.(port)
      })

      const marker = new Marker({ element: el }).setLngLat([port.lng, port.lat]).addTo(map)
      markers.set(port.id, { marker, label, dot, name: port.name })
    }

    return () => {
      for (const { marker } of markers.values()) marker.remove()
      markers.clear()
    }
  }, [ports, mapReady])

  // Port status colours + tooltip content.
  useEffect(() => {
    if (!mapReady) return
    const profileStart = performance.now()
    const labelStates = portLabelStateRef.current
    for (const [id, { dot, name }] of portMarkersRef.current) {
      const result = portAnalysis?.[id]
      const disruption = result?.disruption
      const status: DisplayStatus = disruption?.displayStatus ?? 'no-data'
      const matched = Boolean(result && result.portid)
      const ring = id === selectedPortId ? 'ring-2 ring-app-text' : ''
      const dotClass = `h-full w-full rounded-full ${PORT_STATUS_DOT[status]} ${ring}`.trim()
      const previous = labelStates.get(id)
      if (previous?.dotClass !== dotClass) dot.setAttribute('class', dotClass)

      // Only memoise the inputs; the tooltip DOM is rebuilt lazily on hover.
      labelStates.set(id, {
        dotClass,
        rendered: previous?.rendered ?? null,
        input: {
          name,
          status,
          baseline: disruption?.baseline ?? null,
          recent: disruption?.recent ?? null,
          changePct: disruption?.changePct ?? null,
          importChange: result?.importTrend.changePct ?? null,
          exportChange: result?.exportTrend.changePct ?? null,
          matched,
          dataAsOf,
        },
      })
    }
    recordReplayTime('map', performance.now() - profileStart, dataAsOf)
  }, [portAnalysis, dataAsOf, selectedPortId, mapReady])

  // Port visibility: layer toggle + declutter (top-8 Indian + foreign below zoom 4).
  useEffect(() => {
    if (!mapReady) return
    for (const [id, { marker }] of portMarkersRef.current) {
      const port = portById.get(id)
      const visible =
        showPorts && (port ? !declutter || port.country !== 'IN' || topIndianIds.has(port.id) : false)
      marker.getElement().style.display = visible ? '' : 'none'
    }
  }, [showPorts, declutter, portById, topIndianIds, mapReady])

  return <div ref={containerRef} className="h-full w-full" />
}
