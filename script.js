// ==========================================================
// If you still see "Debug: (page loaded...)" and NOT this line,
// then script.js is not executing.
// ==========================================================
(function bootMark(){
  const dbg = document.getElementById("debugBox");
  const add = window.__DBG_ADD__ || ((s)=>{ if(dbg) dbg.textContent += "\n" + s; });
  add("Debug: script.js executed ✅ (JS runtime)");
  add("Debug: script version = 20260118a");
})();

/* -----------------------------
   PODCASTS
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
   DOM (guarded)
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
const addDebug = window.__DBG_ADD__ || ((s)=>{ if(debugBox) debugBox.textContent += "\n" + s; });

/* -----------------------------
   DOCX loader
-------------------------------- */
function inferOwnerRepoFromLocation() {
  const host = window.location.host; // esbalabhakti-arch.github.io
  const owner = host.split(".github.io")[0];
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

async function loadDocxSmart(repoPath) {
  const { owner, repo } = inferOwnerRepoFromLocation();
  const branches = ["main", "master", "gh-pages"];

  const variants = [...new Set([
    repoPath,
    repoPath.replace(/^Images\//, "images/"),
    repoPath.replace(/^images\//, "Images/"),
  ])];

  addDebug(`Debug: owner=${owner} repo=${repo}`);
  addDebug(`Debug: requested=${repoPath}`);

  // Try GitHub Pages URLs first
  for (const v of variants) {
    const url = resolveUrl(v);
    try {
      const r = await fetchArrayBuffer(url);
      const u8 = new Uint8Array(r.ab);
      addDebug(`✅ Pages OK: ${url}`);
      addDebug(`   bytes=${r.bytes} type=${r.ct || "?"}`);

      if (looksLikeLFSPointer(u8)) { addDebug("⚠️ Pages returned Git LFS pointer"); break; }
      if (!startsWithPK(u8))       { addDebug("⚠️ Pages returned NOT a DOCX (no PK header)"); break; }

      addDebug("✅ DOCX bytes look valid (PK header)");
      return r.ab;
    } catch (e) {
      addDebug(`❌ Pages FAIL: ${url}`);
      addDebug(`   ${String(e.message || e)}`);
    }
  }

  // Fallback: GitHub media (best for LFS), try branches
  for (const branch of branches) {
    const media = githubMediaUrl(owner, repo, branch, repoPath);
    try {
      const r = await fetchArrayBuffer(media);
      const u8 = new Uint8Array(r.ab);

      addDebug(`✅ Media OK: ${media}`);
      addDebug(`   bytes=${r.bytes} type=${r.ct || "?"}`);

      if (looksLikeLFSPointer(u8)) { addDebug("❌ Media still pointer (unexpected)"); continue; }
      if (!startsWithPK(u8))       { addDebug("❌ Media not DOCX (no PK)"); continue; }

      addDebug(`✅ DOCX valid via Media (branch=${branch})`);
      return r.ab;
    } catch (e) {
      addDebug(`❌ Media FAIL (branch=${branch}): ${media}`);
      addDebug(`   ${String(e.message || e)}`);
    }
  }

  throw new Error("All DOCX fetch attempts failed (see debug log above).");
}

/* -----------------------------
   DOCX -> text -> parse
-------------------------------- */
async function loadPodcastQuestions(podcastId) {
  const p = PODCASTS.find(x => x.id === podcastId);
  if (!p) throw new Error("Unknown podcast id: " + podcastId);

  showMessage(`Loading: ${p.file}`, "");

  if (!window.mammoth) {
    addDebug("❌ Mammoth is not available (library did not load).");
    throw new Error("Mammoth library missing.");
  }

  allQuestions = [];

  const arrayBuffer = await loadDocxSmart(p.file);

  let rawText = "";
  const result = await window.mammoth.extractRawText({ arrayBuffer });
  rawText = (result?.value || "").replace(/\r/g, "");
  addDebug(`Debug: mammoth extracted text length = ${rawText.length}`);

  const parsed = parseQuestionsFromText(rawText);
  allQuestions = parsed;

  if (!allQuestions.length) {
    addDebug("⚠️ Parsed 0 questions. Text preview:");
    addDebug(rawText.slice(0, 900));
    showMessage("Parsed 0 questions ❌ (see Debug box for text preview)", "bad");
  } else {
    showMessage(`Loaded ${allQuestions.length} questions ✅`, "good");
  }
}

/* -----------------------------
   Simple parser
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
    if (cur.options.length === 4 && cur.correctIndex >= 0) out.push(cur);
    cur = null; lastWasOpt = false;
  }

  for (const line of lines) {
    const qm = line.match(qRe);
    if (qm) { finalize(); cur = { q: (qm[2] || "").trim(), options: [], correctIndex: -1 }; continue; }
    if (!cur) continue;

    const am = line.match(ansRe);
    if (am) { cur.correctIndex = am[1].toUpperCase().charCodeAt(0) - 65; lastWasOpt = false; continue; }

    const om = line.match(optRe);
    if (om) { cur.options.push((om[2] || "").trim()); lastWasOpt = true; continue; }

    if (cur.options.length > 0 && lastWasOpt) cur.options[cur.options.length - 1] += " " + line;
    else if (cur.options.length === 0) cur.q += " " + line;
  }

  finalize();
  return out.map(q => ({...q, q: q.q.trim(), options: q.options.map(s => s.trim())}));
}

/* -----------------------------
   UI
-------------------------------- */
function renderTabs() {
  setTabs.innerHTML = "";
  for (const s of SETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tab" + (s.key === selectedSetKey ? " active" : "");
    b.textContent = s.key === "missed" ? `${s.label} (${missedPool.length})` : s.label;
    b.addEventListener("click", () => { selectedSetKey = s.key; renderTabs(); showMessage("Press Start.", ""); });
    setTabs.appendChild(b);
  }
}

function updateStats() {
  statCorrect.textContent = `Correct: ${correct}`;
  statAttempted.textContent = `Attempted: ${attempted}`;
  statFirstTry.textContent = `First-try: ${firstTryCorrect}`;
  statMissed.textContent = `Missed pool: ${missedPool.length}`;
}

function showMessage(text, kind) {
  quizArea.innerHTML = "";
  const msg = document.createElement("div");
  msg.className = "msg" + (kind ? ` ${kind}` : "");
  msg.textContent = text;
  quizArea.appendChild(msg);
}

async function init() {
  addDebug("Debug: init() starting…");

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
    addDebug(`Debug: podcast changed -> ${selectedPodcastId}`);
    await loadPodcastQuestions(selectedPodcastId);
  });

  startBtn.addEventListener("click", async () => {
    if (!allQuestions.length) await loadPodcastQuestions(selectedPodcastId);
    if (!allQuestions.length) return;
    showMessage(`Loaded ✅ Now parsing/quiz flow can proceed (questions=${allQuestions.length})`, "good");
  });

  finishBtn.addEventListener("click", () => {
    showMessage(`Summary ✅ Attempted=${attempted} Correct=${correct} FirstTry=${firstTryCorrect}`, "good");
  });

  // Auto-load initial
  await loadPodcastQuestions(selectedPodcastId);
}

init().catch(e => {
  addDebug("❌ init crashed: " + String(e.message || e));
  showMessage("App crashed. See Debug box above.", "bad");
});
