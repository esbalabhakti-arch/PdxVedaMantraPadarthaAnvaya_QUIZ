/* -------------------------------------------------------
   Veda Podcast Learning Check Quiz
   - Auto-lists Images/*_quiz.docx via GitHub API
   - Parses 50 MCQs from DOCX (based on your current format)
   - Runs quiz in sets of 10 + Review Missed pool
-------------------------------------------------------- */

/* === IMPORTANT: repo config (must match your deployed repo) ===
   Your link shows:
   https://esbalabhakti-arch.github.io/PdxVedaMantraPadarthaAnvaya_QUIZ/

   So:
   OWNER = esbalabhakti-arch
   REPO  = PdxVedaMantraPadarthaAnvaya_QUIZ
   BRANCH= main
   PATH  = Images   (case-sensitive!)
*/
const GITHUB_OWNER = "esbalabhakti-arch";
const GITHUB_REPO = "PdxVedaMantraPadarthaAnvaya_QUIZ";
const GITHUB_BRANCH = "main";
const QUIZ_FOLDER = "Images"; // must match your folder name exactly

/* Optional: nicer display names (you can add more later).
   Keys are filenames (exact). If missing, we auto-generate a readable name.
*/
const TITLE_OVERRIDES = {
  "101_Intro_1_quiz.docx": "101 — Introduction (Part 1)",
  "102_Intro_2_quiz.docx": "102 — Introduction (Part 2)",
  "103_1st_Panchadi_quiz.docx": "103 — First Piñcati of Arunam"
};

const $ = (id) => document.getElementById(id);

// UI
const podcastSelect = $("podcastSelect");
const setToggle = $("setToggle");
const statusPill = $("statusPill");
const helperText = $("helperText");

const btnStart = $("btnStart");
const btnFinish = $("btnFinish");

const scorePill = $("scorePill");
const missedPill = $("missedPill");

const questionWrap = $("questionWrap");
const qTitle = $("qTitle");
const qText = $("qText");
const opts = $("opts");
const feedback = $("feedback");
const btnCheck = $("btnCheck");
const btnNext = $("btnNext");

// State
let library = [];            // [{file, title, url}]
let allQuestions = [];       // parsed questions for selected podcast
let activeSet = 1;           // 1..5 or "missed"
let setQuestions = [];       // current set slice
let qIndex = 0;

let attempted = 0;
let correct = 0;
let firstTryCorrect = 0;

let currentQ = null;
let selectedLetter = null;
let lockedCorrect = false;
let attemptCountThisQ = 0;

// For "ask again at end" behavior
// missedPool holds question objects user got wrong at least once.
const missedPool = new Map(); // key: q.key, value: question object
const firstTryWrong = new Set(); // key: q.key if wrong at least once

// ----------------------------------------------------
// Helpers
// ----------------------------------------------------
function setStatus(msg) {
  if (statusPill) statusPill.textContent = msg;
}

function updateScoreUI() {
  scorePill.textContent = `Correct: ${correct} • Attempted: ${attempted} • First-try: ${firstTryCorrect}`;
  missedPill.textContent = `In Review Missed pool: ${missedPool.size}`;
}

function setActiveSetUI(which) {
  [...setToggle.querySelectorAll("button")].forEach(b => {
    const v = b.dataset.set;
    b.classList.remove("active");
    b.classList.add("ghost");
    if (String(v) === String(which)) {
      b.classList.add("active");
      b.classList.remove("ghost");
    }
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizeSpaces(s) {
  return String(s || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ----------------------------------------------------
// GitHub listing (auto-picks up new docx files)
// ----------------------------------------------------
async function listQuizFilesFromGitHub() {
  // GitHub Contents API (public repos):
  // https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={branch}
  const api = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${QUIZ_FOLDER}?ref=${GITHUB_BRANCH}`;
  const res = await fetch(api, { cache: "no-cache" });

  if (!res.ok) {
    throw new Error(
      `Could not list quiz files from GitHub.\n` +
      `API: ${api}\n` +
      `HTTP ${res.status} ${res.statusText}\n\n` +
      `Check repo name, branch, and folder name (Images vs images).`
    );
  }

  const items = await res.json();

  const docx = (items || [])
    .filter(it => it && it.type === "file")
    .map(it => it.name)
    .filter(name => name.toLowerCase().endsWith(".docx"))
    .filter(name => name.toLowerCase().endsWith("_quiz.docx"));

  // sort by numeric prefix if present
  docx.sort((a, b) => {
    const na = parseInt(a.split("_")[0], 10);
    const nb = parseInt(b.split("_")[0], 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });

  return docx;
}

function prettyTitleFromFilename(name) {
  if (TITLE_OVERRIDES[name]) return TITLE_OVERRIDES[name];

  // 101_Intro_1_quiz.docx -> "101 — Intro 1"
  const base = name.replace(/_quiz\.docx$/i, "");
  const parts = base.split("_");
  const maybeNum = parts[0];
  const rest = parts.slice(1).join(" ").replace(/\s+/g, " ").trim();
  if (/^\d+$/.test(maybeNum)) return `${maybeNum} — ${titleCase(rest)}`;
  return titleCase(rest || base);
}

function titleCase(s) {
  return String(s || "")
    .split(" ")
    .map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w)
    .join(" ");
}

function buildLibrary(filenames) {
  return filenames.map(file => ({
    file,
    title: prettyTitleFromFilename(file),
    // Use relative URL (works on GitHub Pages, case-sensitive folder):
    url: `${QUIZ_FOLDER}/${file}`
  }));
}

function populatePodcastSelect() {
  podcastSelect.innerHTML = "";

  if (!library.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(No quiz files found)";
    podcastSelect.appendChild(opt);
    return;
  }

  for (const item of library) {
    const opt = document.createElement("option");
    opt.value = item.file;
    opt.textContent = item.title;
    podcastSelect.appendChild(opt);
  }
}

// ----------------------------------------------------
// DOCX parsing (uses mammoth raw text)
// Expected pattern in your docx (based on uploaded file):
// 1.
// Question text... [(Source: ...)]
// A. ...
// B. ...
// C. ...
// D. ...
// Correct Answer: B
// Check: ...
// ----------------------------------------------------
async function fetchDocxRawText(url) {
  if (!window.mammoth) {
    throw new Error("mammoth.js did not load (internet blocked or script tag missing).");
  }

  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(
      `Could not fetch quiz DOCX: ${url}\n` +
      `HTTP ${res.status} ${res.statusText}\n\n` +
      `Check that the file exists and folder name matches exactly (Images vs images).`
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return normalizeSpaces(result.value || "");
}

function parseQuestionsFromRawText(raw) {
  const questions = [];

  // Split into question blocks by "\n<number>.\n"
  const reBlock = /(?:^|\n)(\d+)\.\s*\n([\s\S]*?)(?=\n\d+\.\s*\n|$)/g;
  let m;

  while ((m = reBlock.exec(raw)) !== null) {
    const num = parseInt(m[1], 10);
    const block = m[2].trim();

    // Correct Answer
    const ansMatch = block.match(/Correct Answer:\s*([A-D])/i);
    if (!ansMatch) continue;
    const correctLetter = ansMatch[1].toUpperCase();

    // Check explanation
    let checkText = "";
    const checkMatch = block.match(/Check:\s*([\s\S]*)$/i);
    if (checkMatch) checkText = checkMatch[1].trim();

    // Before Correct Answer is stem + options
    const beforeCorrect = block.split(/Correct Answer:/i)[0].trim();

    // Extract options lines
    const optMatches = [...beforeCorrect.matchAll(/\n([A-D])\.\s*([^\n]*)/g)];
    if (optMatches.length < 2) {
      // Sometimes options could be in same line; try alternate:
      // "A. ...\nB. ..." is typical; if missing, skip
      continue;
    }

    const options = {};
    for (const om of optMatches) {
      options[om[1].toUpperCase()] = (om[2] || "").trim();
    }

    // Question stem is everything before first "\nA."
    const stem = beforeCorrect.split(/\nA\.\s*/)[0].trim();

    // Try source filename from [(Source: ...)]
    let source = "";
    const src = stem.match(/\[\(Source:\s*([^\]]+)\)\]/i);
    if (src) source = src[1].replace(/\)\]/g, "").trim();

    const cleanStem = stem.replace(/\[\(Source:[\s\S]*?\)\]/gi, "").trim();

    questions.push({
      key: `Q${num}`,
      number: num,
      text: cleanStem,
      options: {
        A: options.A || "",
        B: options.B || "",
        C: options.C || "",
        D: options.D || ""
      },
      answer: correctLetter,
      check: checkText,
      source
    });
  }

  // Sort by question number
  questions.sort((a, b) => a.number - b.number);

  return questions;
}

// ----------------------------------------------------
// Sets logic (1..5 of 10 questions) + Review Missed
// ----------------------------------------------------
function getSetSlice(all, setNum) {
  const start = (setNum - 1) * 10;
  return all.slice(start, start + 10);
}

function currentSetName() {
  if (activeSet === "missed") return "Review Missed";
  return `Set ${activeSet}`;
}

function updateSetButtonLabels() {
  // Subtle labels: Set 1..5 (no yellow, no bold screaming)
  const total = allQuestions.length;

  for (let i = 1; i <= 5; i++) {
    const btn = setToggle.querySelector(`button[data-set="${i}"]`);
    if (!btn) continue;

    const slice = getSetSlice(allQuestions, i);
    if (slice.length) {
      const a = (i - 1) * 10 + 1;
      const b = (i - 1) * 10 + slice.length;
      btn.textContent = `Set ${i} (Q${a}–${b})`;
      btn.disabled = false;
      btn.style.opacity = "";
    } else {
      // If fewer questions than needed
      btn.textContent = `Set ${i}`;
      btn.disabled = true;
      btn.style.opacity = "0.45";
    }
  }

  const missedBtn = setToggle.querySelector(`button[data-set="missed"]`);
  if (missedBtn) {
    missedBtn.textContent = `Review Missed (${missedPool.size})`;
  }
}

// ----------------------------------------------------
// Quiz flow
// ----------------------------------------------------
function resetSessionStats() {
  attempted = 0;
  correct = 0;
  firstTryCorrect = 0;
  lockedCorrect = false;
  attemptCountThisQ = 0;
  selectedLetter = null;
  currentQ = null;
  qIndex = 0;

  // Keep missedPool across sets in a session (as requested)
  // But clear firstTryWrong for accurate session stats if you want:
  firstTryWrong.clear();

  updateScoreUI();
}

function prepareQuestionList() {
  if (activeSet === "missed") {
    setQuestions = [...missedPool.values()];
  } else {
    setQuestions = getSetSlice(allQuestions, activeSet);
  }

  qIndex = 0;
}

function showIntroMessage() {
  questionWrap.style.display = "none";
  feedback.style.display = "none";
  btnCheck.disabled = true;
  btnNext.disabled = true;

  helperText.textContent = `Select a podcast, pick a set, then press Start.`;
  setStatus(`${currentSetName()} • Ready`);
  updateSetButtonLabels();
  updateScoreUI();
}

function renderQuestion(q) {
  currentQ = q;
  selectedLetter = null;
  lockedCorrect = false;
  attemptCountThisQ = 0;

  questionWrap.style.display = "block";
  feedback.style.display = "none";
  feedback.className = "feedback";
  feedback.textContent = "";

  btnCheck.disabled = true;
  btnNext.disabled = true;

  qTitle.textContent =
    (activeSet === "missed")
      ? `Review Missed — ${q.key}`
      : `${currentSetName()} — ${q.key}`;

  qText.textContent = q.text;

  opts.innerHTML = "";
  const letters = ["A", "B", "C", "D"].filter(L => (q.options[L] || "").trim().length);

  letters.forEach((L) => {
    const div = document.createElement("label");
    div.className = "opt";
    div.dataset.letter = L;

    div.innerHTML = `
      <input type="radio" name="opt" value="${L}" />
      <span><b>${L}.</b> ${escapeHtml(q.options[L])}</span>
    `;

    div.addEventListener("click", () => {
      // UI selection
      [...opts.querySelectorAll(".opt")].forEach(x => x.classList.remove("selected"));
      div.classList.add("selected");

      const input = div.querySelector("input");
      input.checked = true;

      selectedLetter = L;
      btnCheck.disabled = false;
      setStatus(`${currentSetName()} • Answer selected`);
    });

    opts.appendChild(div);
  });

  setStatus(`${currentSetName()} • Question ${qIndex + 1}/${setQuestions.length}`);
}

function showFeedbackGood(text) {
  feedback.style.display = "block";
  feedback.className = "feedback good";
  feedback.textContent = text;
}

function showFeedbackBad(text) {
  feedback.style.display = "block";
  feedback.className = "feedback bad";
  feedback.textContent = text;
}

function encourageLine() {
  const lines = [
    "Nice! ✅",
    "Good job! 🌟",
    "Super! 🙌",
    "Great focus! 💪",
    "Well done! 🎉"
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

function checkAnswer() {
  if (!currentQ || !selectedLetter) return;

  attempted += 1;
  attemptCountThisQ += 1;

  const isCorrect = selectedLetter === currentQ.answer;

  if (isCorrect) {
    correct += 1;

    if (attemptCountThisQ === 1 && !firstTryWrong.has(currentQ.key)) {
      firstTryCorrect += 1;
    }

    // If it was in missedPool and answered correctly now, remove it (for Review Missed cleanup)
    if (missedPool.has(currentQ.key)) {
      missedPool.delete(currentQ.key);
    }

    lockedCorrect = true;

    const checkExplain = currentQ.check ? `\n\nCheck: ${currentQ.check}` : "";
    showFeedbackGood(`${encourageLine()} Correct answer: ${currentQ.answer}.${checkExplain}`);

    btnNext.disabled = false;
    btnCheck.disabled = true;

  } else {
    // Mark for missed review
    firstTryWrong.add(currentQ.key);
    missedPool.set(currentQ.key, currentQ);

    showFeedbackBad(
      `Not quite. ❌ Try again.\n\nTip: Re-read the question carefully and pick the best match.`
    );

    // Do NOT allow Next until correct
    btnNext.disabled = true;
    btnCheck.disabled = false;
  }

  updateSetButtonLabels();
  updateScoreUI();
}

function nextQuestion() {
  if (!lockedCorrect) return;

  qIndex += 1;
  if (qIndex >= setQuestions.length) {
    finishSet();
    return;
  }

  renderQuestion(setQuestions[qIndex]);
}

function finishSet() {
  questionWrap.style.display = "none";
  btnCheck.disabled = true;
  btnNext.disabled = true;

  const missedCount = missedPool.size;

  const msg =
    `Finished ${currentSetName()}.\n\n` +
    `Session so far:\n` +
    `• Attempted: ${attempted}\n` +
    `• Correct: ${correct}\n` +
    `• First-try correct: ${firstTryCorrect}\n` +
    `• In Review Missed pool: ${missedCount}\n\n` +
    (missedCount
      ? `Want a challenge? Try "Review Missed" to clean up mistakes 💪`
      : `Perfect run so far — nice work! 🌟`);

  feedback.style.display = "block";
  feedback.className = "feedback good";
  feedback.textContent = msg;

  setStatus(`${currentSetName()} • Finished`);
  helperText.textContent = `Finished. You can pick another set, or Review Missed.`;
  updateSetButtonLabels();
  updateScoreUI();
}

// ----------------------------------------------------
// Load selected podcast quiz file
// ----------------------------------------------------
async function loadSelectedPodcast() {
  const file = podcastSelect.value;
  const item = library.find(x => x.file === file);
  if (!item) {
    allQuestions = [];
    showIntroMessage();
    return;
  }

  setStatus("Loading quiz DOCX…");
  helperText.textContent = "Loading questions…";

  try {
    const raw = await fetchDocxRawText(item.url);
    const qs = parseQuestionsFromRawText(raw);

    if (!qs.length) {
      throw new Error(
        `No questions parsed.\n\n` +
        `This usually means the DOCX format changed.\n` +
        `Your current parser expects:\n` +
        `1. (on its own line)\n` +
        `Question text\n` +
        `A. ... B. ... C. ... D. ...\n` +
        `Correct Answer: X\n` +
        `Check: ...`
      );
    }

    allQuestions = qs;

    // Reset UI set (keep missed pool across podcast? usually no)
    missedPool.clear();
    firstTryWrong.clear();

    updateSetButtonLabels();
    setStatus("Ready");
    helperText.textContent = `Loaded ${allQuestions.length} questions. Pick a set and press Start.`;
    updateScoreUI();

    // Keep current set selection but clamp if disabled
    if (activeSet !== "missed") {
      const slice = getSetSlice(allQuestions, activeSet);
      if (!slice.length) {
        activeSet = 1;
        setActiveSetUI(1);
      }
    }

    showIntroMessage();
  } catch (err) {
    allQuestions = [];
    missedPool.clear();

    setStatus("Error");
    helperText.textContent = "Could not load questions.";
    feedback.style.display = "block";
    feedback.className = "feedback bad";
    feedback.textContent = String(err);

    updateSetButtonLabels();
    updateScoreUI();
  }
}

// ----------------------------------------------------
// Event Wiring
// ----------------------------------------------------
podcastSelect.addEventListener("change", async () => {
  await loadSelectedPodcast();
});

setToggle.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const which = btn.dataset.set;
  if (btn.disabled) return;

  activeSet = (which === "missed") ? "missed" : parseInt(which, 10);
  setActiveSetUI(which);

  // Don’t auto-start; user presses Start
  showIntroMessage();
});

btnStart.addEventListener("click", () => {
  if (!allQuestions.length) return;

  setStatus(`${currentSetName()} • Starting…`);
  feedback.style.display = "none";
  feedback.textContent = "";
  btnNext.disabled = true;
  btnCheck.disabled = true;

  // Reset per-run stats (keep missedPool across sets; keep session totals)
  // If you want totals across multiple sets in one sitting, do NOT reset:
  // For now: keep session totals across sets, as you wanted "session so far".
  // So we do NOT reset attempted/correct here.
  // If first start and everything is 0, fine.
  if (attempted === 0 && correct === 0 && firstTryCorrect === 0) {
    updateScoreUI();
  }

  prepareQuestionList();

  if (activeSet === "missed" && setQuestions.length === 0) {
    feedback.style.display = "block";
    feedback.className = "feedback";
    feedback.textContent = "No missed questions yet 🙂 Pick a set first, then come back here.";
    setStatus("Review Missed • Empty");
    return;
  }

  renderQuestion(setQuestions[qIndex]);
});

btnFinish.addEventListener("click", () => {
  questionWrap.style.display = "none";
  btnCheck.disabled = true;
  btnNext.disabled = true;

  const msg =
    `Nice work! ✅\n\n` +
    `Session summary:\n` +
    `• Attempted: ${attempted}\n` +
    `• Correct: ${correct}\n` +
    `• First-try correct: ${firstTryCorrect}\n` +
    `• In Review Missed pool: ${missedPool.size}\n\n` +
    `Keep going — consistency beats intensity 🌟`;

  feedback.style.display = "block";
  feedback.className = "feedback good";
  feedback.textContent = msg;

  setStatus("Finished");
  helperText.textContent = "Finished. You can pick another set or podcast and press Start.";
  updateSetButtonLabels();
  updateScoreUI();
});

btnCheck.addEventListener("click", () => {
  checkAnswer();
});

btnNext.addEventListener("click", () => {
  nextQuestion();
});

// ----------------------------------------------------
// Init
// ----------------------------------------------------
(async function init() {
  setStatus("Initializing…");
  helperText.textContent = "Initializing…";
  updateScoreUI();

  try {
    const files = await listQuizFilesFromGitHub();
    library = buildLibrary(files);

    populatePodcastSelect();

    // default select first
    if (library.length) {
      podcastSelect.value = library[0].file;
      await loadSelectedPodcast();
    } else {
      setStatus("No quiz files found");
      helperText.textContent = `No *_quiz.docx files found in ${QUIZ_FOLDER}/.`;
    }

    // default set
    activeSet = 1;
    setActiveSetUI(1);
    showIntroMessage();
  } catch (err) {
    setStatus("Error");
    helperText.textContent = "Initialization failed.";

    feedback.style.display = "block";
    feedback.className = "feedback bad";
    feedback.textContent =
      String(err) +
      `\n\nFix checklist:\n` +
      `1) Repo name correct in script.js\n` +
      `2) Branch is 'main'\n` +
      `3) Folder name is exactly 'Images'\n` +
      `4) Files end with '_quiz.docx'\n`;

    populatePodcastSelect();
  }
})();
