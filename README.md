# Grounds — how well-argued is this page?

A tiny Chrome extension (Manifest V3) that reads the article you're on and shows
a small badge telling you **how well-argued** it is — with real reasons and
structure, not just rhetoric — using the **[Jev](https://www.typesafe.ai)** API
(TypeSafe's "System One" model, which returns typed decisions instead of prose).

It answers a 2-second question: *does this page actually argue its case, or is it
just asserting?* — so you can decide whether it's worth your time.

> **Not** a fact-checker and **not** a "true/false" judge. It rates the presence
> and structure of argumentation, **never whether the conclusions are correct**
> (that's beyond any model). An opinion column can be highly argued; a
> confident-sounding rant is not.

## The badge

A floating badge (bottom-right, in a shadow DOM so page styles can't break it)
shows one **label** plus **Jev's confidence**, with traffic-light colours:

| Level | Badge | Meaning |
|------:|-------|---------|
| 0 | *(hidden)* | Unsupported assertions / pure rhetoric — not worth it, **no badge shown** |
| 1 | 🔴 **Loosely argued** | A few reasons, but loose or mainly rhetorical |
| 2 | 🟡 **Solidly argued** | Clear reasons with a coherent logical structure |
| 3 | 🟢 **Rigorously argued** | Structured reasoning, real evidence, counterpoints addressed |

## How it works

1. **Extraction** — [Readability](https://github.com/mozilla/readability) (the
   engine behind Firefox/Safari Reader View) isolates the main article body,
   dropping nav, sidebars, comments and related boxes. It runs synchronously on
   a clone of the DOM, so the impact is negligible.
2. **Local gate** — if Readability returns a long, coherent body (≥ ~1,500 chars)
   the page is confidently an article. If there's too little text (< ~500 chars)
   the extension abstains and **no badge appears** — and no Jev call is made.
3. **Safety check (ambiguous pages only)** — when extraction is uncertain, the
   single Jev call also asks a `choice` (`single article` / `feed or listing` /
   `other`); the badge appears **only** if Jev confirms a single article.
4. **Verdict** — one `score` call to Jev on a 4-level argumentation rubric; the
   raw score maps to the badge label, shown with Jev's confidence.

One article = **one** Jev call (~100 ms). No per-sentence requests.

## Install (developer mode)

1. Get a **Jev API key** from TypeSafe.
2. Clone this repo (or download the ZIP).
3. Open `chrome://extensions`, turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select this folder.
5. Open the extension popup, paste your **Jev API key**, then either:
   - press **Analyze page** on an article, or
   - flip the **Auto-analyze** switch to have it run on articles as you read.

There are no build steps — it's plain HTML/CSS/JS.

## Bring your own key

There is **no API key in this repository** and none is bundled with the
extension. Each user supplies their own Jev key. It's stored only in your
browser (`chrome.storage.local`), it never syncs, and it is used **only** by the
background service worker — the web page never sees it.

## Privacy & data

Be aware of what this does: to score an article, the extension **sends the
extracted article text to TypeSafe's API** (`https://api.typesafe.ai`) over
HTTPS, together with your key. In auto mode this happens for every article you
read. The extension:

- sends **only** the extracted article text (not full page HTML, forms, etc.);
- makes the request from the **background service worker**, so your key is never
  exposed to the page;
- can make privileged cross-origin requests **only** to `api.typesafe.ai`
  (see `host_permissions`);
- does not store, log, or send your data anywhere else.

Whatever you send is subject to TypeSafe's own data handling. Don't use it on
pages you consider private/confidential unless you're comfortable with that.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save your API key and settings locally. |
| `activeTab` / `scripting` | Inject the analyzer into the current tab on demand. |
| `host_permissions: api.typesafe.ai` | Call the Jev API. |
| content script on pages | Read the article text to analyze it. |

## Configuration (for tinkerers)

Everything lives in a couple of constants:

- **Rubric & prompt** — `background.js`: `ARGUMENT_INSTRUCTIONS` and
  `ARGUMENT_CRITERIA` define exactly what "well-argued" means and explicitly tell
  the model to ignore rhetoric. Change these to retune the judgment.
- **Endpoint / model** — `background.js`: `JEV_ENDPOINT`, `JEV_MODEL`.
- **Thresholds** — `content.js`: `STRONG_MIN`, `MIN_CHARS`, `MAX_CHARS`.
- **Labels & colours** — `content.js`: `LEVELS`.

## Project layout

| File | Role |
|------|------|
| `manifest.json` | MV3 config, permissions, icons. |
| `background.js` | Service worker: the single Jev call, score normalization. |
| `content.js` | Extraction (Readability), gate, badge (shadow DOM). |
| `Readability.js` | Mozilla Readability, vendored (Apache-2.0). |
| `popup.html` / `popup.css` / `popup.js` | The mini UI: key, auto toggle, buttons. |
| `icons/` | Toolbar/store icons (generated). |

## Notes & limitations

- "How well-argued" is still a judgment — treat the badge as a signal, not a
  verdict; that's why Jev's confidence is shown.
- Distinguishing genuine structure from persuasive rhetoric is subtle; borderline
  articles may wobble between levels 2 and 3.
- Soft paywalls with only a teaser visible will be judged on the visible portion.
- Doesn't run on special pages (`chrome://…`, the Web Store, PDFs) — a Chrome
  limitation, not a bug.

## Credits & licence

- Article extraction by [Mozilla Readability](https://github.com/mozilla/readability)
  (Apache-2.0), vendored in `Readability.js`.
- Scoring by the [Jev](https://www.typesafe.ai) model (TypeSafe). Not affiliated
  with or endorsed by TypeSafe.
- This extension's own code is released under the MIT License — see `LICENSE`.
