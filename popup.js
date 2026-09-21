// Popup logic: store the API key / active flag and drive the content script.

const els = {
  active: document.getElementById("active"),
  apiKey: document.getElementById("apiKey"),
  run: document.getElementById("run"),
  clear: document.getElementById("clear"),
  status: document.getElementById("status")
};

const DEFAULTS = { active: false, apiKey: "" };

const VERDICT_WORDS = ["Unsupported", "Loosely argued", "Solidly argued", "Rigorously argued"];

function setStatus(text, kind) {
  els.status.textContent = text || "";
  els.status.className = "status" + (kind ? " " + kind : "");
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
}

els.active.addEventListener("change", () =>
  chrome.storage.local.set({ active: els.active.checked })
);
els.apiKey.addEventListener("change", () =>
  chrome.storage.local.set({ apiKey: els.apiKey.value.trim() })
);

els.run.addEventListener("click", async () => {
  await chrome.storage.local.set({ apiKey: els.apiKey.value.trim() });
  if (!els.apiKey.value.trim()) {
    setStatus("Enter your Jev API key first.", "error");
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
