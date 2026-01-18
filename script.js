/* =========================================================
   QUIZ PAGE (Sets of 10 + Review Missed)
   - Loads a podcast quiz DOCX via mammoth.js
   - Splits into 5 sets of 10 questions (first 50 questions)
   - Shows ONE question at a time
   - Cannot proceed until correct
   - Tracks Correct / Attempted / First-try
   - Missed questions go to "Review Missed"
   ========================================================= */

/* ------------------------------
   CONFIG: add new quiz docx here
   Folder structure (case-sensitive on GitHub Pages):
   - Images/<file>.docx
   ------------------------------ */
const QUIZ_LIBRARY = [
  { id: "101", title: "101 — Introduction (Part 1)", docx: "Images/101_Intro_1_quiz.docx" },
  { id: "102", title: "102 — Introduction (Part 2) of Aruṇam", docx: "Images/102_Intro_2_quiz.docx" },
  { id: "103", title: "103 — First Pañcati of Aruṇam", docx: "Images/103_1st_Panchadi_quiz.docx" }
];

const QUESTIONS_PER_SET = 10;
const NUM_SETS = 5; // Set 1..5 = 50 questions

/* ------------------------------
   UI helpers
   ------------------------------ */
const $ = (id) => document.getElementById(id);

const podcastSelect = $("podcastSelect");
const setTabs = $("setTabs");

const btnStart = $("btnStart");
const btnFinish = $("btnFinish");
const btnCheck = $("btnCheck");
const btnNext = $("btnNext");

const sessionBadge = $("sessionBadge");
const questionArea = $("questionArea");
const summaryArea = $("summaryArea");

const qTitle = $("qTitle");
const qMeta = $("qMeta");
const choicesEl = $("choices");
const feedbackEl = $("feedback");

const statCorrect = $("statCorrect");
const statAttempted = $("statAttempted");
const statFirstTry = $("statFirstTry");

/* ------------------------------
   State
   ------------------------------ */
let allQuestions = [];          // full parsed list from docx
let sets = [];                  // [{name, questions:[...]}] length 5
let activeSetIndex = 0;         // 0..4
let activeMode = "set";         // "set" | "missed"

let queue = [];                // questions left in current mode
let current = null;            // current question object
let currentAttemptCount = 0;   // attempts for current question
let selectedChoice = null;     // 'A'/'B'/'C'/'D'

let stats = {
  correct: 0,
  attempted: 0,
  firstTry: 0
};

let missedPool = [];           // questions user missed (session-wide), unique by q._key
let missedKeys = new Set();    // for uniqueness

/* ------------------------------
   Utilities
   ------------------------------ */
function setBadge(msg){
  sessionBadge.textContent = msg;
}

function resetStats(){
  stats = { correct:0, attempted:0, firstTry:0 };
  renderStats();
}

function renderStats(){
  statCorrect.textContent = `Correct: ${stats.correct}`;
  statAttempted.textContent = `Attempted: ${stats.attempted}`;
  statFirstTry.textContent = `First-try: ${stats.firstTry}`;
}

function showFeedback(type, text){
  feedbackEl.classList.remove("good","bad");
  feedbackEl.textContent = text;
  feedbackEl.classList.add(type === "good" ? "good" : "bad");
}

function clearFeedback(){
  feedbackEl.classList.remove("good","bad");
  feedbackEl.textContent = "";
}

function shuffle(arr){
  // Fisher–Yates
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

/* ------------------------------
   DOCX -> HTML -> Question parsing
   This parser is designed to be tolerant:
   It looks for blocks like:
     Question ...
     A) ...
     B) ...
     C) ...
     D) ...
     Answer: B
     Explanation: ...
   If your docx uses slightly different labels, it still often works.
   ------------------------------ */
async function loadDocxAsText(docxPath){
  if(!window.mammoth) throw new Error("mammoth.js not loaded. Check script tag.");

  const res = await fetch(docxPath, { cache:"no-cache" });
  if(!res.ok){
    throw new Error(`Could not fetch: ${docxPath}\nHTTP ${res.status} ${res.statusText}\n\nCheck the file path and folder case (Images vs images).`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const html = (result.value || "").trim();

  // Convert to plain-ish text while preserving line breaks
  const tmp = document.createElement("div");
  tmp.innerHTML = html
    .replace(/<\/p>/gi, "</p>\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const text = tmp.textContent || "";
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join("\n");
}

function parseQuestions(text){
  // Strategy:
  // Split on occurrences of "Q" or "Question" markers,
  // then parse each chunk for options and answer.
  const chunks = [];
  const lines = text.split("\n");

  let buf = [];
  function pushBuf(){
    if(buf.length) chunks.push(buf.join("\n"));
    buf = [];
  }

  for(const line of lines){
    const isStart =
      /^Q\s*\d+[\).\:-]/i.test(line) ||
      /^Question\s*\d*[\).\:-]?/i.test(line);
    if(isStart && buf.length) pushBuf();
    buf.push(line);
  }
  pushBuf();

  const questions = [];
  let idx = 0;

  for(const chunk of chunks){
    // Extract options
    const opt = { A:null, B:null, C:null, D:null };
    const optRe = /^(A|B|C|D)\s*[\)\.\:-]\s*(.+)$/i;

    const chunkLines = chunk.split("\n");
    let qLines = [];
    let explanationLines = [];
    let answer = null;
    let inExplanation = false;

    for(const lnRaw of chunkLines){
      const ln = lnRaw.trim();

      // Answer line
      const ansMatch = ln.match(/^Answer\s*[:\-]\s*([A-D])\b/i) || ln.match(/^Correct\s*Answer\s*[:\-]\s*([A-D])\b/i);
      if(ansMatch){
        answer = ansMatch[1].toUpperCase();
        continue;
      }

      // Explanation start
      if(/^Explanation\s*[:\-]/i.test(ln) || /^Check\s*[:\-]/i.test(ln) || /^Reason\s*[:\-]/i.test(ln)){
        inExplanation = true;
        const cleaned = ln.replace(/^Explanation\s*[:\-]\s*/i,"")
                          .replace(/^Check\s*[:\-]\s*/i,"")
                          .replace(/^Reason\s*[:\-]\s*/i,"");
        if(cleaned) explanationLines.push(cleaned);
        continue;
      }

      // Option lines
      const m = ln.match(optRe);
      if(m && !inExplanation){
        opt[m[1].toUpperCase()] = m[2].trim();
        continue;
      }

      // If we already entered explanation, keep collecting
      if(inExplanation){
        explanationLines.push(ln);
      } else {
        qLines.push(ln);
      }
    }

    // Build question text:
    let qText = qLines.join(" ").trim();
    // Remove leading "Q1:" etc from qText
    qText = qText.replace(/^Q\s*\d+[\).\:-]\s*/i,"")
                 .replace(/^Question\s*\d*[\).\:-]?\s*/i,"")
                 .trim();

    // If options were not found via strict pattern, try a fallback scan:
    // (Sometimes docx lists "A." or "A -" etc; already covered. If not, skip.)
    const hasAll = opt.A && opt.B && opt.C && opt.D;

    if(!qText || !hasAll || !answer){
      // If the chunk doesn't parse cleanly, ignore it rather than breaking the quiz.
      continue;
    }

    idx += 1;
    questions.push({
      _key: `q${idx}_${hashString(qText).slice(0,8)}`,
      q: qText,
      choices: opt,
      answer,
      explanation: explanationLines.join("\n").trim()
    });
  }

  return questions;
}

function hashString(str){
  // simple deterministic hash for IDs
  let h = 2166136261;
  for(let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/* ------------------------------
   Set building
   ------------------------------ */
function buildSets(questions){
  // Take first 50 questions (or fewer)
  const capped = questions.slice(0, QUESTIONS_PER_SET * NUM_SETS);

  const out = [];
  for(let s=0; s<NUM_SETS; s++){
    const start = s * QUESTIONS_PER_SET;
    const end = start + QUESTIONS_PER_SET;
    const slice = capped.slice(start, end);
    out.push({
      name: `Set ${s+1}`,
      questions: slice
    });
  }
  return out;
}

/* ------------------------------
   Tabs
   ------------------------------ */
function renderTabs(){
  setTabs.innerHTML = "";

  for(let i=0;i<NUM_SETS;i++){
    const b = document.createElement("button");
    b.className = "tabBtn";
    b.textContent = `Set ${i+1}`;
    b.dataset.mode = "set";
    b.dataset.setIndex = String(i);
    if(activeMode==="set" && activeSetIndex===i) b.classList.add("active");
    b.addEventListener("click", () => switchToSet(i));
    setTabs.appendChild(b);
  }

  const missedBtn = document.createElement("button");
  missedBtn.className = "tabBtn";
  missedBtn.textContent = "Review Missed";
  missedBtn.dataset.mode = "missed";
  if(activeMode==="missed") missedBtn.classList.add("active");
  missedBtn.addEventListener("click", () => switchToMissed());
  setTabs.appendChild(missedBtn);
}

function switchToSet(i){
  activeMode = "set";
  activeSetIndex = i;
  renderTabs();

  // If quiz already started, load that set queue
  if(allQuestions.length){
    queue = shuffle(sets[i].questions);
    current = null;
    currentAttemptCount = 0;
    selectedChoice = null;
    clearFeedback();
    setBadge(`Set ${i+1} selected. Press Start.`);
    questionArea.style.display = "none";
    summaryArea.style.display = "none";
    btnCheck.disabled = true;
    btnNext.disabled = true;
  }
}

function switchToMissed(){
  activeMode = "missed";
  renderTabs();

  if(!missedPool.length){
    setBadge("No missed questions yet 🙂");
    questionArea.style.display = "none";
    summaryArea.style.display = "none";
    return;
  }

  queue = shuffle(missedPool);
  current = null;
  currentAttemptCount = 0;
  selectedChoice = null;
  clearFeedback();
  setBadge("Review Missed selected. Press Start.");
  questionArea.style.display = "none";
  summaryArea.style.display = "none";
  btnCheck.disabled = true;
  btnNext.disabled = true;
}

/* ------------------------------
   Quiz engine
   ------------------------------ */
function renderCurrentQuestion(){
  if(!current){
    questionArea.style.display = "none";
    return;
  }

  questionArea.style.display = "block";
  summaryArea.style.display = "none";

  clearFeedback();

  qTitle.textContent = current.q;
  const modeLabel = activeMode === "missed" ? "Review Missed" : `Set ${activeSetIndex+1}`;
  qMeta.textContent = `${modeLabel} • Remaining: ${queue.length + 1}`;

  choicesEl.innerHTML = "";
  selectedChoice = null;

  const letters = ["A","B","C","D"];
  for(const L of letters){
    const row = document.createElement("label");
    row.className = "choice";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "choice";
    input.value = L;

    input.addEventListener("change", () => {
      selectedChoice = L;
      btnCheck.disabled = false;
    });

    const lab = document.createElement("div");
    lab.className = "label";
    lab.textContent = `${L}`;

    const txt = document.createElement("div");
    txt.className = "text";
    txt.textContent = current.choices[L] || "";

    row.appendChild(input);
    row.appendChild(lab);
    row.appendChild(txt);

    choicesEl.appendChild(row);
  }

  btnCheck.disabled = true;
  btnNext.disabled = true;
}

function pickNext(){
  current = queue.shift() || null;
  currentAttemptCount = 0;
  renderCurrentQuestion();
  if(!current){
    endOfMode();
  }
}

function endOfMode(){
  questionArea.style.display = "none";
  summaryArea.style.display = "block";

  const missedCount = missedPool.length;

  summaryArea.innerHTML = `
    <div style="font-weight:900;font-size:18px;margin-bottom:8px;">Nice work! ✅</div>
    <div style="color:rgba(233,238,252,.75);line-height:1.5;">
      Session summary:<br>
      • Attempted: <b>${stats.attempted}</b><br>
      • Correct: <b>${stats.correct}</b><br>
      • First-try correct: <b>${stats.firstTry}</b><br>
      • In Review Missed pool: <b>${missedCount}</b><br><br>
      Want a challenge? Try another Set — or hit <b>Review Missed</b> to clean up mistakes 💪
    </div>
  `;
  setBadge("Finished. You can pick another set, or Review Missed.");
  btnCheck.disabled = true;
  btnNext.disabled = true;
}

function addToMissedPool(q){
  if(!q || !q._key) return;
  if(missedKeys.has(q._key)) return;
  missedKeys.add(q._key);
  missedPool.push(q);
}

function removeFromMissedPool(q){
  if(!q || !q._key) return;
  if(!missedKeys.has(q._key)) return;
  missedKeys.delete(q._key);
  missedPool = missedPool.filter(x => x._key !== q._key);
}

/* ------------------------------
   Button actions
   ------------------------------ */
btnStart.addEventListener("click", async () => {
  try{
    setBadge("Loading quiz…");

    // Load docx for selected podcast
    const selected = QUIZ_LIBRARY.find(x => x.id === podcastSelect.value) || QUIZ_LIBRARY[0];
    if(!selected) throw new Error("No quiz configured.");

    const text = await loadDocxAsText(selected.docx);
    const parsed = parseQuestions(text);

    if(!parsed.length){
      throw new Error("Could not parse questions from the DOCX.\nMake sure the doc contains Q + A/B/C/D + Answer: X + Explanation.");
    }

    allQuestions = parsed;
    sets = buildSets(allQuestions);

    // If fewer than 50, still okay; some sets may be smaller.
    renderTabs();

    // Build queue based on active mode
    if(activeMode === "missed"){
      if(!missedPool.length){
        setBadge("No missed questions yet 🙂 Pick a set first.");
        return;
      }
      queue = shuffle(missedPool);
      setBadge(`Loaded Review Missed for: ${selected.title}.`);
    } else {
      queue = shuffle(sets[activeSetIndex].questions);
      setBadge(`Loaded ${sets[activeSetIndex].name} for: ${selected.title}.`);
    }

    // Reset stats for this run (session)
    resetStats();

    pickNext();
  } catch(err){
    questionArea.style.display = "none";
    summaryArea.style.display = "block";
    summaryArea.textContent = String(err);
    setBadge("Error loading quiz.");
    btnCheck.disabled = true;
    btnNext.disabled = true;
  }
});

btnFinish.addEventListener("click", () => {
  // Finish anytime
  endOfMode();
});

btnCheck.addEventListener("click", () => {
  if(!current || !selectedChoice) return;

  stats.attempted += 1;
  currentAttemptCount += 1;

  const correct = current.answer === selectedChoice;

  if(correct){
    stats.correct += 1;
    if(currentAttemptCount === 1) stats.firstTry += 1;

    // If it was in missed pool and user got it correct now, remove it.
    removeFromMissedPool(current);

    const praise = pickPraise(currentAttemptCount);
    const expl = current.explanation ? `\n\nWhy:\n${current.explanation}` : "";
    showFeedback("good", `${praise}\nCorrect answer: ${current.answer}.${expl}`);

    btnNext.disabled = false;
    btnCheck.disabled = true;
  } else {
    // If wrong, add to missed pool (for end review)
    addToMissedPool(current);

    const nudge = pickNudge();
    showFeedback("bad", `${nudge}\nTry again 🙂`);

    // Cannot go next until correct
    btnNext.disabled = true;
    btnCheck.disabled = false;
  }

  renderStats();
});

btnNext.addEventListener("click", () => {
  // Only enabled after correct
  pickNext();
});

/* ------------------------------
   Praise / Nudge messages
   ------------------------------ */
function pickPraise(attempts){
  if(attempts === 1){
    const arr = [
      "Perfect! 🎯",
      "Nice! ✅ First-try!",
      "Excellent! 🌟",
      "Super! 💪"
    ];
    return arr[Math.floor(Math.random()*arr.length)];
  }
  const arr = [
    "Good catch! ✅",
    "Nice recovery! 💪",
    "You got it! 🌟",
    "Well done — keep going! ✅"
  ];
  return arr[Math.floor(Math.random()*arr.length)];
}

function pickNudge(){
  const arr = [
    "Close! 🤏",
    "Not quite — try once more 🙂",
    "Good attempt! One more try 💪",
    "Almost there! 🙂"
  ];
  return arr[Math.floor(Math.random()*arr.length)];
}

/* ------------------------------
   Init
   ------------------------------ */
function init(){
  // populate podcast dropdown
  podcastSelect.innerHTML = "";
  for(const item of QUIZ_LIBRARY){
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = item.title;
    podcastSelect.appendChild(opt);
  }

  // default tabs
  activeMode = "set";
  activeSetIndex = 0;
  renderTabs();

  setBadge("Select a podcast, choose a Set, then press Start.");
  renderStats();

  // Disable check/next until started
  btnCheck.disabled = true;
  btnNext.disabled = true;

  // If user changes podcast, just reset UI (don’t auto-load)
  podcastSelect.addEventListener("change", () => {
    allQuestions = [];
    sets = [];
    queue = [];
    current = null;
    currentAttemptCount = 0;
    selectedChoice = null;
    clearFeedback();

    questionArea.style.display = "none";
    summaryArea.style.display = "none";
    btnCheck.disabled = true;
    btnNext.disabled = true;

    setBadge("Podcast changed. Press Start to load the quiz.");
  });
}

init();
