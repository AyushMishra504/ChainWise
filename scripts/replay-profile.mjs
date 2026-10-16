/*
 * Dev-only harness: drives a scenario replay in a headless Edge and reports the
 * opt-in ?profileReplay=1 timings (analysis / map / render) plus console output.
 *
 *   node scripts/replay-profile.mjs --label=phase0-before [--sessions=3] [--seconds=6]
 *
 * Requires `npm run dev` on http://localhost:3000.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);

const BASE = args.base ?? 'http://localhost:3000';
const CARD = args.card ?? 'Hormuz';
const SECONDS = Number(args.seconds ?? 6);
const SESSIONS = Number(args.sessions ?? 3);
const LABEL = args.label ?? 'run';
const BASE_PORT = Number(args.port ?? 9333);
/** Set --dump=tooltips to record every marker tooltip at a pinned frame. */
const DUMP = args.dump === 'tooltips';
/** Set --dump=panels to walk every route (and a port) and record its panel. */
const DUMP_PANELS = args.dump === 'panels';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!EDGE) throw new Error('Edge not found');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Nearest chokepoint markers to the map centre — a DOM-visible read of the camera. */
const CAMERA_PROBE = `(() => {
  const mapEl = document.querySelector('.maplibregl-map');
  if (!mapEl) return null;
  const box = mapEl.getBoundingClientRect();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const markers = [...document.querySelectorAll('.maplibregl-marker')].slice(0, 16);
  for (const m of markers) m.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  const rows = markers.map((m) => {
    const r = m.getBoundingClientRect();
    return {
      name: m.textContent.replace(/\\s+/g, ' ').trim().slice(0, 30),
      distancePx: Math.round(Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy)),
    };
  }).sort((a, b) => a.distancePx - b.distancePx);
  return { nearest: rows.slice(0, 4), mapSize: { w: Math.round(box.width), h: Math.round(box.height) } };
})()`;

/**
 * Samples the chokepoint chart mid-replay. The line is expected to *grow* with
 * the time bar: the settled path gains a point per tick and only the newest
 * step animates (dash offset 1 -> 0), so a fast whole-line wipe would show up
 * as a constant drawn-point count with a remounting node every tick.
 */
const CHART_PROBE = `(async () => {
  const SVG = 'svg[aria-label="Daily chokepoint transits"]';
  const SEL = SVG + ' path.chart-draw';
  const nodes = new Set();
  const offsets = new Set();
  const drawn = [];
  let maxAnimations = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 1600) {
    const el = document.querySelector(SEL);
    if (el) {
      if (!el.__cwMark) el.__cwMark = 'n' + (nodes.size + 1);
      nodes.add(el.__cwMark);
      offsets.add(getComputedStyle(el).strokeDashoffset);
      if (el.getAnimations) maxAnimations = Math.max(maxAnimations, el.getAnimations().length);
    }
    const settled = document.querySelector(SVG)?.querySelector('path:not(.chart-draw)');
    if (settled) {
      const d = settled.getAttribute('d') ?? '';
      drawn.push(d ? d.split(/[ML]/).filter(Boolean).length : 0);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  const sole = document.querySelector(SEL);
  const svg = document.querySelector(SVG);
  const footer = svg?.parentElement?.querySelector('div.mt-1')?.textContent ?? null;
  return {
    present: !!sole,
    distinctNodes: nodes.size,
    distinctOffsets: [...offsets].slice(0, 12),
    animationName: sole ? getComputedStyle(sole).animationName : null,
    maxAnimations,
    drawnPointsFirst: drawn.length ? drawn[0] : null,
    drawnPointsLast: drawn.length ? drawn[drawn.length - 1] : null,
    drawnPointSteps: drawn.filter((v, i) => i === 0 || v !== drawn[i - 1]).slice(0, 12),
    footer,
    replayDays: Number(document.querySelector('input[aria-label="Replay date"]')?.max ?? -1) + 1,
  };
})()`;

let seq = 0;
function makeClient(ws) {
  const pending = new Map();
  const console_ = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      console_.push({
        level: msg.params.type,
        text: msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
      });
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      console_.push({ level: 'exception', text: d.exception?.description ?? d.text });
    }
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (e.level === 'error' || e.level === 'warning') console_.push({ level: e.level, text: e.text });
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
    return res.result.value;
  };
  return { send, evaluate, console: console_ };
}

async function runSession(index) {
  const port = BASE_PORT + index;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-profile-'));
  const edge = spawn(
    EDGE,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--enable-unsafe-swiftshader',
      '--window-size=1600,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    let wsUrl = null;
    for (let i = 0; i < 80 && !wsUrl; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        wsUrl = targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null;
      } catch {
        /* not up yet */
      }
      if (!wsUrl) await sleep(250);
    }
    if (!wsUrl) throw new Error('CDP target never appeared');

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const client = makeClient(ws);
    await client.send('Runtime.enable');
    await client.send('Log.enable');
    await client.send('Page.enable');
    await client.send('Page.navigate', { url: `${BASE}/?profileReplay=1` });

    // The app now loads live (no replay bar), so wait for the scenario card and
    // probe the default state before starting a replay.
    const cardExpr = `[...document.querySelectorAll('li')].find(li => li.textContent.includes(${JSON.stringify(CARD)}))`;
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      await sleep(500);
      ready = await client.evaluate(`!!(${cardExpr})`);
    }

    const initial = await client.evaluate(`(() => {
      const header = document.querySelector('header');
      const details = document.querySelector('button[aria-label="Close details"]');
      return {
        replayBar: !!document.querySelector('input[aria-label="Replay date"]'),
        detailsPanel: !!details,
        headerChip: header ? header.textContent.replace(/\\s+/g, ' ').trim() : null,
        pageOverflow: {
          x: document.documentElement.scrollWidth > window.innerWidth,
          y: document.documentElement.scrollHeight > window.innerHeight,
        },
      };
    })()`);

    const webgl = await client.evaluate(
      "(()=>{try{const c=document.createElement('canvas');return !!(c.getContext('webgl2')||c.getContext('webgl'))}catch{return false}})()",
    );
    // Markers are added once the map is ready, so give them a moment.
    let markers = 0;
    for (let i = 0; i < 20 && markers === 0; i++) {
      markers = await client.evaluate("document.querySelectorAll('.maplibregl-marker').length");
      if (!markers) await sleep(500);
    }

    const cameraInitial = await client.evaluate(CAMERA_PROBE);

    // Click the scenario card (which starts the replay) and make sure it plays.
    const pick = await client.evaluate(`(() => {
      const card = ${cardExpr};
      if (!card) return 'card-not-found';
      card.querySelector('button')?.click();
      return 'ok';
    })()`);
    await sleep(600);
    const cardLabel = await client.evaluate(`(() => {
      const card = ${cardExpr};
      return card ? card.querySelector('button')?.textContent ?? null : null;
    })()`);
    let barMounted = false;
    for (let i = 0; i < 40 && !barMounted; i++) {
      barMounted = await client.evaluate(
        "!!document.querySelector('input[aria-label=\"Replay date\"]')",
      );
      if (!barMounted) await sleep(250);
    }
    const playing = await client.evaluate(`(() => {
      if (document.querySelector('button[aria-label="Pause replay"]')) return 'playing';
      const b = document.querySelector('button[aria-label="Play replay"]');
      if (!b) return 'no-button';
      b.click();
      return 'clicked-play';
    })()`);

    // Clicking a scenario must open the affected chokepoint with its chart and
    // pin a red scenario-name banner above that chokepoint.
    const scenarioState = await client.evaluate(`(() => {
      const aside = [...document.querySelectorAll('aside')].find(a => a.textContent.includes('Chokepoint'));
      const banner = [...document.querySelectorAll('.maplibregl-marker')].find(m =>
        m.classList.contains('border-app-red') && m.classList.contains('bg-app-surface'));
      const dot = banner
        ? [...document.querySelectorAll('.maplibregl-marker.h-3')]
            .map((m) => {
              const r = m.getBoundingClientRect();
              const b = banner.getBoundingClientRect();
              return { m, d: Math.hypot(r.x + r.width / 2 - (b.x + b.width / 2), r.y + r.height / 2 - b.bottom) };
            })
            .sort((a, z) => a.d - z.d)[0]?.m ?? null
        : null;
      let gapAboveDotPx = null;
      if (banner && dot) {
        gapAboveDotPx = Math.round(dot.getBoundingClientRect().top - banner.getBoundingClientRect().bottom);
      }
      return {
        detailsPanel: !!document.querySelector('button[aria-label="Close details"]'),
        panelTitle: aside ? (aside.querySelector('h2')?.textContent ?? null) : null,
        chart: !!document.querySelector('svg[aria-label="Daily chokepoint transits"]'),
        chartNote: document.querySelector('svg[aria-label="Daily chokepoint transits"]') ? null
          : (aside?.textContent.includes('Not enough data to chart') ? 'not-enough-data' : 'no-chart'),
        bannerText: banner ? banner.textContent.trim() : null,
        bannerColor: banner ? getComputedStyle(banner).color : null,
        bannerGapAboveDotPx: gapAboveDotPx,
      };
    })()`);

    // A scenario click must NOT move the camera any more: the marker keeps the
    // same distance from the map centre as it had on load.
    const cameraBefore = await client.evaluate(CAMERA_PROBE);
    await sleep(1400);
    const camera = await client.evaluate(CAMERA_PROBE);
    const chartRedraw = await client.evaluate(CHART_PROBE);
    await sleep(SECONDS * 1000);
    const profile = (await client.evaluate('window.replayProfile ?? null')) ?? {};

    let dump = null;
    if (DUMP) {
      // Pin a deterministic frame and pause so tooltips are reproducible.
      await client.evaluate(`(() => {
        document.querySelector('button[aria-label="Pause replay"]')?.click();
        const input = document.querySelector('input[aria-label="Replay date"]');
        if (!input) return 'no-range';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(args.frame ?? '10')});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return 'ok';
      })()`);
      await sleep(600);

      const readAll = `(() => {
        const markers = [...document.querySelectorAll('.maplibregl-marker')];
        return markers.map((el) => {
          el.dispatchEvent(new MouseEvent('mouseenter'));
          const label = el.children[1];
          return { html: label ? label.innerHTML : null, text: label ? (label.textContent ?? '') : null };
        });
      })()`;

      const first = await client.evaluate(readAll);
      const second = await client.evaluate(readAll);
      const frame = await client.evaluate(
        "document.querySelector('input[aria-label=\"Replay date\"]')?.value ?? null",
      );
      dump = { frame, first, stable: JSON.stringify(first) === JSON.stringify(second) };
    }

    // Layout probe: select a route so the right column appears, then measure
    // the grid geometry and check the page does not overflow.
    const selectRoute = await client.evaluate(`(() => {
      const tab = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'My business');
      if (!tab) return 'tab-not-found';
      tab.click();
      return 'ok';
    })()`);
    await sleep(400);
    const routePicked = await client.evaluate(`(() => {
      const select = document.querySelector('select');
      if (!select) return 'select-not-found';
      const option = [...select.options].find(o => o.value);
      if (!option) return 'no-option';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(select, option.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return option.value;
    })()`);
    await sleep(700);
    const layout = await client.evaluate(`(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
      const asides = [...document.querySelectorAll('aside')];
      return {
        header: r(document.querySelector('header')),
        footer: r(document.querySelector('footer')),
        left: r(asides[0] ?? null),
        right: r(asides[1] ?? null),
        map: r(document.querySelector('.maplibregl-map')),
        clipped: { x: document.documentElement.scrollWidth > window.innerWidth, y: document.documentElement.scrollHeight > window.innerHeight },
      };
    })()`);

    // Which routes the app itself considers to pass through each chokepoint:
    // walk every "My business" route and read its chokepoint list. Then open a
    // port marker to check its panel chart.
    let routeChokepoints = null;
    let portPanel = null;
    if (DUMP_PANELS) {
      await client.evaluate(`(() => {
        const tab = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'My business');
        tab?.click();
        return !!tab;
      })()`);
      await sleep(400);
      const optionValues = await client.evaluate(
        "[...document.querySelectorAll('select option')].map(o => o.value).filter(Boolean)",
      );
      routeChokepoints = {};
      for (const value of optionValues) {
        const picked = await client.evaluate(`(() => {
          const select = document.querySelector('select');
          if (!select) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
          setter.call(select, ${JSON.stringify(value)});
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`);
        if (!picked) break;
        await sleep(500);
        routeChokepoints[value] = await client.evaluate(`(() => {
          const h = [...document.querySelectorAll('h3')].find(x => x.textContent.trim() === 'Chokepoints on this route');
          const section = h?.parentElement;
          if (!section) return null;
          return [...section.querySelectorAll('li')].map(li => li.textContent.replace(/\\s+/g, ' ').trim());
        })()`);
      }

      // Labels are built lazily on first hover, so hover them all to read names.
      const portPicked = await client.evaluate(`(() => {
        const markers = [...document.querySelectorAll('.maplibregl-marker')];
        for (const m of markers) m.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        const el = markers.find(m => m.textContent.includes('Rotterdam'));
        if (!el) return 'marker-not-found';
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return 'ok';
      })()`);
      await sleep(700);
      portPanel = await client.evaluate(`(() => {
        const aside = [...document.querySelectorAll('aside')].find(a => a.querySelector('h2'));
        return {
          title: aside?.querySelector('h2')?.textContent ?? null,
          chart: !!document.querySelector('svg[aria-label="Daily port calls by vessel type"]'),
          notEnoughData: aside?.textContent.includes('Not enough data to chart') ?? null,
        };
      })()`);
      portPanel.picked = portPicked;
    }

    // Back to live: the header should switch to the live data chip.
    const backToLive = await client.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Back to live');
      b?.click();
      return !!b;
    })()`);
    await sleep(1500);
    const liveState = await client.evaluate(`(() => {
      const header = document.querySelector('header');
      return {
        headerChip: header ? header.textContent.replace(/\\s+/g, ' ').trim() : null,
        replayBar: !!document.querySelector('input[aria-label="Replay date"]'),
        detailsPanel: !!document.querySelector('button[aria-label="Close details"]'),
        pageOverflow: {
          x: document.documentElement.scrollWidth > window.innerWidth,
          y: document.documentElement.scrollHeight > window.innerHeight,
        },
      };
    })()`);

    ws.close();
    return {
      pick,
      playing,
      webgl,
      markers,
      profile,
      console: client.console,
      ready,
      dump,
      initial,
      cardLabel,
      scenarioState,
      cameraInitial,
      cameraBefore,
      camera,
      chartRedraw,
      layout,
      selectRoute,
      routePicked,
      backToLive,
      liveState,
      routeChokepoints,
      portPanel,
    };
  } finally {
    edge.kill();
  }
}

const SUPPRESS = /Download the React DevTools|devtools|Maplibre|MapLibre|Failed to load resource.*favicon/i;

(async () => {
  const sessions = [];
  for (let i = 0; i < SESSIONS; i++) {
    const s = await runSession(i);
    sessions.push(s);
    console.log(`session ${i + 1}/${SESSIONS}: ticks=${Object.keys(s.profile).length} pick=${s.pick} play=${s.playing} webgl=${s.webgl} markers=${s.markers}`);
  }

  const perSession = sessions.map((s) => {
    const rows = Object.values(s.profile);
    const n = rows.length || 1;
    const mean = (k) => rows.reduce((a, r) => a + r[k], 0) / n;
    return { n: rows.length, analysis: mean('analysis'), map: mean('map'), render: mean('render') };
  });

  const agg = (k) => median(perSession.map((p) => p[k]));
  const warnings = sessions.flatMap((s) => s.console).filter(
    (c) => (c.level === 'error' || c.level === 'warning' || c.level === 'exception') && !SUPPRESS.test(c.text),
  );

  console.log(`\n=== replay profile (${LABEL}) ===`);
  console.log(`sessions=${SESSIONS} seconds=${SECONDS} card=${CARD}`);
  console.log(`ticks: ${perSession.map((p) => p.n).join(', ')}`);
  console.log(`  analysis  median ${agg('analysis').toFixed(3)} ms/tick`);
  console.log(`  map       median ${agg('map').toFixed(3)} ms/tick`);
  console.log(`  render    median ${agg('render').toFixed(3)} ms/tick`);
  console.log(`  combined  median ${(agg('analysis') + agg('map') + agg('render')).toFixed(3)} ms/tick`);
  console.log(`console warnings/errors: ${warnings.length}`);
  for (const w of warnings.slice(0, 12)) console.log(`  [${w.level}] ${w.text.slice(0, 240)}`);

  const first0 = sessions[0] ?? {};
  console.log(`\ndefault state on load: ${JSON.stringify(first0.initial)}`);
  console.log(`card label right after click: ${first0.cardLabel}`);
  console.log(`scenario click: ${JSON.stringify(first0.scenarioState)}`);
  console.log(`camera on load: ${JSON.stringify(first0.cameraInitial)}`);
  console.log(`camera on click: ${JSON.stringify(first0.cameraBefore)}`);
  console.log(`camera settled: ${JSON.stringify(first0.camera)}`);
  console.log(`chart redraw: ${JSON.stringify(first0.chartRedraw)}`);
  console.log(`route select: ${first0.selectRoute} / ${first0.routePicked}`);
  console.log(`layout: ${JSON.stringify(first0.layout)}`);
  console.log(`back to live: clicked=${first0.backToLive} state=${JSON.stringify(first0.liveState)}`);
  if (first0.routeChokepoints) {
    console.log(`route chokepoints: ${JSON.stringify(first0.routeChokepoints)}`);
  }
  if (first0.portPanel) console.log(`port panel: ${JSON.stringify(first0.portPanel)}`);

  const dump = sessions[0]?.dump ?? null;
  if (dump) {
    const texts = dump.first.map((t) => t.text ?? '');
    const empty = texts.map((t, i) => (t.trim() ? -1 : i)).filter((i) => i >= 0);
    console.log(`\ntooltip dump @ frame ${dump.frame}: ${texts.length} markers`);
    console.log(`  non-empty: ${texts.length - empty.length}/${texts.length}  emptyIndexes: ${empty.join(',') || 'none'}`);
    console.log(`  stable across repeated hover: ${dump.stable}`);
    for (const [i, t] of texts.entries()) {
      console.log(`  [${i}] ${t.replace(/\s+/g, ' ').slice(0, 150)}`);
    }
  }

  const outFile = path.join('data', 'profile', `${LABEL}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        label: LABEL,
        card: CARD,
        sessions: perSession,
        median: { analysis: agg('analysis'), map: agg('map'), render: agg('render') },
        webgl: sessions[0]?.webgl,
        markers: sessions[0]?.markers,
        warnings,
        tooltipDump: dump,
        initial: sessions[0]?.initial ?? null,
        cardLabelAfterClick: sessions[0]?.cardLabel ?? null,
        layout: sessions[0]?.layout ?? null,
        backToLive: sessions[0]?.backToLive ?? null,
        liveState: sessions[0]?.liveState ?? null,
        scenarioState: sessions[0]?.scenarioState ?? null,
        camera: sessions[0]?.camera ?? null,
        cameraInitial: sessions[0]?.cameraInitial ?? null,
        cameraBefore: sessions[0]?.cameraBefore ?? null,
        chartRedraw: sessions[0]?.chartRedraw ?? null,
        routeChokepoints: sessions[0]?.routeChokepoints ?? null,
        portPanel: sessions[0]?.portPanel ?? null,
      },
      null,
      2,
    ),
  );
  console.log(`saved ${outFile}`);
  process.exit(0);
})().catch((error) => {
  console.error('harness failed:', error);
  process.exit(1);
});
