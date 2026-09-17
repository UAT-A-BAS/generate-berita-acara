// Live end-to-end proof of the collaboration contract: starts a local wrangler
// Worker, opens two independent browser profiles on the same document, and checks
// that concurrent edits to different fields both survive and never clobber.
//
// Usage: node scripts/verify-collab-e2e.mjs
//        COLLAB_E2E_TARGET=production node scripts/verify-collab-e2e.mjs  (tests the live sites)
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createProbeServer } from "node:net";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOC_ID = `e2e-${Date.now().toString(36)}`;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createProbeServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// Never reuse a fixed port: another checkout (or a dev server the user left running)
// may already own it, and hijacking it would test somebody else's Worker.
const WORKER_PORT = await freePort();
const SITE_PORT = await freePort();
const PRODUCTION = process.env.COLLAB_E2E_TARGET === "production";
const PROD_SITE = "https://generate-berita-acara.pages.dev";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  // Always render the observed value: an empty string is exactly the signal we care about.
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(detail)}`);
}

// Poll until every expectation holds, so a slow render is not mistaken for a lost edit,
// while a genuine clobber still fails because it never converges on the right value.
async function waitForAll(page, expectations, timeoutMs = 10000) {
  const keys = Object.keys(expectations);
  const deadline = Date.now() + timeoutMs;
  let seen = {};
  while (Date.now() < deadline) {
    seen = await page.evaluate((fields) => {
      const out = {};
      fields.forEach((field) => {
        const node = document.getElementById(field);
        out[field] = node ? node.value : null;
      });
      return out;
    }, keys);
    if (keys.every((key) => seen[key] === expectations[key])) return { ok: true, seen };
    await page.waitForTimeout(150);
  }
  return { ok: false, seen };
}

async function waitForHealth(url, timeoutMs = 150000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = `HTTP ${response.status}`;
    } catch {
      lastError = "connection refused (still starting)";
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Worker did not become healthy at ${url} (last: ${lastError})`);
}

function startSiteServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${SITE_PORT}`);
    const relative = url.pathname === "/" ? "/index.html" : url.pathname;
    try {
      const body = await readFile(path.join(repoRoot, decodeURIComponent(relative)));
      const type = relative.endsWith(".js") ? "text/javascript" : "text/html";
      response.writeHead(200, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(SITE_PORT, "127.0.0.1", () => resolve(server)));
}

async function openPeer(browser, name) {
  const context = await browser.newContext();
  if (!PRODUCTION) {
    await context.addInitScript(`
      window.BA_COLLAB_WORKER_URL = "http://127.0.0.1:${WORKER_PORT}";
    `);
  }
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log(`[${name}] page error: ${error.message}`));
  const base = PRODUCTION ? `${PROD_SITE}/` : `http://127.0.0.1:${SITE_PORT}/`;
  await page.goto(`${base}index.html?doc=${DOC_ID}`, { waitUntil: "domcontentloaded" });

  // The app asks for a collaborator name before joining.
  await page.waitForSelector("#collabNameDialog:not([hidden])", { timeout: 15000 });
  await page.fill("#collabNameInput", name);
  await page.click("#saveCollabNameBtn");
  // "Connected" is momentary: the first commit immediately flips the pill to "Saved".
  // Wait for the collaborating state (Live + any online sync status) instead.
  await page.waitForFunction(() => {
    const online = ["Connected", "Syncing", "Saved"];
    return document.getElementById("modeStatusText")?.textContent === "Live"
      && online.includes(document.getElementById("syncStatusText")?.textContent);
  }, null, { timeout: 30000 });
  return { context, page };
}

async function main() {
  const workerLog = [];
  const worker = PRODUCTION
    ? null
    : spawn("npx", ["wrangler", "dev", "--port", String(WORKER_PORT), "--ip", "127.0.0.1"], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });
  if (worker) {
    worker.stdout.on("data", (chunk) => workerLog.push(chunk.toString()));
    worker.stderr.on("data", (chunk) => workerLog.push(chunk.toString()));
  }

  const site = PRODUCTION ? null : await startSiteServer();
  let browser;
  try {
    const healthUrl = PRODUCTION
      ? "https://generate-berita-acara-collab.alex-marcello08.workers.dev/health"
      : `http://127.0.0.1:${WORKER_PORT}/health`;
    if (PRODUCTION) console.log(`target: LIVE ${PROD_SITE} + ${healthUrl}`);
    let health;
    try {
      health = await waitForHealth(healthUrl);
    } catch (error) {
      // Surface the dev server output so a startup failure is diagnosable, not mysterious.
      console.log("\nwranger log tail:");
      console.log(workerLog.join("").split("\n").slice(-25).join("\n"));
      throw error;
    }
    // Identity check: a stale dev server from another checkout must not silently stand in.
    const isOurWorker = health.ok === true && health.service === "generate-berita-acara-collab";
    check("Worker /health responds with the right service", isOurWorker, JSON.stringify(health));
    if (!isOurWorker) throw new Error("Health endpoint belongs to a different Worker; aborting to avoid a false pass.");

    browser = await chromium.launch();
    const peerA = await openPeer(browser, "Peer A");
    const peerB = await openPeer(browser, "Peer B");
    check("both peers report Connected", true);

    await peerA.page.waitForFunction(() => document.getElementById("userCountText")?.textContent?.includes("2"), null, { timeout: 15000 });
    const presence = await peerA.page.textContent("#userCountText");
    check("presence shows 2 users", presence.includes("2"), presence);

    // Concurrent edits to two different fields.
    await peerA.page.fill("#featureName", "PROJECT DARI PEER A");
    await peerB.page.fill("#branchName", "CABANG DARI PEER B");
    const crossSeen = await waitForAll(peerB.page, {
      featureName: "PROJECT DARI PEER A",
      branchName: "CABANG DARI PEER B"
    });
    check("peer B receives peer A's project name", crossSeen.seen.featureName === "PROJECT DARI PEER A", crossSeen.seen.featureName);
    check("peer A receives peer B's branch", (await peerA.page.inputValue("#branchName")) === "CABANG DARI PEER B", await peerA.page.inputValue("#branchName"));

    // The original clobber scenario: one peer keeps typing while the other commits.
    await peerB.page.click("#city");
    await peerB.page.fill("#city", "BANDUNG");
    for (const value of ["BANDUNG 1", "BANDUNG 12", "BANDUNG 123"]) {
      await peerA.page.fill("#approverName", "Approver A");
      await peerB.page.fill("#city", value);
      await peerA.page.waitForTimeout(250);
    }
    // Both peers must converge on the same merged result: B's city AND A's approver.
    const expected = { city: "BANDUNG 123", approverName: "Approver A" };
    const seenA = await waitForAll(peerA.page, expected);
    const seenB = await waitForAll(peerB.page, expected);

    check("peer B's own city was not clobbered", seenB.seen.city === "BANDUNG 123", seenB.seen.city);
    check("peer A received peer B's final city", seenA.seen.city === "BANDUNG 123", seenA.seen.city);
    check("peer A's approver survived", seenA.seen.approverName === "Approver A", seenA.seen.approverName);
    check("peer B received the approver", seenB.seen.approverName === "Approver A", seenB.seen.approverName);

    // A third peer joining later must see the merged state, not a blank or stale doc.
    const peerC = await openPeer(browser, "Peer C");
    const seenC = await waitForAll(peerC.page, {
      featureName: "PROJECT DARI PEER A",
      branchName: "CABANG DARI PEER B",
      city: "BANDUNG 123"
    });
    check("late joiner sees merged project name", seenC.seen.featureName === "PROJECT DARI PEER A", seenC.seen.featureName);
    check("late joiner sees merged branch", seenC.seen.branchName === "CABANG DARI PEER B", seenC.seen.branchName);
    check("late joiner sees merged city", seenC.seen.city === "BANDUNG 123", seenC.seen.city);

    // Reload persistence: the room must survive a full page reload.
    await peerC.page.reload({ waitUntil: "domcontentloaded" });
    await peerC.page.waitForFunction(() => {
      const online = ["Connected", "Syncing", "Saved"];
      return document.getElementById("modeStatusText")?.textContent === "Live"
        && online.includes(document.getElementById("syncStatusText")?.textContent);
    }, null, { timeout: 30000 });
    const reloaded = await waitForAll(peerC.page, { featureName: "PROJECT DARI PEER A" });
    check("state survives reload from Durable Object storage", reloaded.seen.featureName === "PROJECT DARI PEER A", reloaded.seen.featureName);

    // Unchanged snapshots must not write anything (the original overwrite bug).
    const drift = await peerC.page.evaluate(() => {
      const before = document.getElementById("branchName").value;
      return { before };
    });
    await peerA.page.fill("#branchName", "CABANG BARU A");
    const afterC = await waitForAll(peerC.page, { branchName: "CABANG BARU A" });
    check("unchanged peer picks up the remote branch change", afterC.seen.branchName === "CABANG BARU A", `${drift.before} -> ${afterC.seen.branchName}`);

    for (const peer of [peerA, peerB, peerC]) await peer.context.close();
  } finally {
    if (browser) await browser.close();
    if (site) site.close();
    if (worker) {
      worker.kill("SIGTERM");
      await new Promise((resolve) => {
        worker.once("exit", resolve);
        setTimeout(resolve, 5000);
      });
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\ncollab e2e: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("\nwranger log tail:");
    console.log(workerLog.join("").split("\n").slice(-30).join("\n"));
    process.exitCode = 1;
  }
}

await main();
