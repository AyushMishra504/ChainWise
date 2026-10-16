# ChainWise

ChainWise is an operations dashboard for monitoring maritime supply-chain risk around ports, trade routes, and strategic chokepoints. It combines IMF PortWatch activity data with trade-news coverage, route geometry, disruption analysis, and historical event replay.

## What it does

- Shows maritime routes, ports, and chokepoints on a dark MapLibre map.
- Computes sea routes and distance using `searoute-js`.
- Monitors daily chokepoint transits from IMF PortWatch.
- Monitors port calls, vessel categories, and estimated import/export volumes.
- Classifies activity as normal, watch, disrupted, structurally down, or no data.
- Replays historical events such as the Ever Given blockage, the Red Sea crisis, and the Panama drought.
- Measures event impact against a 90-day pre-event baseline.
- Blocks chokepoints and estimates route detours.
- Polls trade-news RSS feeds and correlates recent coverage with transit disruption.
- Provides search suggestions for ports, routes, chokepoints, and scenarios.

## Data sources

### IMF PortWatch

Daily chokepoint and port data is fetched server-side from the public IMF PortWatch ArcGIS services. The app requests history from 2019 onward and keeps:

1. An in-memory cache
2. A disk cache under `data/cache/`
3. A committed offline snapshot under `data/replay/`

Chokepoint data is cached for six hours. Port data follows the same source/cache/fallback pattern. The UI identifies whether the current data is live, cached, or from the offline snapshot.

### Trade news

Trade-news headlines are fetched server-side from:

- [gCaptain](https://gcaptain.com/)
- [Splash 247](https://splash247.com/)
- [Hellenic Shipping News](https://www.hellenicshippingnews.com/)
- [The Loadstar](https://theloadstar.com/)

Only feed metadata, short descriptions, dates, and links are retained. News is cached for 30 minutes and kept in a rolling 90-day log. The corroboration engine counts matching mentions in a seven-day window and reports:

- Corroborated
- Unconfirmed
- Early warning
- Quiet
- No news data

## Project structure

```text
app/                    Next.js app page, layout, and API routes
components/             Map, panels, charts, replay, and dashboard controls
data/                   Static ports, chokepoints, routes, scenarios, and caches
lib/engine/             Pure disruption, replay, port, and news analysis
lib/sources/            Server-only PortWatch and RSS ingestion
lib/                    Client hooks, routing, and shared data models
scripts/                Replay and performance profiling helpers
```

## Getting started

Requirements:

- Node.js 20 or newer
- npm

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Commands

```bash
npm run dev      # Start the development server
npm run build    # Create a production build
npm run start    # Serve the production build
npm run lint     # Run ESLint
npm test         # Run the engine unit tests
```

## Groq disruption analysis

The selected chokepoint panel includes an **Analyze disruption** action. It
calls the server-only `/api/agent` route, where a Groq-hosted model can invoke the
read-only `getChokepointStatus` tool. The tool reuses the PortWatch snapshot
and disruption engine; it rejects unknown configured IDs and reports missing
data instead of inventing measurements.

Add these variables to `.env` (never expose them as `NEXT_PUBLIC_*` values):

```bash
GROQ_API_KEY=your-key
GROQ_MODEL=openai/gpt-oss-20b
```

The panel displays the model explanation and the actual tool input/result log.
Successful analyses are cached in the browser per chokepoint for five minutes,
so repeating the analysis does not send another model request during that
window. Use **Refresh** to bypass the cache and request a fresh analysis.
If the key is missing, the provider fails, or the provider is rate-limited, the
server returns a visible error and the dashboard remains usable.

## API routes

| Route | Purpose |
| --- | --- |
| `/api/portwatch` | Chokepoint transit snapshot |
| `/api/portwatch-ports` | Port activity snapshot |
| `/api/news` | Cached trade-news snapshot |
| `/api/news-refresh` | Force a news refresh and return feed diagnostics |
| `/api/agent` | Groq-hosted disruption analysis with the read-only status tool |

All external fetching happens in server-side source modules. The browser consumes the normalized JSON returned by these routes.

## Interaction guide

- Use the **Scenarios** tab to start or pause a historical replay.
- Use the **Lanes** tab to highlight a trade lane.
- Use **My business** to inspect a specific modeled route.
- Click a port or chokepoint on the map to open its details.
- Use **Block chokepoint** to calculate a detour for the selected route.
- Use the top search field to jump to a port, route, chokepoint, or scenario.
- Open **Data sources** to view the upstream providers.

## Testing and data limitations

The statistical engines and news corroboration logic are covered by Node unit tests. API and map interactions currently rely on build validation and manual browser verification.

Not every displayed chokepoint has an IMF PortWatch series. Unmatched chokepoints intentionally show `No data`; ChainWise does not invent measurements. Port marker sizes use the static vessel-count metadata in `data/ports.ts`, while disruption status uses the fetched daily PortWatch series.
