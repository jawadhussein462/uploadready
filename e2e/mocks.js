// Mock Anthropic Messages API (port 4010) and mock Stripe API (port 12111) for local testing.
const http = require("http");

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const readBody = (req) => new Promise((res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => res(b)); });

http
  .createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.method !== "POST" || req.url !== "/v1/messages") { res.writeHead(404); return res.end(); }
    if (req.headers["x-api-key"] !== "test-key") {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
    }
    const payload = JSON.parse(body);
    const hasImage = payload.messages[0].content.some((c) => c.type === "image");
    log("anthropic: model", payload.model, "tool_choice", payload.tool_choice?.name, "image", hasImage, "tools", payload.tools?.length);
    const input = {
      title: hasImage ? "Scholarship portal (from screenshot)" : "Graduate application — Northbridge University",
      documents: [
        { label: "Passport-style photo", kind: "photo", required: true, formats: ["jpg"], maxSize: { value: 240, unit: "KB" }, pixels: { minWidth: 600, minHeight: 600, maxWidth: 1200, maxHeight: 1200 }, aspectRatio: { width: 1, height: 1 }, background: "white", evidence: ["JPG only, square, between 600 x 600 and 1200 x 1200 pixels, maximum 240 KB"] },
        { label: "Scanned signature", kind: "signature", required: true, formats: ["jpg", "png"], minSize: { value: 10, unit: "KB" }, maxSize: { value: 50, unit: "KB" }, colorMode: "grayscale", evidence: ["JPG or PNG, 10–50 KB, black and white"] },
        { label: "Academic transcripts", kind: "document", required: true, formats: ["pdf"], maxSize: { value: 5, unit: "MB" }, combine: "merge", evidence: ["combine all transcripts into a single PDF"], notes: ["Official copies only"] },
        { label: "ID photo for badge", kind: "photo", required: false, formats: ["jpeg"], printSize: { width: 35, height: 45, unit: "mm" }, dpi: 300, evidence: ["35 x 45 mm at 300 dpi"] },
      ],
      totalMaxSize: { value: 15, unit: "MB" },
      naming: { pattern: "{LASTNAME}_{Firstname}_{Doc}.pdf", allowSpaces: false },
      warnings: ["The instructions don't say whether the signature may be in colour."],
      confidence: 0.93,
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg_mock", type: "message", role: "assistant", model: payload.model, content: [{ type: "tool_use", id: "toolu_1", name: "record_upload_requirements", input }], stop_reason: "tool_use" }));
  })
  .listen(4010, () => log("mock anthropic on 4010"));

const sessions = new Map();
http
  .createServer(async (req, res) => {
    const body = await readBody(req);
    log("stripe:", req.method, req.url);
    if (req.method === "POST" && req.url === "/v1/checkout/sessions") {
      const p = new URLSearchParams(body);
      const id = `cs_test_mock${sessions.size + 1}`;
      const session = {
        id,
        object: "checkout.session",
        payment_status: "paid",
        client_reference_id: p.get("client_reference_id"),
        metadata: { packetId: p.get("metadata[packetId]") },
        amount_total: Number(p.get("line_items[0][price_data][unit_amount]")),
        currency: p.get("line_items[0][price_data][currency]"),
        url: p.get("success_url").replace("{CHECKOUT_SESSION_ID}", id),
      };
      sessions.set(id, session);
      log("stripe: created", id, "packet", session.metadata.packetId, session.amount_total, session.currency);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(session));
    }
    const m = req.url.match(/^\/v1\/checkout\/sessions\/([^/?]+)/);
    if (req.method === "GET" && m && sessions.has(m[1])) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(sessions.get(m[1])));
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { type: "invalid_request_error", message: "No such session" } }));
  })
  .listen(12111, () => log("mock stripe on 12111"));
