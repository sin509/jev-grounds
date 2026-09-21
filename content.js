// Content script (Grounded): isolates the real article text (Readability),
// decides whether the page is actually an article, and — only for a genuine
// article — asks Jev for the opinion-vs-argument verdict and shows a badge.

(() => {
  if (window.__groundedLoaded) return;
  window.__groundedLoaded = true;

  const MAX_CHARS = 20000; // keep well within Jev's ~32k-token state budget
  const STRONG_MIN = 1500; // Readability text this long => confidently an article
  const MIN_CHARS = 500; // below this: not enough text, abstain locally
  const HOST_ID = "grounded-badge-host";

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "NAV", "HEADER",
    "FOOTER", "ASIDE", "BUTTON", "SELECT", "SVG", "FORM"
  ]);

  // Argumentation level. Index 0 (unsupported) is intentionally null: no badge
  // is shown — not worth the reader's time. Levels 1-3 use traffic-light colors.
  const LEVELS = [
    null,
    { word: "Loosely argued", color: "#e5484d" },
    { word: "Solidly argued", color: "#e8a33d" },
    { word: "Rigorously argued", color: "#22a565" }
  ];

  let running = false;

  // --- text extraction -----------------------------------------------------

  function isVisible(el) {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Readability: the main article block only. Returns { title, text } or null.
  function extractWithReadability() {
    if (typeof Readability !== "function") return null;
    try {
      const clone = document.cloneNode(true);
      const article = new Readability(clone).parse();
      if (!article || !article.textContent) return null;
      const text = article.textContent.replace(/\s+\n/g, "\n").trim();
      return { title: (article.title || "").trim(), text };
    } catch (_) {
      return null;
    }
  }

  // Fallback: crude whole-page text (used only to gauge if there's any corpus).
  function extractWholePage() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest(`#${HOST_ID}`)) return NodeFilter.FILTER_REJECT;
        if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
        const t = node.nodeValue;
        if (!t || t.trim().length < 40) return NodeFilter.FILTER_REJECT;
        if (!isVisible(parent)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const seen = new Set();
    const lines = [];
    let total = 0, n;
    while ((n = walker.nextNode())) {
      const t = n.nodeValue.trim().replace(/\s+/g, " ");
      if (seen.has(t)) continue;
      seen.add(t);
      lines.push(t);
      total += t.length + 1;
      if (total >= MAX_CHARS) break;
    }
    return lines.join("\n");
  }

  // Decides what to evaluate and how sure we are it's an article.
  // Returns { text, confident } or null when there's not enough text at all.
  function resolveArticle() {
    const r = extractWithReadability();
    if (r && r.text.length >= STRONG_MIN) {
      const combined = (r.title ? r.title + "\n\n" : "") + r.text;
      return { text: combined.slice(0, MAX_CHARS), confident: true };
    }
    // Ambiguous: little or no Readability result. Fall back to page text just
    // to see whether there's a corpus worth asking Jev to classify.
    const whole = (r && r.text.length >= MIN_CHARS ? r.text : extractWholePage());
    if (whole.length < MIN_CHARS) return null; // abstain locally
    return { text: whole.slice(0, MAX_CHARS), confident: false };
  }

  // --- badge UI (shadow DOM) ------------------------------------------------

  function getShadow() {
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = HOST_ID;
      host.attachShadow({ mode: "open" });
      host.shadowRoot.innerHTML = `
        <style>
          :host { all: initial; }
          .card {
            position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
            width: 230px;
            font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
            background: #ffffff; color: #1a1d21;
            border: 1px solid #e4e7eb; border-radius: 14px;
            box-shadow: 0 6px 24px rgba(0,0,0,.18);
            padding: 12px 13px; animation: pop .18s ease;
          }
          @keyframes pop { from { transform: translateY(6px); opacity: 0 } to { transform: none; opacity: 1 } }
          .top { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
          .brand { display:flex; align-items:center; gap:7px; font-size:11px; font-weight:700;
                    letter-spacing:.4px; text-transform:uppercase; color:#6b7280; }
          .dot { width:14px; height:14px; border-radius:5px;
                 background:linear-gradient(135deg,#e5484d 0%,#e8a33d 50%,#22a565 100%); }
          .x { cursor:pointer; border:none; background:none; font-size:16px; line-height:1;
               color:#9aa1ac; padding:2px 4px; border-radius:6px; }
          .x:hover { background:#f1f2f4; }
          .verdict { font-size:19px; font-weight:700; margin:2px 0 3px; display:flex; align-items:center; }
          .lvldot { width:9px; height:9px; border-radius:50%; margin-right:8px; flex:0 0 auto; }
          .sub { font-size:10px; color:#9aa1ac; text-transform:uppercase; letter-spacing:.5px; }
          .meta { font-size:11px; color:#6b7280; margin-top:10px; }
          .loading, .error { font-size:13px; color:#6b7280; }
          .error { color:#c0392b; }
          @media (prefers-color-scheme: dark) {
            .card { background:#1c1f25; color:#e9eaec; border-color:#2b2f37;
                    box-shadow:0 6px 24px rgba(0,0,0,.5); }
            .x:hover { background:#2b2f37; }
          }
        </style>
        <div class="card"><div class="body"></div></div>
      `;
      document.documentElement.appendChild(host);
    }
    return host.shadowRoot;
  }

  function header() {
    return `
      <div class="top">
        <span class="brand"><span class="dot"></span>Grounded</span>
        <button class="x" title="Close">&times;</button>
      </div>`;
  }

  function bindClose(shadow) {
    const x = shadow.querySelector(".x");
    if (x) x.addEventListener("click", removeBadge);
  }

  function paint(inner) {
    const shadow = getShadow();
    shadow.querySelector(".body").innerHTML = header() + inner;
    bindClose(shadow);
  }

  function renderLoading() { paint(`<div class="loading">Analyzing article…</div>`); }
  function renderError(msg) { paint(`<div class="error">${escapeHtml(msg)}</div>`); }

  function renderResult(lvl, confidence) {
    const conf = confidence != null
      ? `<div class="meta">Jev confidence ${Math.round(confidence * 100)}%</div>` : "";
    paint(`
      <div class="verdict" style="color:${lvl.color}">
        <span class="lvldot" style="background:${lvl.color}"></span>${lvl.word}
      </div>
      <div class="sub">argumentation</div>
      ${conf}
    `);
  }

  function removeBadge() {
    const host = document.getElementById(HOST_ID);
    if (host) host.remove();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  // --- main flow ------------------------------------------------------------

  async function run() {
    if (running) return { ok: false, error: "Already analyzing." };
    running = true;
    try {
      const { apiKey } = await chrome.storage.local.get("apiKey");
      if (!apiKey) return { ok: false, error: "Set your Jev API key in the popup." };

      const resolved = resolveArticle();
      if (!resolved) {
        // Not enough text: no corpus, show nothing on the page.
        removeBadge();
        return { ok: true, abstained: true, message: "No clear article." };
      }

      // When we're sure it's an article we show the badge right away; when
      // we're unsure we still make a safety call to Jev, but stay invisible
      // and only reveal the badge if Jev confirms a single article.
      const withChoice = !resolved.confident;
      if (resolved.confident) renderLoading();

      const resp = await chrome.runtime.sendMessage({
        type: "scoreArticle",
        text: resolved.text,
        withChoice
      });
      if (!resp || !resp.ok) {
        if (resolved.confident) renderError((resp && resp.error) || "Jev request failed.");
        else removeBadge();
        return { ok: false, error: (resp && resp.error) || "Jev request failed." };
      }

      if (withChoice && (!resp.result.pageType || !resp.result.pageType.isArticle)) {
        // Safety call ran, but it's not a single article: stay invisible.
        removeBadge();
        const kind = resp.result.pageType && resp.result.pageType.choice;
        return { ok: true, abstained: true, pageType: kind || null };
      }

      const arg = resp.result.argument;
      const lvl = LEVELS[arg.levelIndex];
      if (!lvl) {
        // Unsupported: not worth the reader's time, show nothing.
        removeBadge();
        return { ok: true, hidden: true, levelIndex: arg.levelIndex };
      }
      renderResult(lvl, arg.confidence);
      return { ok: true, levelIndex: arg.levelIndex };
    } catch (e) {
      renderError(String(e.message || e));
      return { ok: false, error: String(e.message || e) };
    } finally {
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === "run") { run().then(sendResponse); return true; }
    if (msg.type === "clear") { removeBadge(); sendResponse({ ok: true }); return true; }
  });

  chrome.storage.local.get("active").then((cfg) => {
    if (cfg && cfg.active) run();
  });
})();
