/* =========================================================
   Veda Quiz — robust DOCX loader + parser + 5 sets + missed
   ========================================================= */

/**
 * ✅ IMPORTANT: This is what makes "auto-pick new DOCX files" work.
 * We use GitHub Contents API to list Images/ and find *_quiz.docx
 */
const GITHUB_OWNER = "esbalabhakti-arch";
const GITHUB_REPO  = "PdxVedaMantraPadarthaAnvaya_QUIZ";
const IMAGES_DIR   = "Images"; // must match folder name exactly (case-sensitive)

/** Banner path is handled in HTML: Images/Vedic_podcast_banner_2.png */

/* ---------- DOM ---------- */
const podcastSelect = document.getElementById("podcastSelect");
const loadNote      = document.getElementById("loadNote");

const setToggle     = document.getElementById("setToggle");
const missedBtn     = document.getElementById("missedBtn");

const startBtn      = document.getElementById("startBtn");
const finishBtn     = document.getElementById("finishBtn");

const correctChip   = document.getElementById("correctChip");
const attemptedChip = document.getElementById("attemptedChip");
const firstTryChip  = document.getElementById("firstTryChip");
const missedChip    = document.getElementById("missedChip");

const statusLine    = document.getElementById("statusLine");
const qHeader       = document.getElementById("qHeader");
const questionText  = document.getElementById("questionText");
const optionsWrap   = document.getElementById("optionsWrap");

const checkBtn      = document.getElementById("checkBtn");
const nextBtn       = document.getElementById("nextBtn");

const feedbackBox   = document.getElementById("feedbackBox");

/* ---------- State ---------- */
let activeSet = "1"; // "1".."5" or "missed"
let activePodcastKey = null;

const podcastFiles = []; // { key, name, download_url }
const questionsCache = new Map(); // key -> questions[]
const missedPool = new Map(); // key -> Set(questionId) (questionId = 1..50)
const missedQueueState = new Map(); // key -> array of questionIds shuffled each session

let session = {
  running: false,
  mode: "set", // "set" or "missed"
  setIndex: 1, // 1..5
  qList: [],   // array of question objects for current run
  pos: 0,
  selected: null, // "A"|"B"|"C"|"D"
  attemptThisQ: 0,
  firstTryEligible: true,
  stats: {
    attempted: 0,
    correct: 0,
    firstTry: 0
  }
};

/* ---------- Utils ---------- */
function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function setFeedback(type, title, checkText){
  feedbackBox.classList.remove("ok","bad");
  feedbackBox.classList.add(type);
  feedbackBox.innerHTML = `
    <div style="font-weight:900; font-size:16px;">${title}</div>
    ${checkText ? `<div class="checkLine">${escapeHtml(checkText)}</div>` : ""}
  `;
}

function clearFeedback(){
  feedbackBox.classList.remove("ok","bad");
  feedbackBox.style.display = "none";
  feedbackBox.innerHTML = "";
}

function show(el){ el.style.display = ""; }
function hide(el){ el.style.display = "none"; }

function updateChips(){
  correctChip.textContent   = `Correct: ${session.stats.correct}`;
  attemptedChip.textContent = `Attempted: ${session.stats.attempted}`;
  firstTryChip.textContent  = `First-try: ${session.stats.firstTry}`;

  const mp = missedPool.get(activePodcastKey);
  const missedCount = mp ? mp.size : 0;
  missedChip.textContent = `In Review Missed pool: ${missedCount}`;
  missedBtn.textContent = `Review Missed (${missedCount})`;
}

function escapeHtml(s){
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

/* =========================================================
   1) Load podcast list dynamically from GitHub API
   ========================================================= */
async function loadPodcastList(){
  loadNote.textContent = "Loading DOCX files from GitHub…";

  const api = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${IMAGES_DIR}`;
  const res = await fetch(api, { cache: "no-store" });
  if(!res.ok){
    throw new Error(`GitHub API failed (${res.status}). Is the repo public?`);
  }
  const items = await res.json();

  // Pick only *_quiz.docx
  const docs = items
    .filter(x => x && x.type === "file")
    .filter(x => typeof x.name === "string" && x.name.toLowerCase().endsWith("_quiz.docx"));

  docs.sort((a,b) => a.name.localeCompare(b.name));

  podcastFiles.length = 0;
  for(const d of docs){
    // display name: "101 — Intro 1" etc
    const display = d.name
      .replace(/_quiz\.docx$/i,"")
      .replace(/_/g," ")
      .replace(/^(\d+)\s+/,"$1 — ");
    podcastFiles.push({
      key: d.name,
      name: display,
      download_url: d.download_url
    });
  }

  // Fill dropdown
  podcastSelect.innerHTML = "";
  if(podcastFiles.length === 0){
    podcastSelect.innerHTML = `<option value="" selected disabled>No *_quiz.docx files found in ${IMAGES_DIR}/</option>`;
    loadNote.textContent = `No quiz DOCX found. Upload files like 101_Intro_1_quiz.docx into ${IMAGES_DIR}/`;
    return;
  }

  for(const p of podcastFiles){
    const opt = document.createElement("option");
    opt.value = p.key;
    opt.textContent = p.name;
    podcastSelect.appendChild(opt);
  }

  // default select first
  podcastSelect.value = podcastFiles[0].key;
  activePodcastKey = podcastFiles[0].key;

  if(!missedPool.has(activePodcastKey)) missedPool.set(activePodcastKey, new Set());

  loadNote.textContent = `Found ${podcastFiles.length} quiz file(s). Pick one and press Start.`;
  updateChips();
}

/* =========================================================
   2) Fetch DOCX + parse 50 questions
   ========================================================= */
async function getQuestionsForPodcast(key){
  if(questionsCache.has(key)) return questionsCache.get(key);

  const file = podcastFiles.find(x => x.key === key);
  if(!file) throw new Error("Podcast file not found in list.");

  loadNote.textContent = `Loading questions from: ${file.key} …`;

  const docxRes = await fetch(file.download_url, { cache: "no-store" });
  if(!docxRes.ok) throw new Error(`DOCX download failed (${docxRes.status})`);

  const arrayBuffer = await docxRes.arrayBuffer();

  // Mammoth raw text is perfect for your format
  const raw = await mammoth.extractRawText({ arrayBuffer });
  const text = (raw && raw.value) ? raw.value : "";
  const questions = parseQuizTextToQuestions(text);

  if(questions.length === 0){
    throw new Error(`Parsed 0 questions from ${file.key}.`);
  }

  // Expect 50 but we won't hard-crash if it's not exactly 50.
  questionsCache.set(key, questions);
  loadNote.textContent = `Loaded ${questions.length} question(s) from ${file.key}.`;
  return questions;
}

/**
 * Your DOCX structure is consistently like:
 *  "1."
 *  "Question … [Source…]"
 *  "A. ...\nB. ...\nC. ...\nD. ..."
 *  "Correct Answer: B\nCheck: …"
 *
 * We parse that reliably.
 */
function parseQuizTextToQuestions(text){
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const questions = [];
  let i = 0;

  function isNumDot(s){ return /^\d+\.$/.test(s); }

  while(i < lines.length){
    if(!isNumDot(lines[i])) { i++; continue; }

    const qNum = parseInt(lines[i].replace(".",""), 10);
    i++;

    // question text (can be multiple lines until options start)
    let qTextParts = [];
    while(i < lines.length && !/^A\./.test(lines[i]) && !isNumDot(lines[i])){
      if(/^Correct Answer:/.test(lines[i])) break;
      qTextParts.push(lines[i]);
      i++;
    }
    const qTextAll = qTextParts.join(" ").trim();

    // options: gather until "Correct Answer:"
    let optBlob = [];
    while(i < lines.length && !/^Correct Answer:/.test(lines[i]) && !isNumDot(lines[i])){
      optBlob.push(lines[i]);
      i++;
    }
    const optText = optBlob.join(" ").replace(/\s+/g," ").trim();

    // Correct + Check
    let correctLetter = null;
    let checkText = "";

    if(i < lines.length && /^Correct Answer:/.test(lines[i])){
      const m = lines[i].match(/^Correct Answer:\s*([ABCD])\b/i);
      if(m) correctLetter = m[1].toUpperCase();
      const checkMatch = lines[i].match(/Check:\s*(.*)$/i);
      if(checkMatch && checkMatch[1]) checkText = checkMatch[1].trim();
      i++;

      // Sometimes "Check:" continues on next line(s) until next number
      while(i < lines.length && !isNumDot(lines[i]) && !/^Correct Answer:/.test(lines[i])){
        if(/^A\./.test(lines[i])) break;
        // Some docs keep check as a new line
        if(checkText.length > 0) checkText += " ";
        checkText += lines[i];
        i++;
      }
    }

    // Parse options A-D from blob (handles both inline or spaced)
    const opts = parseOptions(optText);

    if(opts.A && opts.B && opts.C && opts.D && correctLetter){
      questions.push({
        id: qNum,
        text: qTextAll,
        options: opts,
        correct: correctLetter,
        check: checkText
      });
    } else {
      // If something odd happens, still try to keep a question (but it might be incomplete)
      // We will skip incomplete ones to avoid broken UI.
    }
  }

  // Sort by id (1..50)
  questions.sort((a,b) => a.id - b.id);
  return questions;
}

function parseOptions(s){
  // Normalize spacing around markers
  const text = (s || "")
    .replace(/\s+/g," ")
    .replace(/([ABCD])\s*\./g, "$1.")
    .trim();

  // Split by A./B./C./D.
  const markers = ["A.","B.","C.","D."];

  const idx = {};
  for(const m of markers){
    idx[m] = text.indexOf(m);
  }
  // If A. not found, return blanks
  if(idx["A."] === -1) return {A:"",B:"",C:"",D:""};

  // Helper slice
  function sliceBetween(startMarker, endMarker){
    const start = idx[startMarker];
    if(start === -1) return "";
    const startPos = start + startMarker.length;
    const end = (endMarker && idx[endMarker] !== -1) ? idx[endMarker] : text.length;
    return text.slice(startPos, end).trim();
  }

  return {
    A: sliceBetween("A.","B."),
    B: sliceBetween("B.","C."),
    C: sliceBetween("C.","D."),
    D: sliceBetween("D.", null)
  };
}

/* =========================================================
   3) Quiz mechanics (sets + missed)
   ========================================================= */
function setActiveSet(newSet){
  activeSet = newSet;

  // UI
  [...setToggle.querySelectorAll("button")].forEach(b => b.classList.remove("active"));
  const btn = [...setToggle.querySelectorAll("button")].find(b => b.dataset.set === newSet);
  if(btn) btn.classList.add("active");

  statusLine.textContent = (newSet === "missed")
    ? "Review Missed: press Start to re-try questions you missed (first attempt)."
    : `Set ${newSet}: press Start to begin.`;

  // If session is running, switching set ends the current run (clean)
  if(session.running){
    endSession(false);
  }
}

function getSetSlice(questions, setNum){
  const start = (setNum - 1) * 10;
  const end = start + 10;
  return questions.slice(start, end);
}

function buildMissedList(questions){
  const pool = missedPool.get(activePodcastKey) || new Set();
  const ids = [...pool.values()].sort((a,b)=>a-b);
  const byId = new Map(questions.map(q => [q.id, q]));
  return ids.map(id => byId.get(id)).filter(Boolean);
}

function beginSession(questionList, mode){
  session.running = true;
  session.mode = mode;
  session.qList = questionList;
  session.pos = 0;
  session.selected = null;
  session.attemptThisQ = 0;
  session.firstTryEligible = true;

  clearFeedback();
  renderQuestion();

  checkBtn.disabled = true;
  nextBtn.disabled = true;
}

function endSession(showSummary=true){
  session.running = false;
  session.qList = [];
  session.pos = 0;
  session.selected = null;
  session.attemptThisQ = 0;
  session.firstTryEligible = true;

  checkBtn.disabled = true;
  nextBtn.disabled = true;

  hide(qHeader);
  hide(questionText);
  hide(optionsWrap);

  if(showSummary){
    const mp = missedPool.get(activePodcastKey) || new Set();
    statusLine.textContent = `Finished. You can pick another set, or Review Missed.`;
    setFeedback(
      "ok",
      "Nice work! ✅",
      `Session summary — Attempted: ${session.stats.attempted}, Correct: ${session.stats.correct}, First-try: ${session.stats.firstTry}. Review Missed pool: ${mp.size}.`
    );
  } else {
    statusLine.textContent = "Select a podcast, pick a set, then press Start.";
    clearFeedback();
  }
}

function renderQuestion(){
  const total = session.qList.length;
  if(total === 0){
    statusLine.textContent = (session.mode === "missed")
      ? "No missed questions yet 🎉 Pick a Set and start."
      : "No questions found for this selection.";
    endSession(false);
    return;
  }

  if(session.pos >= total){
    endSession(true);
    updateChips();
    return;
  }

  const q = session.qList[session.pos];

  show(qHeader);
  show(questionText);
  show(optionsWrap);

  const setLabel = (session.mode === "missed")
    ? `Review Missed — Question ${session.pos + 1} of ${total}`
    : `Set ${activeSet} — Question ${session.pos + 1} of ${total}`;

  qHeader.textContent = setLabel;
  questionText.textContent = q.text;

  // options (4 separate cards)
  optionsWrap.innerHTML = "";
  session.selected = null;
  session.attemptThisQ = 0;
  session.firstTryEligible = true;

  ["A","B","C","D"].forEach(letter => {
    const btn = document.createElement("button");
    btn.className = "optionCard";
    btn.type = "button";
    btn.innerHTML = `<span class="optionLetter">${letter}.</span> ${escapeHtml(q.options[letter])}`;
    btn.addEventListener("click", () => {
      // select styling
      [...optionsWrap.querySelectorAll(".optionCard")].forEach(x => x.classList.remove("selected"));
      btn.classList.add("selected");
      session.selected = letter;
      checkBtn.disabled = false;
      nextBtn.disabled = true; // only after correct
      clearFeedback();
    });
    optionsWrap.appendChild(btn);
  });

  clearFeedback();
  checkBtn.disabled = true;
  nextBtn.disabled = true;
}

/* =========================================================
   4) Events
   ========================================================= */
setToggle.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if(!b) return;
  setActiveSet(b.dataset.set);
});

podcastSelect.addEventListener("change", async () => {
  activePodcastKey = podcastSelect.value;
  if(!missedPool.has(activePodcastKey)) missedPool.set(activePodcastKey, new Set());
  updateChips();
  endSession(false);
  loadNote.textContent = "Press Start to load questions for this podcast.";
});

startBtn.addEventListener("click", async () => {
  try{
    if(!activePodcastKey){
      statusLine.textContent = "Please select a podcast first.";
      return;
    }

    const questions = await getQuestionsForPodcast(activePodcastKey);

    let qList = [];
    if(activeSet === "missed"){
      qList = buildMissedList(questions);
      beginSession(qList, "missed");
    } else {
      const setNum = parseInt(activeSet, 10);
      qList = getSetSlice(questions, setNum);
      beginSession(qList, "set");
    }

    statusLine.textContent = "Quiz started. Pick an option, then press Check Answer.";

  } catch(err){
    statusLine.textContent = "Could not start the quiz.";
    setFeedback("bad", "Error loading quiz ❌", String(err && err.message ? err.message : err));
    checkBtn.disabled = true;
    nextBtn.disabled = true;
  }
});

finishBtn.addEventListener("click", () => {
  if(!session.running){
    statusLine.textContent = "Nothing to finish — press Start when ready.";
    return;
  }
  endSession(true);
  updateChips();
});

checkBtn.addEventListener("click", () => {
  if(!session.running) return;
  const q = session.qList[session.pos];
  if(!q) return;

  if(!session.selected){
    setFeedback("bad","Pick an option first 🙂","");
    return;
  }

  session.stats.attempted += 1;
  session.attemptThisQ += 1;

  const correct = q.correct;
  const selected = session.selected;

  if(selected === correct){
    session.stats.correct += 1;
    if(session.attemptThisQ === 1){
      session.stats.firstTry += 1;
      // If it was in missed pool and now first-try correct in missed mode, we can remove.
      if(session.mode === "missed"){
        const pool = missedPool.get(activePodcastKey) || new Set();
        pool.delete(q.id);
        missedPool.set(activePodcastKey, pool);
      }
    }

    const praise = pickPraise();
    setFeedback("ok", `${praise} ✅`, q.check ? `Check: ${q.check}` : "");
    nextBtn.disabled = false;
    checkBtn.disabled = true;
  } else {
    // wrong answer: add to missed pool if wrong on first attempt of that question
    if(session.attemptThisQ === 1 && session.mode !== "missed"){
      const pool = missedPool.get(activePodcastKey) || new Set();
      pool.add(q.id);
      missedPool.set(activePodcastKey, pool);
    }
    setFeedback("bad", "Not quite — try again 💪", "Tip: re-read the choices and try once more.");
    nextBtn.disabled = true; // cannot advance
  }

  updateChips();
});

nextBtn.addEventListener("click", () => {
  if(!session.running) return;
  session.pos += 1;
  renderQuestion();
  updateChips();
});

/* Motivating phrases */
function pickPraise(){
  const list = [
    "Nice!",
    "Great job!",
    "Super!",
    "Well done!",
    "Awesome!",
    "You got it!",
    "Perfect!"
  ];
  return list[Math.floor(Math.random()*list.length)];
}

/* =========================================================
   Init
   ========================================================= */
(async function init(){
  try{
    await loadPodcastList();
    // default set 1 selected already
    setActiveSet("1");
  }catch(err){
    podcastSelect.innerHTML = `<option value="" selected disabled>Error loading podcast list</option>`;
    loadNote.textContent = String(err && err.message ? err.message : err);
  }
})();
