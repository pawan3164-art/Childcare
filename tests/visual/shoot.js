// Visual review: screenshot every portal and educator-app screen for each role at
// phone, tablet and desktop sizes, and record page errors. Needs the API (:3000),
// portal (:3001) and educator app (:8081) running with seeded demo data.
// Usage: node shoot.js [filter]   (filter = substring of shot name, e.g. "edu")
// Output: out/*.jpg and out/errors.txt (gitignored).
const puppeteer = require('puppeteer-core');
const fs = require('fs');

// Any installed Chromium-based browser; defaults to Edge on Windows.
const BROWSER = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const API = 'http://localhost:3000';
const PORTAL = 'http://localhost:3001';
const EDU = 'http://localhost:8081';
const PW = 'Password123!'; // demo seed password (services/api/prisma/seed.ts)
const SIZES = { desk: [1280, 800], tab: [820, 1180], phone: [390, 844] };
const filter = process.argv[2] || '';
fs.mkdirSync('out', { recursive: true });

async function apiLogin(email) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) });
  return (await r.json()).accessToken;
}

async function shot(page, name) {
  if (filter && !name.includes(filter)) return;
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: `out/${name}.jpg`, type: 'jpeg', quality: 55, fullPage: true });
  console.log('shot', name);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, args: ['--no-first-run'] });
  const errors = [];
  try {
    const roles = {
      admin: { email: 'admin@sunshine.test', pages: ['dashboard', 'children', 'CHILD', 'attendance', 'care-records', 'billing', 'BILL', 'medication', 'incidents'], sizes: ['desk', 'tab', 'phone'] },
      educator: { email: 'educator.joeys@sunshine.test', pages: ['dashboard', 'attendance', 'care-records', 'medication', 'incidents'], sizes: ['tab'] },
      parent: { email: 'parent.nguyen@example.test', pages: ['dashboard', 'CHILD', 'billing', 'BILL', 'incidents'], sizes: ['phone', 'desk'] },
    };
    for (const [role, cfg] of Object.entries(filter.startsWith('edu') ? {} : roles)) {
      const token = await apiLogin(cfg.email);
      const children = await (await fetch(`${API}/children`, { headers: { authorization: `Bearer ${token}` } })).json();
      const childId = Array.isArray(children) ? children[0]?.id : (children.items || children.data || [])[0]?.id;
      for (const size of cfg.sizes) {
        const page = await browser.newPage();
        page.on('pageerror', (e) => errors.push(`${role}/${size}: ${e.message}`));
        page.on('console', (m) => m.type() === 'error' && errors.push(`${role}/${size} console: ${m.text()}`));
        await page.setViewport({ width: SIZES[size][0], height: SIZES[size][1] });
        await page.goto(`${PORTAL}/login`, { waitUntil: 'networkidle2' });
        if (role === 'admin') await shot(page, `portal-login-${size}`);
        await page.evaluate((t) => localStorage.setItem('childcare_token', t), token);
        for (const p of cfg.pages) {
          const path = p === 'CHILD' ? `children/${childId}` : p === 'BILL' ? `billing/${childId}` : p;
          await page.goto(`${PORTAL}/${path}`, { waitUntil: 'networkidle2' });
          await shot(page, `portal-${role}-${p.toLowerCase()}-${size}`);
        }
        await page.close();
      }
    }

    // Educator app (Expo web) — token is in memory only, so log in through the form.
    for (const size of ['phone', 'tab']) {
      const page = await browser.newPage();
      page.on('pageerror', (e) => errors.push(`edu/${size}: ${e.message}`));
      page.on('console', (m) => ['error', 'warn'].includes(m.type()) && errors.push(`edu/${size} console: ${m.text().slice(0, 200)}`));
      page.on('requestfailed', (r) => errors.push(`edu/${size} reqfail: ${r.url()} ${r.failure()?.errorText}`));
      await page.setViewport({ width: SIZES[size][0], height: SIZES[size][1] });
      await page.goto(EDU, { waitUntil: 'networkidle2' });
      await shot(page, `edu-login-${size}`);
      const inputs = await page.$$('input');
      for (const [i, v] of [[0, 'educator.joeys@sunshine.test'], [1, PW]]) {
        await inputs[i].click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await inputs[i].type(v);
      }
      await page.keyboard.press('Enter');
      await new Promise((r) => setTimeout(r, 3000));
      await shot(page, `edu-roster-${size}`);
      // Reloading would drop the in-memory session, so switch tabs by clicking the tab bar.
      for (const [tab, label] of [['care-log', 'Care'], ['profile', 'Profile']]) {
        try {
          const links = await page.$$('a[role="tab"], [role="tab"], a');
          let clicked = false;
          for (const l of links) {
            const t = await l.evaluate((n) => n.textContent || '');
            if (t.includes(label)) { await l.click(); clicked = true; break; }
          }
          if (!clicked) errors.push(`edu/${size}: no tab labelled ${label}`);
        } catch (e) { errors.push(`edu/${size} tab ${tab}: ${e.message}`); }
        await shot(page, `edu-${tab}-${size}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    fs.writeFileSync('out/errors.txt', errors.join('\n'));
    console.log('errors:', errors.length);
  }
})();
