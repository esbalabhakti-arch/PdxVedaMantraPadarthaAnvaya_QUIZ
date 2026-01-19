/* =========================================================
   ✅ FIX FOR DOCX LOADING ON GITHUB PAGES (incl. Git LFS)
   - Tries GitHub Pages path first (same-origin)
   - Detects Git LFS pointer files and auto-falls back to:
     https://media.githubusercontent.com/media/<owner>/<repo>/<branch>/<path>
   - Shows clear diagnostics in the UI when failing
   ========================================================= */

/* ---- SET THESE THREE CORRECTLY ---- */
const REPO_OWNER  = "esbalabhakti-arch";
const REPO_NAME   = "PdxVedaMantraPadarthaAnvaya_QUIZ";
const REPO_BRANCH = "main";

/* -----------------------------
   PODCASTS (paths relative to repo root)
-------------------------------- */
const PODCASTS = [
  { id: "101", title: "101 — Intro 1", file: "Images/101_Intro_1_quiz.docx" },
  { id: "102", title: "102 — Intro 2", file: "Images/102_Intro_2_quiz.docx" },
  { id: "103", title: "103 — 1st Panchadi", file: "Images/103_1st_Panchadi_quiz.docx" },
  { id: "104", title: "104 — 2nd Panchadi (Part 1)", file: "Images/104_2nd_Panchadi_Part1_quiz.docx" },
];

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

let allQuestions = [];
let activeQuestions = [];
let qIndex = 0;

let attempted = 0;
let correct = 0;
let firstTryCorrect = 0;
let currentFirstAttempt = true;

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
   INIT
-------------------------------- */
function init() {
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

  podcastSelect.addEventListener("change", async () => {
    selectedPodcastId = podcastSelect.value;
    await loadPodcastQuestions(selectedPodcastId);
    showMessage("Pick a set, then press Start.", "");
  });

  startBtn.addEventListener("click", async () => {
    if (!allQuestions.length) await loadPodcastQuestions(selectedPodcastId);
    startQuiz();
  });

  finishBtn.addEventListener("click", () => finishQuiz());

  loadPodcastQuestions(selectedPodcastId)
    .then(() => showMessage("Pick a set, then press Start.", ""))
    .catch((e) => {
      console.error(e);
      showMessage("Could not load the quiz. See error details above.", "bad");
    });
}

/* -----------------------------
   URL helpers
-------------------------------- */
function resolveUrl(relPath) {
  // Important on GitHub Pages subpaths
  return new URL(relPath, window.location.href).toString();
}

function githubMediaUrl(repoPath) {
  // Works well for LFS-backed files too
  return `https://media.githubusercontent.com/media/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/${repoPath}`;
}

function githubRawUrl(repoPath) {
  return `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/${repoPath}`;
}

function looksLikeGitLFSPointer(u8) {
  // LFS pointer is plain text; begins with "version https://git-lfs.github.com/spec"
  const head = new TextDecoder().decode(u8.slice(0, 120));
  return head.includes("git-lfs.github.com/spec");
}

async function fetchBinary(url) {
  const res = await fetch(url, { cache: "no-store" });
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}\nURL: ${url}\nContent-Type: ${ct}`);
  }
  const ab = await res.arrayBuffer();
  return { ab, ct, bytes: ab.byteLength, url };
}

async function fetchDocxSmart(repoRelativePath) {
  // 1) Try GitHub Pages same-origin first
  const pageUrl = resolveUrl(repoRelativePath);

  // 2) Try case variants for Images folder
  const variants = [...new Set([
    repoRelativePath,
    repoRelativePath.replace(/^Images\//, "images/"),
    repoRelativePath.replace(/^images\//, "Images/"),
  ])];

  const attempts = [];
  let lastErr = null;

  // Try pages URLs
  for (const v of variants) {
    const u = resolveUrl(v);
    try {
      const r = await fetchBinary(u);
      attempts.push(`✅ OK (Pages): ${u}\n   bytes=${r.bytes}, type=${r.ct || "?"}`);

      const u8 = new Uint8Array(r.ab);
      if (looksLikeGitLFSPointer(u8)) {
        attempts.push(`⚠️ Detected Git LFS pointer at Pages URL. Will try GitHub media URL…`);
        break; // go to media fallback
      }
      return { arrayBuffer: r.ab, attempts };
    } catch (e) {
      attempts.push(`❌ FAIL (Pages): ${u}\n   ${String(e.message || e)}`);
      lastErr = e;
    }
  }

  // If we got here: either Pages failed, or LFS pointer detected.
  const media = githubMediaUrl(repoRelativePath);
  try {
    const r = await fetchBinary(media);
    attempts.push(`✅ OK (Media): ${media}\n   bytes=${r.bytes}, type=${r.ct || "?"}`);
    return { arrayBuffer: r.ab, attempts };
  } catch (e) {
    attempts.push(`❌ FAIL (Media): ${media}\n   ${String(e.message || e)}`);
    lastErr = e;
  }

  // Also try raw (sometimes helpful for non-LFS)
  const raw = githubRawUrl(repoRelativePath);
  try {
    const r = await fetchBinary(raw);
    attempts.push(`✅ OK (Raw): ${raw}\n   bytes=${r.bytes}, type=${r.ct || "?"}`);
    return { arrayBuffer: r.ab, attempts };
  } catch (e) {
    attempts.push(`❌ FAIL (Raw): ${raw}\n   ${String(e.message || e)}`);
    lastErr = e;
  }

  throw new Error(`All DOCX fetch attempts failed.\n\n${attempts.join("\n\n")}\n\nLast error:\n${String(lastErr?.message || lastErr)}`);
}

/* -----------------------------
   Load + parse
-------------------------------- */
async function loadPodcastQuestions(podcastId) {
  const p = PODCASTS.find(x => x.id === podcastId);
  if (!p) throw new Error("Unknown podcast id: " + podcastId);

  showMessage(`Loading quiz DOCX…\n\nFile: ${p.file}\n\n(If it fails, I will show detailed URL attempts here.)`, "");

  allQuestions = [];

  const { arrayBuffer, attempts } = await fetchDocxSmart(p.file);

  // Mammoth expects valid docx bytes
  let rawText = "";
  try {
    const result = await mammoth.extractRawText({ arrayBuffer });
    rawText = (result?.value || "").replace(/\r/g, "");
  } catch (e) {
    throw new Error(
      `Mammoth failed to read DOCX (not valid DOCX bytes).\n\n` +
      `Fetch diagnostics:\n${attempts.join("\n\n")}\n\n` +
      `Error:\n${String(e.message || e)}`
    );
  }

  const parsed = parseQuestionsFromText(rawText);
  allQuestions = parsed;

  if (!allQuestions.length) {
    // Show extracted text snippet to tune parser later if needed
    const preview = rawText.slice(0, 2500);
    showMessage(
      `DOCX downloaded, but parsed 0 questions.\n\n` +
      `Fetch diagnostics:\n${attempts.join("\n\n")}\n\n` +
      `Extracted text preview (first 2500 chars):\n` +
      `${preview}`,
      "bad"
    );
  } else {
    showMessage(
      `Loaded ${allQuestions.length} questions ✅\n\nFetch diagnostics:\n${attempts.join("\n\n")}\n\nPick a set and press Start.`,
      "good"
    );
  }

  return allQuestions;
}

/* -----------------------------
   Parser (forgiving)
-------------------------------- */
function parseQuestionsFromText(text) {
  const normalized = (text || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

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
    if (cur.options.length === 4 && cur.correctIndex >= 0 && cur.correctIndex <= 3) {
      cur.stableKey = (cur.source || "") + "||" + cur.q;
      out.push(cur);
    }
    cur = null;
    lastWasOption = false;
  }

  for (const line of chunks) {
    if (/^Check\s*:/i.test(line)) continue;

    const qm = line.match(qStartRe);
    if (qm) {
      finalize();
      cur = { q: (qm[2] || "").trim(), options: [], correctIndex: -1, source: "" };
      lastWasOption = false;
      continue;
    }
    if (!cur) continue;

    const cm = line.match(correctRe);
    if (cm) {
      const letter = (cm[1] || "").toUpperCase();
      cur.correctIndex = letter.charCodeAt(0) - 65;
      lastWasOption = false;
      continue;
    }

    const om = line.match(optRe);
    if (om) {
      cur.options.push((om[2] || "").trim());
      lastWasOption = true;
      continue;
    }

    if (cur.options.length > 0 && lastWasOption) {
      cur.options[cur.options.length - 1] = (cur.options[cur.options.length - 1] + " " + line).trim();
      continue;
    }

    if (cur.options.length === 0) {
      cur.q = (cur.q + " " + line).trim();
      continue;
    }
  }

  finalize();

  for (const q of out) {
    q.q = (q.q || "").trim();
    q.options = (q.options || []).map(s => (s || "").trim());
  }
  return out;
}

/* -----------------------------
   Tabs
-------------------------------- */
function renderTabs() {
  setTabs.innerHTML = "";
  for (const s of SETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tab" + (s.key === selectedSetKey ? " active" : "");
    b.dataset.key = s.key;
    b.textContent = (s.key === "missed") ? `${s.label} (${missedPool.length})` : s.label;

    b.addEventListener("click", () => {
      selectedSetKey = s.key;
      renderTabs();
      showMessage("Press Start to begin this set.", "");
    });

    setTabs.appendChild(b);
  }
}

/* -----------------------------
   Quiz flow
-------------------------------- */
function startQuiz() {
  if (!allQuestions.length) {
    showMessage("No questions loaded yet.\n\n(Use the message above to see exactly which DOCX URL failed.)", "bad");
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
  showMessage(
    `Session summary ✅\n` +
    `• Attempted: ${attempted}\n` +
    `• Correct: ${correct}\n` +
    `• First-try correct: ${firstTryCorrect}\n` +
    `• Missed pool: ${missedPool.length}\n\n` +
    `Pick another set and press Start.`,
    "good"
  );
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

  const letters = ["A","B","C","D"];
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

function onPickOption(idx, cardEl, qObj) {
  const allOptEls = [...quizArea.querySelectorAll(".opt")];

  attempted++;
  updateStats();

  const isCorrect = idx === qObj.correctIndex;

  if (isCorrect) {
    cardEl.classList.add("good");
    allOptEls.forEach(el => el.classList.add("disabled"));
    correct++;
    if (currentFirstAttempt) firstTryCorrect++;
    updateStats();
    setFeedback("Correct ✅", "good");

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
    cardEl.classList.add("bad");
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

function updateStats() {
  statCorrect.textContent = `Correct: ${correct}`;
  statAttempted.textContent = `Attempted: ${attempted}`;
  statFirstTry.textContent = `First-try: ${firstTryCorrect}`;
  statMissed.textContent = `Missed pool: ${missedPool.length}`;
}

/* -----------------------------
   START
-------------------------------- */
init();
