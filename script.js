/* script.js - Parser tuned to YOUR DOCX structure */

const PODCASTS = [
  { id: "101 — Intro 1", base: "101_Intro_1" },
  { id: "102 — Intro 2", base: "102_Intro_2" },
  { id: "103 — Intro 3", base: "103_Intro_3" },
];

const SETS = [
  { label: "Quiz", suffix: "_quiz" }, // => 101_Intro_1_quiz.docx
  { label: "Set 2", suffix: "_set2" },
  { label: "Set 3", suffix: "_set3" },
  { label: "Set 4", suffix: "_set4" },
  { label: "Set 5", suffix: "_set5" },
];

const QUIZ_DIR = "./quizzes";

// ---------- DOM ----------
const elPodcast = document.getElementById("podcastSelect");
const elSet = document.getElementById("setSelect");
const elReload = document.getElementById("reloadBtn");
const elFile = document.getElementById("docxFileInput");
const elStart = document.getElementById("startBtn");
const elFinish = document.getElementById("finishBtn");

const elStatus = document.getElementById("statusBox");
const elQuizArea = document.getElementById("quizArea");

const elQMeta = document.getElementById("qMeta");
const elQText = document.getElementById("qText");
const elQSource = document.getElementById("qSource");
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
let questions = []; // { number, text, source, choices:{A,B,C,D}, answer }
let currentIndex = 0;

// tracking
let attempted = new Set();
let correct = new Set();
let firstTryCorrect = new Set();
let wrongPool = new Set();
let firstAttemptDone = new Set();

// ---------- INIT ----------
initSelectors();
wireEvents();
setStatus("Ready. Load a DOCX from site or upload one.", "warn");

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
    await loadSelectedDocxFromSite();
  });

  elFile.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadDocxFromFile(file);
    elFile.value = ""; // allow re-upload same file
  });

  elStart.addEventListener("click", () => {
    if (!questions.length) {
      setStatus("No questions loaded yet. Load the DOCX first.", "err");
      return;
    }
    elQuizArea.style.display = "block";
    currentIndex = 0;
    renderQuestion();
  });

  elFinish.addEventListener("click", () => {
    if (wrongPool.size > 0) {
      currentIndex = [...wrongPool][0];
      setStatus(`Review Missed: ${wrongPool.size} question(s).`, "warn");
      renderQuestion();
    } else {
      setStatus("Finished! No missed questions remaining.", "ok");
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
  return `${QUIZ_DIR}/${p.base}${s.suffix}.docx`;
}

async function loadSelectedDocxFromSite() {
  const url = buildDocxUrl();
  elDocxPath.textContent = url;
  resetQuizState();
  setStatus(`Loading from site: ${url}`, "warn");

  try {
    const arrayBuffer = await fetchAsArrayBuffer(url);
    const rawText = await docxToRawText(arrayBuffer);
    const normalized = normalizeDocText(rawText);

    const parsed = parseDocxLikeYourFile(normalized);

    if (!parsed.length) {
      setStatus(
        "Loaded the DOCX but could not parse questions.\n\n" +
        "This parser expects:\n" +
        "• A line with just '1.' (question number)\n" +
        "• Question text\n" +
        "• Choices A./B./C./D.\n" +
        "• 'Correct Answer: X'\n\n" +
        "Click Reveal (debug) only after loading and starting, or check console logs.",
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
      `Failed to load from site.\n\n` +
      `Common causes:\n` +
      `• Wrong path (404)\n` +
      `• The /quizzes folder isn’t in your deployed publish directory\n` +
      `• Netlify/Vercel not serving .docx correctly\n\n` +
      `Error: ${String(err?.message || err)}`,
      "err"
    );
    console.error(err);
  }
}

async function loadDocxFromFile(file) {
  elDocxPath.textContent = `(uploaded) ${file.name}`;
  resetQuizState();
  setStatus(`Loading uploaded file: ${file.name}`, "warn");

  try {
    const arrayBuffer = await file.arrayBuffer();
    const rawText = await docxToRawText(arrayBuffer);
    const normalized = normalizeDocText(rawText);

    const parsed = parseDocxLikeYourFile(normalized);

    if (!parsed.length) {
      setStatus("Could not parse questions from this uploaded DOCX. Check console for raw text.", "err");
      console.warn("RAW TEXT (normalized):\n", normalized);
      return;
    }

    questions = parsed;
    setStatus(`Loaded ${questions.length} question(s) from upload. Click Start.`, "ok");
    updateStats();
  } catch (err) {
    setStatus(`Upload parse failed: ${String(err?.message || err)}`, "err");
    console.error(err);
  }
}

async function fetchAsArrayBuffer(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return await res.arrayBuffer();
}

async function docxToRawText(arrayBuffer) {
  if (!window.mammoth) throw new Error("Mammoth.js missing. Check script include in index.html.");
  const result = await window.mammoth.extractRawText({ arrayBuffer });
  return result.value || "";
}

// ---------- NORMALIZATION ----------
function normalizeDocText(t) {
  if (!t) return "";
  return t
    .replace(/\r/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[•·]/g, "-")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- PARSER (MATCHES YOUR DOCX) ----------
function parseDocxLikeYourFile(text) {
  // Preserve blank lines; your numbering is often on a line by itself.
  const rawLines = text.split("\n").map(l => l.replace(/\s+$/g, ""));

  // Identify question start lines like "1." on its own line
  const qStartRegex = /^\s*(\d{1,3})\.\s*$/;

  const starts = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (qStartRegex.test(rawLines[i])) {
      const num = Number(rawLines[i].match(qStartRegex)[1]);
      starts.push({ lineIndex: i, number: num });
    }
  }
  if (!starts.length) return [];

  const blocks = [];
  for (let k = 0; k < starts.length; k++) {
    const start = starts[k];
    const endLine = (k + 1 < starts.length) ? starts[k + 1].lineIndex : rawLines.length;
    const blockLines = rawLines.slice(start.lineIndex + 1, endLine); // after "1."
    blocks.push({ number: start.number, lines: blockLines });
  }

  const parsed = [];
  for (const b of blocks) {
    const q = parseBlockLikeYourFile(b.number, b.lines);
    if (q) parsed.push(q);
  }
  return parsed;
}

function parseBlockLikeYourFile(number, lines) {
  // Clean: remove leading/trailing empties but keep internal structure
  const cleaned = lines.map(l => l.trim());
  // Find choices and answer
  const choiceRegex = /^([A-D])\.\s*(.+)\s*$/i;
  const answerRegex = /^correct\s*answer\s*:\s*([A-D])\b/i;

  let questionTextParts = [];
  let sourceLine = "";
  const choices = {};
  let answer = null;

  // Step 1: collect question text until first choice A.
  let i = 0;
  for (; i < cleaned.length; i++) {
    const line = cleaned[i];
    if (!line) continue;

    // source line format in your doc: [(Source: ...)]
    if (line.startsWith("[(") && line.includes("Source:")) {
      sourceLine = line;
      continue;
    }

    if (choiceRegex.test(line)) break;

    // skip noise lines
    if (/^\[\(source:/i.test(line)) { sourceLine = line; continue; }
    if (/^below is a rigorous/i.test(line)) continue;

    questionTextParts.push(line);
  }

  // Step 2: parse choices + answer line
  for (; i < cleaned.length; i++) {
    const line = cleaned[i];
    if (!line) continue;

    const cm = line.match(choiceRegex);
    if (cm) {
      const key = cm[1].toUpperCase();
      choices[key] = cm[2].trim();
      continue;
    }

    const am = line.match(answerRegex);
    if (am) {
      answer = am[1].toUpperCase();
      continue;
    }
  }

  // Validate
  const text = questionTextParts.join(" ").replace(/[ ]{2,}/g, " ").trim();
  const hasABCD = ["A","B","C","D"].every(k => !!choices[k]);
  if (!text || !hasABCD || !answer) return null;

  return { number, text, source: sourceLine, choices, answer };
}

// ---------- UI ----------
function renderQuestion() {
  const q = questions[currentIndex];
  elQMeta.textContent = `Question ${currentIndex + 1} / ${questions.length} (DOC #${q.number})`;
  elQText.textContent = q.text;
  elQSource.textContent = q.source || "";

  elQOptions.innerHTML = "";
  for (const L of ["A","B","C","D"]) {
    const id = `opt_${L}`;
    const label = document.createElement("label");
    label.innerHTML = `
      <input type="radio" name="choice" id="${id}" value="${L}">
      <div><strong>${L}.</strong> ${escapeHtml(q.choices[L])}</div>
    `;
    elQOptions.appendChild(label);
  }

  if (wrongPool.has(currentIndex)) setStatus("This question is in Review Missed.", "warn");
  else setStatus("Select an option and click Check.", "ok");

  updateStats();
}

function checkAnswer(revealOnly) {
  const q = questions[currentIndex];
  const selected = document.querySelector('input[name="choice"]:checked')?.value || null;

  if (revealOnly) {
    setStatus(`Answer (debug): ${q.answer}`, "warn");
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
    wrongPool.delete(currentIndex);
    setStatus("✅ Correct!", "ok");
  } else {
    wrongPool.add(currentIndex);
    setStatus(`❌ Not correct. Correct answer is ${q.answer}. Added to Review Missed.`, "err");
  }

  updateStats();
}

function resetQuizState() {
  questions = [];
  currentIndex = 0;
  attempted.clear();
  correct.clear();
  firstTryCorrect.clear();
  wrongPool.clear();
  firstAttemptDone.clear();
  updateStats();
  elQuizArea.style.display = "none";
}

function updateStats() {
  elStatCorrect.textContent = String(correct.size);
  elStatAttempted.textContent = String(attempted.size);
  elStatFirstTry.textContent = String(firstTryCorrect.size);
  elStatReviewPool.textContent = String(wrongPool.size);
}

function setStatus(msg, type) {
  elStatus.classList.remove("ok", "err", "warn");
  elStatus.classList.add(type);
  elStatus.textContent = msg;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
