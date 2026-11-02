// End-to-end check: sample rules → sample files → processing → ZIP download.
// Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium) and a running app.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE || "http://localhost:3100";
// Usage: node e2e/run.js [university|rental|job|visa]
const SAMPLE = process.argv[2] || "university";
const OUT = path.join(__dirname, "output", SAMPLE);
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));

  const t0 = Date.now();
  await page.goto(`${BASE}/app?sample=${SAMPLE}`, { waitUntil: "networkidle" });
  await page.getByText(/documents? to upload/).waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "1-rules.png"), fullPage: true });
  console.log("rules read in", Date.now() - t0, "ms");

  await page.getByRole("button", { name: "Continue to files" }).click();
  await page.getByRole("button", { name: "Use sample files" }).click();
  await page.getByText(/Added \d+ sample files/).waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, "2-files.png"), fullPage: true });
  console.log("files added at", Date.now() - t0, "ms");

  await page.getByRole("button", { name: "Prepare and check files" }).click();
  const start = Date.now();
  await page.waitForFunction(() => !document.body.innerText.includes("Preparing your files"), null, { timeout: 240000, polling: 500 });
  console.log("processing took", Date.now() - start, "ms");
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, "3-review.png"), fullPage: true });
  await page.screenshot({ path: path.join(OUT, "3-review-top.png") });

  const headline = await page.locator("main h2").first().innerText();
  console.log("headline:", headline);

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByRole("button", { name: /Download packet/ }).click()]);
  const zipPath = path.join(OUT, download.suggestedFilename());
  await download.saveAs(zipPath);
  console.log("zip:", zipPath);

  // Open the first "How the size was chosen" panel for a screenshot.
  const details = page.locator("summary", { hasText: "How the size was chosen" }).first();
  if (await details.count()) {
    await details.click();
    await page.waitForTimeout(300);
    await details.locator("xpath=..").screenshot({ path: path.join(OUT, "4-trace.png") });
    const panel = details.locator("xpath=..");
    await panel.getByRole("button", { name: "Show values as a table" }).click();
    const rows = await panel.locator("tbody tr").allInnerTexts();
    fs.writeFileSync(path.join(OUT, "trace.txt"), rows.join("\n"));
    console.log("trace rows:", rows.length);
  }

  fs.writeFileSync(path.join(OUT, "console.txt"), errors.join("\n"));
  console.log(`console messages: ${errors.length}`);
  errors.slice(0, 15).forEach((e) => console.log("  ", e.slice(0, 300)));
  await browser.close();
})().catch((e) => {
  console.error("E2E FAILED:", e);
  process.exit(1);
});
