// ---------------------------------------------------------
// Veda Podcast Learning Check Quiz
// - Loads quiz questions from DOCX using mammoth.extractRawText
// - Splits into 5 sets of 10 questions + Review Missed
// - Shows ONE question at a time
// - Does NOT reveal long document text; only "Check:" explanation
// ---------------------------------------------------------

// ------------------------------
// CONFIG: update when you add podcasts
// Folder structure expected (case-sensitive on GitHub Pages):
//  - Images/<id>_quiz.docx
// ------------------------------
const PODCASTS = [
  {
    id: "101",
    label: "101 — Introduction (Part 1)",
    quizDocx: "Images/101_Intro_1_quiz.docx"
  },
  {
    id: "102",
    label: "102 — Introduction (Part 2)",
    quizDocx: "Images/102_Intro_2_quiz.docx"
  },
  {
    id: "103",
    label: "103 — First Pañcati of Aruṇam",
    quizDocx: "Images/103_1st_Panchadi_quiz.docx"
  }
];

// ------------------------------
// Elements
// ------------------------------
const $ = (id) => document.getElementById(id);

const podcastSelect = $("podcastSelect");
const modeBadge = $("modeBadge");
const messageLine = $("messageLine");

const btnStart = $("btnStart");
const btnFinish = $("btnFinish");
const btnCheck = $("btnCheck");
const btnNext = $("btnNext");

const questionBox = $("questionBox");
const qTitle = $("qTitle");
const qText = $("qText");
const optionsEl = $("options");
const feedbackEl = $("feedback");
const scoreLine = $("scoreLine");
const poolLine = $("poolLine");

const setBtns = {
  set1: $("set1"),
  set2: $("set2"),
  set3: $("set3"),
  set4: $("set4"),
  set5: $("set5"),
  missed: $("missed")
};

// ------------------------------
// State
// ------------------------------
let allQuestions = [];         // full parsed list (usually 50)
let currentPodcast = null;

let activeMode = "set1";       // set1..set5 | missed
let sessionActive = false;

let queue = [];                // questions left in current run
let currentQ = null;

let selectedChoice = null;     // "A" | "B" | "C" | "D"
let attemptsForCurrent = 0;

let attempted = 0;
let correct = 0;
let firstTryCorrect = 0;

let missedPool = [];           // question objects user missed at least once (unique by qNum)

const encouragements = [
  "Nice work! ✅",
  "Super! 🌟",
  "Great job! 🙌",
  "Awesome! 🔥",
  "Perfect! 💯",
  "Well done! 👏"
];

// ------------------------------
// Helpers
// ------------------------------
function setMessage(msg) {
  if (messageLine) messageLine.textContent = msg;
}
function setBadge(msg) {
  if (modeBadge) modeBadge.textContent = msg;
}
function randPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function resetFeedback() {
  feedbackEl.className = "feedback";
  feedbackEl.style.display = "none";
  feedbackEl.textContent = "";
}
function showGood(msg) {
  feedbackEl.className = "feedback good";
  feedbackEl.style.display = "block";
  feedbackEl.textContent = msg;
}
function showBad(msg) {
  feedbackEl.className = "feedback bad";
  feedbackEl.style.display = "block";
  feedbackEl.textContent = msg;
}
function updateScore() {
  scoreLine.textContent = `Correct: ${correct} • Attempted: ${attempted} • First-try: ${firstTryCorrect}`;
  poolLine.textContent = `In Review Missed pool: ${missedPool.length}`;
}
function setActiveButton(id) {
  Object.keys(setBtns).forEach(k => {
    if (setBtns[k]) setBtns[k].classList.toggle("active", k === id);
  });
}
function modeLabel(mode) {
  if (mode === "missed") return "Review Missed";
  if (mode === "set1") return "Set 1";
  if (mode === "set2") return "Set 2";
  if (mode === "set3") return "Set 3";
  if (mode === "set4") return "Set 4";
  if (mode === "set5") return "Set 5";
  return mode;
}

// ------------------------------
// DOCX parsing (robust for your format)
// Expected pattern in DOCX raw text:
//   1.
//   Question...
//   [(Source: ...)]
//   A. ...
//   B. ...
//   C. ...
//   D. ...
//   Correct Answer: B
//   Check: ...
// ------------------------------
function parseQuizRawText(raw) {
  const lines = raw
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const questions = [];
  let i = 0;

  const isQNum = (s) => /^\d+\.$/.test(s);
  const isOpt = (s) => /^[A-D]\.\s*/.test(s);
  const isCorrect = (s) => /^Correct Answer:\s*[A-D]\b/i.test(s);
  const isCheck = (s) => /^Check:\s*/i.test(s);
  const isSource = (s) => /^\[\(Source:/i.test(s);

  while (i < lines.length) {
    if (!isQNum(lines[i])) { i++; continue; }

    const qNum = parseInt(lines[i].replace(".", ""), 10);
    i++;

    // question text
    let q = "";
    while (i < lines.length && !isSource(lines[i]) && !isOpt(lines[i]) && !isCorrect(lines[i]) && !isQNum(lines[i])) {
      q = q ? (q + " " + lines[i]) : lines[i];
      i++;
    }

    // optional source line
    if (i < lines.length && isSource(lines[i])) i++;

    // options
    const opts = [];
    while (i < lines.length && !isCorrect(lines[i]) && !isQNum(lines[i])) {
      const line = lines[i];

      if (isOpt(line)) {
        const key = line.slice(0, 1).toUpperCase();
        const text = line.replace(/^[A-D]\.\s*/, "").trim();
        opts.push({ key, text });
      } else if (opts.length > 0) {
        // continuation line for previous option
        opts[opts.length - 1].text += " " + line;
      }
      i++;
    }

    // correct answer
    let correctKey = null;
    if (i < lines.length && isCorrect(lines[i])) {
      const m = lines[i].match(/Correct Answer:\s*([A-D])/i);
      correctKey = m ? m[1].toUpperCase() : null;
      i++;
    }

    // check explanation (may be 1+ lines until next qNum)
    let check = "";
    if (i < lines.length && isCheck(lines[i])) {
      check = lines[i].replace(/^Check:\s*/i, "").trim();
      i++;
      while (i < lines.length && !isQNum(lines[i])) {
        // stop if we accidentally hit another Correct Answer line or options (rare)
        if (isCorrect(lines[i])) break;
        if (isOpt(lines[i])) break;
        check += (check ? " " : "") + lines[i];
        i++;
      }
    }

    // only accept valid MCQ blocks
    if (q && opts.length >= 4 && correctKey) {
      // ensure 4 options A-D order
      const byKey = new Map(opts.map(o => [o.key, o.text]));
      const normalized = ["A", "B", "C", "D"].map(k => ({
        key: k,
        text: (byKey.get(k) || "").trim()
      })).filter(o => o.text);

      questions.push({
        qNum,
        question: q.trim(),
        options: normalized,
        correct: correctKey,
        check: check.trim()
      });
    }
  }

  // sort by qNum to keep stable ordering
  questions.sort((a,b) => a.qNum - b.qNum);
  return questions;
}

async function loadDocxQuestions(docxPath) {
  if (!window.mammoth) {
    throw new Error("mammoth.js did not load. Check the script tag / internet.");
  }

  const res = await fetch(docxPath, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`Could not fetch: ${docxPath} (HTTP ${res.status}). Check file path + case sensitivity.`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const raw = await window.mammoth.extractRawText({ arrayBuffer });
  const parsed = parseQuizRawText(raw.value || "");

  if (!parsed.length) {
    throw new Error("No questions parsed. The DOCX format may have changed.");
  }

  return parsed;
}

// ------------------------------
// Set slicing
// ------------------------------
function getQuestionsForMode(mode) {
  if (mode === "missed") {
    // Review missed uses current pool (unique)
    return missedPool.slice().sort((a,b) => a.qNum - b.qNum);
  }

  // Normal sets assume 50 questions; slice by qNum order:
  const idx = {
    set1: [0, 10],
    set2: [10, 20],
    set3: [20, 30],
    set4: [30, 40],
    set5: [40, 50]
  }[mode];

  if (!idx) return [];

  return allQuestions.slice(idx[0], idx[1]);
}

// ------------------------------
// Render question
// ------------------------------
function renderQuestion(q) {
  currentQ = q;
  selectedChoice = null;
  attemptsForCurrent = 0;

  resetFeedback();

  qTitle.textContent = `Q${q.qNum}`;
  qText.textContent = q.question;

  optionsEl.innerHTML = "";
  q.options.forEach(opt => {
    const row = document.createElement("label");
    row.className = "opt";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "mcq";
    radio.value = opt.key;

    radio.addEventListener("change", () => {
      selectedChoice = opt.key;
      btnCheck.disabled = false;
      btnNext.disabled = true;
      resetFeedback();
    });

    const txt = document.createElement("div");
    txt.innerHTML = `<b>${opt.key}.</b> ${opt.text}`;

    row.appendChild(radio);
    row.appendChild(txt);
    optionsEl.appendChild(row);
  });

  btnCheck.disabled = true;
  btnNext.disabled = true;
  questionBox.style.display = "block";
  updateScore();
}

// ------------------------------
// Quiz flow
// ------------------------------
function startMode(mode) {
  if (!allQuestions.length && mode !== "missed") {
    setMessage("Load a podcast first, then press Start.");
    return;
  }

  activeMode = mode;
  setActiveButton(mode);

  const list = getQuestionsForMode(mode);

  // If user chooses Review Missed but nothing there
  if (mode === "missed" && list.length === 0) {
    sessionActive = true;
    setBadge(`${modeLabel(mode)} • Ready`);
    setMessage("No missed questions yet 😊 Try a Set first, then come back to Review Missed.");
    questionBox.style.display = "none";
    return;
  }

  // Queue is ordered; no shuffle (so Set 4 really is Q31–40, etc.)
  queue = list.slice();
  sessionActive = true;

  setBadge(`${modeLabel(mode)} • In progress`);
  setMessage(`Go! ${modeLabel(mode)} loaded (${queue.length} questions).`);

  nextQuestion();
}

function nextQuestion() {
  resetFeedback();
  btnNext.disabled = true;

  if (!queue.length) {
    // finished this mode
    setBadge(`${modeLabel(activeMode)} • Finished`);
    setMessage("Finished. You can pick another set, or Review Missed.");
    questionBox.style.display = "none";
    return;
  }

  const q = queue.shift();
  renderQuestion(q);
}

function ensureMissedPool(q) {
  if (!missedPool.some(x => x.qNum === q.qNum)) {
    missedPool.push(q);
  }
}

function checkAnswer() {
  if (!currentQ || !selectedChoice) return;

  attemptsForCurrent += 1;
  attempted += 1;

  if (selectedChoice === currentQ.correct) {
    correct += 1;
    if (attemptsForCurrent === 1) firstTryCorrect += 1;

    // remove from missed pool if it was later solved? (keep it there; user asked to review again at end)
    // We'll keep it there to encourage re-checking.

    const checkText = currentQ.check ? `\n\nCheck: ${currentQ.check}` : "";
    showGood(`${randPick(encouragements)}\nCorrect: ${currentQ.correct}.${checkText}`);

    btnNext.disabled = false;
    btnCheck.disabled = true;

  } else {
    ensureMissedPool(currentQ);
    showBad("Not quite — try again 🙂");
    btnNext.disabled = true;
  }

  updateScore();
}

// ------------------------------
// Podcast loading
// ------------------------------
function populatePodcasts() {
  podcastSelect.innerHTML = "";
  PODCASTS.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    podcastSelect.appendChild(opt);
  });
}

async function loadSelectedPodcast() {
  const id = podcastSelect.value;
  const p = PODCASTS.find(x => x.id === id);
  currentPodcast = p;

  // reset state for new podcast
  allQuestions = [];
  queue = [];
  currentQ = null;
  selectedChoice = null;
  attemptsForCurrent = 0;

  attempted = 0;
  correct = 0;
  firstTryCorrect = 0;
  missedPool = [];

  questionBox.style.display = "none";
  resetFeedback();
  updateScore();

  setBadge(`${modeLabel(activeMode)} • Loading…`);
  setMessage("Loading quiz questions…");

  try {
    allQuestions = await loadDocxQuestions(p.quizDocx);

    setMessage(`Loaded ${allQuestions.length} questions. Pick a Set, then press Start.`);
    setBadge(`${modeLabel(activeMode)} • Ready`);
  } catch (e) {
    setMessage(String(e));
    setBadge(`${modeLabel(activeMode)} • Error`);
  }
}

// ------------------------------
// Wire up events
// ------------------------------
podcastSelect.addEventListener("change", async () => {
  await loadSelectedPodcast();
});

Object.keys(setBtns).forEach(k => {
  setBtns[k].addEventListener("click", () => {
    activeMode = k;
    setActiveButton(k);
    setBadge(`${modeLabel(k)} • Ready`);
    setMessage("Press Start to begin this set.");
    questionBox.style.display = "none";
    resetFeedback();
  });
});

btnStart.addEventListener("click", () => {
  // Start the currently selected mode
  startMode(activeMode);
});

btnFinish.addEventListener("click", () => {
  // End current run (does not clear missed pool)
  sessionActive = false;
  queue = [];
  currentQ = null;
  questionBox.style.display = "none";
  resetFeedback();

  setBadge(`${modeLabel(activeMode)} • Finished`);
  setMessage(`Session summary — Attempted: ${attempted}, Correct: ${correct}, First-try: ${firstTryCorrect}. Great effort 🙌`);
});

btnCheck.addEventListener("click", () => checkAnswer());
btnNext.addEventListener("click", () => nextQuestion());

// ------------------------------
// Init
// ------------------------------
(function init() {
  populatePodcasts();
  setActiveButton("set1");
  updateScore();
  loadSelectedPodcast();
})();
