/* -------------------------------------------------------
   Veda Podcast Learning Check Quiz
   Fixes:
   - If Start does nothing, we now show WHY (errorBox).
   - DOCX parser made more tolerant to formatting variations.
-------------------------------------------------------- */

const GITHUB_OWNER = "esbalabhakti-arch";
const GITHUB_REPO = "PdxVedaMantraPadarthaAnvaya_QUIZ";
const GITHUB_BRANCH = "main";
const QUIZ_FOLDER = "Images"; // case-sensitive

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

const errorBox = $("errorBox");

// State
let library = [];
let allQuestions = [];
let activeSet = 1;
let setQuestions = [];
let qIndex = 0;

let attempted = 0;
let correct = 0;
let firstTryCorrect = 0;

let currentQ = null;
let selectedLetter = null;
let lockedCorrect = false;
let attemptCountThisQ = 0;

const missedPool = new Map();
const firstTryWrong = new Set();

function setStatus(msg) { statusPill.textContent = msg; }

function showError(msg) {
  errorBox.style.display = "block";
  errorBox.textContent = msg;
}
function clearError() {
  errorBox.style.display = "none";
  errorBox.textContent = "";
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

function normalizeSpaces(s) {
  return String(s || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/* ---------------- GitHub listing ---------------- */
async function listQuizFilesFromGitHub() {
  const api = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${QUIZ_FOLDER}?ref=${GITHUB_BRANCH}`;
  const res = await fetch(api, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(
      `Could not list quiz files from GitHub.\n` +
      `API: ${api}\nHTTP ${res.status} ${res.statusText}\n\n` +
      `Double-check:\n- repo name\n- branch (main)\n- folder name (Images with capital I)\n`
    );
  }
  const items = await res.json();

  const docx = (items || [])
    .filter(it => it && it.type === "file")
    .map(it => it.name)
    .filter(name => name.toLowerCase().endsWith("_quiz.docx"));

  docx.sort((a, b) => a.localeCompare(b));
  return docx;
}

function titleCase(s) {
  return String(s || "")
    .split(" ")
    .map(w => w ? (w[0].toUpperCase() + w.slice(1)) : w)
    .join(" ");
}

function prettyTitleFromFilename(name) {
  if (TITLE_OVERRIDES[name]) return TITLE_OVERRIDES[name];

  const base = name.replace(/_quiz\.docx$/i, "");
  const parts = base.split("_");
  const maybeNum = parts[0];
  const rest = parts.slice(1).join(" ").trim();
  if (/^\d+$/.test(maybeNum)) return `${maybeNum} — ${titleCase(rest)}`;
  return titleCase(rest || base);
}

function buildLibrary(filenames) {
  return filenames.map(file => ({
    file,
    title: prettyTitleFromFilename(file),
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

/* ---------------- DOCX load + parse ---------------- */
async function fetchDocxRawText(url) {
  if (!window.mammoth) {
    throw new Error("mammoth.js did not load. (The unpkg script might have been blocked.)");
  }
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(
      `Could not fetch DOCX: ${url}\nHTTP ${res.status} ${res.statusText}\n\n` +
      `Most common causes:\n- Folder name case mismatch (Images vs images)\n- Filename case mismatch\n`
    );
  }
  const arrayBuffer = await res.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return normalizeSpaces(result.value || "");
}

/*
  More tolerant parser:
  - Supports: "1." either on its own line OR followed by text on same line
  - Options can have leading spaces
  - Extracts:
      A. ...
      B. ...
      C. ...
      D. ...
    and "Correct Answer: X"
    and optional "Check: ..."
*/
function parseQuestionsFromRawText(raw) {
  const questions = [];

  // Split into blocks: number dot then content until next number dot
  const reBlock = /(?:^|\n)\s*(\d+)\.\s*([\s\S]*?)(?=(?:\n\s*\d+\.\s)|$)/g;
  let m;

  while ((m = reBlock.exec(raw)) !== null) {
    const num = parseInt(m[1], 10);
    const block = (m[2] || "").trim();
    if (!block) continue;

    const ansMatch = block.match(/Correct Answer:\s*([A-D])/i);
    if (!ansMatch) continue;
    const correctLetter = ansMatch[1].toUpperCase();

    // Check explanation (optional)
    let checkText = "";
    const checkMatch = block.match(/Check:\s*([\s\S]*)$/i);
    if (checkMatch) checkText = (checkMatch[1] || "").trim();

    // Everything before Correct Answer
    const beforeCorrect = block.split(/Correct Answer:/i)[0].trim();

    // Options
    const optMatches = [...beforeCorrect.matchAll(/(?:^|\n)\s*([A-D])\.\s*([^\n]+)/g)];
    if (optMatches.length < 2) continue;

    const options = { A:"", B:"", C:"", D:"" };
    for (const om of optMatches) {
      options[om[1].toUpperCase()] = (om[2] || "").trim();
    }

    // Stem: everything before first option "A."
    const idxA = beforeCorrect.search(/(?:^|\n)\s*A\.\s*/);
    const stem = idxA >= 0 ? beforeCorrect.slice(0, idxA).trim() : beforeCorrect.trim();

    // Remove optional source tag pattern
    const cleanStem = stem.replace(/\[\(Source:[\s\S]*?\)\]/gi, "").trim();

    questions.push({
      key: `Q${num}`,
      number: num,
      text: cleanStem,
      options,
      answer: correctLetter,
      check: checkText
    });
  }

  questions.sort((a, b) => a.number - b.number);
  return questions;
}

/* ---------------- Sets ---------------- */
function getSetSlice(all, setNum) {
  const start = (setNum - 1) * 10;
  return all.slice(start, start + 10);
}
function currentSetName() {
  if (activeSet === "missed") return "Review Missed";
  return `Set ${activeSet}`;
}
function updateSetButtonLabels() {
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
      btn.textContent = `Set ${i}`;
      btn.disabled = true;
      btn.style.opacity = "0.45";
    }
  }

  const missedBtn = setToggle.querySelector(`button[data-set="missed"]`);
  if (missedBtn) missedBtn.textContent = `Review Missed (${missedPool.size})`;
}

/* ---------------- Quiz flow ---------------- */
function showIntroMessage() {
  clearError();
  questionWrap.style.display = "none";
  feedback.style.display = "none";
  btnCheck.disabled = true;
  btnNext.disabled = true;

  helperText.textContent = "Select a podcast, pick a set, then press Start.";
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
  const letters = ["A","B","C","D"].filter(L => (q.options[L] || "").trim().length);

  letters.forEach(L => {
    const div = document.createElement("label");
    div.className = "opt";
    div.dataset.letter = L;

    div.innerHTML = `
      <input type="radio" name="opt" value="${L}" />
      <span><b>${L}.</b> ${escapeHtml(q.options[L])}</span>
    `;

    div.addEventListener("click", () => {
      [...opts.querySelectorAll(".opt")].forEach(x => x.classList.remove("selected"));
      div.classList.add("selected");
      div.querySelector("input").checked = true;

      selectedLetter = L;
      btnCheck.disabled = false;
      setStatus(`${currentSetName()} • Answer selected`);
    });

    opts.appendChild(div);
  });

  setStatus(`${currentSetName()} • Question ${qIndex + 1}/${setQuestions.length}`);
}

function encourageLine() {
  const lines = ["Nice! ✅","Good job! 🌟","Super! 🙌","Great focus! 💪","Well done! 🎉"];
  return lines[Math.floor(Math.random() * lines.length)];
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

    if (missedPool.has(currentQ.key)) missedPool.delete(currentQ.key);

    lockedCorrect = true;

    const checkExplain = currentQ.check ? `\n\nCheck: ${currentQ.check}` : "";
    showFeedbackGood(`${encourageLine()} Correct answer: ${currentQ.answer}.${checkExplain}`);

    btnNext.disabled = false;
    btnCheck.disabled = true;
  } else {
    firstTryWrong.add(currentQ.key);
    missedPool.set(currentQ.key, currentQ);
    showFeedbackBad("Not quite. ❌ Try again.\n\nTip: Re-read the question carefully and pick the best match.");
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
    questionWrap.style.display = "none";
    btnCheck.disabled = true;
    btnNext.disabled = true;

    showFeedbackGood(
      `Finished ${currentSetName()}.\n\n` +
      `Session so far:\n` +
      `• Attempted: ${attempted}\n` +
      `• Correct: ${correct}\n` +
      `• First-try correct: ${firstTryCorrect}\n` +
      `• In Review Missed pool: ${missedPool.size}\n\n` +
      (missedPool.size ? `Try "Review Missed" to clean up mistakes 💪` : `Perfect run so far — nice work! 🌟`)
    );

    setStatus(`${currentSetName()} • Finished`);
    helperText.textContent = "Finished. You can pick another set, or Review Missed.";
    updateSetButtonLabels();
    updateScoreUI();
    return;
  }

  renderQuestion(setQuestions[qIndex]);
}

function prepareQuestionList() {
  if (activeSet === "missed") setQuestions = [...missedPool.values()];
  else setQuestions = getSetSlice(allQuestions, activeSet);
  qIndex = 0;
}

/* ---------------- Podcast load ---------------- */
async function loadSelectedPodcast() {
  clearError();

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
        `No questions parsed from:\n${item.url}\n\n` +
        `This means the DOCX format did not match what the parser expects.\n` +
        `If you want, open the DOCX and confirm it contains:\n` +
        `1. ...\nA. ...\nB. ...\nCorrect Answer: X\nCheck: ...`
      );
    }

    allQuestions = qs;

    // reset missed per podcast
    missedPool.clear();
    firstTryWrong.clear();

    updateSetButtonLabels();
    updateScoreUI();

    helperText.textContent = `Loaded ${allQuestions.length} questions. Pick a set and press Start.`;
    setStatus("Ready");
    showIntroMessage();
  } catch (err) {
    allQuestions = [];
    missedPool.clear();
    updateSetButtonLabels();
    updateScoreUI();

    setStatus("Error");
    helperText.textContent = "Could not load questions.";
    showError(String(err));
  }
}

/* ---------------- Events ---------------- */
podcastSelect.addEventListener("change", async () => {
  await loadSelectedPodcast();
});

setToggle.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn || btn.disabled) return;

  const which = btn.dataset.set;
  activeSet = (which === "missed") ? "missed" : parseInt(which, 10);
  setActiveSetUI(which);
  showIntroMessage();
});

btnStart.addEventListener("click", () => {
  clearError();

  if (!allQuestions.length) {
    showError(
      "Start did nothing because no questions were loaded.\n\n" +
      "Fix checklist:\n" +
      "1) Confirm DOCX files exist inside Images/ folder\n" +
      "2) Filenames end with _quiz.docx\n" +
      "3) Open DevTools → Console for fetch/mammoth errors\n"
    );
    return;
  }

  prepareQuestionList();

  if (activeSet === "missed" && setQuestions.length === 0) {
    showFeedbackBad("No missed questions yet 🙂 Pick a set first, then come back to Review Missed.");
    setStatus("Review Missed • Empty");
    return;
  }

  if (!setQuestions.length) {
    showError(`No questions in ${currentSetName()}.\n(Probably fewer than ${(activeSet-1)*10 + 1} questions exist.)`);
    return;
  }

  feedback.style.display = "none";
  renderQuestion(setQuestions[qIndex]);
});

btnFinish.addEventListener("click", () => {
  questionWrap.style.display = "none";
  btnCheck.disabled = true;
  btnNext.disabled = true;

  showFeedbackGood(
    `Nice work! ✅\n\n` +
    `Session summary:\n` +
    `• Attempted: ${attempted}\n` +
    `• Correct: ${correct}\n` +
    `• First-try correct: ${firstTryCorrect}\n` +
    `• In Review Missed pool: ${missedPool.size}\n\n` +
    `Keep going — consistency beats intensity 🌟`
  );

  setStatus("Finished");
  helperText.textContent = "Finished. You can pick another set or podcast and press Start.";
  updateSetButtonLabels();
  updateScoreUI();
});

btnCheck.addEventListener("click", checkAnswer);
btnNext.addEventListener("click", nextQuestion);

/* ---------------- Init ---------------- */
(async function init() {
  setStatus("Initializing…");
  helperText.textContent = "Initializing…";
  updateScoreUI();

  try {
    const files = await listQuizFilesFromGitHub();
    library = buildLibrary(files);
    populatePodcastSelect();

    if (!library.length) {
      setStatus("No quiz files found");
      showError(`No *_quiz.docx found in ${QUIZ_FOLDER}/`);
      return;
    }

    podcastSelect.value = library[0].file;
    await loadSelectedPodcast();

    activeSet = 1;
    setActiveSetUI(1);
    showIntroMessage();
  } catch (err) {
    setStatus("Error");
    helperText.textContent = "Initialization failed.";
    showError(String(err));
  }
})();
