// Minimal dependency-free HTTP load harness (see docs/adr/0003-performance-test-tooling.md).
//
// Why not plain autocannon: the flows we need to measure are multi-step and
// authenticated (login -> token -> per-role reads/writes with per-request
// bodies), and the API's ThrottlerGuard limits each *source IP* to 600
// req/min per route (5/min on /auth/login). Real traffic arrives from many
// IPs; a single-IP load generator measures the throttle, not the server.
// So this harness spreads requests across loopback source addresses
// (127.x.y.z — all routed to localhost on Windows/Linux) via http.Agent
// `localAddress`, and the single-IP throttle behaviour is measured
// separately and explicitly.
'use strict';
const http = require('http');

const BASE = new URL(process.env.PERF_BASE_URL || 'http://127.0.0.1:3100');

// ---- source IP pools -------------------------------------------------------
const agents = new Map();
function agentFor(ip) {
  let a = agents.get(ip);
  if (!a) {
    a = new http.Agent({ keepAlive: true, localAddress: ip, maxSockets: 32 });
    agents.set(ip, a);
  }
  return a;
}
const TRAFFIC_IP_POOL = Number(process.env.PERF_IP_POOL || 200);
let trafficIpCounter = 0;
function nextTrafficIp() {
  const n = trafficIpCounter++ % TRAFFIC_IP_POOL;
  return `127.1.${Math.floor(n / 250)}.${(n % 250) + 1}`;
}
let loginIpCounter = 0;
/** A never-reused IP per login, so the 5/min/IP auth throttle never fires. */
function nextLoginIp() {
  const n = loginIpCounter++;
  return `127.2.${Math.floor(n / 250)}.${(n % 250) + 1}`;
}

// ---- request ---------------------------------------------------------------
function request(method, path, { token, body, ip, headers = {} } = {}) {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const sourceIp = ip || nextTrafficIp();
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const req = http.request(
      {
        host: BASE.hostname,
        port: BASE.port,
        path,
        method,
        agent: agentFor(sourceIp),
        headers: {
          ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'x-correlation-id': `perf-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const ms = Number(process.hrtime.bigint() - start) / 1e6;
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
          resolve({ status: res.statusCode, ms, json, bytes: text.length });
        });
      },
    );
    req.on('error', (err) => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      resolve({ status: 0, ms, error: err.message });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// ---- stats -----------------------------------------------------------------
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return round(sorted[Math.max(0, idx)]);
}
const round = (x) => (x == null ? null : Math.round(x * 10) / 10);

class Recorder {
  constructor() { this.series = new Map(); }
  add(name, res) {
    let s = this.series.get(name);
    if (!s) { s = { lat: [], statuses: {}, errors: [], first: Date.now(), last: Date.now() }; this.series.set(name, s); }
    s.lat.push(res.ms);
    s.statuses[res.status] = (s.statuses[res.status] || 0) + 1;
    if ((res.status < 200 || res.status >= 300) && s.errors.length < 3) {
      s.errors.push({ status: res.status, error: res.error, body: res.json ?? undefined });
    }
    s.last = Date.now();
  }
  summary(name, elapsedMs) {
    const s = this.series.get(name);
    if (!s) return null;
    const sorted = [...s.lat].sort((a, b) => a - b);
    const ok = Object.entries(s.statuses).filter(([k]) => k >= 200 && k < 300).reduce((a, [, v]) => a + v, 0);
    const wall = elapsedMs ?? Math.max(1, s.last - s.first);
    return {
      requests: sorted.length,
      ok,
      errorRate: round(((sorted.length - ok) / sorted.length) * 100),
      throughputRps: round((sorted.length / wall) * 1000),
      p50: percentile(sorted, 50), p90: percentile(sorted, 90), p95: percentile(sorted, 95),
      p99: percentile(sorted, 99), max: round(sorted[sorted.length - 1]), min: round(sorted[0]),
      mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
      statuses: s.statuses,
      sampleErrors: s.errors.length ? s.errors : undefined,
    };
  }
}

/**
 * Closed-model load: `vus` virtual users each loop `fn(vu, iter)` until
 * `durationMs` elapses or `iterations` total have been started.
 */
async function run({ vus, durationMs, iterations, fn, thinkMs = 0 }) {
  const start = Date.now();
  let started = 0;
  const worker = async (vu) => {
    for (let iter = 0; ; iter++) {
      if (durationMs && Date.now() - start >= durationMs) return;
      if (iterations && started >= iterations) return;
      started++;
      await fn(vu, iter);
      if (thinkMs) await sleep(typeof thinkMs === 'function' ? thinkMs() : thinkMs);
    }
  };
  await Promise.all(Array.from({ length: vus }, (_, i) => worker(i)));
  return Date.now() - start;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email, password = 'Password123!') {
  const res = await request('POST', '/auth/login', { body: { email, password }, ip: nextLoginIp() });
  const token = res.json?.accessToken ?? res.json?.access_token ?? res.json?.token;
  return { res, token, json: res.json };
}

module.exports = { BASE, request, Recorder, run, sleep, login, nextLoginIp, nextTrafficIp, round };
