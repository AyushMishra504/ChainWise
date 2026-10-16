import fs from 'node:fs';
import { analyzeSnapshot } from '../lib/engine/analysis.ts';
import { analyzePorts } from '../lib/engine/portAnalysis.ts';
import { chokepoints } from '../data/chokepoints.ts';
import { ports } from '../data/ports.ts';
import { dateRange } from '../lib/engine/dates.ts';

const cpSnapshot = JSON.parse(fs.readFileSync('./data/replay/portwatch-snapshot.json', 'utf8'));
const portsSnapshot = JSON.parse(fs.readFileSync('./data/replay/portwatch-ports-snapshot.json', 'utf8'));

const cpIds = chokepoints.map(c => c.id);
const portIds = ports.map(p => p.id);

const dates = dateRange('2021-03-15', '2021-04-15');

console.log(`Running benchmark across ${dates.length} dates...`);

// Warmup
for (const date of dates.slice(0, 3)) {
  analyzeSnapshot(cpSnapshot, cpIds, date);
  analyzePorts(portsSnapshot, portIds, date);
}

const start = performance.now();
let cpTime = 0;
let portTime = 0;

for (const date of dates) {
  const t0 = performance.now();
  analyzeSnapshot(cpSnapshot, cpIds, date);
  const t1 = performance.now();
  analyzePorts(portsSnapshot, portIds, date);
  const t2 = performance.now();
  cpTime += (t1 - t0);
  portTime += (t2 - t1);
}

const total = performance.now() - start;
console.log(`Total: ${total.toFixed(2)}ms for ${dates.length} dates (${(total / dates.length).toFixed(2)}ms / tick)`);
console.log(`  Chokepoints: ${(cpTime / dates.length).toFixed(2)}ms / tick`);
console.log(`  Ports: ${(portTime / dates.length).toFixed(2)}ms / tick`);
