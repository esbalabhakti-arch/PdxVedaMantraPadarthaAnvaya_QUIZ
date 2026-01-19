/* -----------------------------
   CONFIG: add podcasts here
   IMPORTANT:
   - Keep file paths RELATIVE to index.html
   - Prefer putting DOCX under "Images/" if that’s where they live
-------------------------------- */
const PODCASTS = [
  { id: "101", title: "101 — Intro 1", file: "Images/101_Intro_1_quiz.docx" },
  { id: "102", title: "102 — Intro 2", file: "Images/102_Intro_2_quiz.docx" },
  { id: "103", title: "103 — 1st Panchadi", file: "Images/103_1st_Panchadi_quiz.docx" },
  { id: "104", title: "104 — 2nd Panchadi (Part 1)", file: "Images/104_2nd_Panchadi_Part1_quiz.docx" },
];

/**
 * Sets are defined as slices over the FULL podcast question list (typically 50).
 * Labels are short so they fit in one row.
 */
const SETS = [
  { key: "set1", label: "1–10", start: 0, end: 10 },
  { key: "set2", label: "11–20", start: 10, end: 20 },
  { key: "set3", label: "21–30", start: 20, end: 30 },
  { key: "set4", label: "31–40", start: 30, end: 40 },
  { key: "set5", label: "41–50", start: 40, end: 50 },
  { key: "missed", label: "Missed", start: 0, end: 0 },
];

/* -----------------------------
   STATE
-------------------------------- */
let selectedPodcastId = PODCASTS[0]?.id || null;
let selectedSetKey = "set1";

let allQuestions = [];          // parsed N for current podcast
let activeQuestions = [];       // selected set slice OR missed pool
let qIndex = 0;

let attempted = 0;
let correct = 0;
let firstTryCorrect = 0;

let currentFirstAttempt = true;

// Missed pool stores question objects (unique by stableKey)
const missedPool = [];

/* -----------------------------
   DOM
-------------------------------- */
const podcastSelect = document.getElementById("podcastSelect");
const setTabs = document.getElementById("setTabs");

const startBtn = document.getElementById("startBtn");
const finishBtn = document.getElementById("finishBtn");

const quizArea = document.getElementById("quizArea");

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

  renderTabs();
  updateStats();

  // Events
  podcastSelect.addEventListener("change", async () => {
    selectedPodcastId = podcastSelect.value;
    await loadPodcastQuestions(selectedPodcastId);
    showMessage("Pick a set, then press Start.", "");
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

  // Initial load
  loadPodcastQuestions(selectedPodcastId)
    .then(() => showMessage("Pick a set, then press Start.", ""))
    .catch((e) => {
      console.error(e);
      showMessage("Could not load the quiz. Open DevTools → Console for details.", "bad");
    });
}

/* -----------------------------
   TABS
-------------------------------- */
function renderTabs() {
  setTabs.innerHTML = "";
  for (const s of SETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tab" + (s.key === selectedSetKey ? " active" : "");
    b.dataset.key = s.key;

    if (s.key === "missed") {
      b.textContent = `${s.label} (${missedPool.length})`;
    } else {
      b.textContent = s.label;
    }

    b.addEventListener("click", () => {
      selectedSetKey = s.key;
      renderTabs();
      showMessage("Press Start to begin this set.", "");
    });

    setTabs.appendChild(b);
  }
}

/* -----------------------------
   LOADING + PARSING (more robust)
-------------------------------- */

/**
 * Build a fully-qualified URL (important on GitHub Pages subpaths).
 */
function resolveUrl(relPath) {
  return new URL(relPath, window.location.href).toString();
}

/**
 * Try fetching the DOCX with fallback path variants.
 * This helps when folder case differs (Images vs images) or paths change.
 */
async function fetchWithFallback(relPath) {
  const variants = [];

  // 1) as provided
  variants.push(relPath);

  // 2) common case variants
  if (relPath.startsWith("Images/")) variants.push("images/" + relPath.slice("Images/".length));
  if (relPath.startsWith("images/")) variants.push("Images/" + relPath.slice("images/".length));

  // 3) also try without leading "./"
  variants.push(relPath.replace(/^\.\//, ""));

  // de-dup
  const uniq = [...new Set(variants)];

  let lastErr = null;

  for (const v of uniq) {
    const url = resolveUrl(v);
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        lastErr = new Error(`Fetch failed (${res.status}) for ${url}`);
        continue;
      }
      const ab = await res.arrayBuffer();
      return { arrayBuffer: ab, usedUrl: url };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("Fetch failed for all fallback paths.");
}

async function loadPodcastQuestions(podcastId) {
  const p = PODCASTS.find(x => x.id === podcastId);
  if (!p) throw new Error("Unknown podcast id: " + podcastId);

  showMessage(`Loading: ${p.file}`, "");

  allQuestions = [];

  // Fetch DOCX (with fallback)
  const { arrayBuffer, usedUrl } = await fetchWithFallback(p.file);

  // Mammoth extracts text from DOCX
  let rawText = "";
  try {
    const result = await mammoth.extractRawText({ arrayBuffer });
    rawText = (result?.value || "").replace(/\r/g, "");
  } catch (e) {
    console.error(e);
    throw new Error("Mammoth failed to read the DOCX. Is it a valid .docx file?");
  }

  // Parse
  const parsed = parseQuestionsFromText(rawText);
  allQuestions = parsed;

  if (!allQuestions.length) {
    console.warn("Raw extracted text (first 4000 chars):\n", rawText.slice(0, 4000));
    showMessage(
      `Loaded DOCX but parsed 0 questions ❌\n\nFile URL tried:\n${usedUrl}\n\n` +
      `This usually means the DOCX text format doesn't match the parser patterns.\n` +
      `Open DevTools → Console to see extracted text preview.`,
      "bad"
    );
  } else {
    showMessage(`Loaded ${allQuestions.length} questions ✅  Pick a set and press Start.`, "good");
  }

  return allQuestions;
}

/**
 * More forgiving parser:
 * Supports:
 * - Question start: "1.", "1)", "1 -", "Q1.", "Q 1)"
 * - Options: "A.", "A)", "A -", also lowercase "a)"
 * - Options can sometimes be on the same line
 * - Correct answer: "Correct Answer: C", "Answer: C", "Ans: C", "Correct: C"
 * - Wrapped lines (question or option continuation)
 * - Ignores "Check:" lines (explanations)
 */
function parseQuestionsFromText(text) {
  // Normalize NBSP, weird spaces
  const normalized = (text || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n"); // collapse huge gaps

  // Work with "paragraph-ish" chunks to reduce line-break sensitivity
  const chunks = normalized
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

  const out = [];
  let cur = null;
  let lastWasOption = false;

  const qStartRe = /^(?:Q\s*)?(\d+)\s*[\.\)\-:]\s+(.*)$/i;
  const optRe = /^([A-Da-d])\s*[\.\)\-:]\s+(.*)$/;
  const correctRe = /^(?:Correct\s*Answer|Correct\s*Option|Correct|Answer|Ans)\s*[:\-]\s*([A-D])\b/i;

  function finalize() {
    if (!cur) return;

    // Sometimes options are fewer because they were inline; try to keep only good ones.
    if (cur.options.length === 4 && cur.correctIndex >= 0 && cur.correctIndex <= 3) {
      cur.stableKey = (cur.source || "") + "||" + cur.q;
      out.push(cur);
    }
    cur = null;
    lastWasOption = false;
  }

  // Helper: split inline options on one line like "A) ... B) ... C) ... D) ..."
  function trySplitInlineOptions(line) {
    // Find positions of option markers
    const markers = [];
    const re = /(^|[\s])([A-Da-d])\s*[\.\)\-:]\s+/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      markers.push({ idx: m.index + (m[1] ? m[1].length : 0), letter: m[2] });
    }
    if (markers.length < 2) return null;

    const parts = [];
    for (let i = 0; i < markers.length; i++) {
      const start = markers[i].idx;
      const end = (i + 1 < markers.length) ? markers[i + 1].idx : line.length;
      const seg = line.slice(start, end).trim();
      const mm = seg.match(/^([A-Da-d])\s*[\.\)\-:]\s+(.*)$/);
      if (!mm) continue;
      parts.push({ letter: mm[1].toUpperCase(), text: (mm[2] || "").trim() });
    }
    if (parts.length >= 2) return parts;
    return null;
  }

  for (let i = 0; i < chunks.length; i++) {
    const line = chunks[i];

    // ignore check/explanation lines
    if (/^Check\s*:/i.test(line)) continue;

    // Question start
    const qm = line.match(qStartRe);
    if (qm) {
      finalize();
      cur = {
        q: (qm[2] || "").trim(),
        options: [],
        correctIndex: -1,
        source: "",
      };
      lastWasOption = false;
      continue;
    }

    if (!cur) {
      // Skip text until first question
      continue;
    }

    // Correct answer line
    const cm = line.match(correctRe);
    if (cm) {
      const letter = (cm[1] || "").toUpperCase();
      cur.correctIndex = letter.charCodeAt(0) - "A".charCodeAt(0);
      lastWasOption = false;
      continue;
    }

    // Correct answer embedded in a longer line, e.g. "... (Correct Answer: C)"
    const embedded = line.match(/(?:Correct\s*Answer|Correct|Answer|Ans)\s*[:\-]\s*([A-D])\b/i);
    if (embedded) {
      const letter = (embedded[1] || "").toUpperCase();
      cur.correctIndex = letter.charCodeAt(0) - "A".charCodeAt(0);
      // continue parsing other content too
      // (we won't `continue` here)
    }

    // Inline options on the same line
    const inline = trySplitInlineOptions(line);
    if (inline && cur.options.length === 0) {
      // Only use this if we haven't started collecting options yet (avoid duplicates)
      const sorted = inline
        .sort((a, b) => a.letter.localeCompare(b.letter))
        .slice(0, 4);

      // Place them in A,B,C,D order if possible
      const map = new Map(sorted.map(p => [p.letter, p.text]));
      const letters = ["A","B","C","D"];
      const opts = letters.map(L => map.get(L)).filter(Boolean);

      if (opts.length >= 2) {
        // If we got at least 2, accept (and later wrapping can append)
        cur.options = [];
        letters.forEach(L => {
          if (map.has(L)) cur.options.push(map.get(L));
        });
        lastWasOption = true;
        continue;
      }
    }

    // Regular option line
    const om = line.match(optRe);
    if (om) {
      const letter = (om[1] || "").toUpperCase();
      const text = (om[2] || "").trim();

      // Make sure options are appended in the order they appear in the doc
      cur.options.push(text);
      lastWasOption = true;
      continue;
    }

    // Wrapping/continuations:
    // If we've started options, append to last option. Else append to question.
    if (cur.options.length > 0 && lastWasOption) {
      cur.options[cur.options.length - 1] = (cur.options[cur.options.length - 1] + " " + line).trim();
      continue;
    }

    if (cur.options.length === 0) {
      // Question continuation
      cur.q = (cur.q + " " + line).trim();
      continue;
    }

    // If options exist but lastWasOption is false, still treat as continuation of question (rare)
    cur.q = (cur.q + " " + line).trim();
  }

  finalize();

  // Post-clean: remove any accidental extras, trim
  for (const q of out) {
    q.q = (q.q || "").trim();
    q.options = (q.options || []).map(s => (s || "").trim());
  }

  return out;
}

/* -----------------------------
   QUIZ FLOW
-------------------------------- */
function startQuiz() {
  if (!allQuestions.length) {
    showMessage("No questions loaded yet.", "bad");
    return;
  }

  activeQuestions = buildActiveList();
  if (!activeQuestions.length) {
    showMessage(
      selectedSetKey === "missed"
        ? "Missed pool is empty 🎉 (It fills when you answer something wrong once.)"
        : "This set has no questions (unexpected).",
      "bad"
    );
    return;
  }

  qIndex = 0;
  currentFirstAttempt = true;

  renderQuestion();
}

function buildActiveList() {
  if (selectedSetKey === "missed") return missedPool.slice();

  const s = SETS.find(x => x.key === selectedSetKey);
  if (!s) return [];
  return allQuestions.slice(s.start, s.end);
}

function finishQuiz() {
  const msg =
    `Session summary ✅\n` +
    `• Attempted: ${attempted}\n` +
    `• Correct: ${correct}\n` +
    `• First-try correct: ${firstTryCorrect}\n` +
    `• Missed pool: ${missedPool.length}\n\n` +
    `Pick another set and press Start.`;

  showMessage(msg, "good");
}

function renderQuestion() {
  const qObj = activeQuestions[qIndex];
  if (!qObj) return;

  currentFirstAttempt = true;

  const setLabel = selectedSetKey === "missed"
    ? `Missed (${activeQuestions.length})`
    : (SETS.find(x => x.key === selectedSetKey)?.label || "Set");

  quizArea.innerHTML = "";

  const header = document.createElement("div");
  header.className = "qHeader";
  header.textContent = `${setLabel} • Q ${qIndex + 1} / ${activeQuestions.length}`;
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
    badge.textContent = letters[idx] || "";

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
  msg.textContent = "Pick an option — I’ll tell you immediately.";
  quizArea.appendChild(msg);
}

/**
 * Behavior you requested:
 * - Immediately indicate correct/wrong
 * - If correct → auto next question (no button)
 * - If wrong → stay on same question until correct
 */
function onPickOption(idx, cardEl, qObj) {
  const allOptEls = [...quizArea.querySelectorAll(".opt")];

  attempted++;
  updateStats();

  const isCorrect = idx === qObj.correctIndex;

  if (isCorrect) {
    // Mark correct
    cardEl.classList.add("good");
    allOptEls.forEach(el => el.classList.add("disabled"));
    correct++;

    if (currentFirstAttempt) firstTryCorrect++;

    updateStats();
    setFeedback(pickEncouragement(), "good");

    // Auto-advance after a short pause
    setTimeout(() => {
      qIndex++;
      if (qIndex >= activeQuestions.length) {
        showMessage(
          `Finished ✅\n\nAttempted: ${attempted}\nCorrect: ${correct}\nFirst-try: ${firstTryCorrect}\nMissed pool: ${missedPool.length}\n\nPick another set and press Start.`,
          "good"
        );
        return;
      }
      renderQuestion();
    }, 650);

  } else {
    // Wrong: stay here until correct
    cardEl.classList.add("bad");

    // Put into missed pool only if wrong on first attempt
    if (currentFirstAttempt) addToMissed(qObj);

    currentFirstAttempt = false;
    setFeedback("Not this one ❌ Try again.", "bad");
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
  quizArea.innerHTML = "";
  const msg = document.createElement("div");
  msg.className = "msg" + (kind ? ` ${kind}` : "");
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
  statMissed.textContent = `Missed pool: ${missedPool.length}`;
}

function pickEncouragement() {
  const arr = [
    "Correct ✅",
    "Nice ✅",
    "Perfect ✅",
    "Great ✅",
    "Yes ✅",
  ];
  return arr[Math.floor(Math.random() * arr.length)];
}

/* -----------------------------
   START
-------------------------------- */
init();
