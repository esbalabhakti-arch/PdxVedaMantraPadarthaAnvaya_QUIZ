/* =========================================================
   ✅ Working version for your DOCX format:
   - Questions are numbered: "1.", "2.", ...
   - Options may be inline: "A. ... B. ... C. ... D. ..."
   - Correct line may be: "Correct Answer :B" (no space)
   - Immediate feedback on click
   - Auto-advance on correct; stay until correct when wrong
   ========================================================= */

const PODCASTS = [
  { id: "101", title: "101 — Intro 1", file: "Images/101_Intro_1_quiz.docx" },
  { id: "102", title: "102 — Intro 2", file: "Images/102_Intro_2_quiz.docx" },
  { id: "103", title: "103 — 1st Panchadi", file: "Images/103_1st_Panchadi_quiz.docx" },
  { id: "104", title: "104 — 2nd Panchadi (Part 1)", file: "Images/104_2nd_Panchadi_Part1_quiz.docx" },
];

const SETS = [
  { key: "set1", label: "1–10",  start: 0,  end: 10 },
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
   Debug helpers (collapsed by default)
-------------------------------- */
function setDebug(text){ if (debugBox) debugBox.textContent = text; }
function addDebug(line){ if (debugBox) debugBox.textContent += "\n" + line; }

/* -----------------------------
   URL helpers for GitHub Pages
-------------------------------- */
function resolveUrl(relPath) {
  return new URL(relPath, window.location.href).toString();
}

function inferOwnerRepoFromLocation() {
  const host = window.location.host; // esbalabhakti-arch.github.io
  const owner = host.split(".github.io")[0];
  const parts = window.location.pathname.split("/").filter(Boolean);
  const repo = parts[0] || "";
  return { owner, repo };
}

function githubMediaUrl(owner, repo, branch, repoPath) {
  return `https://media.githubusercontent.com/media/${owner}/${repo}/${branch}/${repoPath}`;
}

function startsWithPK(u8) {
  return u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4B; // "PK"
}

function looksLikeLFSPointer(u8) {
  const txt = new TextDecoder().decode(u8.slice(0, 120));
  return txt.includes("git-lfs.github.com/spec");
}

async function fetchArrayBuffer(url) {
  const res = await fetch(url, { cache: "no-store" });
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} | type=${ct}`);
  const ab = await res.arrayBuffer();
  return { ab, ct, bytes: ab.byteLength };
}

/* Smart DOCX fetch:
   - try Pages path (Images vs images)
   - validate ZIP header
   - fallback to media URL (main/master/gh-pages) for LFS cases
*/
async function loadDocxSmart(repoPath) {
  const { owner, repo } = inferOwnerRepoFromLocation();
  const branches = ["main", "master", "gh-pages"];
  const variants = [...new Set([
    repoPath,
    repoPath.replace(/^Images\//, "images/"),
    repoPath.replace(/^images\//, "Images/"),
  ])];

  setDebug(`Debug: owner=${owner} repo=${repo}\nDebug: requested=${repoPath}`);

  for (const v of variants) {
    const url = resolveUrl(v);
    try {
      const r = await fetchArrayBuffer(url);
      const u8 = new Uint8Array(r.ab);
      addDebug(`✅ Pages OK: ${url}`);
      addDebug(`   bytes=${r.bytes} type=${r.ct || "?"}`);

      if (looksLikeLFSPointer(u8)) { addDebug("⚠️ Pages returned LFS pointer text"); break; }
      if (!startsWithPK(u8))       { addDebug("⚠️ Pages returned NOT DOCX (no PK header)"); break; }

      addDebug("✅ DOCX bytes valid (PK header)");
      return r.ab;
    } catch (e) {
      addDebug(`❌ Pages FAIL: ${url}`);
      addDebug(`   ${String(e.message || e)}`);
    }
  }

  for (const branch of branches) {
    const media = githubMediaUrl(owner, repo, branch, repoPath);
    try {
      const r = await fetchArrayBuffer(media);
      const u8 = new Uint8Array(r.ab);
      addDebug(`✅ Media OK: ${media}`);
      addDebug(`   bytes=${r.bytes} type=${r.ct || "?"}`);

      if (looksLikeLFSPointer(u8)) { addDebug("❌ Media still pointer"); continue; }
      if (!startsWithPK(u8))       { addDebug("❌ Media not DOCX (no PK)"); continue; }

      addDebug(`✅ DOCX valid via Media (branch=${branch})`);
      return r.ab;
    } catch (e) {
      addDebug(`❌ Media FAIL (branch=${branch}): ${media}`);
      addDebug(`   ${String(e.message || e)}`);
    }
  }

  throw new Error("All DOCX fetch attempts failed (see Debug details).");
}

/* -----------------------------
   ✅ NEW PARSER: handles your exact DOCX text
-------------------------------- */
function cleanText(s) {
  return (s || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function stripBracketSources(s) {
  // remove things like: [(Source: 101_Intro_1_transcription.docx)]
  return (s || "").replace(/\[\s*\(Source:[^\]]+\)\s*\]/gi, "").trim();
}

function parseQuestionsFromText(text) {
  const t = cleanText(text);

  // Split into numbered blocks: "\n1.\n", "\n2.\n", etc
  // We'll locate all "^\s*\d+\." markers (multiline)
  const re = /(^|\n)\s*(\d+)\.\s*/g;
  const matches = [...t.matchAll(re)];
  if (matches.length === 0) return [];

  const blocks = [];
  for (let i = 0; i < matches.length; i++) {
    const start = (matches[i].index ?? 0) + (matches[i][1] ? matches[i][1].length : 0); // include newline offset
    const next = (i + 1 < matches.length) ? (matches[i + 1].index ?? t.length) : t.length;
    const block = t.slice(start, next).trim();
    blocks.push(block);
  }

  const out = [];

  for (const blockRaw of blocks) {
    const block = blockRaw.replace(/\r/g, "").trim();
    if (!block) continue;

    // Find Correct Answer letter
    const ansM = block.match(/Correct\s*Answer\s*[:\-]\s*([A-D])\b/i)
      || block.match(/Correct\s*Answer\s*:\s*([A-D])\b/i)
      || block.match(/\bCorrect\s*[:\-]\s*([A-D])\b/i);

    const correctLetter = ansM ? ansM[1].toUpperCase() : null;

    // Extract options with a robust marker: A. / A) / A: / A -
    const optRe = /(^|\s)([A-D])\s*[\.\)\-:]\s*/g;
    const optMatches = [...block.matchAll(optRe)];

    if (optMatches.length < 4 || !correctLetter) continue;

    // Question text = from beginning of block to first option marker
    const firstOptIdx = optMatches[0].index ?? 0;
    let qText = block.slice(0, firstOptIdx).trim();
    qText = stripBracketSources(qText);

    // Now parse each option text as substring between markers
    const options = [];
    for (let i = 0; i < optMatches.length; i++) {
      const m = optMatches[i];
      const letter = m[2].toUpperCase();
      const start = (m.index ?? 0) + m[0].length;
      const end = (i + 1 < optMatches.length) ? (optMatches[i + 1].index ?? block.length) : block.length;
      let optText = block.slice(start, end);

      // Stop option text before "Correct Answer" or "Check:"
      optText = optText.split(/Correct\s*Answer\s*[:\-]/i)[0];
      optText = optText.split(/\bCheck\s*[:\-]/i)[0];

      optText = stripBracketSources(cleanText(optText));
      options.push({ letter, text: optText });
    }

    // Keep only A-D in order and ensure 4
    const map = new Map(options.map(o => [o.letter, o.text]));
    const finalOpts = ["A","B","C","D"].map(L => map.get(L) || "").filter(Boolean);

    if (finalOpts.length !== 4) continue;

    const correctIndex = correctLetter.charCodeAt(0) - 65;
    if (correctIndex < 0 || correctIndex > 3) continue;

    out.push({
      q: qText,
      options: finalOpts,
      correctIndex,
      stableKey: qText
    });
  }

  return out;
}

/* -----------------------------
   Load + parse
-------------------------------- */
async function loadPodcastQuestions(podcastId) {
  const p = PODCASTS.find(x => x.id === podcastId);
  if (!p) throw new Error("Unknown podcast id: " + podcastId);

  showMessage(`Loading: ${p.file}`, "");
  allQuestions = [];

  const arrayBuffer = await loadDocxSmart(p.file);

  if (!window.mammoth) throw new Error("Mammoth library missing.");

  const result = await window.mammoth.extractRawText({ arrayBuffer });
  const rawText = (result?.value || "").replace(/\r/g, "");
  addDebug(`Debug: mammoth text length = ${rawText.length}`);

  const parsed = parseQuestionsFromText(rawText);
  allQuestions = parsed;

  addDebug(`Debug: parsed questions = ${allQuestions.length}`);

  if (!allQuestions.length) {
    addDebug("⚠️ Parser got 0 questions. Showing first 1200 chars:");
    addDebug(rawText.slice(0, 1200));
    showMessage("Parsed 0 questions ❌ (open Debug details)", "bad");
  } else {
    showMessage(`Loaded ${allQuestions.length} questions ✅ Pick a set and press Start.`, "good");
  }
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
    b.textContent = (s.key === "missed") ? `${s.label} (${missedPool.length})` : s.label;

    b.addEventListener("click", () => {
      selectedSetKey = s.key;
      renderTabs();
      showMessage("Press Start to begin this set.", "");
    });

    setTabs.appendChild(b);
  }
}

function updateStats() {
  statCorrect.textContent = `Correct: ${correct}`;
  statAttempted.textContent = `Attempted: ${attempted}`;
  statFirstTry.textContent = `First-try: ${firstTryCorrect}`;
  statMissed.textContent = `Missed pool: ${missedPool.length}`;
}

/* -----------------------------
   Quiz flow (immediate check + auto next on correct)
-------------------------------- */
function buildActiveList() {
  if (selectedSetKey === "missed") return missedPool.slice();
  const s = SETS.find(x => x.key === selectedSetKey);
  return s ? allQuestions.slice(s.start, s.end) : [];
}

function startQuiz() {
  if (!allQuestions.length) {
    showMessage("No questions loaded yet ❌ (select podcast to load)", "bad");
    return;
  }

  activeQuestions = buildActiveList();
  if (!activeQuestions.length) {
    showMessage(
      selectedSetKey === "missed"
        ? "Missed pool is empty 🎉"
        : "This set has no questions.",
      "bad"
    );
    return;
  }

  qIndex = 0;
  currentFirstAttempt = true;
  renderQuestion();
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
  msg.textContent = "Pick an option — I’ll tell you immediately.";
  quizArea.appendChild(msg);
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

/* -----------------------------
   Init
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

  // auto-load the first podcast so it feels alive
  loadPodcastQuestions(selectedPodcastId).catch(err => {
    showMessage(`Load failed ❌\n${String(err.message || err)}`, "bad");
  });
}

init();
