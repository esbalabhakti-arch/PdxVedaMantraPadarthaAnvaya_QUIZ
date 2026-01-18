// ---------------------------------------------------------
// Veda Podcast Learning Check Quiz
// ---------------------------------------------------------
// IMPORTANT: GitHub Pages is case-sensitive.
// Your folder is: images/   (lowercase)
// So docx paths MUST be: images/<file>.docx
// ---------------------------------------------------------

const PODCASTS = [
  { id: "101", label: "101 — Introduction (Part 1)", quizDocx: "images/101_Intro_1_quiz.docx" },
  { id: "102", label: "102 — Introduction (Part 2)", quizDocx: "images/102_Intro_2_quiz.docx" },
  { id: "103", label: "103 — First Pañcati of Aruṇam", quizDocx: "images/103_1st_Panchadi_quiz.docx" }
];

// Elements
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

// State
let allQuestions = [];
let currentPodcast = null;

let activeMode = "set1";
let queue = [];
let currentQ = null;

let selectedChoice = null;
let attemptsForCurrent = 0;

let attempted = 0;
let correct = 0;
let firstTryCorrect = 0;

let missedPool = [];

const encouragements = [
  "Nice work! ✅",
  "Super! 🌟",
  "Great job! 🙌",
  "Awesome! 🔥",
  "Perfect! 💯",
  "Well done! 👏"
];

// Helpers
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

// ---------------------------------------------------------
// DOCX parsing (more flexible)
// Accepts:
//  - question start: "1." OR "1)" OR "1"
//  - options: "A." OR "A)" OR "A:" (and same for B/C/D)
//  - correct: "Correct Answer: B" (case-insensitive)
//  - check: "Check:" (case-insensitive)
// ---------------------------------------------------------
function parseQuizRawText(raw) {
  const lines = raw
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const questions = [];
  let i = 0;

  const isQNum = (s) => /^\d+(\.|\\)|\))?$/.test(s); // handles "1", "1.", "1)"
  const qNumValue = (s) => parseInt((s.match(/^\d+/) || ["0"])[0], 10);

  const isOpt = (s) => /^[A-D](\.|\)|:)\s*/.test(s);
  const optKey = (s) => s.slice(0,1).toUpperCase();
  const optText = (s) => s.replace(/^[A-D](\.|\)|:)\s*/, "").trim();

  const isCorrect = (s) => /^Correct\s*Answer\s*:\s*[A-D]\b/i.test(s);
  const correctKey = (s) => {
    const m = s.match(/Correct\s*Answer\s*:\s*([A-D])/i);
    return m ? m[1].toUpperCase() : null;
  };

  const isCheck = (s) => /^Check\s*:\s*/i.test(s);
  const checkText = (s) => s.replace(/^Check\s*:\s*/i, "").trim();

  while (i < lines.length) {
    if (!isQNum(lines[i])) { i++; continue; }

    const qNum = qNumValue(lines[i]);
    i++;

    // Collect question text until options start
    let q = "";
    while (i < lines.length && !isOpt(lines[i]) && !isCorrect(lines[i]) && !isQNum(lines[i])) {
      q = q ? (q + " " + lines[i]) : lines[i];
      i++;
    }

    // Options
    const opts = [];
    while (i < lines.length && !isCorrect(lines[i]) && !isQNum(lines[i])) {
      const line = lines[i];

      if (isOpt(line)) {
        const key = optKey(line);
        const text = optText(line);
        opts.push({ key, text });
      } else if (opts.length > 0) {
        // continuation line for previous option
        opts[opts.length - 1].text += " " + line;
      }
      i++;
    }

    // Correct Answer
    let ck = null;
    if (i < lines.length && isCorrect(lines[i])) {
      ck = correctKey(lines[i]);
      i++;
    }

    // Check explanation
    let check = "";
    if (i < lines.length && isCheck(lines[i])) {
      check = checkText(lines[i]);
      i++;
      while (i < lines.length && !isQNum(lines[i])) {
        // stop if next block accidentally begins
        if (isCorrect(lines[i])) break;
        if (isOpt(lines[i])) break;
        check += (check ? " " : "") + lines[i];
        i++;
      }
    }

    // Normalize options A-D
    const byKey = new Map(opts.map(o => [o.key, o.text.trim()]));
    const normalized = ["A","B","C","D"]
      .map(k => ({ key:k, text:(byKey.get(k) || "").trim() }))
      .filter(o => o.text);

    // Only accept MCQ blocks with 4 options + correct key
    if (q && normalized.length >= 4 && ck) {
      questions.push({
        qNum,
        question: q.trim(),
        options: normalized.slice(0,4),
        correct: ck,
        check: (check || "").trim()
      });
    }
  }

  questions.sort((a,b) => a.qNum - b.qNum);
  return questions;
}

async function loadDocxQuestions(docxPath) {
  if (!window.mammoth) {
    throw new Error("mammoth.js did not load. Check the script tag / internet.");
  }

  const res = await fetch(docxPath, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(
      `Could not fetch: ${docxPath}\n` +
      `HTTP ${res.status} ${res.statusText}\n\n` +
      `✅ Check:\n` +
      `- Folder name is "images" (lowercase)\n` +
      `- File is committed/pushed to GitHub\n` +
      `- Path matches exactly (case-sensitive)`
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  const raw = await window.mammoth.extractRawText({ arrayBuffer });
  const parsed = parseQuizRawText(raw.value || "");

  if (!parsed.length) {
    // Provide a helpful hint without dumping the whole doc
    const preview = (raw.value || "").split(/\r?\n/).slice(0, 20).join("\n");
    throw new Error(
      "No questions parsed. The DOCX format may not match the expected pattern.\n\n" +
      "Expected patterns:\n" +
      "- Question numbers: 1.  or 1) or 1\n" +
      "- Options: A. or A) or A:\n" +
      "- Correct Answer: B\n" +
      "- Check: ...\n\n" +
      "First 20 lines seen by parser:\n" + preview
    );
  }

  return parsed;
}

// Set slicing
function getQuestionsForMode(mode) {
  if (mode === "missed") return missedPool.slice().sort((a,b)=>a.qNum-b.qNum);

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

// Render question
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

// Flow
function nextQuestion() {
  resetFeedback();
  btnNext.disabled = true;

  if (!queue.length) {
    setBadge(`${modeLabel(activeMode)} • Finished`);
    setMessage("Finished. You can pick another set, or Review Missed.");
    questionBox.style.display = "none";
    return;
  }

  renderQuestion(queue.shift());
}

function ensureMissedPool(q) {
  if (!missedPool.some(x => x.qNum === q.qNum)) missedPool.push(q);
}

function checkAnswer() {
  if (!currentQ || !selectedChoice) return;

  attemptsForCurrent += 1;
  attempted += 1;

  if (selectedChoice === currentQ.correct) {
    correct += 1;
    if (attemptsForCurrent === 1) firstTryCorrect += 1;

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

function startMode(mode) {
  activeMode = mode;
  setActiveButton(mode);

  const list = getQuestionsForMode(mode);

  if (mode === "missed" && list.length === 0) {
    setBadge(`${modeLabel(mode)} • Ready`);
    setMessage("No missed questions yet 😊 Try a Set first, then Review Missed.");
    questionBox.style.display = "none";
    return;
  }

  if (!list.length) {
    setBadge(`${modeLabel(mode)} • Ready`);
    setMessage("No questions found for this set. (Is the DOCX parsed and 50 questions present?)");
    questionBox.style.display = "none";
    return;
  }

  queue = list.slice(); // ordered, not shuffled
  setBadge(`${modeLabel(mode)} • In progress`);
  setMessage(`Go! ${modeLabel(mode)} loaded (${queue.length} questions).`);

  nextQuestion();
}

// Podcast loading
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
  setMessage(`Loading quiz from: ${p.quizDocx}`);

  try {
    allQuestions = await loadDocxQuestions(p.quizDocx);
    setBadge(`${modeLabel(activeMode)} • Ready`);
    setMessage(`Loaded ${allQuestions.length} questions. Pick a Set, then press Start.`);
  } catch (e) {
    setBadge(`${modeLabel(activeMode)} • Error`);
    setMessage(String(e));
  }
}

// Events
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

btnStart.addEventListener("click", () => startMode(activeMode));

btnFinish.addEventListener("click", () => {
  queue = [];
  currentQ = null;
  questionBox.style.display = "none";
  resetFeedback();
  setBadge(`${modeLabel(activeMode)} • Finished`);
  setMessage(`Session summary — Attempted: ${attempted}, Correct: ${correct}, First-try: ${firstTryCorrect}. Great effort 🙌`);
});

btnCheck.addEventListener("click", () => checkAnswer());
btnNext.addEventListener("click", () => nextQuestion());

// Init
(function init() {
  populatePodcasts();
  setActiveButton("set1");
  updateScore();
  loadSelectedPodcast();
})();
