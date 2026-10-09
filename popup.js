// Popup logic: store the API key / base URL / active flag and drive the content script.

const els = {
  active: document.getElementById("active"),
  apiKey: document.getElementById("apiKey"),
  apiBaseUrl: document.getElementById("apiBaseUrl"),
  run: document.getElementById("run"),
  clear: document.getElementById("clear"),
  status: document.getElementById("status")
};

const DEFAULTS = { active: false, apiKey: "", apiBaseUrl: "" };
const DEFAULT_API_BASE = "https://api.typesafe.ai";

const VERDICT_WORDS = ["Unsupported", "Loosely argued", "Solidly argued", "Rigorously argued"];

function setStatus(text, kind) {
  els.status.textContent = text || "";
  els.status.className = "status" + (kind ? " " + kind : "");
}

function resolveApiBase(raw) {
  const trimmed = (raw || "").trim();
  return trimmed || DEFAULT_API_BASE;
}

function hostPermissionPattern(baseUrl) {
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.protocol}//${u.host}/*`;
  } catch (_) {
    return null;
  }
}

// Ask for host access when the user picks a non-default API base (needs a
// user gesture — call from change/click handlers, not from the service worker).
async function ensureHostPermission(baseUrl) {
  const pattern = hostPermissionPattern(baseUrl);
  if (!pattern) {
    return { ok: false, error: "Invalid API Base URL." };
  }
  let origin;
  try {
    origin = new URL(baseUrl).origin;
  } catch (_) {
    return { ok: false, error: "Invalid API Base URL." };
  }
  if (origin === new URL(DEFAULT_API_BASE).origin) {
    return { ok: true };
  }
  const perm = { origins: [pattern] };
  const already = await chrome.permissions.contains(perm);
  if (already) return { ok: true };
  const granted = await chrome.permissions.request(perm);
  if (!granted) {
    return { ok: false, error: "Host permission denied for " + origin + "." };
  }
  return { ok: true };
}

async function saveSettings() {
  await chrome.storage.local.set({
    apiKey: els.apiKey.value.trim(),
    apiBaseUrl: els.apiBaseUrl.value.trim()
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Message the content script; inject it on demand if the page was open before
// the extension was installed.
async function sendToTab(tab, message) {
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (_) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["Readability.js", "content.js"]
    });
    return await chrome.tabs.sendMessage(tab.id, message);
  }
}

async function init() {
  const cfg = await chrome.storage.local.get(DEFAULTS);
  els.active.checked = !!cfg.active;
  els.apiKey.value = cfg.apiKey || "";
  els.apiBaseUrl.value = cfg.apiBaseUrl || "";
}

els.active.addEventListener("change", () =>
  chrome.storage.local.set({ active: els.active.checked })
);
els.apiKey.addEventListener("change", () =>
  chrome.storage.local.set({ apiKey: els.apiKey.value.trim() })
);
els.apiBaseUrl.addEventListener("change", async () => {
  const base = resolveApiBase(els.apiBaseUrl.value);
  const perm = await ensureHostPermission(base);
  if (!perm.ok) {
    setStatus(perm.error, "error");
    return;
  }
  await chrome.storage.local.set({ apiBaseUrl: els.apiBaseUrl.value.trim() });
  setStatus(
    els.apiBaseUrl.value.trim()
      ? "Using custom API base."
      : "Using default API base.",
    "ok"
  );
});

els.run.addEventListener("click", async () => {
  await saveSettings();
  if (!els.apiKey.value.trim()) {
    setStatus("Enter your Jev API key first.", "error");
    return;
  }
  const base = resolveApiBase(els.apiBaseUrl.value);
  const perm = await ensureHostPermission(base);
  if (!perm.ok) {
    setStatus(perm.error, "error");
    return;
  }
  els.run.disabled = true;
  setStatus("Analyzing with Jev…");
  try {
    const tab = await getActiveTab();
    const res = await sendToTab(tab, { type: "run" });
    if (res && res.ok) {
      if (res.hidden) {
        setStatus("Unsupported — badge hidden (not worth it).", "ok");
      } else if (typeof res.levelIndex === "number") {
        setStatus(`${VERDICT_WORDS[res.levelIndex] || "Done"}.`, "ok");
      } else if (res.abstained) {
        setStatus(res.pageType
          ? `Skipped: looks like a ${res.pageType}.`
          : "Skipped: no clear article here.", "ok");
      } else {
        setStatus(res.message || "Done.", "ok");
      }
    } else {
      setStatus((res && res.error) || "Unknown error.", "error");
    }
  } catch (e) {
    setStatus("Can't run on this page: " + (e.message || e), "error");
  } finally {
    els.run.disabled = false;
  }
});

els.clear.addEventListener("click", async () => {
  try {
    const tab = await getActiveTab();
    await sendToTab(tab, { type: "clear" });
    setStatus("Badge hidden.", "ok");
  } catch (e) {
    setStatus("Nothing to hide here.", "error");
  }
});

init();
