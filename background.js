// Service worker: single Jev call that scores the article on a spectrum from
// bare "opinion" to sustained "argument" (presence of argumentation, not its
// soundness). When the page type is ambiguous, the same call also asks a Choice
// to confirm it's a real article.

const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";

// Argumentation rubric: 4 ordered levels => raw score 0..3, normalized to 0..100.
// We rate how WELL-STRUCTURED the argumentation is, not whether the conclusions
// are correct (judging correctness reliably is beyond any model, and most
// humans). Crucially, rhetoric alone must NOT score high.
const ARGUMENT_CRITERIA = [
  "Unsupported assertions or pure rhetoric",
  "A few reasons, but loose or mainly rhetorical",
  "Clear reasons with a coherent logical structure",
  "Rigorous: structured reasoning, real evidence, counterpoints addressed"
];
const ARGUMENT_INSTRUCTIONS =
  "Rate how well the article supports its claims with well-structured " +
  "argumentation: explicit reasons, a clear logical structure, evidence or " +
  "examples that genuinely support the point, and engagement with " +
  "counterarguments. Do NOT be swayed by rhetorical force, emotive or vivid " +
  "language, a confident tone, or examples used only as decoration — none of " +
  "these count as argument on their own. A fluent, persuasive-sounding piece " +
  "that only asserts must score low. Judge the structure and strength of the " +
  "reasoning, not how persuasive it sounds and not whether the conclusions are " +
  "correct.";

// Choice used only when the local extractor is unsure the page is an article.
const PAGE_TYPE_OPTIONS = ["single article", "feed or listing", "other"];
const PAGE_TYPE_INSTRUCTIONS =
  "What kind of page is this text taken from? Choose 'single article' only " +
  "if it is one coherent article or essay; 'feed or listing' for home pages, " +
  "social feeds, search results or link lists; otherwise 'other'.";

// Reads the chosen option from Jev's Choice answer, tolerating field variants.
function readChoice(ans) {
  if (!ans) return null;
  for (const k of ["choice", "option", "value", "label", "answer"]) {
    if (typeof ans[k] === "string") return ans[k];
  }
  // Fallback: highest-probability entry.
  const probs = ans.probabilities || ans.probs;
  if (probs && typeof probs === "object") {
    let best = null, bestP = -1;
    for (const [k, v] of Object.entries(probs)) {
      if (typeof v === "number" && v > bestP) { bestP = v; best = k; }
    }
    return best;
  }
  return null;
}

function normalizeArgument(ans) {
  if (!ans || typeof ans.score !== "number") {
    throw new Error("Jev response has no 'score' field.");
  }
  const levels = ARGUMENT_CRITERIA.length; // 4
  const raw = ans.score; // 0..3, probability-weighted
  const score = Math.max(0, Math.min(100, Math.round((raw / (levels - 1)) * 100)));
  const levelIndex = Math.max(0, Math.min(levels - 1, Math.round(raw)));
  return {
    score,
    levelIndex,
    levels,
    confidence: typeof ans.confidence === "number" ? ans.confidence : null
  };
}

async function callJev(text, apiKey, withChoice) {
  const questions = {
    argument: {
      type: "score",
      instructions: ARGUMENT_INSTRUCTIONS,
      criteria: ARGUMENT_CRITERIA
    }
  };
  if (withChoice) {
    questions.page_type = {
      type: "choice",
      instructions: PAGE_TYPE_INSTRUCTIONS,
      options: PAGE_TYPE_OPTIONS
    };
  }

  const res = await fetch(JEV_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model: JEV_MODEL, state: text, questions })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const answers = data.answers || data;

  const result = { argument: normalizeArgument(answers.argument) };
  if (withChoice) {
    const choice = readChoice(answers.page_type);
    result.pageType = {
      choice,
      isArticle: choice === "single article",
      confidence: answers.page_type && typeof answers.page_type.confidence === "number"
        ? answers.page_type.confidence
        : null
    };
  }
  return result;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "scoreArticle") {
    (async () => {
      try {
        const { apiKey } = await chrome.storage.local.get("apiKey");
        if (!apiKey) {
          sendResponse({ ok: false, error: "Missing Jev API key." });
          return;
        }
        const result = await callJev(msg.text || "", apiKey, !!msg.withChoice);
        sendResponse({ ok: true, result });
      } catch (e) {
        sendResponse({ ok: false, error: String(e.message || e) });
      }
    })();
    return true; // async response
  }
});
