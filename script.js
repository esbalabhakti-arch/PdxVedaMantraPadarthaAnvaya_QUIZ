/* =========================================================
   Veda Podcast Quiz (DOCX-driven, GitHub Pages compatible)
   - Discovers DOCX files in /Images via GitHub API
   - Fetches DOCX from same origin (Images/<file>)
   - Parses questions robustly (handles options in one line)
   - Auto-checks answer immediately on option click ✅
   ========================================================= */

const REPO_OWNER = "esbalabhakti-arch";
const REPO_NAME  = "PdxVedaMantraPadarthaAnvaya_QUIZ";
const BRANCH     = "main";
const IMAGES_DIR = "Images"; // case-sensitive on GitHub Pages

const $ = (id) => document.getElementById(id);

const podcastSelect = $("podcastSelect");
const setToggle = $("setToggle");
const btnMissed = $("btnMissed");

const btnStart = $("btnStart");
const btnFinish = $("btnFinish");
const btnCheck = $("btnCheck");   // kept for UI, but we won't require it
const btnNext = $("btnNext");

const statCorrect = $("statCorrect");
const statAttempted = $("statAttempted");
const statFirstTry = $("statFirstTry");
const statMissedPool = $("statMissedPool");

const qMeta = $("qMeta");
const qText = $("qText");
const optionsEl = $("options");
const feedbackEl = $("feedback");

// ---------- State ----------
let podcasts = []; // [{fileName, label}]
let questionsCache = new Map(); // fileName -> parsed questions array

let currentPodcastFile = null;
let currentSet = "1"; // "1".."5" or "missed"

let quizQueue = [];
let quizIndex = 0;
let quizActive = false;

let selectedOption = null;
let currentQuestionAttemptedOnce = false;

// NEW: lock options after correct so extra clicks don't change anything
let questionLocked = false;

let score = {
  attempted: 0,
  correct: 0,
  firstTry: 0
};

// Missed per podcast (persist)
function missedKey(fileName){ return `vedaQuiz_missed_${fileName}`; }
function loadMissed(fileName){
  try { return JSON.parse(localStorage.getItem(missedKey(fileName)) || "[]"); }
  catch { return []; }
}
function saveMissed(fileName, arr){
  localStorage.setItem(missedKey(fileName), JSON.stringify(arr));
}

// ---------- Motivational lines ----------
const MOTIVATION_OK = [
  "Nice! ✅",
  "Super! 🌟",
  "Good one! 👏",
  "Boom — correct! 💥",
  "Solid! Keep going 💪"
];
const MOTIVATION_TRY = [
  "Close — try once more 🙂",
  "Not this one. Have another go 💡",
  "Almost there. Re-check the options 🔍",
  "Try again — you’ve got this 💪"
];
const pick = (arr) => arr[Math.floor(Math.random()*arr.length)];

// ---------- UI helpers ----------
function setMeta(msg){ qMeta.textContent = msg; }

function setFeedback(msg, kind){
  feedbackEl.style.display = "block";
  feedbackEl.classList.remove("ok","bad");
  if (kind) feedbackEl.classList.add(kind);
  feedbackEl.textContent = msg;
}
function clearFeedback(){
  feedbackEl.style.display = "none";
  feedbackEl.classList.remove("ok","bad");
  feedbackEl.textContent = "";
}

function updateStats(){
  statCorrect.textContent = `Correct: ${score.correct}`;
  statAttempted.textContent = `Attempted: ${score.attempted}`;
  statFirstTry.textContent = `First-try: ${score.firstTry}`;

  const missed = currentPodcastFile ? loadMissed(currentPodcastFile) : [];
  statMissedPool.textContent = `In Review Missed pool: ${missed.length}`;
  btnMissed.textContent = `Review Missed (${missed.length})`;
}

function resetQuestionUI(){
  qText.style.display = "none";
  optionsEl.style.display = "none";
  optionsEl.innerHTML = "";
  btnCheck.disabled = true;  // we keep it disabled; auto-check happens on click
  btnNext.disabled = true;
  selectedOption = null;
  currentQuestionAttemptedOnce = false;
  questionLocked = false;    // NEW
  clearFeedback();
}

function markActiveSetButton(value){
  [...setToggle.querySelectorAll("button[data-set]")].forEach(b=>{
    b.classList.toggle("active", b.dataset.set === value);
  });
}

// ---------- DOCX discovery ----------
async function listDocxFromRepo(){
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${IMAGES_DIR}?ref=${BRANCH}`;
  const res = await fetch(url, { cache:"no-cache" });
  if (!res.ok) throw new Error(`GitHub API failed (${res.status}). Is the repo public?`);
  const data = await res.json();

  // only *_quiz.docx
  const docx = (data || [])
    .filter(x => x.type === "file")
    .map(x => x.name)
    .filter(name => name.toLowerCase().endsWith("_quiz.docx"));

  // Sort by numeric prefix if present
  docx.sort((a,b)=>{
    const na = parseInt((a.match(/^(\d+)/)||[])[1] || "999999", 10);
    const nb = parseInt((b.match(/^(\d+)/)||[])[1] || "999999", 10);
    return na - nb || a.localeCompare(b);
  });

  return docx.map(name => ({
    fileName: name,
    label: toNicePodcastLabel(name)
  }));
}

function toNicePodcastLabel(fileName){
  // 101_Intro_1_quiz.docx -> "101 — Intro 1"
  const base = fileName.replace(/_quiz\.docx$/i, "");
  const parts = base.split("_");
  const num = parts[0] || base;
  const rest = parts.slice(1).join(" ").trim();
  return rest ? `${num} — ${titleCase(rest)}` : base;
}
function titleCase(s){
  return s.split(/\s+/).map(w => w ? w[0].toUpperCase()+w.slice(1) : w).join(" ");
}

// ---------- DOCX fetch + parse ----------
async function loadQuestionsForPodcast(fileName){
  if (questionsCache.has(fileName)) return questionsCache.get(fileName);

  if (!window.mammoth) throw new Error("mammoth.js did not load.");

  // same-origin fetch (GitHub Pages)
  const path = `${IMAGES_DIR}/${fileName}`;
  const res = await fetch(path, { cache:"no-cache" });
  if (!res.ok) throw new Error(`Could not fetch ${path}. Check folder case: "${IMAGES_DIR}"`);

  const buf = await res.arrayBuffer();
  const raw = await window.mammoth.extractRawText({ arrayBuffer: buf });
  const text = (raw.value || "").replace(/\r/g,"").trim();

  const qs = parseQuizText(text);

  questionsCache.set(fileName, qs);
  return qs;
}

/* Robust parser for your DOCX pattern:
   1.
   Question line(s)...
   A. ... B. ... C. ... D. ...
   Correct Answer: B
   Check: explanation...
*/
function parseQuizText(text){
  const lines = text
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const questions = [];
  let i = 0;

  const isNumLine = (l) => /^\d+\.\s*$/.test(l) || /^\d+\)\s*$/.test(l);
  const isCorrectLine = (l) => /^Correct\s*Answer\s*:/i.test(l);
  const isCheckLine = (l) => /^Check\s*:/i.test(l);

  while (i < lines.length){
    while (i < lines.length && !isNumLine(lines[i])) i++;
    if (i >= lines.length) break;

    const qNumber = parseInt(lines[i].match(/^(\d+)/)[1], 10);
    i++;

    let qParts = [];
    while (i < lines.length && !/^[A-D]\./.test(lines[i]) && !isCorrectLine(lines[i]) && !isNumLine(lines[i])) {
      if (!/^\[Source:/i.test(lines[i])) qParts.push(lines[i]);
      i++;
    }
    const questionText = qParts.join(" ").trim();

    let optionBlock = [];
    while (i < lines.length && !isCorrectLine(lines[i]) && !isNumLine(lines[i])) {
      optionBlock.push(lines[i]);
      i++;
    }

    const { options } = parseOptions(optionBlock.join(" "));

    let correct = null;
    if (i < lines.length && isCorrectLine(lines[i])) {
      const m = lines[i].match(/Correct\s*Answer\s*:\s*([A-D])/i);
      correct = m ? m[1].toUpperCase() : null;
      i++;
    }

    let checkParts = [];
    while (i < lines.length && !isNumLine(lines[i])) {
      if (isCheckLine(lines[i])) {
        checkParts.push(lines[i].replace(/^Check\s*:\s*/i, "").trim());
      } else if (!isCorrectLine(lines[i])) {
        checkParts.push(lines[i]);
      }
      i++;
    }
    const checkText = checkParts.join(" ").trim();

    if (questionText && options.length >= 4 && correct){
      questions.push({
        num: qNumber,
        question: questionText,
        options,
        correct,
        check: checkText || ""
      });
    }
  }

  return questions;
}

function parseOptions(block){
  const normalized = block.replace(/\s+/g, " ").trim();
  const parts = normalized.split(/(?=[A-D]\.\s)/g).map(s => s.trim()).filter(Boolean);

  const options = [];
  for (const p of parts){
    const m = p.match(/^([A-D])\.\s*(.+)$/);
    if (!m) continue;
    options.push({ letter: m[1].toUpperCase(), text: m[2].trim() });
  }

  if (options.length < 4){
    const fallback = [];
    const re = /([A-D])\.\s*/g;
    let match, idxs = [];
    while ((match = re.exec(normalized)) !== null){
      idxs.push({ letter: match[1].toUpperCase(), index: match.index });
    }
    for (let k=0; k<idxs.length; k++){
      const start = idxs[k].index;
      const end = (k+1<idxs.length) ? idxs[k+1].index : normalized.length;
      const seg = normalized.slice(start, end).trim();
      const mm = seg.match(/^([A-D])\.\s*(.+)$/);
      if (mm) fallback.push({ letter:mm[1].toUpperCase(), text:mm[2].trim() });
    }
    if (fallback.length >= 4) return { options:fallback };
  }

  return { options };
}

// ---------- Quiz mechanics ----------
function buildQueue(allQuestions){
  if (!allQuestions || !allQuestions.length) return [];

  if (currentSet === "missed"){
    const missedNums = loadMissed(currentPodcastFile);
    return allQuestions.filter(q => missedNums.includes(q.num));
  }

  const setIdx = parseInt(currentSet, 10);
  const start = (setIdx - 1) * 10;
  const end = start + 10;
  return allQuestions.slice(start, end);
}

function renderQuestion(){
  resetQuestionUI();

  if (!quizActive || quizIndex >= quizQueue.length){
    quizActive = false;
    setMeta("Finished. You can pick another set, or Review Missed.");
    setFeedback("Nice work ✅\nTry another set — or hit Review Missed to clean up mistakes 💪", "ok");
    return;
  }

  const q = quizQueue[quizIndex];
  qText.style.display = "block";
  optionsEl.style.display = "flex";

  const modeLabel = (currentSet === "missed")
    ? `Review Missed • Question ${quizIndex+1} of ${quizQueue.length}`
    : `Set ${currentSet} • Question ${quizIndex+1} of ${quizQueue.length}`;

  setMeta(modeLabel);
  qText.textContent = q.question;

  // Build separate option boxes + AUTO CHECK on click ✅
  for (const opt of q.options){
    const div = document.createElement("div");
    div.className = "opt";
    div.dataset.letter = opt.letter;

    div.innerHTML = `
      <div class="letter">${opt.letter}</div>
      <div class="txt">${escapeHtml(opt.text)}</div>
    `;

    div.addEventListener("click", ()=>{
      if (!quizActive) return;
      if (questionLocked) return; // NEW: lock after correct

      [...optionsEl.querySelectorAll(".opt")].forEach(x=>x.classList.remove("selected"));
      div.classList.add("selected");
      selectedOption = opt.letter;

      // ✅ Immediately validate (no need to press Check Answer)
      checkAnswer();
    });

    optionsEl.appendChild(div);
  }
}

function escapeHtml(s){
  return (s||"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;");
}

function addToMissed(qNum){
  const arr = loadMissed(currentPodcastFile);
  if (!arr.includes(qNum)){
    arr.push(qNum);
    saveMissed(currentPodcastFile, arr);
  }
}

function removeFromMissed(qNum){
  const arr = loadMissed(currentPodcastFile).filter(n => n !== qNum);
  saveMissed(currentPodcastFile, arr);
}

async function startQuiz(){
  if (!currentPodcastFile){
    setMeta("Pick a podcast first.");
    return;
  }

  setMeta(`Loading questions from: ${currentPodcastFile} ...`);
  resetQuestionUI();

  const all = await loadQuestionsForPodcast(currentPodcastFile);

  if (!all.length){
    setMeta("Could not start the quiz.");
    setFeedback(`Error loading quiz ❌\nParsed 0 questions from ${currentPodcastFile}.`, "bad");
    return;
  }

  quizQueue = buildQueue(all);

  if (!quizQueue.length){
    if (currentSet === "missed"){
      setMeta("Review Missed is empty 🎉");
      setFeedback("Nothing in Missed right now. Pick a Set and press Start.", "ok");
    } else {
      setMeta("No questions in this set.");
      setFeedback("This set range is empty for this DOCX.", "bad");
    }
    updateStats();
    return;
  }

  quizActive = true;
  quizIndex = 0;
  renderQuestion();
  updateStats();
}

function finishQuiz(){
  quizActive = false;
  btnCheck.disabled = true;
  btnNext.disabled = true;

  const missed = currentPodcastFile ? loadMissed(currentPodcastFile).length : 0;

  setMeta("Session summary:");
  setFeedback(
    `Attempted: ${score.attempted}\nCorrect: ${score.correct}\nFirst-try correct: ${score.firstTry}\nMissed pool: ${missed}\n\nKeep going — small daily wins add up 💪`,
    "ok"
  );
  qText.style.display = "none";
  optionsEl.style.display = "none";
}

function checkAnswer(){
  if (!quizActive) return;
  const q = quizQueue[quizIndex];
  if (!q || !selectedOption) return;

  score.attempted += 1;

  const isFirstAttemptForThisQ = !currentQuestionAttemptedOnce;
  currentQuestionAttemptedOnce = true;

  if (selectedOption === q.correct){
    score.correct += 1;
    if (isFirstAttemptForThisQ) score.firstTry += 1;

    // If we are in missed mode and got it right, remove it
    if (currentSet === "missed") removeFromMissed(q.num);

    const checkLine = q.check ? `\n\nWhy: ${q.check}` : "";
    setFeedback(`${pick(MOTIVATION_OK)}${checkLine}`, "ok");

    // ✅ Lock options once correct, enable Next
    questionLocked = true;
    btnNext.disabled = false;

  } else {
    if (isFirstAttemptForThisQ){
      addToMissed(q.num);
    }
    setFeedback(`${pick(MOTIVATION_TRY)}\n(You need to get it right to move forward.)`, "bad");

    // Keep Next disabled until correct
    btnNext.disabled = true;
  }

  updateStats();
}

function nextQuestion(){
  if (!quizActive) return;
  quizIndex += 1;
  renderQuestion();
  updateStats();
}

// ---------- Events ----------
setToggle.addEventListener("click", (e)=>{
  const btn = e.target.closest("button[data-set]");
  if (!btn) return;
  currentSet = btn.dataset.set;
  markActiveSetButton(currentSet);
  resetQuestionUI();
  setMeta("Pick a podcast, pick a set, then press Start.");
  updateStats();
});

podcastSelect.addEventListener("change", async ()=>{
  currentPodcastFile = podcastSelect.value;
  resetQuestionUI();
  setMeta(`Selected: ${currentPodcastFile}. Press Start.`);
  updateStats();

  try { await loadQuestionsForPodcast(currentPodcastFile); }
  catch { /* ignore */ }
});

btnStart.addEventListener("click", ()=>{
  startQuiz().catch(err=>{
    setMeta("Could not start the quiz.");
    setFeedback(String(err), "bad");
  });
});
btnFinish.addEventListener("click", finishQuiz);

// We keep this button, but it’s no longer required.
// If someone clicks it, it still works.
btnCheck.addEventListener("click", checkAnswer);

btnNext.addEventListener("click", nextQuestion);

// ---------- Init ----------
async function init(){
  setMeta("Loading podcast list...");
  updateStats();

  try{
    podcasts = await listDocxFromRepo();

    podcastSelect.innerHTML = "";
    for (const p of podcasts){
      const opt = document.createElement("option");
      opt.value = p.fileName;
      opt.textContent = p.label;
      podcastSelect.appendChild(opt);
    }

    currentPodcastFile = podcasts[0]?.fileName || null;
    if (currentPodcastFile){
      podcastSelect.value = currentPodcastFile;
      setMeta("Pick a set, then press Start.");
      updateStats();
      loadQuestionsForPodcast(currentPodcastFile).catch(()=>{});
    } else {
      setMeta(`No *_quiz.docx found in /${IMAGES_DIR}.`);
      setFeedback(`Please upload quiz files ending with _quiz.docx into /${IMAGES_DIR}/`, "bad");
    }
  } catch(err){
    setMeta("Could not load podcast list.");
    setFeedback(String(err), "bad");
  }
}

init();
