/* -------------------------------------------------------
   Veda Podcast Learning Check Quiz
   Complete implementation with DOCX parsing and tracking
-------------------------------------------------------- */

const GITHUB_OWNER = "esbalabhakti-arch";
const GITHUB_REPO = "PdxVedaMantraPadarthaAnvaya_QUIZ";
const GITHUB_BRANCH = "main";
const QUIZ_FOLDER = "Images";

const TITLE_OVERRIDES = {
  "101_Intro_1_quiz.docx": "101 — Introduction (Part 1)",
  "102_Intro_2_quiz.docx": "102 — Introduction (Part 2)",
  "103_1st_Panchadi_quiz.docx": "103 — First Pañcati of Aruṇam"
};

const $ = (id) => document.getElementById(id);

// UI Elements
const podcastSelect = $("podcastSelect");
const setToggle = $("setToggle");
const modePill = $("modePill");
const mainMsg = $("mainMsg");
const startBtn = $("startBtn");
const finishBtn = $("finishBtn");
const scoreCorrect = $("scoreCorrect");
const scoreAttempted = $("scoreAttempted");
const scoreFirstTry = $("scoreFirstTry");
const qBox = $("qBox");
const qTitle = $("qTitle");
const qMeta = $("qMeta");
const options = $("options");
const checkBtn = $("checkBtn");
const nextBtn = $("nextBtn");
const resultBox = $("resultBox");

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

const missedQuestionsSet = new Set();

/* ---------------- Utility Functions ---------------- */
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

function setStatus(msg) {
  modePill.textContent = msg;
}

function updateScoreUI() {
  scoreCorrect.textContent = `Correct: ${correct}`;
  scoreAttempted.textContent = `Attempted: ${attempted}`;
  scoreFirstTry.textContent = `First-try: ${firstTryCorrect}`;
}

function setActiveSetUI(which) {
  [...setToggle.querySelectorAll("button")].forEach(b => {
    const v = b.dataset.set;
    b.classList.remove("active");
    if (String(v) === String(which)) {
      b.classList.add("active");
    }
  });
}

/* ---------------- GitHub File Listing ---------------- */
async function listQuizFilesFromGitHub() {
  const api = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${QUIZ_FOLDER}?ref=${GITHUB_BRANCH}`;
  try {
    const res = await fetch(api, { cache: "no-cache" });
    if (!res.ok) {
      throw new Error(`Could not list quiz files from GitHub. HTTP ${res.status}`);
    }
    const items = await res.json();

    const docx = (items || [])
      .filter(it => it && it.type === "file")
      .map(it => it.name)
      .filter(name => name.toLowerCase().endsWith("_quiz.docx"));

    docx.sort((a, b) => a.localeCompare(b));
    return docx;
  } catch (err) {
    console.error("Error listing files:", err);
    return [];
  }
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
    url: `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${QUIZ_FOLDER}/${file}`
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

/* ---------------- DOCX Loading and Parsing ---------------- */
async function fetchDocxRawText(url) {
  if (!window.mammoth) {
    throw new Error("mammoth.js did not load.");
  }
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`Could not fetch DOCX: ${url}\nHTTP ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return normalizeSpaces(result.value || "");
}

function parseQuestionsFromRawText(raw) {
  const questions = [];
  
  // Split into blocks by question number
  const reBlock = /(?:^|\n)\s*(\d+)\.\s*([\s\S]*?)(?=(?:\n\s*\d+\.\s)|$)/g;
  let m;

  while ((m = reBlock.exec(raw)) !== null) {
    const num = parseInt(m[1], 10);
    const block = (m[2] || "").trim();
    if (!block) continue;

    // Extract correct answer
    const ansMatch = block.match(/Correct Answer:\s*([A-D])/i);
    if (!ansMatch) continue;
    const correctLetter = ansMatch[1].toUpperCase();

    // Extract check explanation (optional)
    let checkText = "";
    const checkMatch = block.match(/Check:\s*([\s\S]*)$/i);
    if (checkMatch) checkText = (checkMatch[1] || "").trim();

    // Everything before Correct Answer
    const beforeCorrect = block.split(/Correct Answer:/i)[0].trim();

    // Extract options A-D
    const optMatches = [...beforeCorrect.matchAll(/(?:^|\n)\s*([A-D])\.\s*([^\n]+)/g)];
    if (optMatches.length < 2) continue;

    const opts = { A:"", B:"", C:"", D:"" };
    for (const om of optMatches) {
      opts[om[1].toUpperCase()] = (om[2] || "").trim();
    }

    // Extract question stem (everything before first option)
    const idxA = beforeCorrect.search(/(?:^|\n)\s*A\.\s*/);
    const stem = idxA >= 0 ? beforeCorrect.slice(0, idxA).trim() : beforeCorrect.trim();
    
    // Remove source tags
    const cleanStem = stem.replace(/\[\(Source:[\s\S]*?\)\]/gi, "").trim();

    questions.push({
      key: `Q${num}`,
      number: num,
      text: cleanStem,
      options: opts,
      answer: correctLetter,
      check: checkText
    });
  }

  questions.sort((a, b) => a.number - b.number);
  return questions;
}

/* ---------------- Set Management ---------------- */
function getSetSlice(all, setNum) {
  const start = (setNum - 1) * 10;
  return all.slice(start, start + 10);
}

function currentSetName() {
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
}

/* ---------------- Quiz Flow ---------------- */
function showIntroMessage() {
  qBox.style.display = "none";
  resultBox.style.display = "none";
  checkBtn.disabled = true;
  nextBtn.disabled = true;

  mainMsg.style.display = "block";
  mainMsg.textContent = "Select a podcast, pick a set, then press Start.";
  setStatus(`${currentSetName()} • Ready`);
  updateSetButtonLabels();
  updateScoreUI();
}

function renderQuestion(q) {
  currentQ = q;
  selectedLetter = null;
  lockedCorrect = false;
  attemptCountThisQ = 0;

  qBox.style.display = "block";
  mainMsg.style.display = "none";
  resultBox.style.display = "none";
  resultBox.className = "result";
  resultBox.textContent = "";

  checkBtn.disabled = true;
  nextBtn.disabled = true;

  qTitle.textContent = `${currentSetName()} — ${q.key}`;
  qMeta.textContent = `Question ${qIndex + 1} of ${setQuestions.length}`;

  const qTextEl = document.createElement("div");
  qTextEl.textContent = q.text;
  qTextEl.style.marginBottom = "10px";
  
  options.innerHTML = "";
  options.parentNode.insertBefore(qTextEl, options);

  const letters = ["A","B","C","D"].filter(L => (q.options[L] || "").trim().length);

  letters.forEach(L => {
    const div = document.createElement("label");
    div.className = "opt";
    div.dataset.letter = L;

    div.innerHTML = `
      <input type="radio" name="opt" value="${L}" />
      <span class="txt"><b>${L}.</b> ${escapeHtml(q.options[L])}</span>
    `;

    div.addEventListener("click", () => {
      [...options.querySelectorAll(".opt")].forEach(x => x.classList.remove("selected"));
      div.classList.add("selected");
      div.querySelector("input").checked = true;

      selectedLetter = L;
      checkBtn.disabled = false;
      setStatus(`${currentSetName()} • Answer selected`);
    });

    options.appendChild(div);
  });

  setStatus(`${currentSetName()} • Question ${qIndex + 1}/${setQuestions.length}`);
}

function encourageLine() {
  const lines = ["Nice! ✅","Good job! 🌟","Super! 🙌","Great focus! 💪","Well done! 🎉"];
  return lines[Math.floor(Math.random() * lines.length)];
}

function showFeedbackGood(text) {
  resultBox.style.display = "block";
  resultBox.className = "result ok";
  resultBox.textContent = text;
}

function showFeedbackBad(text) {
  resultBox.style.display = "block";
  resultBox.className = "result bad";
  resultBox.textContent = text;
}

function checkAnswer() {
  if (!currentQ || !selectedLetter) return;

  attempted += 1;
  attemptCountThisQ += 1;

  const isCorrect = selectedLetter === currentQ.answer;

  if (isCorrect) {
    correct += 1;

    if (attemptCountThisQ === 1) {
      firstTryCorrect += 1;
    } else {
      missedQuestionsSet.add(currentQ.key);
    }

    lockedCorrect = true;

    const checkExplain = currentQ.check ? `\n\nCheck: ${currentQ.check}` : "";
    showFeedbackGood(`${encourageLine()} Correct answer: ${currentQ.answer}.${checkExplain}`);

    nextBtn.disabled = false;
    checkBtn.disabled = true;
  } else {
    missedQuestionsSet.add(currentQ.key);
    showFeedbackBad("Not quite. ❌ Try again.\n\nTip: Re-read the question carefully and pick the best match.");
    nextBtn.disabled = true;
    checkBtn.disabled = false;
  }

  updateScoreUI();
}

function nextQuestion() {
  if (!lockedCorrect) return;

  qIndex += 1;
  if (qIndex >= setQuestions.length) {
    // Set completed
    qBox.style.display = "none";
    checkBtn.disabled = true;
    nextBtn.disabled = true;

    const allDone = (activeSet === 5 && setQuestions.length === 10) || 
                    (getSetSlice(allQuestions, activeSet + 1).length === 0);

    if (allDone) {
      mainMsg.style.display = "block";
      mainMsg.innerHTML = `
        <b>All questions done! 🎉</b><br/><br/>
        Session summary:<br/>
        • Attempted: ${attempted}<br/>
        • Correct: ${correct}<br/>
        • First-try correct: ${firstTryCorrect}<br/>
        • Questions requiring multiple attempts: ${missedQuestionsSet.size}<br/><br/>
        <b>Now click the Finish button.</b>
      `;
      setStatus("All Sets Complete");
    } else {
      mainMsg.style.display = "block";
      mainMsg.innerHTML = `
        <b>Congratulations, 10 question set complete! 🌟</b><br/><br/>
        Move to the next set to continue.
      `;
      setStatus(`${currentSetName()} • Finished`);
    }
    return;
  }

  renderQuestion(setQuestions[qIndex]);
}

function prepareQuestionList() {
  setQuestions = getSetSlice(allQuestions, activeSet);
  qIndex = 0;
}

/* ---------------- Podcast Loading ---------------- */
async function loadSelectedPodcast() {
  const file = podcastSelect.value;
  const item = library.find(x => x.file === file);
  if (!item) {
    allQuestions = [];
    showIntroMessage();
    return;
  }

  setStatus("Loading quiz DOCX…");
  mainMsg.style.display = "block";
  mainMsg.textContent = "Loading questions…";

  try {
    const raw = await fetchDocxRawText(item.url);
    const qs = parseQuestionsFromRawText(raw);

    if (!qs.length) {
      throw new Error(`No questions parsed from: ${item.url}`);
    }

    allQuestions = qs;

    // Reset scores for new document
    attempted = 0;
    correct = 0;
    firstTryCorrect = 0;
    missedQuestionsSet.clear();

    updateSetButtonLabels();
    updateScoreUI();

    mainMsg.textContent = `Loaded ${allQuestions.length} questions. Pick a set and press Start.`;
    setStatus("Ready");
    showIntroMessage();
  } catch (err) {
    allQuestions = [];
    updateSetButtonLabels();
    updateScoreUI();

    setStatus("Error");
    mainMsg.style.display = "block";
    mainMsg.textContent = `Could not load questions: ${err.message}`;
  }
}

/* ---------------- Event Listeners ---------------- */
podcastSelect.addEventListener("change", async () => {
  await loadSelectedPodcast();
});

setToggle.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn || btn.disabled) return;

  const which = btn.dataset.set;
  activeSet = parseInt(which, 10);
  setActiveSetUI(which);
  showIntroMessage();
});

startBtn.addEventListener("click", () => {
  if (!allQuestions.length) {
    mainMsg.style.display = "block";
    mainMsg.textContent = "No questions loaded. Please select a podcast first.";
    return;
  }

  prepareQuestionList();

  if (!setQuestions.length) {
    mainMsg.style.display = "block";
    mainMsg.textContent = `No questions in ${currentSetName()}.`;
    return;
  }

  resultBox.style.display = "none";
  renderQuestion(setQuestions[qIndex]);
});

finishBtn.addEventListener("click", () => {
  qBox.style.display = "none";
  checkBtn.disabled = true;
  nextBtn.disabled = true;

  mainMsg.style.display = "block";
  mainMsg.innerHTML = `
    <b>Nice work! ✅</b><br/><br/>
    Session summary:<br/>
    • Attempted: ${attempted}<br/>
    • Correct: ${correct}<br/>
    • First-try correct: ${firstTryCorrect}<br/>
    • Questions requiring multiple attempts: ${missedQuestionsSet.size}<br/><br/>
    Keep going — consistency beats intensity 🌟
  `;

  setStatus("Finished");
});

checkBtn.addEventListener("click", checkAnswer);
nextBtn.addEventListener("click", nextQuestion);

/* ---------------- Initialize ---------------- */
(async function init() {
  setStatus("Initializing…");
  mainMsg.textContent = "Initializing…";
  updateScoreUI();

  try {
    const files = await listQuizFilesFromGitHub();
    library = buildLibrary(files);
    populatePodcastSelect();

    if (!library.length) {
      setStatus("No quiz files found");
      mainMsg.textContent = `No *_quiz.docx found in ${QUIZ_FOLDER}/`;
      return;
    }

    podcastSelect.value = library[0].file;
    await loadSelectedPodcast();

    activeSet = 1;
    setActiveSetUI(1);
    showIntroMessage();
  } catch (err) {
    setStatus("Error");
    mainMsg.textContent = `Initialization failed: ${err.message}`;
  }
})();
