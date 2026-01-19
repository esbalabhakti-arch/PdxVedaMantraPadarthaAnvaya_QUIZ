/* -----------------------------
   CONFIG: add podcasts here
-------------------------------- */
const PODCASTS = [
  { id: "101", title: "101 — Intro 1", file: "Images/101_Intro_1_quiz.docx" },
  { id: "102", title: "102 — Intro 2", file: "Images/102_Intro_2_quiz.docx" },
  { id: "103", title: "103 — 1st Pañchadi", file: "Images/103_1st_Panchadi_quiz.docx" },
  { id: "104", title: "104 — 2nd Pañchadi (Part 1)", file: "Images/104_2nd_Panchadi_Part1_quiz.docx" },
];

const SETS = [
  { key: "set1", label: "Set 1 (Q1–10)", start: 0, end: 10 },
  { key: "set2", label: "Set 2 (Q11–20)", start: 10, end: 20 },
  { key: "set3", label: "Set 3 (Q21–30)", start: 20, end: 30 },
  { key: "set4", label: "Set 4 (Q31–40)", start: 30, end: 40 },
  { key: "set5", label: "Set 5 (Q41–50)", start: 40, end: 50 },
  { key: "missed", label: "Review Missed (0)", start: 0, end: 0 },
];

/* -----------------------------
   STATE
-------------------------------- */
let selectedPodcastId = PODCASTS[0]?.id || null;
let selectedSetKey = "set1";

let allQuestions = [];          // parsed 50 for current podcast
let activeQuestions = [];       // 10 for selected set OR missed pool
let qIndex = 0;

let attempted = 0;
let correct = 0;
let firstTryCorrect = 0;

let currentFirstAttempt = true;
let lockedUntilCorrect = false;

const missedPool = [];          // stores question objects (unique by stableKey)

/* -----------------------------
   DOM
-------------------------------- */
const podcastSelect = document.getElementById("podcastSelect");
const setTabs = document.getElementById("setTabs");

const startBtn = document.getElementById("startBtn");
const finishBtn = document.getElementById("finishBtn");
const nextBtn = document.getElementById("nextBtn");

const quizArea = document.getElementById("quizArea");
const statusMsg = document.getElementById("statusMsg");

const statCorrect = document.getElementById("statCorrect");
const statAttempted = document.getElementById("statAttempted");
const statFirstTry = document.getElementById("statFirstTry");
const statMissed = document.getElementById("statMissed");

/* -----------------------------
   INIT UI
-------------------------------- */
function init() {
  // Populate podcast dropdown
  podcastSelect.innerHTML = "";
  for (const p of PODCASTS) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.title;
    podcastSelect.appendChild(opt);
  }
  podcastSelect.value = selectedPodcastId;

  // Tabs
  renderTabs();

  // Events
  podcastSelect.addEventListener("change", async () => {
    selectedPodcastId = podcastSelect.value;
    await loadPodcastQuestions(selectedPodcastId);
    resetRunUIOnly();
  });

  startBtn.addEventListener("click", async () => {
    if (!allQuestions.length) {
      await loadPodcastQuestions(selectedPodcastId);
    }
    startQuiz();
  });

  finishBtn.addEventListener("click", () => {
    finishQuiz();
  });

  nextBtn.addEventListener("click", () => {
    if (lockedUntilCorrect) return;
    qIndex++;
    if (qIndex >= activeQuestions.length) {
      showMessage("Finished this set. Pick another set — or Review Missed 💪", "good");
      nextBtn.disabled = true;
      return;
    }
    renderQuestion();
  });

  // Initial load
  loadPodcastQuestions(selectedPodcastId)
    .then(() => resetRunUIOnly())
    .catch((e) => {
      console.error(e);
      showMessage("Could not load the quiz. Open DevTools → Console for details.", "bad");
    });
}

function renderTabs() {
  setTabs.innerHTML = "";
  for (const s of SETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tab" + (s.key === selectedSetKey ? " active" : "");
    b.dataset.key = s.key;
    b.textContent = s.key === "missed"
      ? `Review Missed (${missedPool.length})`
      : s.label;

    b.addEventListener("click", () => {
      selectedSetKey = s.key;
      renderTabs();
      resetRunUIOnly();
    });

    setTabs.appendChild(b);
  }
}

/* -----------------------------
   LOADING + PARSING (robust)
-------------------------------- */
async function loadPodcastQuestions(podcastId) {
  const p = PODCASTS.find(x => x.id === podcastId);
  if (!p) throw new Error("Unknown podcast id: " + podcastId);

  showMessage(`Loading questions from: ${p.file} ...`, "");
  allQuestions = [];

  const res = await fetch(p.file, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status}) for ${p.file}`);
  }

  const arrayBuffer = await res.arrayBuffer();

  // Mammoth extracts text from DOCX
  let rawText = "";
  try {
    const result = await mammoth.extractRawText({ arrayBuffer });
    rawText = (result?.value || "").replace(/\r/g, "");
  } catch (e) {
    console.error(e);
    throw new Error("Mammoth failed to read DOCX (is the file a valid .docx?)");
  }

  const parsed = parseQuestionsFromText(rawText);
  allQuestions = parsed;

  if (!allQuestions.length) {
    console.warn("Raw extracted text:\n", rawText.slice(0, 3000));
    showMessage(`Error loading quiz ❌  Parsed 0 questions from ${p.file}.`, "bad");
  } else {
    showMessage(`Loaded ${allQuestions.length} questions ✅  Pick a set, then press Start.`, "good");
  }

  return allQuestions;
}

/**
 * Robust parser:
 * - Question start: "1. ..." or "1) ..." (with optional leading spaces)
 * - Options: "A. ..." or "A) ..." or "A - ..."
 * - Correct: "Correct Answer: C" (case-insensitive; spaces tolerant)
 * - "Check:" lines ignored
 *
 * It also tolerates option text wrapping onto the next line.
 */
function parseQuestionsFromText(text) {
  const lines = text
    .split("\n")
    .map(l => l.replace(/\u00A0/g, " ").trimEnd()) // normalize nbsp
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const isQStart = (l) => /^\s*\d+\s*[\.\)]\s+/.test(l);
  const isOpt = (l) => /^[A-D]\s*[\.\)\-:]\s+/.test(l);
  const isCorrect = (l) => /^Correct\s*Answer\s*:\s*[A-D]\s*$/i.test(l);
  const getCorrectLetter = (l) => (l.match(/([A-D])\s*$/i) || [])[1]?.toUpperCase();

  const stripQPrefix = (l) => l.replace(/^\s*\d+\s*[\.\)]\s+/, "").trim();
  const stripOptPrefix = (l) => l.replace(/^[A-D]\s*[\.\)\-:]\s+/, "").trim();

  const out = [];
  let cur = null;

  function finalize() {
    if (!cur) return;

    // must have 4 options + correct
    if (cur.options.length === 4 && cur.correctIndex >= 0 && cur.correctIndex <= 3) {
      // stable key helps missed uniqueness
      cur.stableKey = (cur.source || "") + "||" + cur.q;
      out.push(cur);
    }
    cur = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];

    // ignore "Check:" explanation lines (they can be long)
    if (/^Check\s*:/i.test(l)) continue;

    if (isQStart(l)) {
      finalize();
      cur = {
        q: stripQPrefix(l),
        options: [],
        correctIndex: -1,
        source: "", // optional
      };
      continue;
    }

    // If we see "[(Source: ...)]" inside the question line, keep it.
    if (cur && cur.q && cur.q.includes("Source:")) {
      // already included in q text; do nothing
    }

    // options
    if (cur && isOpt(l)) {
      cur.options.push(stripOptPrefix(l));
      continue;
    }

    // correct answer
    if (cur && isCorrect(l)) {
      const letter = getCorrectLetter(l);
      if (letter) cur.correctIndex = letter.charCodeAt(0) - "A".charCodeAt(0);
      continue;
    }

    // Option wrapping: if we are inside a question and last thing was an option, append wrapped line
    if (cur && cur.options.length > 0 && !isQStart(l) && !isOpt(l) && !isCorrect(l)) {
      // append to last option (this fixes "options became one line" style issues)
      cur.options[cur.options.length - 1] = (cur.options[cur.options.length - 1] + " " + l).trim();
      continue;
    }

    // Question wrapping (sometimes question spans multiple lines before options start)
    if (cur && cur.options.length === 0 && !isOpt(l) && !isCorrect(l) && !isQStart(l)) {
      cur.q = (cur.q + " " + l).trim();
      continue;
    }
  }

  finalize();
  return out;
}

/* -----------------------------
   QUIZ FLOW
-------------------------------- */
function resetRunUIOnly() {
  qIndex = 0;
  currentFirstAttempt = true;
  lockedUntilCorrect = false;
  nextBtn.disabled = true;
  renderTabs();

  // Don’t reset global stats here (stats are per session until Finish)
  // Just show readiness
  showMessage("Select a podcast, pick a set, then press Start.", "");
}

function startQuiz() {
  if (!allQuestions.length) {
    showMessage("No questions loaded yet.", "bad");
    return;
  }

  activeQuestions = buildActiveList();
  if (!activeQuestions.length) {
    showMessage(selectedSetKey === "missed"
      ? "Review Missed is empty 🎉 Make a mistake (once) to populate it."
      : "This set has no questions (unexpected).", "bad");
    return;
  }

  qIndex = 0;
  currentFirstAttempt = true;
  lockedUntilCorrect = false;
  nextBtn.disabled = true;

  renderQuestion();
}

function buildActiveList() {
  if (selectedSetKey === "missed") {
    // copy of pool (in current order)
    return missedPool.slice();
  }
  const s = SETS.find(x => x.key === selectedSetKey);
  const slice = allQuestions.slice(s.start, s.end);
  return slice;
}

function finishQuiz() {
  // Simple summary + keep missed pool intact across sessions
  const msg =
    `Nice work ✅  Session summary:\n` +
    `• Attempted: ${attempted}\n` +
    `• Correct: ${correct}\n` +
    `• First-try correct: ${firstTryCorrect}\n` +
    `• In Review Missed pool: ${missedPool.length}\n\n` +
    `Try another Set — or hit Review Missed to clean up mistakes 💪`;

  showMessage(msg, "good");
  quizArea.scrollIntoView({ behavior: "smooth", block: "start" });
  nextBtn.disabled = true;
}

function renderQuestion() {
  const qObj = activeQuestions[qIndex];
  if (!qObj) return;

  currentFirstAttempt = true;
  lockedUntilCorrect = false;
  nextBtn.disabled = true;

  const setLabel = selectedSetKey === "missed"
    ? "Review Missed"
    : (SETS.find(x => x.key === selectedSetKey)?.label || "Set");

  quizArea.innerHTML = "";

  const header = document.createElement("div");
  header.className = "qHeader";
  header.textContent = `${setLabel} • Question ${qIndex + 1} of ${activeQuestions.length}`;
  quizArea.appendChild(header);

  const qEl = document.createElement("div");
  qEl.className = "question";
  qEl.textContent = qObj.q;
  quizArea.appendChild(qEl);

  const opts = document.createElement("div");
  opts.className = "options";

  const letters = ["A", "B", "C", "D"];
  qObj.options.forEach((optText, idx) => {
    const card = document.createElement("div");
    card.className = "opt";
    card.dataset.idx = String(idx);

    const badge = document.createElement("div");
    badge.className = "optBadge";
    badge.textContent = letters[idx];

    const t = document.createElement("div");
    t.className = "optText";
    t.textContent = optText;

    card.appendChild(badge);
    card.appendChild(t);

    card.addEventListener("click", () => onPickOption(idx, card, qObj));

    opts.appendChild(card);
  });

  quizArea.appendChild(opts);

  const msg = document.createElement("div");
  msg.className = "msg";
  msg.id = "feedbackMsg";
  msg.textContent = "Pick an option — I’ll tell you immediately if it’s correct 🙂";
  quizArea.appendChild(msg);
}

function onPickOption(idx, cardEl, qObj) {
  if (lockedUntilCorrect) return;

  attempted++;
  updateStats();

  const allOptEls = [...quizArea.querySelectorAll(".opt")];

  const isCorrect = idx === qObj.correctIndex;

  // Visual marking
  if (isCorrect) {
    cardEl.classList.add("good");
    allOptEls.forEach(el => el.classList.add("disabled"));
    lockedUntilCorrect = false;
    nextBtn.disabled = false;

    if (currentFirstAttempt) {
      firstTryCorrect++;
    }

    correct++;
    updateStats();

    setFeedback(pickEncouragement(), "good");
  } else {
    cardEl.classList.add("bad");

    // Put into missed pool ONLY if wrong on FIRST attempt
    if (currentFirstAttempt) {
      addToMissed(qObj);
    }

    currentFirstAttempt = false;
    lockedUntilCorrect = true;

    // allow another try: unlock but keep "must be correct to proceed"
    setTimeout(() => {
      lockedUntilCorrect = false;
      setFeedback("Not this one. Have another go 💡", "bad");
    }, 250);
  }
}

function addToMissed(qObj) {
  const key = qObj.stableKey || qObj.q;
  const already = missedPool.some(x => (x.stableKey || x.q) === key);
  if (!already) missedPool.push(qObj);
  renderTabs();
  updateStats();
}

function setFeedback(text, kind) {
  const el = document.getElementById("feedbackMsg");
  if (!el) return;
  el.textContent = text;
  el.className = "msg" + (kind ? ` ${kind}` : "");
}

function showMessage(text, kind) {
  // status message shown in quiz area when not in a question
  quizArea.innerHTML = "";
  const msg = document.createElement("div");
  msg.className = "msg" + (kind ? ` ${kind}` : "");
  msg.id = "statusMsg";
  msg.textContent = text;
  quizArea.appendChild(msg);
}

/* -----------------------------
   STATS + MOTIVATION
-------------------------------- */
function updateStats() {
  statCorrect.textContent = `Correct: ${correct}`;
  statAttempted.textContent = `Attempted: ${attempted}`;
  statFirstTry.textContent = `First-try: ${firstTryCorrect}`;
  statMissed.textContent = `In Review Missed pool: ${missedPool.length}`;
}

function pickEncouragement() {
  const arr = [
    "Correct ✅ Nice!",
    "Yes ✅ Keep going!",
    "Perfect ✅ You’re on it!",
    "Correct ✅ Solid listening!",
    "Great ✅ Next one!",
  ];
  return arr[Math.floor(Math.random() * arr.length)];
}

/* -----------------------------
   START
-------------------------------- */
init();
