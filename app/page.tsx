'use client'

import { Profiler, useCallback, useEffect, useMemo, useState } from 'react'
import { measureReplay, profileDate, recordReplayTime } from '@/lib/replayPerformance'
import Map from '@/components/Map'
import type { MapApi } from '@/components/Map'
import TopBar from '@/components/TopBar'
import type { SearchOption } from '@/components/TopBar'
import LeftPanel from '@/components/LeftPanel'
import RightPanel from '@/components/RightPanel'
import MapControls from '@/components/MapControls'
import type { LayerKey } from '@/components/MapControls'
import BottomStrip from '@/components/BottomStrip'
import type { LogEvent } from '@/components/BottomStrip'
import EventLogOverlay from '@/components/EventLogOverlay'
import ReplayBar from '@/components/ReplayBar'
import { chokepoints } from '@/data/chokepoints'
import type { Chokepoint } from '@/data/chokepoints'
import { ports } from '@/data/ports'
import type { Port } from '@/data/ports'
import { routes as routeDefs, computeAllRoutes } from '@/data/routes'
import type { ComputedRoute, Lane } from '@/data/routes'
import { scenarios, scenarioById } from '@/data/scenarios'
import type { Scenario } from '@/data/scenarios'
import { rerouteAvoidingMany, daysForKm } from '@/lib/seaRouting'
import { usePortwatch } from '@/lib/usePortwatch'
import { usePortwatchPorts } from '@/lib/usePortwatchPorts'
import { useNews } from '@/lib/useNews'
import { analyzeSnapshot } from '@/lib/engine/analysis'
import type { ChokepointAnalysis } from '@/lib/engine/analysis'
import { analyzePorts } from '@/lib/engine/portAnalysis'
import type { PortAnalysis } from '@/lib/engine/portAnalysis'
import { dateRange, addDays } from '@/lib/engine/dates'
import { measureScenario, dropAt } from '@/lib/engine/replay'
import type { EventImpact } from '@/lib/engine/replay'
import { corroborateAll, type ChokepointNews } from '@/lib/engine/corroboration'
import { NEWS_QUERIES } from '@/data/news-queries'

const REPLAY_TICK_MS = 220

/** Trailing days charted when there is no replay to anchor the window to. */
const CHART_LIVE_DAYS = 90
/** Days of pre-event baseline charted ahead of a replay window. */
const CHART_LEAD_IN_DAYS = 30

/** How many leading points of an ascending series fall on or before `asOf`. */
function revealedCount(series: { date: string }[], asOf: string | null): number {
  if (!asOf) return series.length
  let count = 0
  while (count < series.length && series[count].date <= asOf) count++
  return count
}

let eventSeq = 0
const nextEventId = () => `evt-${Date.now().toString(36)}-${eventSeq++}`
const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const pctText = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`)
const chokepointEventName = (name: string) => name.replace(/^Strait of /, '').replace(/ Strait$/, '')

export default function ProfiledHome() {
  return <Profiler id="Home" onRender={(_id, _phase, actualDuration) => recordReplayTime('render', actualDuration)}><Home /></Profiler>
}

function Home() {
  // Sea paths are computed once from the static port/chokepoint data.
  const computedRoutes = useMemo(() => computeAllRoutes(routeDefs, ports, chokepoints), [])
  const allChokepointIds = useMemo(() => chokepoints.map((cp) => cp.id), [])
  const allPortIds = useMemo(() => ports.map((port) => port.id), [])

  // Default state on load is live: nothing selected, nothing blocked, no replay.
  const [selectedRoute, setSelectedRoute] = useState<ComputedRoute | null>(null)
  const [blockedCpIds, setBlockedCpIds] = useState<string[]>([])
  const [replayId, setReplayId] = useState<string | null>(null)
  const [replayIndex, setReplayIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [events, setEvents] = useState<LogEvent[]>([])
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    routes: true,
    chokepoints: true,
    ports: true,
  })
  const [eventLogOpen, setEventLogOpen] = useState(false)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [mapApi, setMapApi] = useState<MapApi | null>(null)
  const [selectedChokepoint, setSelectedChokepoint] = useState<Chokepoint | null>(null)
  const [selectedPort, setSelectedPort] = useState<Port | null>(null)
  const [highlightedChokepointId, setHighlightedChokepointId] = useState<string | null>(null)
  const [selectedLane, setSelectedLane] = useState<Lane | null>(null)
  const [rightPanelWidth, setRightPanelWidth] = useState(360)

  // Chokepoints: log a line for every one that needs attention as data lands.
  const portwatch = usePortwatch(({ analysis, snapshot }) => {
    const latest = snapshot.latestDate ?? '—'
    const flagged = chokepoints
      .map((cp) => ({ cp, result: analysis[cp.id] }))
      .filter(
        ({ result }) =>
          result?.status === 'watch' ||
          result?.status === 'disrupted' ||
          result?.displayStatus === 'structurally-down' ||
          result?.displayStatus === 'severely-disrupted',
      )
    if (flagged.length === 0) return
    setEvents((prev) => [
      ...flagged.map(({ cp, result }) => ({
        id: nextEventId(),
        time: nowTime(),
        source: 'IMF PortWatch',
        message:
          result.displayStatus === 'severely-disrupted' && result.structuralPct !== null
            ? `${chokepointEventName(cp.name)} transits down ${Math.abs(result.structuralPct * 100).toFixed(0)}% vs ${result.structuralLabel}`
            : `${cp.name} ${result.status} — ${pctText(result.changePct)} vs baseline (data to ${latest})`,
        tone: (result.status === 'disrupted' || result.displayStatus === 'severely-disrupted' ? 'warn' : 'info') as LogEvent['tone'],
      })),
      ...prev,
    ])
  })

  // Ports: same treatment for ports needing attention.
  const portsFeed = usePortwatchPorts(({ analysis, snapshot }) => {
    const latest = snapshot.latestDate ?? '—'
    const flagged = ports
      .map((port) => ({ port, result: analysis[port.id] }))
      .filter(
        ({ result }) =>
          result &&
          (result.disruption.status === 'watch' ||
            result.disruption.status === 'disrupted' ||
            result.disruption.displayStatus === 'structurally-down' ||
            result.disruption.displayStatus === 'severely-disrupted'),
      )
    if (flagged.length === 0) return
    setEvents((prev) => [
      ...flagged.map(({ port, result }) => ({
        id: nextEventId(),
        time: nowTime(),
        source: 'IMF PortWatch',
        message: `${port.name} ${result.disruption.status} — ${pctText(result.disruption.changePct)} port calls vs baseline (data to ${latest})`,
        tone: (result.disruption.status === 'disrupted' || result.disruption.displayStatus === 'severely-disrupted' ? 'warn' : 'info') as LogEvent['tone'],
      })),
      ...prev,
    ])
  })

  const snapshot = portwatch.snapshot
  const portsSnapshot = portsFeed.snapshot

  // Trade-news: poll the RSS aggregator (server side, 30 min cache).
  const newsFeed = useNews()
  const newsSnapshot = newsFeed.snapshot

  const searchOptions = useMemo<SearchOption[]>(
    () => [
      ...ports.map((port) => ({ id: port.id, label: port.name, type: "port" as const, detail: port.country })),
      ...computedRoutes.map((route) => ({ id: route.id, label: route.name, type: "route" as const, detail: route.lane })),
      ...chokepoints.map((cp) => ({ id: cp.id, label: cp.name, type: "chokepoint" as const, detail: cp.country })),
      ...scenarios.map((scenario) => ({ id: scenario.id, label: scenario.name, type: "scenario" as const, detail: scenario.kind })),
    ],
    [computedRoutes],
  )

  // Measured historical impact of each scenario, from real PortWatch data.
  const impacts = useMemo(() => {
    if (!snapshot) return null
    const out: Record<string, EventImpact> = {}
    for (const scenario of scenarios) out[scenario.id] = measureScenario(snapshot, scenario)
    return out
  }, [snapshot])

  const activeScenario = useMemo(() => scenarioById(replayId), [replayId])
  const activeImpact = activeScenario && impacts ? impacts[activeScenario.id] ?? null : null
  const replayDates = useMemo(
    () =>
      activeImpact?.startDate && activeImpact.endDate
        ? dateRange(activeImpact.startDate, activeImpact.endDate)
        : [],
    [activeImpact],
  )
  const replayDate = activeScenario
    ? replayDates[Math.min(replayIndex, replayDates.length - 1)] ?? activeImpact?.startDate ?? null
    : null
  // One committed date drives the slider, analysis, map and panels together.
  const displayedReplayDate = replayDate
  profileDate(displayedReplayDate)
  const atEnd = replayDates.length > 0 && replayIndex >= replayDates.length - 1
  const isPlaying = playing && !atEnd

  // Analysis is live, or as-of the replay date. The dense engine makes each
  // replay frame an O(window) slice lookup, so no per-frame precompute is
  // needed (and no main-thread burst when Play is pressed).
  const analysis: ChokepointAnalysis | null = useMemo(() => {
    if (!snapshot) return portwatch.analysis
    return measureReplay(displayedReplayDate, 'analysis', () => analyzeSnapshot(snapshot, allChokepointIds, displayedReplayDate ?? undefined))
  }, [snapshot, portwatch.analysis, allChokepointIds, displayedReplayDate])

  const newsAsOf = displayedReplayDate ?? newsSnapshot?.items[0]?.date ?? snapshot?.latestDate ?? null
  const newsByChokepoint = useMemo<Record<string, ChokepointNews>>(() => {
    if (!newsAsOf) return {}
    const transit = Object.fromEntries(
      Object.entries(analysis ?? {}).map(([id, result]) => [id, result.status]),
    )
    return corroborateAll(NEWS_QUERIES, newsSnapshot?.items ?? [], transit, newsAsOf)
  }, [analysis, newsAsOf, newsSnapshot])

  const portAnalysis: Record<string, PortAnalysis> | null = useMemo(() => {
    if (!portsSnapshot) return portsFeed.analysis
    return measureReplay(displayedReplayDate, 'analysis', () => analyzePorts(portsSnapshot, allPortIds, displayedReplayDate ?? undefined))
  }, [portsSnapshot, portsFeed.analysis, allPortIds, displayedReplayDate])

  // Charts need the daily series, which the bulk passes skip; compute it only
  // for whatever is selected (and only while it is on screen).
  const selectedChokepointResult = useMemo(() => {
    if (!snapshot || !selectedChokepoint) return null
    return (
      measureReplay(displayedReplayDate, 'analysis', () =>
        analyzeSnapshot(snapshot, [selectedChokepoint.id], displayedReplayDate ?? undefined, true),
      )[selectedChokepoint.id] ?? null
    )
  }, [snapshot, selectedChokepoint, displayedReplayDate])

  const selectedPortResult = useMemo(() => {
    if (!portsSnapshot || !selectedPort) return null
    return (
      measureReplay(displayedReplayDate, 'analysis', () =>
        analyzePorts(portsSnapshot, [selectedPort.id], displayedReplayDate ?? undefined, true),
      )[selectedPort.id] ?? null
    )
  }, [portsSnapshot, selectedPort, displayedReplayDate])

  // Charts plot a fixed window — the replay's event window (with a short
  // pre-event lead-in) while replaying, a trailing 90 days when live — so the
  // scales hold still and the line extends with the time bar, instead of the
  // whole history being wiped and redrawn on every tick.
  const chartWindow = useMemo(() => {
    if (!activeImpact?.startDate || !activeImpact.endDate) return null
    return {
      start: addDays(activeImpact.startDate, -CHART_LEAD_IN_DAYS),
      end: activeImpact.endDate,
    }
  }, [activeImpact])

  const chokepointChartSeries = useMemo(() => {
    if (!snapshot || !selectedChokepoint) return []
    const result = analyzeSnapshot(snapshot, [selectedChokepoint.id], chartWindow?.end, true)[
      selectedChokepoint.id
    ]
    if (!result) return []
    return chartWindow
      ? result.series.filter((point) => point.date >= chartWindow.start)
      : result.series.slice(-CHART_LIVE_DAYS)
  }, [snapshot, selectedChokepoint, chartWindow])

  const portChartSeries = useMemo(() => {
    if (!portsSnapshot || !selectedPort) return []
    const result = analyzePorts(portsSnapshot, [selectedPort.id], chartWindow?.end, true)[selectedPort.id]
    if (!result) return []
    return chartWindow
      ? result.series.filter((point) => point.date >= chartWindow.start)
      : result.series.slice(-CHART_LIVE_DAYS)
  }, [portsSnapshot, selectedPort, chartWindow])

  const chokepointChartVisible = revealedCount(chokepointChartSeries, displayedReplayDate)
  const portChartVisible = revealedCount(portChartSeries, displayedReplayDate)

  const replayDrop =
    activeScenario && impacts && replayDate ? dropAt(impacts[activeScenario.id], replayDate) : null

  // While replaying, the event's chokepoints are the ones we route around.
  const effectiveBlocked = activeScenario ? activeScenario.chokepointIds : blockedCpIds

  // Reroute the selected route around every blocked chokepoint at once.
  const reroute = useMemo(() => {
    if (!selectedRoute || effectiveBlocked.length === 0) return null
    const blocked = chokepoints.filter((c) => effectiveBlocked.includes(c.id))
    return rerouteAvoidingMany(
      {
        coords: selectedRoute.path,
        lengthKm: selectedRoute.lengthKm,
        days: daysForKm(selectedRoute.lengthKm),
      },
      blocked,
    )
  }, [selectedRoute, effectiveBlocked])

  // Keep the canonical path on the map while selection changes. Reroute
  // metrics remain in the details panel without morphing the clicked line.
  const displayRoutes = computedRoutes

  const laneCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const route of computedRoutes) counts[route.lane] = (counts[route.lane] ?? 0) + 1
    return counts
  }, [computedRoutes])

  // Focused routes: the replaying scenario's own lanes take priority, then a
  // manually picked lane. An empty focus set would dim every route, so it falls
  // back to "no focus" instead.
  const focusedRouteIds = useMemo(() => {
    const ids = new Set<string>()
    if (activeScenario) {
      const affected = new Set(activeScenario.chokepointIds)
      for (const route of computedRoutes) {
        if (route.passesThrough.some((id) => affected.has(id))) ids.add(route.id)
      }
    } else if (selectedLane) {
      for (const route of computedRoutes) if (route.lane === selectedLane) ids.add(route.id)
    } else {
      return null
    }
    return ids.size > 0 ? ids : null
  }, [computedRoutes, selectedLane, activeScenario])

  const dataAsOf = displayedReplayDate ?? snapshot?.latestDate ?? null

  // Real risk index: how many monitored chokepoints are flagged (watch or
  // worse) in the analysis currently on screen.
  const riskIndex = useMemo(() => {
    if (!analysis) return null
    let flagged = 0
    for (const id of allChokepointIds) {
      const result = analysis[id]
      if (!result) continue
      if (
        result.status === 'watch' ||
        result.status === 'disrupted' ||
        result.displayStatus === 'structurally-down' ||
        result.displayStatus === 'severely-disrupted'
      ) {
        flagged++
      }
    }
    return { flagged, total: allChokepointIds.length }
  }, [analysis, allChokepointIds])

  // Advance the replay clock while playing.
  useEffect(() => {
    if (!playing || !activeScenario || replayDates.length === 0) return
    const last = replayDates.length - 1
    const id = setInterval(() => {
      setReplayIndex((i) => (i >= last ? i : i + 1))
    }, REPLAY_TICK_MS)
    return () => clearInterval(id)
  }, [playing, activeScenario, replayDates.length])

  const addEvent = useCallback((message: string, tone: LogEvent['tone'] = 'info', source = 'ChainWise') =>
    setEvents((prev) => [{ id: nextEventId(), time: nowTime(), source, message, tone }, ...prev]), [])

  const toggleLayer = useCallback((key: LayerKey) =>
    setLayers((prev) => ({ ...prev, [key]: !prev[key] })), [])

  // Manual blocking is single-select: blocking a new chokepoint clears the
  // previous one; clicking a blocked chokepoint clears it.
  const toggleChokepoint = useCallback((chokepoint: Chokepoint) => {
    setReplayId(null)
    setPlaying(false)
    const isBlocked = blockedCpIds.includes(chokepoint.id)
    setBlockedCpIds(isBlocked ? [] : [chokepoint.id])
    addEvent(
      isBlocked
        ? `Restored ${chokepoint.name}`
        : `Blocked ${chokepoint.name}${blockedCpIds.length > 0 ? ' (previous block cleared)' : ''}`,
      isBlocked ? 'info' : 'warn',
    )
  }, [blockedCpIds, addEvent])

  // Clicking a scenario starts it immediately: the replay runs from its start
  // date, the affected chokepoint opens in the details panel and the map eases
  // onto it. Its routes are highlighted by `focusedRouteIds`.
  const startReplay = useCallback((scenario: Scenario) => {
    setReplayId(scenario.id)
    setReplayIndex(0)
    setPlaying(true)
    setBlockedCpIds(scenario.chokepointIds)
    setSelectedPort(null)
    const primary = chokepoints.find((cp) => cp.id === scenario.chokepointIds[0]) ?? null
    setSelectedChokepoint(primary)
    const impact = impacts?.[scenario.id]
    addEvent(
      `Playing ${scenario.name} · ${impact?.startDate ?? 'measuring'} to ${impact?.endDate ?? 'ongoing'}`,
      'warn',
      'Replay',
    )
  }, [impacts, addEvent])

  const exitReplay = () => {
    setPlaying(false)
    setReplayId(null)
    setReplayIndex(0)
    setBlockedCpIds([])
    addEvent('Back to live IMF PortWatch data', 'info')
  }

  const togglePlay = () => {
    if (atEnd) {
      setReplayIndex(0)
      setPlaying(true)
      return
    }
    setPlaying((value) => !value)
  }

  const scrubReplay = (index: number) => {
    setPlaying(false)
    setReplayIndex(index)
  }

  const selectRoute = useCallback((route: ComputedRoute) => {
    setSelectedRoute(route)
    setSelectedChokepoint(null)
    setSelectedPort(null)
  }, [])

  const selectChokepoint = useCallback((chokepoint: Chokepoint) => {
    setSelectedChokepoint(chokepoint)
    setSelectedPort(null)
  }, [])

  const selectPort = useCallback((port: Port) => {
    setSelectedPort(port)
    setSelectedChokepoint(null)
  }, [])

  const selectSearchOption = useCallback((option: SearchOption) => {
    if (option.type === "port") {
      const port = ports.find((item) => item.id === option.id)
      if (port) selectPort(port)
    } else if (option.type === "route") {
      const route = computedRoutes.find((item) => item.id === option.id)
      if (route) selectRoute(route)
    } else if (option.type === "chokepoint") {
      const chokepoint = chokepoints.find((item) => item.id === option.id)
      if (chokepoint) selectChokepoint(chokepoint)
    } else {
      const scenario = scenarioById(option.id)
      if (scenario) startReplay(scenario)
    }
  }, [computedRoutes, selectChokepoint, selectPort, selectRoute, startReplay])

  const clearMapSelection = useCallback(() => {
    setSelectedRoute(null)
    setSelectedChokepoint(null)
    setSelectedPort(null)
  }, [])

  const clearAll = useCallback(() => {
    setSelectedRoute(null)
    setSelectedChokepoint(null)
    setSelectedPort(null)
    setBlockedCpIds([])
    setReplayId(null)
    setPlaying(false)
    setReplayIndex(0)
    addEvent('All selections cleared', 'info')
  }, [addEvent])

  const toggleEventLog = useCallback(() => setEventLogOpen(open => !open), [])
  const controls = useMemo(() => (
    <MapControls layers={layers} onToggleLayer={toggleLayer}
      onZoomIn={() => mapApi?.zoomIn()} onZoomOut={() => mapApi?.zoomOut()}
      onCenterIndia={() => mapApi?.centerIndia()} />
  ), [layers, toggleLayer, mapApi])

  // The right column only exists when something is selected.
  const rightOpen = Boolean(selectedRoute || selectedChokepoint || selectedPort)

  const startRightPanelResize = useCallback((clientX: number) => {
    setRightPanelWidth(Math.min(560, Math.max(300, window.innerWidth - clientX)))
    const onMove = (event: PointerEvent) => {
      const width = Math.min(560, Math.max(300, window.innerWidth - event.clientX))
      setRightPanelWidth(width)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  return (
    <main
      className="grid h-dvh w-full grid-rows-[56px_minmax(0,1fr)_44px] overflow-hidden bg-app-bg text-app-text"
      style={{
        gridTemplateColumns: `${leftCollapsed ? 56 : 320}px minmax(0, 1fr) ${rightOpen ? rightPanelWidth : 0}px`,
      }}
    >
      <TopBar
        dataAsOf={dataAsOf}
        dataSource={snapshot?.source ?? null}
        replayName={activeScenario?.name ?? null}
        searchOptions={searchOptions}
        onSearchSelect={selectSearchOption}
      />

      <LeftPanel
        activeScenarioId={replayId}
        playing={isPlaying}
        impacts={impacts}
        onReplay={startReplay}
        onClearSelection={clearAll}
        collapsed={leftCollapsed}
        onToggleCollapsed={() => setLeftCollapsed((value) => !value)}
        selectedLane={selectedLane}
        laneCounts={laneCounts}
        onSelectLane={setSelectedLane}
        routes={computedRoutes}
        selectedRouteId={selectedRoute?.id ?? null}
        onSelectRoute={selectRoute}
      />

      {/* Center cell: only the map, the replay bar and the event-log drawer. */}
      <div className="relative min-h-0 overflow-hidden">
        <Map
          chokepoints={chokepoints}
          ports={ports}
          routes={displayRoutes}
          reroute={reroute}
          selectedRouteId={selectedRoute?.id ?? null}
          onSelectRoute={selectRoute}
          blockedChokepointIds={effectiveBlocked}
          chokepointAnalysis={analysis}
          portAnalysis={portAnalysis}
          dataAsOf={dataAsOf}
          selectedChokepointId={selectedChokepoint?.id ?? null}
          highlightedChokepointId={highlightedChokepointId}
          selectedPortId={selectedPort?.id ?? null}
          focusedRouteIds={focusedRouteIds}
          onSelectChokepoint={selectChokepoint}
          onSelectPort={selectPort}
          showRoutes={layers.routes}
          showChokepoints={layers.chokepoints}
          showPorts={layers.ports}
          onClearSelection={clearMapSelection}
          onReady={setMapApi}
          scenarioName={activeScenario?.name ?? null}
          scenarioChokepointId={activeScenario?.chokepointIds[0] ?? null}
          newsByChokepoint={Object.fromEntries(
            Object.entries(newsByChokepoint).map(([id, value]) => [id, value.status]),
          )}
        />

        {activeScenario && replayDate ? (
          <ReplayBar
            scenario={activeScenario}
            date={replayDate}
            index={replayIndex}
            count={replayDates.length}
            playing={isPlaying}
            dropPct={replayDrop}
            onTogglePlay={togglePlay}
            onScrub={scrubReplay}
            onExit={exitReplay}
          />
        ) : null}

        {eventLogOpen ? (
          <EventLogOverlay events={events} onClose={() => setEventLogOpen(false)} />
        ) : null}
      </div>

      {rightOpen ? (
        <RightPanel
          chokepoints={chokepoints}
          ports={ports}
          selectedRoute={selectedRoute}
          blockedCpIds={effectiveBlocked}
          reroute={reroute}
          onBlockToggle={toggleChokepoint}
          onChokepointHover={setHighlightedChokepointId}
          selectedChokepoint={selectedChokepoint}
          chokepointResult={selectedChokepointResult}
          chokepointChartSeries={chokepointChartSeries}
          chokepointChartVisible={chokepointChartVisible}
          selectedPort={selectedPort}
          portResult={selectedPortResult}
          portChartSeries={portChartSeries}
          portChartVisible={portChartVisible}
          portAnalysis={portAnalysis}
          dataAsOf={dataAsOf}
          news={selectedChokepoint ? newsByChokepoint[selectedChokepoint.id] ?? null : null}
          newsLoading={newsFeed.loading}
          newsError={newsFeed.error}
          onResizeStart={startRightPanelResize}
          onClear={clearMapSelection}
        />
      ) : null}

      <BottomStrip
        events={events}
        eventLogOpen={eventLogOpen}
        onToggleEventLog={toggleEventLog}
        risk={riskIndex}
        dataAsOf={dataAsOf}
        dataSource={snapshot?.source ?? null}
        replaying={activeScenario !== null}
        controls={controls}
      />
    </main>
  )
}
