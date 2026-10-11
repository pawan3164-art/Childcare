#!/usr/bin/env node
// Stage PR / U3 delta suite: refresh tokens, read-audit interceptor (cold vs warm) and family-request writes.
// Same harness, DB and conventions as run-api-load.js (ADR 0003). Needs childcare_perf seeded with the demo
// seed + seed-perf-data.sql and the API running (PERF_BASE_URL, default http://127.0.0.1:3100).
//
//   PERF_TAG=pr-default node tests/performance/run-pr-load.js [refresh reads writes]
//
// reads  = cold phase (first read per person+record, so the audit row is written) then warm phase (de-duplicated).
//          Start the API with AUDIT_READ_DEDUP_SECONDS=0 to make every read write an audit row (upper bound).
// Writes data (absences, pickup nominations, sessions, audit rows). Never point at a shared database.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { BASE, request, Recorder, run, sleep, login, round } = require('./lib/harness');

const rec = new Recorder();
const results = {};
const WARM_MS = Number(process.env.PERF_WARM_MS || 10000);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function record(scenario, name, elapsed, extra = {}) {
  const s = rec.summary(name, elapsed);
  results[scenario] = results[scenario] || {};
  results[scenario][name] = { ...s, ...extra };
  const { requests, errorRate, throughputRps, p50, p95, p99, max, statuses } = s;
  console.log(`  ${name.padEnd(54)} n=${requests} err=${errorRate}% rps=${throughputRps} p50=${p50} p95=${p95} p99=${p99} max=${max} ${JSON.stringify(statuses)}`);
}
const timed = async (name, method, p, opts) => { const r = await request(method, p, opts); rec.add(name, r); return r; };

function psql(sql) {
  return execSync(`docker exec childcare-dev-postgres-1 psql -U childcare -d childcare_perf -At -F "|" -c "${sql}"`).toString().trim().split('\n').filter(Boolean);
}

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

async function context() {
  const rows = psql("select u.email, r.child_id from guardian_child_relationships r join users u on u.id = r.guardian_user_id where u.email like 'perf.parent.%' order by u.email");
  const pairs = rows.map((r) => r.split('|'));
  const parents = [];
  await run({ vus: 10, iterations: pairs.length, fn: async (_, i) => { void i; } }); // no-op warm of the loop
  let idx = 0;
  await run({ vus: 10, iterations: pairs.length, fn: async () => {
    const [email, childId] = pairs[idx++];
    const { token, json } = await login(email);
    if (token) parents.push({ email, childId, token, refreshToken: json.refreshToken });
  } });
  const admin = (await login('admin@sunshine.test')).token;
  const educator = (await login('educator.joeys@sunshine.test')).token;
  const rooms = (await request('GET', '/rooms', { token: admin })).json;
  const joeys = rooms.find((r) => r.name.startsWith('Joeys'));
  const joeysChildren = psql(`select id from children where room_id = '${joeys.id}'`);
  console.log(`  context: ${parents.length} parent sessions, ${joeysChildren.length} Joeys children`);
  return { parents, admin, educator, joeysChildren };
}

const scenarios = {
  async refresh(ctx) {
    // Each VU owns one session and chains its single-use refresh token.
    for (const vus of [1, 10]) {
      const name = `POST /auth/refresh (c=${vus})`;
      const chains = ctx.parents.slice(0, vus).map((p) => ({ rt: null, email: p.email }));
      for (const c of chains) c.rt = (await login(c.email)).json.refreshToken;
      const elapsed = await run({ vus, durationMs: 8000, fn: async (vu) => {
        const c = chains[vu];
        const r = await timed(name, 'POST', '/auth/refresh', { body: { refreshToken: c.rt } });
        if (r.json?.refreshToken) c.rt = r.json.refreshToken;
      } });
      record('refresh', name, elapsed, { vus });
    }
  },

  async reads(ctx) {
    const P = ctx.parents;
    const eps = [
      ['child list (parent)', (p) => ['/children', p.token]],
      ['daily timeline (parent)', (p) => [`/children/${p.childId}/timeline`, p.token]],
      ['at-a-glance (parent)', (p) => [`/children/${p.childId}/at-a-glance`, p.token]],
      ['ledger (parent)', (p) => [`/children/${p.childId}/ledger`, p.token]],
      ['care-records (parent)', (p) => [`/children/${p.childId}/care-records`, p.token]],
    ];
    // Warm the JIT / pool on endpoints that write no audit row, so "cold" means audit-cold, not process-cold.
    await run({ vus: 10, iterations: 300, fn: () => request('GET', '/auth/me', { token: P[0].token }) });
    await run({ vus: 10, iterations: 100, fn: () => request('GET', '/rooms', { token: ctx.admin }) });

    for (const [label, build] of eps) {
      let i = 0;
      const cold = `COLD ${label}`;
      const e1 = await run({ vus: 10, iterations: P.length, fn: async () => { const p = P[i++]; const [u, t] = build(p); await timed(cold, 'GET', u, { token: t }); } });
      record('reads', cold, e1);
      await sleep(300);
      const warm = `WARM ${label}`;
      const e2 = await run({ vus: 20, durationMs: WARM_MS, fn: async () => { const p = pick(P); const [u, t] = build(p); await timed(warm, 'GET', u, { token: t }); } });
      record('reads', warm, e2, { vus: 20 });
    }

    // Staff care-record read: educator over 25 Joeys children (cold = first read per child by this educator).
    let j = 0;
    const cold = 'COLD care-records (educator)';
    const e1 = await run({ vus: 5, iterations: ctx.joeysChildren.length, fn: () => timed(cold, 'GET', `/children/${ctx.joeysChildren[j++]}/care-records`, { token: ctx.educator }) });
    record('reads', cold, e1);
    const warm = 'WARM care-records (educator)';
    const e2 = await run({ vus: 20, durationMs: WARM_MS, fn: () => timed(warm, 'GET', `/children/${pick(ctx.joeysChildren)}/care-records`, { token: ctx.educator }) });
    record('reads', warm, e2, { vus: 20 });
    // Admin list (100 children, known N+1) cold then warm.
    const ac = 'COLD child list (admin, 100)';
    record('reads', ac, await run({ vus: 1, iterations: 1, fn: () => timed(ac, 'GET', '/children', { token: ctx.admin }) }));
    const aw = 'WARM child list (admin, 100)';
    record('reads', aw, await run({ vus: 20, durationMs: WARM_MS, fn: () => timed(aw, 'GET', '/children', { token: ctx.admin }) }), { vus: 20 });
  },

  async writes(ctx) {
    const P = ctx.parents;
    const N = Number(process.env.PERF_WRITES || 1500);
    // Distinct (child, date) keys, so no conflicts: measures lock + insert + audit cost.
    for (const vus of [1, 10]) {
      const name = `POST pickup-nominations distinct keys (c=${vus})`;
      let k = vus === 1 ? 0 : 100000;
      const n = vus === 1 ? 100 : N;
      const base = vus === 1 ? 1 : 10; // different day ranges per run so rows never collide
      const elapsed = await run({ vus, iterations: n, fn: async () => {
        const i = k++ % 100000; const p = P[i % P.length]; const d = base + Math.floor(i / P.length);
        await timed(name, 'POST', `/children/${p.childId}/pickup-nominations`, { token: p.token, body: { date: day(d % 29 + 1), personName: `Perf Person ${base}-${d}`, personPhone: '0400 000 000' } });
      } });
      record('writes', name, elapsed, { vus });
    }
    {
      const name = 'POST absences distinct keys (c=10)';
      let k = 0;
      const elapsed = await run({ vus: 10, iterations: N, fn: async () => {
        const i = k++; const p = P[i % P.length]; const d = 2 + Math.floor(i / P.length);
        await timed(name, 'POST', `/children/${p.childId}/absences`, { token: p.token, body: { date: day(d), reason: 'perf' } });
      } });
      record('writes', name, elapsed, { vus: 10 });
    }
    {
      // Advisory-lock contention: every request targets the SAME child+day. 201 x3 (cap) then 409s are expected outcomes.
      const name = 'POST pickup-nominations HOT key (c=10, same child+day)';
      const p = P[0]; let k = 0;
      const elapsed = await run({ vus: 10, iterations: 200, fn: async () => {
        await timed(name, 'POST', `/children/${p.childId}/pickup-nominations`, { token: p.token, body: { date: day(40 > 30 ? 30 : 30), personName: `Hot ${k++}` } });
      } });
      record('writes', name, elapsed, { vus: 10, note: '201 up to cap of 3 then 409 is the expected outcome' });
    }
  },
};

(async () => {
  const order = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios);
  console.log(`Target ${BASE.href}  scenarios: ${order.join(', ')}  tag=${process.env.PERF_TAG || ''}`);
  const ctx = await context();
  for (const n of order) { console.log(`\n== ${n}`); await scenarios[n](ctx); await sleep(1000); }
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD').toString().trim(); } catch {}
  const out = { runAt: new Date().toISOString(), target: BASE.href, commit,
    environment: { node: process.version, cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, platform: `${os.platform()} ${os.release()}`,
      auditReadDedupSeconds: process.env.PERF_DEDUP_NOTE || 'default(300)', note: process.env.PERF_NOTE || 'local dev machine; prod-mode built API + Postgres (Docker) + load generator on one host' },
    scenarios: results };
  const dir = path.join(__dirname, 'results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${out.runAt.replace(/[:.]/g, '-')}${process.env.PERF_TAG ? '-' + process.env.PERF_TAG : ''}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nResults written to ${file}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
