// Summarises an ops/cache-ab.sh run: per-endpoint medians across rounds for
// each arm, and the cache-on vs cache-off change in p99 and throughput.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const runs = { on: [], off: [] };
for (const file of readdirSync(dir).filter((f) => /^(on|off)-\d+\.json$/.test(f))) {
  runs[file.split('-')[0]].push(JSON.parse(readFileSync(join(dir, file), 'utf8')));
}

const summary = runs.on[0].endpoints.map(({ label, path }) => {
  const arm = (name) => {
    const eps = runs[name].map((r) => r.endpoints.find((e) => e.path === path));
    return {
      rps: median(eps.map((e) => e.requestsPerSec)),
      p50: median(eps.map((e) => e.latency.p50)),
      p99: median(eps.map((e) => e.latency.p99)),
      non2xx: eps.reduce((n, e) => n + e.non2xx, 0),
    };
  };
  const on = arm('on');
  const off = arm('off');
  return {
    label,
    on,
    off,
    p99Change: (on.p99 - off.p99) / off.p99,
    rpsChange: (on.rps - off.rps) / off.rps,
  };
});

const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
console.log(`\nCache A/B — medians of ${runs.on.length} on / ${runs.off.length} off runs\n`);
for (const s of summary) {
  console.log(s.label);
  console.log(`  cache off: ${s.off.rps} req/s  p50 ${s.off.p50}ms  p99 ${s.off.p99}ms  non-2xx ${s.off.non2xx}`);
  console.log(`  cache on:  ${s.on.rps} req/s  p50 ${s.on.p50}ms  p99 ${s.on.p99}ms  non-2xx ${s.on.non2xx}`);
  console.log(`  change:    p99 ${pct(s.p99Change)}  throughput ${pct(s.rpsChange)}\n`);
}
writeFileSync(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
