#!/usr/bin/env node
// API load/latency suite measured against docs/performance-slas.md.
//
// Usage (from repo root, API already running and seeded with BOTH the demo
// seed and tests/performance/seed-perf-data.sql — use an isolated DB):
//   PERF_BASE_URL=http://127.0.0.1:3100 node tests/performance/run-api-load.js [scenario ...]
// Scenarios: health login reads attendance group-care sync invoice-batch sessions throttle
// (default: all, in that order). Results -> tests/performance/results/<timestamp>.json
//
// Writes data (attendance events, care records, sync ops, invoices). Never
// point this at a database someone else is using.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { BASE, request, Recorder, run, sleep, login, round } = require('./lib/harness');

const DUR = Number(process.env.PERF_DURATION_MS || 15000);
const rec = new Recorder();
const results = {};
const uuid = () => require('crypto').randomUUID();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function record(scenario, name, elapsed, extra = {}) {
  const s = rec.summary(name, elapsed);
  results[scenario] = results[scenario] || {};
  results[scenario][name] = { ...s, ...extra };
  const { requests, errorRate, throughputRps, p50, p95, p99, max } = s;
  console.log(`  ${name.padEnd(44)} n=${requests} err=${errorRate}% rps=${throughputRps} p50=${p50} p95=${p95} p99=${p99} max=${max}`);
}

async function timed(name, method, p, opts) {
  const res = await request(method, p, opts);
  rec.add(name, res);
  return res;
}

// ---------------------------------------------------------------------------
async function context() {
  const admin = (await login('admin@sunshine.test')).token;
  const educator = (await login('educator.joeys@sunshine.test')).token;
  const parent = (await login('parent.nguyen@example.test')).token;
  if (!admin || !educator || !parent) throw new Error('login failed — is the API up and seeded?');
  const rooms = (await request('GET', '/rooms', { token: admin })).json;
  const joeys = rooms.find((r) => r.name.startsWith('Joeys'));
  const allChildren = (await request('GET', '/children', { token: admin })).json;
  const joeysChildren = allChildren.filter((c) => c.roomId === joeys.id).map((c) => c.id);
  const parentChildren = (await request('GET', '/children', { token: parent })).json.map((c) => c.id);
  return { admin, educator, parent, rooms, joeys, allChildren, joeysChildren, parentChildren };
}

const scenarios = {
  // Mirrors the Stage 5 baseline (20 connections, 10 s, GET /health) for a like-for-like comparison.
  async health() {
    const elapsed = await run({ vus: 20, durationMs: 10000, fn: () => timed('GET /health', 'GET', '/health') });
    record('health', 'GET /health', elapsed);
  },

  async login() {
    const emails = ['admin@sunshine.test', 'educator.joeys@sunshine.test', 'educator.kangaroos@sunshine.test',
      'parent.nguyen@example.test', 'parent.chen@example.test', 'parent.smith@example.test'];
    for (const vus of [1, 10]) {
      const name = `POST /auth/login (c=${vus})`;
      const elapsed = await run({ vus, iterations: vus === 1 ? 20 : 200, fn: async () => {
        const { res } = await login(pick(emails));
        rec.add(name, res);
      } });
      record('login', name, elapsed);
    }
  },

  async reads(ctx) {
    const c = ctx;
    const mia = c.parentChildren[0];
    const someChild = c.joeysChildren[3];
    const endpoints = [
      ['GET /children (admin, 100 children)', '/children', c.admin],
      ['GET /children?roomId (educator, 25)', `/children?roomId=${c.joeys.id}`, c.educator],
      ['GET /children (parent, 2)', '/children', c.parent],
      ['GET /rooms', '/rooms', c.admin],
      ['GET /users', '/users', c.admin],
      ['GET /incidents', '/incidents', c.admin],
      ['GET /medication/administrations', '/medication/administrations', c.admin],
      ['GET /guardian-relationships?childId', `/guardian-relationships?childId=${someChild}`, c.admin],
      ['GET /children/:id/at-a-glance (parent)', `/children/${mia}/at-a-glance`, c.parent],
      ['GET /children/:id/attendance (parent)', `/children/${mia}/attendance`, c.parent],
      ['GET /children/:id/care-records (parent)', `/children/${mia}/care-records`, c.parent],
      ['GET /children/:id/ledger (parent)', `/children/${mia}/ledger`, c.parent],
      ['GET /auth/me', '/auth/me', c.parent],
    ];
    const vus = Number(process.env.PERF_READ_VUS || 20);
    for (const [name, p, token] of endpoints) {
      const elapsed = await run({ vus, durationMs: DUR / 1.5, fn: () => timed(name, 'GET', p, { token }) });
      const sample = rec.series.get(name);
      record('reads', name, elapsed, { vus });
      void sample;
    }
  },

  async attendance(ctx) {
    const state = new Map();
    for (const vus of [1, 10]) {
      const name = `POST /attendance/events (c=${vus})`;
      const elapsed = await run({ vus, durationMs: vus === 1 ? 5000 : DUR, fn: async () => {
        const childId = pick(ctx.joeysChildren);
        const next = state.get(childId) === 'SIGN_IN' ? 'SIGN_OUT' : 'SIGN_IN';
        state.set(childId, next);
        await timed(name, 'POST', '/attendance/events', { token: ctx.educator,
          body: { childId, eventType: next, method: 'EDUCATOR', timestamp: new Date().toISOString() } });
      } });
      record('attendance', name, elapsed, { vus });
    }
  },

  // Group-first logging: one MEAL for the whole 25-child room. c=20 deliberately
  // exceeds the Prisma pool size (num_cpus*2+1) to probe nested-transaction pool starvation.
  async 'group-care'(ctx) {
    for (const vus of [1, 5, 20]) {
      const name = `POST /care-records/group 25 kids (c=${vus})`;
      const elapsed = await run({ vus, durationMs: vus === 1 ? 8000 : DUR, fn: () =>
        timed(name, 'POST', '/care-records/group', { token: ctx.educator,
          body: { type: pick(['MEAL', 'SLEEP', 'TOILETING', 'ACTIVITY']), timestamp: new Date().toISOString(),
            defaultNote: 'perf', childIds: ctx.joeysChildren } }) });
      record('group-care', name, elapsed, { vus });
    }
  },

  // SLA: offline sync flush, 100 queued operations on reconnect < 10 s.
  async sync(ctx) {
    const batch = () => Array.from({ length: 100 }, (_, i) => {
      const childId = pick(ctx.joeysChildren);
      const ts = new Date(Date.now() - (100 - i) * 1000).toISOString();
      const isAtt = i % 2 === 0;
      const id = uuid();
      return { idempotencyKey: uuid(), clientOperationId: uuid(), entityType: isAtt ? 'AttendanceEvent' : 'CareRecord',
        entityId: id, operationType: 'CREATE', clientTimestamp: ts,
        payload: isAtt ? { childId, eventType: i % 4 === 0 ? 'SIGN_IN' : 'SIGN_OUT', method: 'EDUCATOR', timestamp: ts }
          : { childId, type: 'MEAL', timestamp: ts, note: 'offline' } };
    });
    for (const vus of [1, 5, 20]) {
      const name = `POST /sync/operations x100 ops (devices=${vus})`;
      const elapsed = await run({ vus, iterations: vus === 1 ? 5 : vus * 2, fn: async () => {
        const res = await timed(name, 'POST', '/sync/operations', { token: ctx.educator, body: batch() });
        if (res.status === 201 || res.status === 200) {
          const bad = (res.json?.results || []).filter((r) => r.status !== 'APPLIED').length;
          if (bad) console.log(`    ! ${bad} ops not APPLIED`);
        }
      } });
      record('sync', name, elapsed, { vus });
    }
    // Replay of an already-flushed batch (idempotent no-op path, e.g. retry after timeout).
    const b = batch();
    await request('POST', '/sync/operations', { token: ctx.educator, body: b });
    const name = 'POST /sync/operations x100 replay (idempotent)';
    const elapsed = await run({ vus: 1, iterations: 3, fn: () => timed(name, 'POST', '/sync/operations', { token: ctx.educator, body: b }) });
    record('sync', name, elapsed);
  },

  // SLA: invoice batch run (1000 invoices) < 15 min. There is no batch endpoint;
  // a batch run is 1000 POST /invoices calls (100 children x 10 fortnightly cycles).
  async 'invoice-batch'(ctx) {
    const N = Number(process.env.PERF_INVOICES || 1000);
    const children = ctx.allChildren.map((c) => c.id);
    for (const [vus, yearOffset] of [[1, 0], [8, 1]]) {
      const name = `POST /invoices x${N} (c=${vus})`;
      let i = 0;
      const t0 = Date.now();
      const elapsed = await run({ vus, iterations: N, fn: async () => {
        const k = i++;
        const child = children[k % children.length];
        const cycle = Math.floor(k / children.length);
        const start = new Date(Date.UTC(2026 - yearOffset, 0, 5 + cycle * 14));
        const end = new Date(start.getTime() + 13 * 86400000);
        await timed(name, 'POST', '/invoices', { token: ctx.admin,
          body: { childId: child, cycleStart: start.toISOString().slice(0, 10), cycleEnd: end.toISOString().slice(0, 10) } });
      } });
      record('invoice-batch', name, elapsed, { vus, wallClockSec: round((Date.now() - t0) / 1000), invoices: N });
    }
  },

  // SLA: 500 concurrent active sessions without degradation. Each session is a
  // real login (distinct source IPs), then a mixed read/write loop with think time.
  async sessions(ctx) {
    const parentEmails = (await request('GET', '/users', { token: ctx.admin })).json
      .map((u) => u.email).filter((e) => e.startsWith('perf.parent.') || e.startsWith('parent.'));
    const staffEmails = ['educator.joeys@sunshine.test'];
    const MIX_DUR = Number(process.env.PERF_SESSION_DURATION_MS || 60000);
    for (const total of [50, 500]) {
      console.log(`  logging in ${total} sessions...`);
      const sessions = [];
      await run({ vus: 10, iterations: total, fn: async (_, it) => {
        const isStaff = sessions.length % 10 === 0; // ~10% staff devices, 90% parents
        const email = isStaff ? pick(staffEmails) : pick(parentEmails);
        const { token } = await login(email);
        if (!token) return;
        const kids = (await request('GET', '/children', { token })).json || [];
        sessions.push({ token, isStaff, kids: kids.map((k) => k.id) });
      } });
      console.log(`  ${sessions.length} sessions active; running mixed load ${MIX_DUR / 1000}s`);
      const tag = `(sessions=${sessions.length})`;
      const elapsed = await run({ vus: sessions.length, durationMs: MIX_DUR, thinkMs: () => 1000 + Math.random() * 2000, fn: async (vu) => {
        const s = sessions[vu];
        if (s.isStaff) {
          const r = Math.random();
          if (r < 0.5) await timed(`mixed ${tag}`, 'GET', `/children?roomId=${ctx.joeys.id}`, { token: s.token });
          else if (r < 0.8) await timed(`mixed ${tag}`, 'POST', '/attendance/events', { token: s.token,
            body: { childId: pick(ctx.joeysChildren), eventType: pick(['SIGN_IN', 'SIGN_OUT']), method: 'EDUCATOR', timestamp: new Date().toISOString() } });
          else await timed(`mixed ${tag}`, 'POST', '/care-records/group', { token: s.token,
            body: { type: 'ACTIVITY', timestamp: new Date().toISOString(), childIds: ctx.joeysChildren } });
        } else {
          const kid = pick(s.kids);
          const r = Math.random();
          if (r < 0.6) await timed(`mixed ${tag}`, 'GET', `/children/${kid}/at-a-glance`, { token: s.token });
          else if (r < 0.8) await timed(`mixed ${tag}`, 'GET', `/children/${kid}/care-records`, { token: s.token });
          else await timed(`mixed ${tag}`, 'GET', '/children', { token: s.token });
        }
      } });
      record('sessions', `mixed ${tag}`, elapsed, { sessions: sessions.length });
    }
  },

  // Explicit single-IP behaviour: what one office NAT sees from the global
  // 600/min/IP/route throttle.
  async throttle(ctx) {
    const ip = '127.3.0.1';
    const name = 'GET /auth/me from ONE source IP (700 req)';
    const elapsed = await run({ vus: 10, iterations: 700, fn: () => timed(name, 'GET', '/auth/me', { token: ctx.parent, ip }) });
    record('throttle', name, elapsed);
  },
};

(async () => {
  const wanted = process.argv.slice(2);
  const order = wanted.length ? wanted : Object.keys(scenarios);
  console.log(`Target ${BASE.href}  scenarios: ${order.join(', ')}`);
  const ctx = await context();
  for (const name of order) {
    console.log(`\n== ${name}`);
    await scenarios[name](ctx);
    await sleep(1000);
  }
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD').toString().trim(); } catch {}
  const out = {
    runAt: new Date().toISOString(),
    target: BASE.href,
    commit,
    environment: { node: process.version, cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, platform: `${os.platform()} ${os.release()}`,
      note: process.env.PERF_NOTE || 'local dev machine; API + Postgres + load generator on one host' },
    scenarios: results,
  };
  const dir = path.join(__dirname, 'results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${out.runAt.replace(/[:.]/g, '-')}${process.env.PERF_TAG ? '-' + process.env.PERF_TAG : ''}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nResults written to ${file}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
