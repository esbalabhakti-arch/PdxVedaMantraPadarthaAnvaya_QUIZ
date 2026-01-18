// ============================================================
// VEDA PODCAST LEARNING CHECK QUIZ
// - Reads *_quiz.docx files from /Images using GitHub API
// - Parses MCQs from DOCX (your exact format: "1.", options, "Correct Answer:", "Check:")
// - Shows ONE question at a time
// - Won't go next until correct
// - Tracks: Attempted, Correct, First-try Correct
// - If not correct in first attempt, it is queued for "Review Missed"
// ============================================================

const $ = (id) => document.getElementById(id);

// UI
const podcastSelect = $("podcastSelect");

const btnQuiz = $("btnQuiz");
const btnReview = $("btnReview");

const btnStart = $("btnStart");
const btnFinish = $("btnFinish");
const btnCheck = $("btnCheck");
const btnNext = $("btnNext");

const pillProgress = $("pillProgress");
const pillScore = $("pillScore");

const qText = $("qText");
const qSource = $("qSource");
const optionsEl = $("options");
const feedbackEl = $("feedback");

// Modal
const modalBackdrop = $("modalBackdrop");
const summaryText = $("summaryText");
const btnCloseModal = $("btnCloseModal");

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function setText(el, v) { if (el) el.textContent = v; }

function openModal(msg) {
  setText(summaryText, msg);
  modalBackdrop.style.display = "flex";
}
function closeModal() {
  modalBackdrop.style.display = "none";
}
btnCloseModal?.addEventListener("click", closeModal);
modalBackdrop?.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal();
});

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sanitizeLine(s) {
  return (s || "").replace(/\u00A0/g, " ").trim();
}

// ------------------------------------------------------------
// GitHub repo auto-detect (works on github.io)
// ------------------------------------------------------------
function detectGitHubRepo() {
  // On GitHub Pages: https://<owner>.github.io/<repo>/
  const host = window.location.hostname;
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const isGhPages = host.endsWith("github.io") && pathParts.length >= 1;

  if (!isGhPages) return null;

  const owner = host.split(".")[0];
  const repo = pathParts[0];
  return { owner, repo };
}

// ------------------------------------------------------------
// Load quiz file list from GitHub API
// ------------------------------------------------------------
async function listQuizFiles() {
  const repoInfo = detectGitHubRepo();

  // Fallback (for local testing) — update if needed
  // If you run locally, GitHub API still works if the repo is public,
  // but owner/repo detection may fail, so you can hardcode:
  // const repoInfo = { owner: "esbalabhakti-arch", repo: "YOUR_QUIZ_REPO_NAME" };

  if (!repoInfo) {
    throw new Error(
      "Could not detect GitHub repo from URL.\n" +
      "This page is intended to run on GitHub Pages (https://<owner>.github.io/<repo>/)."
    );
  }

  const { owner, repo } = repoInfo;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/Images`;

  const res = await fetch(apiUrl, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(
      `GitHub API error listing /Images\n` +
      `${apiUrl}\nHTTP ${res.status} ${res.statusText}\n\n` +
      `Check:\n- Repo is PUBLIC\n- Folder name is exactly: Images\n- GitHub Pages is enabled`
    );
  }

  const items = await res.json();
  const quizFiles = items
    .filter(x => x.type === "file" && typeof x.name === "string" && x.name.toLowerCase().endsWith("_quiz.docx"))
    .map(x => ({
      name: x.name,
      // Use site-relative path for fetch
      path: `Images/${x.name}`,
      id: x.name.replace(/_quiz\.docx$/i, "")
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!quizFiles.length) {
    throw new Error(
      "No *_quiz.docx files found in /Images.\n" +
      "Make sure your quiz documents are inside the Images folder and named like:\n" +
      "101_Intro_1_quiz.docx"
    );
  }

  return quizFiles;
}

// ------------------------------------------------------------
// DOCX -> raw text via Mammoth, then parse
// ------------------------------------------------------------
async function docxToRawText(docxPath) {
  if (!window.mammoth) {
    throw new Error("mammoth.js did not load. Check the script tag in index.html.");
  }

  const res = await fetch(docxPath, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(
      `Could not fetch: ${docxPath}\nHTTP ${res.status} ${res.statusText}\n\n` +
      `Check folder and file name case.\n` +
      `Folder must be: Images (capital I).`
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return (result.value || "");
}

function parseQuizRawText(raw, sourceFileName) {
  // Your docs have a header + then repeating blocks:
  // 1.
  // Question...
  // [(Source: ...)]
  // A. ...
  // B. ...
  // ...
  // Correct Answer: B
  // Check: ...
  //
  // We'll parse in a forgiving way.

  const lines = raw
    .split(/\r?\n/)
    .map(sanitizeLine)
    .filter(l => l.length > 0);

  const questions = [];
  let i = 0;

  const isQnum = (s) => /^\d+\.$/.test(s);

  while (i < lines.length) {
    if (!isQnum(lines[i])) { i++; continue; }

    const qnum = lines[i]; // e.g. "1."
    i++;

    // question text (could be multiple lines until a source/options start)
    let q = [];
    while (i < lines.length) {
      const s = lines[i];
      if (s.startsWith("A.") || s.startsWith("[(Source:") || s.startsWith("Correct Answer:") || isQnum(s)) break;
      q.push(s);
      i++;
    }
    const questionText = q.join(" ").trim();

    // optional source line
    let sourceLine = "";
    if (i < lines.length && lines[i].startsWith("[(Source:")) {
      sourceLine = lines[i];
      i++;
    }

    // options: may be in one line or multiple lines
    let optLines = [];
    while (i < lines.length && !lines[i].startsWith("Correct Answer:") && !isQnum(lines[i])) {
      optLines.push(lines[i]);
      i++;
    }
    const optBlob = optLines.join(" ").replace(/\s+/g, " ").trim();

    // extract A-D options
    // split on "A." "B." "C." "D."
    const parts = optBlob.split(/(?=[A-D]\.)/g).map(sanitizeLine).filter(Boolean);
    const options = {};
    for (const part of parts) {
      const m = part.match(/^([A-D])\.\s*(.*)$/);
      if (m) options[m[1]] = m[2].trim();
    }

    // correct answer
    let correct = "";
    if (i < lines.length && lines[i].startsWith("Correct Answer:")) {
      const m = lines[i].match(/Correct Answer:\s*([A-D])/i);
      correct = m ? m[1].toUpperCase() : "";
      i++;
    }

    // check/explanation (may span multiple lines until next question number)
    let expl = [];
    if (i < lines.length && lines[i].startsWith("Check:")) {
      expl.push(lines[i].replace(/^Check:\s*/i, "").trim());
      i++;
      while (i < lines.length && !isQnum(lines[i])) {
        // stop if we hit something that looks like next block
        if (/^Correct Answer:/.test(lines[i])) break;
        expl.push(lines[i]);
        i++;
      }
    }
    const explanation = expl.join(" ").trim();

    // Only accept valid questions
    const hasMin = questionText && options.A && options.B && options.C && options.D && correct;
    if (hasMin) {
      questions.push({
        qnum,
        questionText,
        options,
        correct,
        explanation,
        sourceFileName,
        sourceLine
      });
    }
  }

  return questions;
}

// ------------------------------------------------------------
// State
// ------------------------------------------------------------
let quizFiles = [];
let quizBankByPodcast = new Map(); // key: file.id, value: {file, questions, title}
let activePodcastId = null;

let mode = "quiz"; // "quiz" | "review"

// For a run
let runQuestions = [];           // array of question objects
let reviewQueue = [];            // questions missed first try
let currentIndex = 0;
let currentQuestion = null;
let attemptsForThisQ = 0;

// stats
let attemptedSet = new Set();    // unique questions attempted (by unique key)
let correctSet = new Set();      // unique questions answered correctly (by unique key)
let firstTrySet = new Set();     // unique questions correct on first attempt
let totalAttempts = 0;

// encouragement
const ENCOURAGE = [
  "Nice! ✅",
  "Great job! 🌟",
  "Super! 🙌",
  "Excellent! 💯",
  "Well done! 🎉",
  "Perfect! ✅"
];
const TRY_AGAIN = [
  "Almost — try again 🙂",
  "Good attempt — one more try 👌",
  "Not yet — re-read and try again 💡",
  "Close — pick the best option and try again 🙂"
];

function qKey(q) {
  // stable id for stats
  return `${q.sourceFileName}::${q.qnum}`;
}

function updatePills() {
  const total = runQuestions.length;
  const which = currentIndex + 1;

  let label = (mode === "review") ? "REVIEW MISSED" : "QUIZ";
  setText(pillProgress, `${label} • Q ${Math.min(which, total)} / ${total} • Attempts (total): ${totalAttempts}`);

  setText(
    pillScore,
    `Correct: ${correctSet.size} • Attempted: ${attemptedSet.size} • First-try: ${firstTrySet.size}`
  );
}

function setMode(newMode) {
  mode = newMode;
  if (newMode === "quiz") {
    btnQuiz.classList.add("active");
    btnReview.classList.remove("active");
  } else {
    btnReview.classList.add("active");
    btnQuiz.classList.remove("active");
  }
}

// ------------------------------------------------------------
// UI rendering
// ------------------------------------------------------------
function clearFeedback() {
  feedbackEl.className = "feedback";
  feedbackEl.style.display = "none";
  feedbackEl.textContent = "";
}

function showFeedback(type, msg) {
  feedbackEl.className = `feedback ${type}`;
  feedbackEl.style.display = "block";
  feedbackEl.textContent = msg;
}

function renderQuestion(q) {
  currentQuestion = q;
  attemptsForThisQ = 0;

  clearFeedback();
  btnNext.disabled = true;
  btnCheck.disabled = true;

  setText(qText, q.questionText || "Question");
  setText(qSource, q.sourceLine ? q.sourceLine : (q.sourceFileName ? `Source: ${q.sourceFileName}` : ""));

  optionsEl.innerHTML = "";

  const letters = ["A","B","C","D"];
  letters.forEach(letter => {
    const id = `opt_${letter}`;
    const label = document.createElement("label");
    label.className = "opt";
    label.setAttribute("for", id);

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "answer";
    input.id = id;
    input.value = letter;

    input.addEventListener("change", () => {
      btnCheck.disabled = false;
    });

    const text = document.createElement("div");
    text.innerHTML = `<strong>${letter}.</strong> ${escapeHtml(q.options[letter] || "")}`;

    label.appendChild(input);
    label.appendChild(text);
    optionsEl.appendChild(label);
  });

  updatePills();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function getSelectedAnswer() {
  const sel = document.querySelector('input[name="answer"]:checked');
  return sel ? sel.value : "";
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ------------------------------------------------------------
// Quiz flow
// ------------------------------------------------------------
function buildRunQuestions() {
  // For now: run is based on selected podcast only
  const bank = quizBankByPodcast.get(activePodcastId);
  if (!bank || !bank.questions.length) {
    runQuestions = [];
    return;
  }

  // keep order as in doc (or shuffle if you want)
  // runQuestions = shuffle(bank.questions);
  runQuestions = bank.questions.slice();

  reviewQueue = [];
  currentIndex = 0;
  currentQuestion = null;

  attemptedSet = new Set();
  correctSet = new Set();
  firstTrySet = new Set();
  totalAttempts = 0;

  setMode("quiz");
}

function startRun() {
  if (!activePodcastId) return;

  buildRunQuestions();
  if (!runQuestions.length) {
    setText(qText, "No questions found in this quiz DOCX (format may not match).");
    return;
  }
  renderQuestion(runQuestions[0]);
}

function nextQuestion() {
  clearFeedback();
  btnNext.disabled = true;
  btnCheck.disabled = true;

  currentIndex++;

  // end of main quiz
  if (mode === "quiz" && currentIndex >= runQuestions.length) {
    if (reviewQueue.length > 0) {
      // switch to review mode
      setMode("review");
      runQuestions = reviewQueue.slice();
      reviewQueue = [];
      currentIndex = 0;
      renderQuestion(runQuestions[0]);
      return;
    }

    showSummaryAndStop(true);
    return;
  }

  // end of review
  if (mode === "review" && currentIndex >= runQuestions.length) {
    showSummaryAndStop(true);
    return;
  }

  renderQuestion(runQuestions[currentIndex]);
}

function showSummaryAndStop(finishedNaturally) {
  const msg =
    `Attempted (unique): ${attemptedSet.size}\n` +
    `Correct (unique): ${correctSet.size}\n` +
    `Correct on first try: ${firstTrySet.size}\n\n` +
    (finishedNaturally
      ? "Great work! Keep going — a little every day builds real mastery 🙏"
      : "Nice session! Come back anytime and continue 🙏");

  openModal(msg);

  // freeze UI softly
  btnCheck.disabled = true;
  btnNext.disabled = true;
  optionsEl.innerHTML = "";
  setText(qText, "Quiz ended. You can press Start again anytime.");
  setText(qSource, "");
  clearFeedback();
  updatePills();
}

// ------------------------------------------------------------
// Checking answers (NO autoplay, user-driven)
// ------------------------------------------------------------
function checkAnswer() {
  if (!currentQuestion) return;

  const chosen = getSelectedAnswer();
  if (!chosen) return;

  attemptsForThisQ++;
  totalAttempts++;

  const key = qKey(currentQuestion);
  attemptedSet.add(key);

  const correct = currentQuestion.correct;

  if (chosen === correct) {
    // first attempt success?
    if (attemptsForThisQ === 1) {
      firstTrySet.add(key);
    } else {
      // if they missed it on first try in QUIZ mode, queue for review
      if (mode === "quiz") {
        // add only once
        if (!reviewQueue.find(q => qKey(q) === key)) {
          reviewQueue.push(currentQuestion);
        }
      }
    }

    correctSet.add(key);

    const praise = pickRandom(ENCOURAGE);
    const explain = currentQuestion.explanation ? `\n\nWhy: ${currentQuestion.explanation}` : "";
    showFeedback("good", `${praise}\nCorrect answer: ${correct}.${explain}`);

    btnNext.disabled = false;
    btnCheck.disabled = true;
  } else {
    const nudge = pickRandom(TRY_AGAIN);
    showFeedback("bad", `${nudge}\n(You must get it correct before moving on.)`);
    btnNext.disabled = true; // stay on same question
    btnCheck.disabled = false;
  }

  updatePills();
}

// ------------------------------------------------------------
// Load everything
// ------------------------------------------------------------
async function init() {
  setText(pillProgress, "Loading quiz files…");
  setText(pillScore, "Correct: 0 • Attempted: 0 • First-try: 0");

  try {
    quizFiles = await listQuizFiles();

    // Populate podcast select using filenames first
    podcastSelect.innerHTML = "";
    quizFiles.forEach(f => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.id; // will be upgraded after parsing header
      podcastSelect.appendChild(opt);
    });

    // Pre-load and parse all quizzes (small files; ok)
    for (const f of quizFiles) {
      const raw = await docxToRawText(f.path);
      const questions = parseQuizRawText(raw, f.name);

      // Try to get a nicer title from the first header line if present
      // e.g. "Below is a rigorous MCQ set (50 questions) ... Session 101 – Introduction (Part 1)."
      const firstLine = sanitizeLine(raw.split(/\r?\n/)[0] || "");
      let title = f.id;
      const m = firstLine.match(/Session\s+(\d+)\s*[–-]\s*(.*?)(?:\.\s*$|$)/i);
      if (m) {
        title = `${m[1]} — ${m[2].trim()}`;
      }

      quizBankByPodcast.set(f.id, { file: f, questions, title });
    }

    // Upgrade select labels
    [...podcastSelect.options].forEach(opt => {
      const bank = quizBankByPodcast.get(opt.value);
      if (bank?.title) opt.textContent = bank.title;
    });

    activePodcastId = podcastSelect.value;

    setText(pillProgress, "Ready. Select a podcast and press Start.");
    setText(qText, "Select a podcast, then press Start.");
    setText(qSource, "");
    optionsEl.innerHTML = "";
    clearFeedback();
    updatePills();

  } catch (err) {
    setText(pillProgress, "Error loading quizzes.");
    setText(qText, String(err));
    setText(qSource, "");
    optionsEl.innerHTML = "";
    clearFeedback();
  }
}

// ------------------------------------------------------------
// Events
// ------------------------------------------------------------
podcastSelect?.addEventListener("change", () => {
  activePodcastId = podcastSelect.value;

  // reset UI prompt
  btnCheck.disabled = true;
  btnNext.disabled = true;
  clearFeedback();
  optionsEl.innerHTML = "";
  setText(qText, "Press Start to begin the quiz.");
  setText(qSource, "");
  setText(pillProgress, "Ready. Press Start.");
});

btnStart?.addEventListener("click", () => {
  startRun();
});

btnCheck?.addEventListener("click", () => {
  checkAnswer();
});

btnNext?.addEventListener("click", () => {
  nextQuestion();
});

btnFinish?.addEventListener("click", () => {
  showSummaryAndStop(false);
});

// Toggle buttons (purely UI/intent; review mode auto-starts after quiz ends)
btnQuiz?.addEventListener("click", () => {
  setMode("quiz");
  clearFeedback();
});
btnReview?.addEventListener("click", () => {
  setMode("review");
  clearFeedback();
  // Note: review mode is automatically triggered after quiz ends,
  // because it depends on what was missed.
});

// Start
init();
