import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const artifact = new URL("../berita-acara-generator-offline.html", import.meta.url);
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ offline: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const networkRequests = [];
  const webSockets = [];
  const errors = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("file:") && !request.url().startsWith("data:") && !request.url().startsWith("blob:")) networkRequests.push(request.url());
  });
  page.on("websocket", (socket) => webSockets.push(socket.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(artifact.href);
  await page.locator("#featureName").fill("Verifikasi Offline");
  await page.locator("#featureName").blur();
  await page.waitForTimeout(500);
  assert.equal(await page.locator("h1").innerText(), "Generator Berita Acara");
  assert.equal(await page.locator("#collabToggleBtn").isVisible(), false, "Start Collab must be hidden offline");
  assert.equal(await page.locator("#copyShareLinkBtn").isVisible(), false, "Share link must be hidden offline");
  assert.equal(await page.locator("#featureName").inputValue(), "Verifikasi Offline");
  await page.locator("#importDraftInput").setInputFiles({
    name: "offline-verification.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      schema: 2,
      featureName: "Draft Offline",
      branchName: "Cabang Jakarta",
      divisionLine: "Divisi GPOL",
      applicationLine: "Aplikasi Verifikasi",
      implementationDates: ["17/09/2026"],
      city: "Jakarta",
      signDate: "17/09/2026",
      approverName: "Penyetuju",
      approverRole: "Manager",
      groups: [{ uid: "offline-group", dates: ["17/09/2026"], rows: [{ uid: "offline-row", activity: "Verifikasi offline", result: "Berhasil", pic: "Penguji" }] }],
      makers: [{ uid: "offline-maker", name: "Pembuat", role: "Staff" }],
      comments: []
    }))
  });
  await page.waitForFunction(() => document.querySelector("#featureName").value === "Draft Offline");
  const draftDownload = page.waitForEvent("download");
  await page.locator("#saveDraftBtn").click();
  const draft = JSON.parse(await readFile(await (await draftDownload).path(), "utf8"));
  assert.equal(draft.featureName, "Draft Offline");
  assert.equal(draft.groups[0].rows[0].result, "Berhasil");
  const pdfDownload = page.waitForEvent("download");
  await page.locator("#generateBtn").click();
  const pdf = await readFile(await (await pdfDownload).path());
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-", "Generate PDF must download a real PDF offline");
  assert.ok(pdf.length > 1000, "Generated PDF must contain document content");
  assert.deepEqual(errors, [], "No JavaScript runtime errors");
  assert.deepEqual(networkRequests, [], "Offline app must not attempt network requests");
  assert.deepEqual(webSockets, [], "Offline app must not create WebSockets");
  console.log(`PASS file:// page rendered: ${page.url()}`);
  console.log("PASS offline editor input and draft import/export round trip");
  console.log(`PASS Generate PDF download: ${pdf.length} bytes`);
  console.log("PASS Collab controls visible: 0");
  console.log(`PASS non-file network requests: ${networkRequests.length}`);
  console.log(`PASS WebSocket attempts: ${webSockets.length}`);
  console.log(`PASS JavaScript errors: ${errors.length}`);
} finally {
  await browser.close();
}
