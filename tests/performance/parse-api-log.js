#!/usr/bin/env node
// Server-side latency per route from the API's structured pino-http logs
// (NODE_ENV=production JSON output). Complements client-side numbers from
// run-api-load.js: server time excludes client/TCP queueing, so a large gap
// between the two points at event-loop saturation or connection queueing,
// while a high server time points at the handler/DB work itself.
//
//   node tests/performance/parse-api-log.js <api-log-file> [sinceIsoTimestamp]
'use strict';
const fs = require('fs');
const [file, since] = process.argv.slice(2);
const sinceMs = since ? Date.parse(since) : 0;
const byRoute = new Map();
const errors = new Map();
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.startsWith('{')) continue;
  let e; try { e = JSON.parse(line); } catch { continue; }
  if (e.time < sinceMs) continue;
  if (e.level >= 50 && e.err) errors.set(e.err.message?.slice(0, 120), (errors.get(e.err.message?.slice(0, 120)) || 0) + 1);
  if (!e.req || e.responseTime == null || !e.res) continue;
  const route = `${e.req.method} ${e.req.url.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')}`;
  let r = byRoute.get(route);
  if (!r) byRoute.set(route, (r = { t: [], codes: {} }));
  r.t.push(e.responseTime);
  r.codes[e.res.statusCode] = (r.codes[e.res.statusCode] || 0) + 1;
}
const pct = (s, p) => s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)];
const rows = [...byRoute.entries()].map(([route, r]) => {
  const s = r.t.sort((a, b) => a - b);
  return { route, n: s.length, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: s[s.length - 1], codes: JSON.stringify(r.codes) };
}).sort((a, b) => b.p95 - a.p95);
console.table(rows);
if (errors.size) { console.log('Server errors (level>=50):'); for (const [m, n] of errors) console.log(`  ${n} x ${m}`); }
