# Grounds

A small Chrome extension (Manifest V3) that reads the article you are on and
shows a badge saying how well argued it is: whether the page backs its claims
with reasons and structure, or just asserts them. It uses the
[Jev](https://www.typesafe.ai) API (TypeSafe's "System One" model, which returns
typed decisions instead of prose).

Grounds is not a fact checker. It does not judge whether the conclusions are
true, only how the article argues. An opinion column can be well argued; a
confident sounding rant is not.

## The badge

The badge floats in the bottom right corner (inside a shadow DOM, so page styles
cannot break it). It shows one label plus Jev's confidence, coloured like a
traffic light:

| Level | Badge | Meaning |
|------:|-------|---------|
| 0 | *(hidden)* | Unsupported assertions or pure rhetoric. Not worth it, so no badge is shown. |
| 1 | 🔴 Loosely argued | A few reasons, but loose or mostly rhetorical. |
| 2 | 🟡 Solidly argued | Clear reasons with a coherent logical structure. |
| 3 | 🟢 Rigorously argued | Structured reasoning, real evidence, counterpoints addressed. |

## How it works

1. Extraction. [Readability](https://github.com/mozilla/readability) (the engine
   behind Firefox and Safari Reader View) isolates the main article body and
   drops nav, sidebars, comments and related boxes. It runs on a clone of the
   DOM, so the cost is negligible.
2. Local gate. If Readability returns a long, coherent body (about 1,500
   characters or more) the page counts as an article. If there is too little
   text (under about 500 characters) Grounds stays quiet and makes no Jev call.
3. Safety check for ambiguous pages. When extraction is uncertain, the single Jev
   call also asks a `choice` question (`single article`, `feed or listing`, or
   `other`). The badge shows only if Jev confirms a single article.
4. Verdict. One `score` call to Jev on a four level argumentation rubric. The raw
   score maps to the badge label and is shown with Jev's confidence.

One article means one Jev call (about 100 ms). There are no per sentence
requests.

## Install (developer mode)

1. Get a Jev API key from TypeSafe.
2. Clone this repository (or download the ZIP).
3. Open `chrome://extensions` and turn on Developer mode (top right).
4. Click Load unpacked and select this folder.
5. Open the popup, paste your Jev API key, then either press Analyze page on an
   article, or turn on Auto analyze to run it on articles as you read.

There is no build step. It is plain HTML, CSS and JavaScript.

## Bring your own key

There is no API key in this repository, and none ships with the extension. Each
user provides their own Jev key. It is stored only in your browser
(`chrome.storage.local`), it never syncs, and it is used only by the background
service worker. The web page never sees it.

## Privacy and data

To score an article, Grounds sends the extracted article text to the Jev API
(`https://api.typesafe.ai`) over HTTPS, together with your key. In auto mode this
happens for every article you read. Grounds:

* sends only the extracted article text, not the full page HTML or form fields;
* makes the request from the background service worker, so your key is never
  exposed to the page;
* can make privileged cross origin requests only to `api.typesafe.ai` (see
  `host_permissions`);
* does not store, log, or send your data anywhere else.

Anything you send is handled under TypeSafe's own terms. Do not run it on pages
you consider private or confidential unless you are comfortable with that.

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Save your API key and settings locally. |
| `activeTab`, `scripting` | Inject the analyzer into the current tab on demand. |
| `host_permissions: api.typesafe.ai` | Call the Jev API. |
| content script on pages | Read the article text to analyze it. |

## Configuration

The parts you are likely to change live in a few constants:

* Rubric and prompt: `background.js`, `ARGUMENT_INSTRUCTIONS` and
  `ARGUMENT_CRITERIA`. These define what "well argued" means and tell the model
  to ignore rhetoric.
* Endpoint and model: `background.js`, `JEV_ENDPOINT` and `JEV_MODEL`.
* Thresholds: `content.js`, `STRONG_MIN`, `MIN_CHARS`, `MAX_CHARS`.
* Labels and colours: `content.js`, `LEVELS`.

## Project layout

| File | Role |
|------|------|
| `manifest.json` | MV3 config, permissions, icons. |
| `background.js` | Service worker: the single Jev call and score normalization. |
| `content.js` | Extraction (Readability), gate, and badge (shadow DOM). |
| `Readability.js` | Mozilla Readability, vendored (Apache 2.0). |
| `popup.html`, `popup.css`, `popup.js` | The mini UI: key, auto toggle, buttons. |
| `icons/` | Toolbar and store icons. |

## Notes and limitations

* How well argued is still a judgment. Treat the badge as a signal, not a
  verdict. That is why Jev's confidence is shown.
* Telling genuine structure apart from persuasive rhetoric is hard, so borderline
  articles can move between levels 2 and 3.
* Soft paywalls that show only a teaser are judged on the visible portion.
* It does not run on special pages (`chrome://…`, the Web Store, PDFs). That is a
  Chrome limitation.

## Credits and license

* Article extraction by [Mozilla Readability](https://github.com/mozilla/readability)
  (Apache 2.0), vendored in `Readability.js`.
* Scoring by the [Jev](https://www.typesafe.ai) model (TypeSafe). This project is
  not affiliated with or endorsed by TypeSafe.
* This extension's own code is released under the MIT License. See `LICENSE`.
