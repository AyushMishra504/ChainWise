'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AttributionControl,
  Map as MapLibreMap,
  MapGeoJSONFeature,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { LineLayerSpecification } from 'maplibre-gl'
import type { Chokepoint } from '@/data/chokepoints'
import type { Port } from '@/data/ports'
import type { ComputedRoute } from '@/data/routes'

// MapLibre v6 is ESM-only: point it at its web worker (Next.js emits it as an asset).
setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString())

// Self-contained raster style: no style-JSON fetch, no sprite, no fonts to load.
// Esri's World Dark Gray canvas is free, keyless, and attribution-complete;
// the Reference layer adds place/road labels on top of the base tiles.
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
    { id: 'esri-labels', type: 'raster' as const, source: 'esriLabels' },
  ],
}

// Shipping-monitor palette: glowing green route lines, yellow chokepoints,
// blue ports. Selected route is brighter green.
const ROUTE_COLOR = 'rgba(74, 222, 128, 0.5)' // green, subdued
const ROUTE_SELECTED_COLOR = '#4ade80' // bright green
const ROUTE_WIDTH = 2
const ROUTE_SELECTED_WIDTH = 3.5

const routesLineLayerSpec = (selectedRouteId: string | null): LineLayerSpecification => ({
  id: 'routes-line',
  type: 'line',
  source: 'routes',
  paint: {
    'line-color': [
      'case',
      ['==', ['get', 'id'], selectedRouteId ?? ''],
      ROUTE_SELECTED_COLOR,
      ROUTE_COLOR,
    ],
    'line-width': [
      'case',
      ['==', ['get', 'id'], selectedRouteId ?? ''],
      ROUTE_SELECTED_WIDTH,
      ROUTE_WIDTH,
    ],
  },
})

const routeHitLayerSpec: LineLayerSpecification = {
  id: 'routes-hit',
  type: 'line',
  source: 'routes',
  paint: { 'line-color': 'transparent', 'line-width': 12 },
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

const routeGlowLayerSpec: LineLayerSpecification = {
  id: 'routes-glow',
  type: 'line',
  source: 'routes',
  paint: {
    'line-color': ROUTE_COLOR,
    'line-width': 7,
    'line-blur': 4,
    'line-opacity': 0.35,
  },
}

// ---- chokepoint markers ----

const cpDotClass =
  'h-2.5 w-2.5 shrink-0 cursor-pointer rounded-full bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.7)]'

const cpLabelClass =
  'cursor-pointer select-none whitespace-nowrap rounded bg-neutral-900/85 px-1 py-0.5 text-[10px] font-medium leading-none text-yellow-200 opacity-0 transition-opacity'

// ---- port markers ----

const portDotClass = (isIndian: boolean) =>
  isIndian
    ? 'h-3 w-3 cursor-pointer rounded-full bg-sky-400 shadow-[0_0_7px_rgba(56,189,248,0.8)]'
    : 'h-2.5 w-2.5 cursor-pointer rounded-full bg-sky-500 shadow-[0_0_5px_rgba(56,189,248,0.5)]'

const portLabelClass =
  'pointer-events-none cursor-default select-none whitespace-nowrap rounded bg-neutral-900/85 px-1 py-0.5 text-[10px] font-medium leading-none text-sky-200'

const portMarkerClass = 'flex cursor-pointer items-center'

type MapProps = {
  chokepoints: Chokepoint[]
  ports: Port[]
  routes: ComputedRoute[]
  selectedRouteId?: string | null
  onSelectRoute?: (route: ComputedRoute) => void
  /** Chokepoint ids whose edges the current routes must avoid (drawn as blocked). */
  blockedChokepointIds?: string[]
  onBlockToggle?: (chokepoint: Chokepoint) => void
  /** Fired whenever the user clicks empty water (used to clear selection). */
  onClearSelection?: () => void
}

export default function MapView({
  chokepoints,
  ports,
  routes,
  selectedRouteId = null,
  onSelectRoute,
  blockedChokepointIds = [],
  onBlockToggle,
  onClearSelection,
}: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [mapReady, setMapReady] = useState(false)

  const onSelectRouteRef = useRef(onSelectRoute)
  const onBlockToggleRef = useRef(onBlockToggle)
  const onClearSelectionRef = useRef(onClearSelection)
  const routesRef = useRef(routes)
  const blockedRef = useRef(blockedChokepointIds)

  useEffect(() => {
    routesRef.current = routes
    blockedRef.current = blockedChokepointIds
  }, [routes, blockedChokepointIds])

  useEffect(() => {
    onSelectRouteRef.current = onSelectRoute
    onBlockToggleRef.current = onBlockToggle
    onClearSelectionRef.current = onClearSelection
  }, [onSelectRoute, onBlockToggle, onClearSelection])

  // Stable, minimal DOM: routes via GeoJSON layers; chokepoints and ports via
  // markers. Labels are hover-only, so no per-render label state machine.
  const chokepointMarkersRef = useRef(new Map<string, { marker: Marker; label: HTMLElement }>())
  const portMarkersRef = useRef(new Map<string, { marker: Marker; label: HTMLElement }>())

  // Create the map once; it persists across renders.
  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false
    const cleansers: Array<() => void> = []

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

    if (process.env.NODE_ENV !== 'production') {
      ;(window as unknown as { __chainwiseMap?: MapLibreMap }).__chainwiseMap = map
    }

    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')

    map.on('load', () => {
      if (cancelled) return
      setMapReady(true)

      map.addSource('routes', {
        type: 'geojson',
        data: routeCollection(routesRef.current),
      })
      map.addLayer(routeGlowLayerSpec)
      map.addLayer(routesLineLayerSpec(selectedRouteId))
      map.addLayer(routeHitLayerSpec)

      map.on('click', 'routes-hit', (e) => {
        const feature = e.features?.[0] as MapGeoJSONFeature | undefined
        const id = feature?.properties?.id
        if (!id) return
        const route = routesRef.current.find((r) => r.id === id)
        if (route) onSelectRouteRef.current?.(route)
      })
      map.on('mouseenter', 'routes-hit', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'routes-hit', () => {
        map.getCanvas().style.cursor = ''
      })
      map.on('click', (e) => {
        // Click on empty water (no route under cursor) clears selection.
        const hits = map.queryRenderedFeatures(e.point, { layers: ['routes-hit'] })
        if (hits.length === 0) onClearSelectionRef.current?.()
      })
    })

    return () => {
      cancelled = true
      for (const clean of cleansers) clean()
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Keep route selection styling in sync without touching the data.
  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current
    if (!map || !map.getLayer('routes-line')) return
    const paint = routesLineLayerSpec(selectedRouteId).paint
    if (!paint) return
    map.setPaintProperty('routes-line', 'line-color', paint['line-color'])
    map.setPaintProperty('routes-line', 'line-width', paint['line-width'])
  }, [selectedRouteId, mapReady])

  // Chokepoint markers: yellow dots + hover labels + block toggle handler.
  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current
    if (!map) return
    const markers = chokepointMarkersRef.current

    for (const cp of chokepoints) {
      if (markers.has(cp.id)) continue
      const el = document.createElement('div')
      el.className = 'flex items-center gap-1'
      const dot = document.createElement('div')
      dot.className = cpDotClass
      const label = document.createElement('div')
      label.className = cpLabelClass
      label.textContent = cp.name
      el.append(label, dot)
      // hover reveals label via sibling rule (dot + label share the marker el)
      el.addEventListener('mouseenter', () => {
        label.style.opacity = '1'
      })
      el.addEventListener('mouseleave', () => {
        label.style.opacity = ''
      })
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onBlockToggleRef.current?.(cp)
      })

      const marker = new Marker({ element: el })
        .setLngLat([cp.lng, cp.lat])
        .addTo(map)
      markers.set(cp.id, { marker, label })
    }

    return () => {
      for (const { marker } of markers.values()) marker.remove()
      markers.clear()
    }
  }, [chokepoints, mapReady])

  // Port markers: blue dots (Indian slightly larger) + hover labels.
  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current
    if (!map) return
    const markers = portMarkersRef.current

    for (const port of ports) {
      if (markers.has(port.id)) continue
      const el = document.createElement('div')
      el.className = portMarkerClass
      const dot = document.createElement('div')
      dot.className = portDotClass(port.country === 'IN')
      const label = document.createElement('div')
      label.className = portLabelClass
      label.textContent = port.name
      label.style.opacity = '0'
      el.append(dot, label)
      el.addEventListener('mouseenter', () => {
        label.style.opacity = '1'
      })
      el.addEventListener('mouseleave', () => {
        label.style.opacity = '0'
      })

      const marker = new Marker({ element: el })
        .setLngLat([port.lng, port.lat])
        .addTo(map)
      markers.set(port.id, { marker, label })
    }

    return () => {
      for (const { marker } of markers.values()) marker.remove()
      markers.clear()
    }
  }, [ports, mapReady])

  return <div ref={containerRef} className="h-full w-full" />
}
