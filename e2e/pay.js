// Payment flow: paywall → Stripe (mock) → return → files restored from IndexedDB → unlocked download.
// Start `node e2e/mocks.js`, then the app with:
//   ANTHROPIC_API_KEY=test-key ANTHROPIC_BASE_URL=http://localhost:4010 \
//   STRIPE_SECRET_KEY=sk_test_mock STRIPE_API_BASE=http://localhost:12111 UNLOCK_TOKEN_SECRET=test npm start -- -p 3100
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:3100";
const OUT = path.join(__dirname, "output", "pay");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));

  await page.goto(`${BASE}/app?sample=university`, { waitUntil: "networkidle" });
  await page.getByText(/documents? to upload/).waitFor({ timeout: 20000 });
  const source = await page.getByText(/Read by Claude/).first().innerText();
  console.log("source line:", source.slice(0, 80));
  await page.screenshot({ path: path.join(OUT, "1-rules-ai.png"), fullPage: true });
  await page.getByLabel("First name").fill("Marie-Hélène");
  await page.getByLabel("Last name").fill("Dupont");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Continue to files" }).click();
  await page.getByRole("button", { name: "Use sample files" }).click();
  await page.getByText(/Added \d+ sample files/).waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Prepare and check files" }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Preparing your files"), null, { timeout: 240000, polling: 500 });
  console.log("processed; headline:", await page.locator("main h2").first().innerText());

  await page.getByRole("button", { name: /Download packet, €4\.90/ }).click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "2-paywall.png") });
  await Promise.all([page.waitForURL(/checkout=success/, { timeout: 30000 }), page.getByRole("button", { name: /Pay €4\.90 and download/ }).click()]);
  console.log("returned from checkout:", page.url());
  await page.getByText("Payment received").waitFor({ timeout: 30000 });
  console.log("payment confirmed toast shown");
  await page.waitForFunction(() => !document.body.innerText.includes("Preparing your files") && document.body.innerText.includes("Download packet (.zip)"), null, { timeout: 240000, polling: 500 });
  await page.screenshot({ path: path.join(OUT, "3-unlocked.png") });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download packet (.zip)" }).click()]);
  const zip = path.join(OUT, download.suggestedFilename());
  await download.saveAs(zip);
  console.log("downloaded", zip);

  // A reload keeps the unlock and the files.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.body.innerText.includes("Download packet (.zip)") && !document.body.innerText.includes("Preparing your files"), null, { timeout: 240000, polling: 500 });
  console.log("after reload: still unlocked");
  console.log("console messages:", errors.length);
  errors.slice(0, 10).forEach((e) => console.log("  ", e.slice(0, 300)));
  await browser.close();
})().catch((e) => {
  console.error("PAY E2E FAILED:", e.message);
  process.exit(1);
});
