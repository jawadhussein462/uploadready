# UploadReady

Make every file fit the upload rules.

UploadReady prepares documents and photos for online applications: jobs, universities, rental dossiers, visas and government forms. The applicant pastes the portal's instructions (or a screenshot of them) and adds their files. UploadReady converts, resizes, compresses and renames each file, then checks the complete set against every rule: formats, sizes, dimensions, DPI, pages and names. The applicant gets readable previews, a list of problems it can't fix (with the fix), and a ZIP of ready-to-upload files for a one-time fee per packet.

**Documents never leave the applicant's device.** All file processing runs in the browser. Only the instructions text or screenshot is sent to the server, to be read by Claude.

---

## Contents

- [Quick start](#quick-start)
- [Deploy to Vercel](#deploy-to-vercel)
- [Environment variables](#environment-variables)
- [Architecture](#architecture)
- [How the engine works](#how-the-engine-works)
- [Payments](#payments)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Limitations and next steps](#limitations-and-next-steps)

## Quick start

Requirements: Node.js 20.9 or newer.

```bash
npm install            # also copies the pdf.js worker into /public
cp .env.example .env.local
npm run dev            # http://localhost:3000
```

Every key is optional. With no keys:

- the requirements are read by the built-in rule reader (English and French), and screenshots are disabled;
- payments are off, so packets download for free.

Add `ANTHROPIC_API_KEY` to turn on AI reading (text and screenshots). Add `STRIPE_SECRET_KEY` to turn on the paywall.

To try the full flow without your own documents, open `/app?sample=university`, continue to **Files**, and choose **Use sample files**.

## Deploy to Vercel

The frontend and backend are one Next.js app, so they deploy as one Vercel project with no extra configuration.

1. Push this folder to a GitHub, GitLab or Bitbucket repository.
2. In Vercel, choose **Add New → Project** and import the repository. The framework preset is detected as Next.js.
3. Under **Environment Variables**, add the variables from the table below (at least `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `UNLOCK_TOKEN_SECRET` and `NEXT_PUBLIC_APP_URL` for production).
4. Deploy. When you change an environment variable later, redeploy so the landing page shows the new price.

Once the repository exists, you can also use a one-click button (replace the URL):

```
https://vercel.com/new/clone?repository-url=https://github.com/YOU/uploadready&env=ANTHROPIC_API_KEY,STRIPE_SECRET_KEY,UNLOCK_TOKEN_SECRET,NEXT_PUBLIC_APP_URL
```

Why this works on Vercel: serverless functions accept request bodies of only about 4.5 MB, and passport scans or multi-page PDFs often exceed that. Because files are processed in the browser, they never touch a function. The only server work is reading the instructions (a few kB, or a downsized screenshot) and creating Stripe sessions.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | For AI reading | Claude reads the instructions (text and screenshots). Without it, the built-in rule reader is used and screenshots are disabled. |
| `ANTHROPIC_MODEL` | No | Model for reading the rules. Default `claude-sonnet-5-5`. |
| `ANTHROPIC_BASE_URL` | No | Proxy or mock endpoint. Default `https://api.anthropic.com`. |
| `STRIPE_SECRET_KEY` | For payments | Enables the one-time payment per packet. Use `sk_test_…` while testing. |
| `PACKET_PRICE_CENTS` | No | Price in the smallest currency unit. Default `490` (€4.90). |
| `PACKET_CURRENCY` | No | ISO currency code. Default `eur`. |
| `UNLOCK_TOKEN_SECRET` | With payments | Signs the "packet paid" receipts. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `NEXT_PUBLIC_APP_URL` | Production | Public URL for Stripe redirects, the sitemap and social previews. |
| `RATE_LIMIT_PER_10_MIN` | No | AI reader requests per IP per 10 minutes. Default `20`. |
| `STRIPE_API_BASE` | Tests only | Points the Stripe SDK at stripe-mock or `e2e/mocks.js`. |

Keys are only read in server code (`src/lib/server/*`, `src/lib/ai/extract.ts`, which import `server-only`), so they can never be bundled into the browser.

## Architecture

```
Browser (Next.js client)                                  Server (Next.js route handlers on Vercel)
────────────────────────────────────────                 ───────────────────────────────────────────
Landing page  /                                           GET  /api/config            which features are on, price
Workspace     /app                                        POST /api/requirements      Claude tool call → PacketSpec
  1 Rules   → POST /api/requirements ───────────────────▶   (falls back to the rule reader on any AI error)
  2 Files   → inspect, match files to documents (local)   POST /api/checkout          Stripe Checkout session
  3 Check   → process + verify every file (local)         POST /api/checkout/verify   paid? → signed unlock receipt
            → ZIP, or paywall → Stripe ────────────────▶  POST /api/unlock            check a stored receipt
State: zustand, saved to IndexedDB (rules, files, settings, receipt)
```

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS 4, Radix primitives, Archivo variable font, sonner toasts.
- **Engine** (`src/lib/engine`): plain TypeScript running in the browser, using canvas, pdf-lib, pdf.js and heic2any. Pure parts are unit-tested in Node.
- **AI**: one forced tool call to Claude (`record_upload_requirements`). The model only extracts what the text says: numbers with their units and verbatim evidence. All unit arithmetic happens in code (`src/lib/ai/schema.ts`), so "240 KB" always becomes the same byte limit.
- **Persistence**: the packet (rules, files, choices, receipt) is kept in IndexedDB. This is what lets a file survive a refresh or the round-trip to Stripe. "Start a new packet" deletes it.

## How the engine works

**Reading the rules** (`rules-parser.ts`, `ai/schema.ts`). Quantities are tokenised (sizes, pixel boxes, print sizes, DPI, pages, file counts) and each one is classified as a minimum, maximum or exact value from the nearest qualifier ("at most", "no less than", "ne doit pas dépasser"…). Rules attach to the documents named in the same sentence, line or heading block, and "all files…" rules apply to every document. Limits are read strictly: a maximum of "240 KB" is 240,000 bytes and a minimum of "54 KB" is 55,296 bytes, so files pass whichever definition a portal uses. Each rule keeps the sentence it came from, shown highlighted in the UI.

**Matching files to documents** (`assign.ts`). Every file–document pair gets a score from file-name tokens (with English and French synonyms and fuzzy matching), image content (skin-tone portrait likelihood, signature ink-on-paper likelihood, page likelihood) and whether the format can be converted. The Hungarian algorithm (Kuhn–Munkres) finds the best overall assignment, with an "unassigned" option priced at a confidence threshold. Manual choices are kept fixed.

**Framing** (`image/framing.ts`). For photos, the background colour is estimated from the border median. A skin region that stands out from it (in CIELAB and YCbCr) gives the face, then the crown and chin are traced. The frame uses ID-photo proportions: the head is about 60% of a square frame and 70% of a 35 × 45 mm frame. If no face is found, a saliency search (edges + foreground + skin, using an integral image) picks the window. Signatures are trimmed to their ink. Documents are never cropped, only padded with white. Everything can be adjusted by hand.

**Hitting the size limit** (`image/optimize.ts`). This is a rate–distortion search. For each accepted format and a ladder of output sizes, JPEG/WebP quality is bisected to the highest value under the limit. Every candidate is decoded and scored with SSIM against the full-quality reference on a common grid, so lost resolution counts as lost detail. The best-scoring file under the limit wins. Minimum sizes are met by raising quality, then by inert comment padding. The app plots every version tried ("How the size was chosen").

**PDFs** (`pdf/assemble.ts`). Several files merge into one PDF in the order shown. Strategy ladder: keep original pages untouched → re-encode embedded images (respecting a required DPI) → re-render pages with pdf.js (300→72 dpi depending on page count) with bisected JPEG quality. Text detection decides whether to warn that text is no longer selectable. Password-protected files are flagged.

**Clean-up** (`image/enhance.ts`). Signature paper is pushed to white while keeping ink hue. Phone photos of pages get their paper colour estimated per block, smoothed and divided out (removing shadows and colour casts), then a contrast curve. There is also a greyscale conversion.

**Verification** (`validate.ts`). Every output is checked from its bytes: type from magic bytes, dimensions and DPI from JPEG/PNG/WebP headers (DPI is written into JFIF or a CRC-checked PNG `pHYs` chunk), pages from the PDF, plus extension, name rules and the total packet size. Photos also get judgement checks: sharpness (variance of the Laplacian), background uniformity (CIELAB spread of the border) and exposure.

## Payments

The flow uses Stripe Checkout with inline `price_data`, so you don't need to create products in the Stripe dashboard:

1. The applicant prepares and checks everything for free.
2. **Download** opens the paywall. `POST /api/checkout` creates a Checkout Session tagged with the packet ID. The state is saved to IndexedDB first.
3. Stripe redirects back to `/app?checkout=success&session_id=…`. `POST /api/checkout/verify` retrieves the session from Stripe and, if it's paid, returns an HMAC-signed receipt bound to the packet ID.
4. The receipt is stored with the packet and re-checked on load (`/api/unlock`). The applicant can download again after edits to the same packet.

No webhook is required. If you want accounting or emails, add a `checkout.session.completed` webhook. Before going live, switch to live keys, set `NEXT_PUBLIC_APP_URL` to your domain, and set a strong `UNLOCK_TOKEN_SECRET`.

Trade-off: because documents are processed on the device, the paywall is enforced in the browser with a server-verified receipt. That's normal for privacy-first tools; a determined user with developer tools could get around it. If that matters more than privacy, move the final export to a server.

## Testing

```bash
npm test          # 38 unit tests: rule reader (EN/FR samples), units, AI output conversion,
                  # JPEG/PNG metadata, SSIM, framing geometry, Hungarian matching, naming, validation
npm run typecheck
npm run build
```

End-to-end tests drive a real Chromium through the whole flow and verify the downloaded ZIP:

```bash
npm i -D playwright && npx playwright install chromium
npm run build && npm start -- -p 3100        # in one terminal
node e2e/run.js university                   # or rental | job | visa
python3 e2e/verify.py e2e/output/university/*.zip   # independent check with Pillow
```

To test AI reading and payments without real keys, `e2e/mocks.js` starts a mock Anthropic API (port 4010) and a mock Stripe API (port 12111). Then run the app pointed at them and run `node e2e/pay.js` (setup instructions are at the top of that file).

## Project structure

```
src/
  app/
    page.tsx                 landing page
    app/page.tsx             the workspace (/app)
    privacy/page.tsx
    api/                     config, requirements, checkout, checkout/verify, unlock
    opengraph-image.tsx      social preview, robots.ts, sitemap.ts, icon.svg
  components/
    marketing/               hero (animated "fits" headline + demo), sections, FAQ, chart
    workspace/               rules, files and review steps, requirement editor, crop editor, paywall
    charts/                  size-vs-similarity chart (hover, keyboard, table view)
    ui/                      buttons, fields, dialog, status, size gauge
  lib/
    engine/                  rules parser, units, matching, naming, validation, pipeline
      image/                 decoding, framing, optimiser, analysis (SSIM…), metadata, clean-up
      pdf/                   pdf.js loader, PDF assembly and size fitting
    ai/                      Claude tool schema, prompt and call
    server/                  config, Stripe client, rate limit, signed receipts
    store/                   zustand store + IndexedDB persistence
    client/                  API calls, sample-file generator
tests/                       vitest unit tests
e2e/                         Playwright flows, mock servers, ZIP verifier
```

## Limitations and next steps

- **Rate limiting** is in memory per server instance. Use Upstash Redis or Vercel KV for a hard global limit.
- **HEIC** files are decoded natively in Safari and with heic2any (WebAssembly, loaded on demand) elsewhere. Very large HEIC files can take a few seconds.
- **Grey-scale JPEGs** are written as 3-channel images with equal channels (canvas encoders can't write 1-channel JPEG). They look and measure as black and white.
- **Next steps** worth considering: perspective correction for phone photos of pages, landmark-based face detection (MediaPipe) for stricter ID-photo checks, saved presets for popular portals, accounts for applicants with many applications, and a B2B plan for advisors and relocation agencies.
