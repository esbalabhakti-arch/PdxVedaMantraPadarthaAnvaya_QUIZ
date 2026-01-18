/* script.js - robust DOCX loader + parser */

const PODCASTS = [
  // Edit these to match your filenames.
  // IMPORTANT: Put the .docx in /quizzes/ in your deployed site.
  { id: "102 — Intro 2", base: "102_Intro_2" },
  { id: "101 — Intro 1", base: "101_Intro_1" },
  { id: "103 — Intro 3", base: "103_Intro_3" },
];

// If each podcast has multiple sets, name them like:
// 102_Intro_2_set1.docx, 102_Intro_2_set2.docx, etc.
// If you have just one docx per podcast, keep setCount = 1.
const SETS = [
  { label: "Set 1", suffix: "_quiz" },
  { label: "Set 2", suffix: "_set2" },
  { label: "Set 3", suffix: "_set3" },
  { label: "Set 4", suffix: "_set4" },
  { label: "Set 5", suffix: "_set5" },
];

const QUIZ_DIR = "./quizzes"; // where DOCX files live

// ---------- DOM ----------
const elPodcast = document.getElementById("podcastSelect");
const elSet = document.getElementById("setSelect");
const elReload = document.getElementById("reloadBtn");
const elStart = document.getElementById("startBtn");
const elFinish = document.getElementById("finishBtn");

const elStatus = document.getElementById("statusBox");
const elQuizArea = document.getElementById("quizArea");

const elQMeta = document.getElementById("qMeta");
const elQText = document.getElementById("qText");
const elQOptions = document.getElementById("qOptions");
const elDocxPath = document.getElementById("docxPath");

const elPrev = document.getElementById("prevBtn");
const elNext = document.getElementById("nextBtn");
const elCheck = document.getElementById("checkBtn");
const elReveal = document.getElementById("revealBtn");

const elStatCorrect = document.getElementById("statCorrect");
const elStatAttempted = document.getElementById("statAttempted");
const elStatFirstTry = document.getElementById("statFirstTry");
const elStatReview = document.getElementById("statReviewPool");

// ---------- STATE ----------
let questions = []; // { number, text, choices:{A,B,C,D}, answer:'A'.., rawBlock }
let currentIndex = 0;

// tracking
let attempted = new Set();
let correct = new Set();
let firstTryCorrect = new Set();
let wrongPool = new Set(); // question indexes missed at least once

// per-question first attempt correctness
let firstAttemptDone = new Set();

// ---------- INIT ----------
initSelectors();
wireEvents();
setStatus("Choose a podcast + set, then click Reload DOCX.", "warn");

function initSelectors() {
  elPodcast.innerHTML = PODCASTS.map((p, i) =>
    `<option value="${i}">${escapeHtml(p.id)}</option>`
  ).join("");

  elSet.innerHTML = SETS.map((s, i) =>
    `<option value="${i}">${escapeHtml(s.label)}</option>`
  ).join("");
}

function wireEvents() {
  elReload.addEventListener("click", async () => {
    await loadSelectedDocx();
  });

  elStart.addEventListener("click", () => {
    if (!questions.length) {
      setStatus("No questions loaded yet. Click Reload DOCX first.", "err");
      return;
    }
    elQuizArea.style.display = "block";
    currentIndex = 0;
    renderQuestion();
  });

  elFinish.addEventListener("click", () => {
    // basic finish behavior: go to review pool if any
    if (wrongPool.size > 0) {
      const first = [...wrongPool][0];
      currentIndex = first;
      setStatus(`Review Missed: ${wrongPool.size} question(s).`, "warn");
      renderQuestion();
    } else {
      setStatus("Quiz finished! No missed questions in the review pool.", "ok");
      elQuizArea.style.display = "none";
    }
  });

  elPrev.addEventListener("click", () => {
    if (!questions.length) return;
    currentIndex = Math.max(0, currentIndex - 1);
    renderQuestion();
  });

  elNext.addEventListener("click", () => {
    if (!questions.length) return;
    currentIndex = Math.min(questions.length - 1, currentIndex + 1);
    renderQuestion();
  });

  elCheck.addEventListener("click", () => checkAnswer(false));
  elReveal.addEventListener("click", () => checkAnswer(true));
}

// ---------- DOCX LOADING ----------
function buildDocxUrl() {
  const p = PODCASTS[Number(elPodcast.value)];
  const s = SETS[Number(elSet.value)];
  // e.g. ./quizzes/102_Intro_2_quiz.docx
  return `${QUIZ_DIR}/${p.base}${s.suffix}.docx`;
}

async function loadSelectedDocx() {
  const url = buildDocxUrl();
  elDocxPath.textContent = url;

  // reset state
  questions = [];
  currentIndex = 0;
  attempted.clear();
  correct.clear();
  firstTryCorrect.clear();
  wrongPool.clear();
  firstAttemptDone.clear();
  updateStats();
  elQuizArea.style.display = "none";

  setStatus(`Loading DOCX: ${url}`, "warn");

  try {
    const arrayBuffer = await fetchAsArrayBuffer(url);
    const rawText = await docxToRawText(arrayBuffer);

    // IMPORTANT: normalize weird spacing & bullets
    const normalized = normalizeDocText(rawText);

    const parsed = parseQuestions(normalized);

    if (!parsed.length) {
      setStatus(
        "Could not parse any questions from the DOCX. " +
        "This usually means the DOCX formatting doesn’t match the parser patterns.\n\n" +
        "Fix: ensure each question block contains (1) question line + A/B/C/D lines + a Correct Answer line.",
        "err"
      );
      console.warn("RAW TEXT (normalized):\n", normalized);
      return;
    }

    questions = parsed;
    setStatus(`Loaded ${questions.length} question(s). Click Start.`, "ok");
    updateStats();
  } catch (err) {
    setStatus(
      `Failed to load/parse DOCX.\n\n${String(err?.message || err)}`,
      "err"
    );
    console.error(err);
  }
}

async function fetchAsArrayBuffer(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} when fetching ${url}. Check the file path and deploy output.`);
  }
  return await res.arrayBuffer();
}

async function docxToRawText(arrayBuffer) {
  if (!window.mammoth) {
    throw new Error("Mammoth.js not available. Check the <script> include in index.html.");
  }
  const result = await window.mammoth.extractRawText({ arrayBuffer });
  // result.messages contains warnings; not fatal
  return result.value || "";
}

// ---------- TEXT NORMALIZATION ----------
function normalizeDocText(t) {
  if (!t) return "";
  return t
    .replace(/\r/g, "")
    .replace(/\u00A0/g, " ")              // nbsp
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[•·]/g, "-")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- PARSER ----------
/*
  We split into question blocks by detecting:
    - start of line with: 1. / 1) / Q1. / Q1)
*/
function parseQuestions(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // Rebuild into a single string with line breaks preserved between logical lines
  const joined = lines.join("\n");

  // Find all question-start markers with indices
  const startRegex = /^(?:Q\s*)?(\d{1,3})\s*[\.\)]\s+/gmi;

  const starts = [];
  let m;
  while ((m = startRegex.exec(joined)) !== null) {
    starts.push({ idx: m.index, qnum: Number(m[1]) });
  }

  if (!starts.length) return [];

  const blocks = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = (i + 1 < starts.length) ? starts[i + 1].idx : joined.length;
    blocks.push({
      number: start.qnum,
      raw: joined.slice(start.idx, end).trim()
    });
  }

  const parsed = [];
  for (const b of blocks) {
    const q = parseBlock(b.number, b.raw);
    if (q) parsed.push(q);
  }
  return parsed;
}

function parseBlock(number, rawBlock) {
  // break into lines for easier parsing
  const lines = rawBlock.split("\n").map(s => s.trim()).filter(Boolean);

  // first line contains question (remove leading "Q1." / "1." etc)
  let first = lines[0] || "";
  first = first.replace(/^(?:Q\s*)?\d{1,3}\s*[\.\)]\s*/i, "").trim();
  if (!first) return null;

  const choices = {};
  const choiceRegex = /^([A-D])\s*[\.\)\-:]\s*(.+)$/i;

  // Extract answer letter from any line like:
  // Correct Answer: B / Answer: B / Correct: B
  const answerRegex = /(correct\s*answer|answer|correct)\s*[:\-]\s*([A-D])\b/i;

  let answer = null;

  // Collect possible multi-line question text until we hit A/B/C/D
  const qTextParts = [first];

  let i = 1;
  // gather extra question lines before options start
  for (; i < lines.length; i++) {
    const line = lines[i];

    if (choiceRegex.test(line)) break; // options begin
    if (answerRegex.test(line)) {
      const mm = line.match(answerRegex);
      if (mm) answer = mm[2].toUpperCase();
      continue;
    }
    // Sometimes "Check" line exists - ignore
    if (/^check\s*[:\-]/i.test(line)) continue;

    qTextParts.push(line);
  }

  // parse options and answer lines
  for (; i < lines.length; i++) {
    const line = lines[i];

    const cm = line.match(choiceRegex);
    if (cm) {
      const key = cm[1].toUpperCase();
      choices[key] = (choices[key] ? (choices[key] + " " + cm[2]) : cm[2]).trim();
      continue;
    }

    const am = line.match(answerRegex);
    if (am) {
      answer = am[2].toUpperCase();
      continue;
    }
  }

  // Must have at least A-D (we’ll allow missing one, but warn)
  const hasAnyChoices = ["A","B","C","D"].some(k => choices[k]);
  if (!hasAnyChoices) return null;

  if (!answer || !choices[answer]) {
    // If answer missing, still keep question but mark answer null
    // (You can decide to reject instead.)
    // For your UI (multiple-choice quiz), answer is needed—so we reject.
    return null;
  }

  return {
    number,
    text: qTextParts.join(" ").replace(/[ ]{2,}/g, " ").trim(),
    choices,
    answer,
    rawBlock
  };
}

// ---------- RENDER ----------
function renderQuestion() {
  if (!questions.length) return;

  const q = questions[currentIndex];
  elQMeta.textContent = `Question ${currentIndex + 1} / ${questions.length} (DOC #${q.number})`;
  elQText.textContent = q.text;

  elQOptions.innerHTML = "";
  const letters = ["A", "B", "C", "D"].filter(k => q.choices[k]);

  for (const L of letters) {
    const id = `opt_${L}`;
    const label = document.createElement("label");
    label.innerHTML = `
      <input type="radio" name="choice" id="${id}" value="${L}">
      <div><strong>${L}.</strong> ${escapeHtml(q.choices[L])}</div>
    `;
    elQOptions.appendChild(label);
  }

  // If this question is in the review pool, show that
  if (wrongPool.has(currentIndex)) {
    setStatus("This question is in your Review Missed pool.", "warn");
  } else {
    setStatus("Select an option and click Check.", "ok");
  }

  updateStats();
}

// ---------- CHECK ----------
function checkAnswer(revealOnly) {
  if (!questions.length) return;

  const q = questions[currentIndex];
  const selected = document.querySelector('input[name="choice"]:checked')?.value || null;

  if (revealOnly) {
    setStatus(`Answer (debug): ${q.answer}`, "warn");
    console.log("RAW BLOCK:\n", q.rawBlock);
    return;
  }

  if (!selected) {
    setStatus("Pick an option first.", "warn");
    return;
  }

  attempted.add(currentIndex);

  const isFirstAttempt = !firstAttemptDone.has(currentIndex);
  if (isFirstAttempt) firstAttemptDone.add(currentIndex);

  if (selected === q.answer) {
    correct.add(currentIndex);
    if (isFirstAttempt) firstTryCorrect.add(currentIndex);

    // remove from review pool if previously missed
    if (wrongPool.has(currentIndex)) wrongPool.delete(currentIndex);

    setStatus("✅ Correct!", "ok");
  } else {
    wrongPool.add(currentIndex);
    setStatus(`❌ Not correct. Correct answer is ${q.answer}. Added to Review Missed.`, "err");
  }

  updateStats();
}

// ---------- STATS ----------
function updateStats() {
  elStatCorrect.textContent = String(correct.size);
  elStatAttempted.textContent = String(attempted.size);
  elStatFirstTry.textContent = String(firstTryCorrect.size);
  elStatReview.textContent = String(wrongPool.size);
}

// ---------- STATUS ----------
function setStatus(msg, type) {
  elStatus.classList.remove("ok", "err", "warn");
  elStatus.classList.add(type);
  elStatus.textContent = msg;
}

// ---------- UTIL ----------
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Auto-load on first render (optional):
// loadSelectedDocx();
