/* =========================================================
   DOCX LOADING FIX (GitHub Pages + case/path + LFS pointer)
   - Shows detailed diagnostics in a dedicated debug box
   - Validates that downloaded bytes are a real DOCX (ZIP: starts with "PK")
   - Detects LFS pointer text and retries via GitHub "media" URL
   - Tries branch candidates automatically: main, master, gh-pages
   ========================================================= */

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

const debugBox = document.getElementById("debugBox");

/* -----------------------------
   DEBUG helpers (never overwritten)
-------------------------------- */
function setDebug(text) {
  debugBox.textContent = text;
}
function appendDebug(line) {
  debugBox.textContent += "\n" + line;
}

/* -----------------------------
   GitHub inference (no manual config)
-------------------------------- */
function inferOwnerRepoFromLocation() {
  // Example: https://esbalabhakti-arch.github.io/PdxVedaMantraPadarthaAnvaya_QUIZ/
  const host = window.location.host; // esbalabhakti-arch.github.io
  const owner = host.split(".github.io")[0];

  // First path segment is repo name on Pages
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const repo = pathParts[0] || "";

  return { owner, repo };
}

function resolveUrl(relPath) {
  return new URL(relPath, window.location.href).toString();
}

function githubMediaUrl(owner, repo, branch, repoPath) {
  return `https://media.githubusercontent.com/media/${owner}/${repo}/${branch}/${repoPath}`;
}

function githubRawUrl(owner, repo, branch, repoPath) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${repoPath}`;
}

/* -----------------------------
   DOCX byte validation
-------------------------------- */
function startsWithPK(u8) {
  // DOCX is a ZIP container. ZIP signature: 0x50 0x4B => "PK"
  return u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4B;
}

function looksLikeLFSPointer(u8) {
  // LFS pointer is plain text starting with "version https://git-lfs.github.com/spec"
  const txt = new TextDecoder().decode(u8.slice(0, 120));
  return txt.includes("git-lfs.github.com/spec");
}

async function fetchArrayBuffer(url) {
  const res = await fetch(url, { cache: "no-store" });
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} | type=${ct}`);
  }
  const ab = await res.arrayBuffer();
  return { ab, ct, bytes: ab.byteLength };
}

/**
 * Smart loader:
 * 1) Try Pages URL(s): Images/ vs images/
 * 2) Validate bytes. If not ZIP or LFS pointer → try GitHub media/raw across branches.
 */
async function loadDocxSmart(repoPath) {
  const { owner, repo } = inferOwnerRepoFromLocation();
  const branches = ["main", "master", "gh-pages"];

  const variants = [...new Set([
    repoPath,
    repoPath.replace(/^Images\//, "images/"),
    repoPath.replace(/^images\//, "Images/"),
  ])];

  setDebug(
    `Debug (DOCX loader)\n` +
    `Owner: ${owner}\nRepo: ${repo}\n` +
    `Requested file: ${repoPath}\n` +
    `Now trying URLs…`
  );

  // 1) Try Pages same-origin first
  for (const v of variants) {
    const url = resolveUrl(v);
    try {
      const r = await fetchArrayBuffer(url);
      const u8 = new Uint8Array(r.ab);

      appendDebug(`✅ Pages OK: ${url}`);
      appendDebug(`   bytes=${r.bytes} | type=${r.ct || "?"}`);

      if (looksLikeLFSPointer(u8)) {
        appendDebug(`⚠️ Looks like Git LFS pointer text (NOT real docx). Will try GitHub media/raw…`);
        break;
      }
      if (!startsWithPK(u8)) {
        appendDebug(`⚠️ Downloaded content is NOT a ZIP/DOCX (missing "PK" header). Will try GitHub media/raw…`);
        break;
      }

      appendDebug(`✅ DOCX bytes look valid (ZIP header "PK").`);
      return r.ab;
    } catch (e) {
      appendDebug(`❌ Pages FAIL: ${url}`);
      appendDebug(`   ${String(e.message || e)}`);
    }
  }

  // 2) Fallback: GitHub media/raw (tries branches)
  for (const branch of branches) {
    // try media first (best for LFS)
    {
      const media = githubMediaUrl(owner, repo, branch, repoPath);
      try {
        const r = await fetchArrayBuffer(media);
        const u8 = new Uint8Array(r.ab);

        appendDebug(`✅ Media OK: ${media}`);
        appendDebug(`   bytes=${r.bytes} | type=${r.ct || "?"}`);

        if (looksLikeLFSPointer(u8)) {
          appendDebug(`❌ Media returned LFS pointer too (unexpected). Continue…`);
        } else if (!startsWithPK(u8)) {
          appendDebug(`❌ Media returned non-DOCX bytes (no "PK"). Continue…`);
        } else {
          appendDebug(`✅ DOCX bytes valid via Media (branch=${branch}).`);
          return r.ab;
        }
      } catch (e) {
        appendDebug(`❌ Media FAIL (branch=${branch}): ${media}`);
        appendDebug(`   ${String(e.message || e)}`);
      }
    }

    // then raw
    {
      const raw = githubRawUrl(owner, repo, branch, repoPath);
      try {
        const r = await fetchArrayBuffer(raw);
        const u8 = new Uint8Array(r.ab);

        appendDebug(`✅ Raw OK: ${raw}`);
        appendDebug(`   bytes=${r.bytes} | type=${r.ct || "?"}`);

        if (looksLikeLFSPointer(u8)) {
          appendDebug(`❌ Raw returned LFS pointer (expected if stored in LFS). Continue…`);
        } else if (!startsWithPK(u8)) {
          appendDebug(`❌ Raw returned non-DOCX bytes (no "PK"). Continue…`);
        } else {
          appendDebug(`✅ DOCX bytes valid via Raw (branch=${branch}).`);
          return r.ab;
        }
      } catch (e) {
        appendDebug(`❌ Raw FAIL (branch=${branch}): ${raw}`);
        appendDebug(`   ${String(e.message || e)}`);
      }
    }
  }

  throw new Error("All attempts failed. See Debug box above for exact URLs and errors.");
}

/* -----------------------------
   DOCX -> text -> parse
-------------------------------- */
async function loadPodcastQuestions(podcastId) {
  const p = PODCASTS.find(x => x.id === podcastId);
  if (!p) throw new Error("Unknown podcast id: " + podcastId);

  showMessage(`Loading: ${p.file}`, "");
  allQuestions = [];

  const arrayBuffer = await loadDocxSmart(p.file);

  let rawText = "";
  try {
    const result = await mammoth.extractRawText({ arrayBuffer });
    rawText = (result?.value || "").replace(/\r/g, "");
  } catch (e) {
    appendDebug(`❌ Mammoth parse failed: ${String(e.message || e)}`);
    throw new Error("DOCX downloaded, but Mammoth could not parse it (likely not real DOCX bytes).");
  }

  const parsed = parseQuestionsFromText(rawText);
  allQuestions = parsed;

  if (!allQuestions.length) {
    appendDebug(`⚠️ Mammoth extracted text, but parser found 0 questions.`);
    appendDebug(`--- Extracted text preview (first 1200 chars) ---\n${rawText.slice(0, 1200)}`);
    showMessage(`Parsed 0 questions ❌ (See Debug box above — it includes extracted text preview)`, "bad");
  } else {
    showMessage(`Loaded ${allQuestions.length} questions ✅ Pick a set and press Start.`, "good");
  }

  return allQuestions;
}

/* -----------------------------
   Parser (keep simple for now)
-------------------------------- */
function parseQuestionsFromText(text) {
  const lines = (text || "")
    .replace(/\u00A0/g, " ")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

  const out = [];
  let cur = null;
  let lastWasOpt = false;

  const qRe = /^(?:Q\s*)?(\d+)\s*[\.\)\-:]\s+(.*)$/i;
  const optRe = /^([A-Da-d])\s*[\.\)\-:]\s+(.*)$/;
  const ansRe = /^(?:Correct\s*Answer|Answer|Ans|Correct)\s*[:\-]\s*([A-D])\b/i;

  function finalize() {
    if (!cur) return;
    if (cur.options.length === 4 && cur.correctIndex >= 0) {
      cur.stableKey = cur.q;
      out.push(cur);
    }
    cur = null;
    lastWasOpt = false;
  }

  for (const line of lines) {
    if (/^Check\s*:/i.test(line)) continue;

    const qm = line.match(qRe);
    if (qm) {
      finalize();
      cur = { q: (qm[2] || "").trim(), options: [], correctIndex: -1 };
      continue;
    }
    if (!cur) continue;

    const am = line.match(ansRe);
    if (am) {
      cur.correctIndex = am[1].toUpperCase().charCodeAt(0) - 65;
      lastWasOpt = false;
      continue;
    }

    const om = line.match(optRe);
    if (om) {
      cur.options.push((om[2] || "").trim());
      lastWasOpt = true;
      continue;
    }

    if (cur.options.length > 0 && lastWasOpt) {
      cur.options[cur.options.length - 1] = (cur.options[cur.options.length - 1] + " " + line).trim();
    } else if (cur.options.length === 0) {
      cur.q = (cur.q + " " + line).trim();
    }
  }

  finalize();
  return out;
}

/* -----------------------------
   UI: Tabs, Quiz, Immediate check, Auto-advance
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
    .catch((e) => showMessage(`Load failed ❌\n${String(e.message || e)}\n\n(See Debug box above.)`, "bad"));
}

function renderTabs() {
  setTabs.innerHTML = "";
  for (const s of SETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tab" + (s.key === selectedSetKey ? " active" : "");
    b.textContent = (s.key === "missed") ? `${s.label} (${missedPool.length})` : s.label;

    b.addEventListener("click", () => {
      selectedSetKey = s.key;
      renderTabs();
      showMessage("Press Start to begin this set.", "");
    });

    setTabs.appendChild(b);
  }
}

function startQuiz() {
  if (!allQuestions.length) {
    showMessage("No questions loaded yet ❌\n(See Debug box above for exact DOCX URL failures.)", "bad");
    return;
  }

  activeQuestions = buildActiveList();
  if (!activeQuestions.length) {
    showMessage(
      selectedSetKey === "missed"
        ? "Missed pool is empty 🎉"
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
  return s ? allQuestions.slice(s.start, s.end) : [];
}

function finishQuiz() {
  showMessage(
    `Session summary ✅\n` +
    `• Attempted: ${attempted}\n` +
    `• Correct: ${correct}\n` +
    `• First-try correct: ${firstTryCorrect}\n` +
    `• Missed pool: ${missedPool.length}`,
    "good"
  );
}

function renderQuestion() {
  const qObj = activeQuestions[qIndex];
  if (!qObj) return;

  currentFirstAttempt = true;

  quizArea.innerHTML = "";

  const header = document.createElement("div");
  header.className = "qHeader";
  header.textContent = `Q ${qIndex + 1} / ${activeQuestions.length}`;
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
        showMessage("Finished ✅ Pick another set and press Start.", "good");
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
  if (!missedPool.some(x => (x.stableKey || x.q) === key)) missedPool.push(qObj);
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

init();
