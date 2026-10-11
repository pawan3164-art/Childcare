#!/usr/bin/env node
// Stage U4 delta suite: calendar, menus, health (allergy register + child health record) and forms/e-signature.
// Same harness, DB and conventions as run-api-load.js / run-pr-load.js (ADR 0003). Needs childcare_perf with the demo seed,
// seed-perf-data.sql and seed-u4-perf-data.sql applied (migrations through u4c_signatures) and the API running
// (PERF_BASE_URL, default http://127.0.0.1:3100).
//
//   PERF_TAG=u4 node tests/performance/run-u4-load.js [reads forms-read forms-write]
//
// Writes data (form requests, signatures, submissions, audit rows). Never point at a shared database.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { BASE, request, Recorder, run, sleep, login, round } = require('./lib/harness');

const rec = new Recorder();
const results = {};
const WARM_MS = Number(process.env.PERF_WARM_MS || 10000);
const POOL_PER_PARENT = Number(process.env.PERF_FORMS_POOL || 20);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function record(scenario, name, elapsed, extra = {}) {
  const s = rec.summary(name, elapsed);
  results[scenario] = results[scenario] || {};
  results[scenario][name] = { ...s, ...extra };
  const { requests, errorRate, throughputRps, p50, p95, p99, max, statuses } = s;
  console.log(`  ${name.padEnd(56)} n=${requests} err=${errorRate}% rps=${throughputRps} p50=${p50} p95=${p95} p99=${p99} max=${max} ${JSON.stringify(statuses)}`);
}
const timed = async (name, method, p, opts) => { const r = await request(method, p, opts); rec.add(name, r); return r; };

function psql(sql) {
  return execSync(`docker exec childcare-dev-postgres-1 psql -U childcare -d childcare_perf -At -F "|" -c "${sql}"`).toString().trim().split('\n').filter(Boolean);
}

async function context() {
  const pairs = psql("select u.email, r.child_id from guardian_child_relationships r join users u on u.id = r.guardian_user_id where u.email like 'perf.parent.%' order by u.email").map((r) => r.split('|'));
  const parents = [];
  let idx = 0;
  await run({ vus: 10, iterations: pairs.length, fn: async () => {
    const [email, childId] = pairs[idx++];
    const { token } = await login(email);
    if (token) parents.push({ email, childId, token });
  } });
  const admin = (await login('admin@sunshine.test')).token;
  const educator = (await login('educator.joeys@sunshine.test')).token;
  const allChildren = psql('select id from children');
  const [tpl1, tpl2] = [psql("select id from form_templates where title = 'Perf Excursion consent'")[0], psql("select id from form_templates where title = 'Perf Annual update'")[0]];
  console.log(`  context: ${parents.length} parent sessions, ${allChildren.length} children, templates ${tpl1 ? 'ok' : 'MISSING'}`);
  return { parents, admin, educator, allChildren, tpl1, tpl2 };
}

/** One cold pass (first read per record, audit row written) then a warm closed-loop run, for a request builder. */
async function readSeries(scenario, label, build, ctx, { vus = 20, items }) {
  const cold1 = `${label} (c=1 unloaded)`;
  const e0 = await run({ vus: 1, iterations: 30, fn: async (_, i) => { const [u, t] = build(items ? items[i % items.length] : null); await timed(cold1, 'GET', u, { token: t }); } });
  record(scenario, cold1, e0, { vus: 1 });
  const name = `${label} (c=${vus})`;
  const e1 = await run({ vus, durationMs: WARM_MS, fn: async () => { const [u, t] = build(items ? pick(items) : null); await timed(name, 'GET', u, { token: t }); } });
  record(scenario, name, e1, { vus });
}

const scenarios = {
  async reads(ctx) {
    const P = ctx.parents;
    await run({ vus: 10, iterations: 300, fn: () => request('GET', '/auth/me', { token: P[0].token }) });
    await run({ vus: 10, iterations: 100, fn: () => request('GET', '/rooms', { token: ctx.admin }) });
    // Sizes of the payloads, for the report.
    const size = async (p, t) => (await request('GET', p, { token: t })).bytes;
    const to60 = new Date(Date.now() + 59 * 86400000).toISOString().slice(0, 10);
    results.payloadBytes = {
      calendarDefault30d_admin: await size('/calendar/events', ctx.admin),
      menusWeek_admin: await size('/menus', ctx.admin),
      allergyRegister_admin: await size('/health/allergy-register', ctx.admin),
      childHealth_admin: await size(`/children/${ctx.allChildren[0]}/health`, ctx.admin),
    };
    console.log('  payload bytes', JSON.stringify(results.payloadBytes));

    // Calendar
    await readSeries('reads', 'GET /calendar/events default 30d (parent)', (p) => ['/calendar/events', p.token], ctx, { items: P });
    await readSeries('reads', 'GET /calendar/events default 30d (admin)', () => ['/calendar/events', ctx.admin], ctx, {});
    await readSeries('reads', 'GET /calendar/events default 30d (educator)', () => ['/calendar/events', ctx.educator], ctx, {});
    await readSeries('reads', `GET /calendar/events 60d range (admin)`, () => [`/calendar/events?to=${to60}`, ctx.admin], ctx, {});
    // Menus
    await readSeries('reads', 'GET /menus current week (parent)', (p) => ['/menus', p.token], ctx, { items: P });
    await readSeries('reads', 'GET /menus current week (admin)', () => ['/menus', ctx.admin], ctx, {});
    // Health
    await readSeries('reads', 'GET /health/allergy-register (admin, ~50 children)', () => ['/health/allergy-register', ctx.admin], ctx, {});
    await readSeries('reads', 'GET /health/allergy-register (educator, own room)', () => ['/health/allergy-register', ctx.educator], ctx, {});
    await readSeries('reads', 'GET /children/:id/health (parent)', (p) => [`/children/${p.childId}/health`, p.token], ctx, { items: P });
    await readSeries('reads', 'GET /children/:id/health (admin)', (c) => [`/children/${c}/health`, ctx.admin], ctx, { items: ctx.allChildren });
  },

  async 'forms-read'(ctx) {
    const P = ctx.parents;
    const n = psql("select count(*) from form_requests")[0];
    console.log(`  form_requests in centre: ${n}`);
    results.formRequestsInCentre = Number(n);
    results.payloadBytes = results.payloadBytes || {};
    results.payloadBytes.formsRequestsAdmin = (await request('GET', '/forms/requests', { token: ctx.admin })).bytes;
    results.payloadBytes.formsMyRequests = (await request('GET', '/forms/my-requests', { token: P[0].token })).bytes;
    // Resolve one request id per parent for the detail endpoint.
    const detail = [];
    for (const p of P) {
      const r = await request('GET', '/forms/my-requests?status=PENDING', { token: p.token });
      if (Array.isArray(r.json) && r.json[0]) detail.push({ ...p, reqId: r.json[0].id });
    }
    await readSeries('forms-read', `GET /forms/my-requests (parent, ${Math.round(Number(n) / P.length)}/parent)`, (p) => ['/forms/my-requests', p.token], ctx, { items: P });
    await readSeries('forms-read', 'GET /forms/my-requests?status=PENDING (parent)', (p) => ['/forms/my-requests?status=PENDING', p.token], ctx, { items: P });
    await readSeries('forms-read', 'GET /forms/my-requests/:id (parent)', (p) => [`/forms/my-requests/${p.reqId}`, p.token], ctx, { items: detail });
    await readSeries('forms-read', `GET /forms/requests (admin, ${n} requests)`, () => ['/forms/requests', ctx.admin], ctx, {});
    await readSeries('forms-read', `GET /forms/requests?status=PENDING (admin)`, () => ['/forms/requests?status=PENDING', ctx.admin], ctx, {});
  },

  async 'forms-write'(ctx) {
    const P = ctx.parents;
    // 1) Admin bulk send: POST /forms/requests with 100 childIds (one request per guardian-child link, ~100 inserts + audit + notifications).
    const sendBody = () => ({ templateId: ctx.tpl2, version: 1, childIds: ctx.allChildren });
    for (const [vus, iters] of [[1, 10], [5, 15]]) {
      const name = `POST /forms/requests 100 childIds (c=${vus})`;
      const e = await run({ vus, iterations: iters, fn: () => timed(name, 'POST', '/forms/requests', { token: ctx.admin, body: sendBody() }) });
      record('forms-write', name, e, { vus, childIds: ctx.allChildren.length });
    }

    // 2) Signature + submit. Pool: POOL_PER_PARENT fresh PENDING excursion-consent requests per perf parent (seeded as DB owner).
    psql(`insert into form_requests (id, org_id, centre_id, template_id, template_version, child_id, guardian_user_id, status, created_by_user_id) select gen_random_uuid()::text, r.org_id, r.centre_id, '${ctx.tpl1}', 1, r.child_id, r.guardian_user_id, 'PENDING', (select id from users where email='admin@sunshine.test') from guardian_child_relationships r join users u on u.id=r.guardian_user_id cross join generate_series(1, ${POOL_PER_PARENT}) where u.email like 'perf.parent.%'`);
    const pool = new Map();
    for (const p of P) {
      const r = await request('GET', '/forms/my-requests?status=PENDING', { token: p.token });
      pool.set(p.email, (r.json || []).filter((x) => x.templateId === ctx.tpl1).map((x) => x.id));
    }
    const work = [];
    for (const p of P) for (const id of pool.get(p.email) || []) work.push({ p, id });
    console.log(`  submit pool: ${work.length} pending requests`);
    const strokes = () => Array.from({ length: 3 }, () => Array.from({ length: 80 }, (_, i) => [Math.random(), (i % 10) / 10]));
    for (const vus of [1, 10]) {
      const n = vus === 1 ? 30 : Math.min(work.length - 30, 600);
      const sigName = `POST /forms/my-requests/:id/signature (c=${vus})`;
      const subName = `POST /forms/my-requests/:id/submit (c=${vus})`;
      const flowName = `FLOW signature+submit end-to-end (c=${vus})`;
      const e = await run({ vus, iterations: n, fn: async () => {
        const w = work.pop(); if (!w) return;
        const t0 = process.hrtime.bigint();
        const s = await timed(sigName, 'POST', `/forms/my-requests/${w.id}/signature`, { token: w.p.token, body: { strokes: strokes() } });
        const r = await timed(subName, 'POST', `/forms/my-requests/${w.id}/submit`, {
          token: w.p.token,
          body: { answers: { destination: 'Perf Zoo', allergies_ok: true }, signature: { typedName: 'Perf Parent', imageRef: s.json?.imageRef, consent: true } },
        });
        rec.add(flowName, { status: r.status, ms: Number(process.hrtime.bigint() - t0) / 1e6 });
      } });
      record('forms-write', sigName, e, { vus });
      record('forms-write', subName, e, { vus });
      record('forms-write', flowName, e, { vus });
      await sleep(500);
    }

    // 3) Re-run the list reads at the grown size (scale probe: the endpoint is unpaginated).
    const n = psql('select count(*) from form_requests')[0];
    results.formRequestsAfterWrites = Number(n);
    await readSeries('forms-write', `SCALE GET /forms/requests (admin, ${n} requests)`, () => ['/forms/requests', ctx.admin], ctx, { vus: 10 });
    await readSeries('forms-write', `SCALE GET /forms/my-requests (parent, ~${Math.round(Number(n) / P.length)}/parent)`, (p) => ['/forms/my-requests', p.token], ctx, { items: P });
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
      note: process.env.PERF_NOTE || 'local dev machine; prod-mode built API + Postgres (Docker) + load generator on one host; childcare_perf' },
    scenarios: results };
  const dir = path.join(__dirname, 'results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${out.runAt.replace(/[:.]/g, '-')}${process.env.PERF_TAG ? '-' + process.env.PERF_TAG : ''}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nResults written to ${file}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
