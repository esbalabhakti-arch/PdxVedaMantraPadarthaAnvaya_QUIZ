/*  Veda Podcast Learning Check Quiz
    - Loads .docx quizzes from Images/ folder on GitHub Pages
    - Splits each doc into Set 1..5 (10 questions each)
    - "Review Missed" contains questions not correct on FIRST attempt
    - One question at a time; cannot proceed until correct
*/

const UI = {
  podcastSelect: document.getElementById("podcastSelect"),
  setToggle: document.getElementById("setToggle"),
  missedBtn: document.getElementById("missedBtn"),
  modePill: document.getElementById("modePill"),
  startBtn: document.getElementById("startBtn"),
  finishBtn: document.getElementById("finishBtn"),
  mainMsg: document.getElementById("mainMsg"),

  scoreCorrect: document.getElementById("scoreCorrect"),
  scoreAttempted: document.getElementById("scoreAttempted"),
  scoreFirstTry: document.getElementById("scoreFirstTry"),
  scoreMissedPool: document.getElementById("scoreMissedPool"),

  qBox: document.getElementById("qBox"),
  qTitle: document.getElementById("qTitle"),
  qMeta: document.getElementById("qMeta"),
  options: document.getElementById("options"),
  checkBtn: document.getElementById("checkBtn"),
  nextBtn: document.getElementById("nextBtn"),
  resultBox: document.getElementById("resultBox"),
};

const ENCOURAGE_OK = [
  "Nice! ✅",
  "Super! 💪",
  "Great job! 🌟",
  "Perfect — keep going! 🔥",
  "Awesome! 🙌"
];

const ENCOURAGE_BAD = [
  "Not yet — try once more 🙂",
  "Close! Give it another go 💡",
  "Good effort — one more try 💪",
  "Almost there — re-read the options 🙂"
];

// ------------ State ------------
const State = {
  files: [],                 // [{name, path}]
  cache: new Map(),          // filename -> parsed questions[]
  selectedFile: "",

  activeMode: "set",         // "set" | "missed"
  activeSetIndex: 0,         // 0..4

  // quiz session counters (for current session only)
  attempted: 0,
  correct: 0,
  firstTry: 0,

  // missed pool across session (for current selected podcast)
  missedIds: new Set(),      // question.id strings for "first-try failed"
  missedList: [],            // question objects (unique), in encounter order

  // current run
  runList: [],               // questions for this run (set or missed)
  runIndex: 0,               // index in runList
  current: null,             // current question object
  currentTries: 0,           // tries for current question in this run
  selectedChoice: null,      // "A"|"B"|"C"|"D"
  started: false
};

// ------------ Helpers ------------
function randPick(arr){
  return arr[Math.floor(Math.random() * arr.length)];
}

function setMessage(html){
  UI.mainMsg.innerHTML = html;
}

function updateScores(){
  UI.scoreCorrect.textContent = `Correct: ${State.correct}`;
  UI.scoreAttempted.textContent = `Attempted: ${State.attempted}`;
  UI.scoreFirstTry.textContent = `First-try: ${State.firstTry}`;
  UI.scoreMissedPool.textContent = `In Review Missed pool: ${State.missedList.length}`;
  UI.missedBtn.textContent = `Review Missed (${State.missedList.length})`;
}

function setModePill(){
  if (State.activeMode === "missed"){
    UI.modePill.textContent = `Review Missed • Ready`;
  } else {
    UI.modePill.textContent = `Set ${State.activeSetIndex + 1} • Ready`;
  }
}

function setActiveToggleButton(){
  const btns = [...UI.setToggle.querySelectorAll(".tbtn")];
  btns.forEach(b => b.classList.remove("active"));

  if (State.activeMode === "missed"){
    UI.missedBtn.classList.add("active");
  } else {
    const wanted = String(State.activeSetIndex + 1);
    const b = btns.find(x => x.dataset.set === wanted);
    if (b) b.classList.add("active");
  }
}

function getOwnerAndRepo(){
  // Works for: https://<owner>.github.io/<repo>/
  const host = window.location.hostname || "";
  const owner = host.split(".github.io")[0] || "";
  const parts = (window.location.pathname || "/").split("/").filter(Boolean);
  const repo = parts[0] || "";
  return { owner, repo };
}

function nicePodcastName(filename){
  // e.g. 101_Intro_1_quiz.docx -> "101 — Intro 1"
  let base = filename.replace(/_quiz\.docx$/i, "");
  base = base.replace(/_/g, " ").trim();
  // If starts with number, add em dash styling
  const m = base.match(/^(\d+)\s+(.*)$/);
  if (m) return `${m[1]} — ${m[2]}`;
  return base;
}

// ------------ DOCX parsing ------------
function parseQuestionsFromRawText(rawText, sourceFilename){
  // The DOCX raw text (from mammoth) follows:
  // 1.
  // Question text...
  // A. ...
  // B. ...
  // C. ...
  // D. ...
  // Correct Answer: B
  // Check: explanation...
  //
  // We'll parse using a robust regex across the whole text.

  const text = (rawText || "").replace(/\r\n/g, "\n");
  const re = /(?:^|\n)(\d+)\.\s*\n([\s\S]*?)\nA\.\s*([^\n]*)\nB\.\s*([^\n]*)\nC\.\s*([^\n]*)\nD\.\s*([^\n]*)\nCorrect Answer:\s*([ABCD])\s*\nCheck:\s*([\s\S]*?)(?=\n\d+\.\s*\n|$)/g;

  const out = [];
  let m;
  while ((m = re.exec(text)) !== null){
    const n = parseInt(m[1], 10);
    const qText = m[2].trim();
    const A = m[3].trim();
    const B = m[4].trim();
    const C = m[5].trim();
    const D = m[6].trim();
    const ans = m[7].trim();
    const check = m[8].trim();

    // stable id per podcast+question number
    const id = `${sourceFilename}::Q${n}`;

    out.push({
      id,
      num: n,
      text: qText,
      options: { A, B, C, D },
      answer: ans,
      check
    });
  }

  // Sort by question number just in case
  out.sort((a,b) => a.num - b.num);
  return out;
}

async function loadDocxQuestions(filename){
  if (State.cache.has(filename)) return State.cache.get(filename);

  // Fetch DOCX from Images/ (capital I)
  const url = `Images/${encodeURIComponent(filename)}`;
  const resp = await fetch(url);
  if (!resp.ok){
    throw new Error(`Could not fetch ${url}. HTTP ${resp.status}`);
  }
  const arrayBuffer = await resp.arrayBuffer();

  if (!window.mammoth || !mammoth.extractRawText){
    throw new Error("Mammoth did not load. Check the mammoth script tag.");
  }

  const result = await mammoth.extractRawText({ arrayBuffer });
  const raw = (result && result.value) ? result.value : "";
  const qs = parseQuestionsFromRawText(raw, filename);

  State.cache.set(filename, qs);
  return qs;
}

// ------------ GitHub listing (auto-pickup new DOCX) ------------
async function listDocxFiles(){
  const { owner, repo } = getOwnerAndRepo();

  // If not running on GitHub pages, fallback to known filenames
  if (!owner || !repo){
    return [
      { name: "101_Intro_1_quiz.docx", path: "Images/101_Intro_1_quiz.docx" },
      { name: "102_Intro_2_quiz.docx", path: "Images/102_Intro_2_quiz.docx" },
      { name: "103_1st_Panchadi_quiz.docx", path: "Images/103_1st_Panchadi_quiz.docx" }
    ];
  }

  const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/Images`;
  const resp = await fetch(api, { headers: { "Accept": "application/vnd.github+json" } });

  if (!resp.ok){
    // API rate limit / temporary failure — fallback to known list
    return [
      { name: "101_Intro_1_quiz.docx", path: "Images/101_Intro_1_quiz.docx" },
      { name: "102_Intro_2_quiz.docx", path: "Images/102_Intro_2_quiz.docx" },
      { name: "103_1st_Panchadi_quiz.docx", path: "Images/103_1st_Panchadi_quiz.docx" }
    ];
  }

  const items = await resp.json();
  const docx = (items || [])
    .filter(x => x && x.type === "file" && typeof x.name === "string")
    .filter(x => x.name.toLowerCase().endsWith("_quiz.docx"))
    .map(x => ({ name: x.name, path: `Images/${x.name}` }));

  // Sort by leading number if present
  docx.sort((a,b) => {
    const na = parseInt((a.name.match(/^(\d+)/) || [,"999999"])[1], 10);
    const nb = parseInt((b.name.match(/^(\d+)/) || [,"999999"])[1], 10);
    return na - nb;
  });

  return docx;
}

function fillPodcastDropdown(files){
  UI.podcastSelect.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Select a podcast…";
  UI.podcastSelect.appendChild(opt0);

  files.forEach(f => {
    const opt = document.createElement("option");
    opt.value = f.name;
    opt.textContent = nicePodcastName(f.name);
    UI.podcastSelect.appendChild(opt);
  });
}

// ------------ Quiz mechanics ------------
function resetSessionStateForPodcast(){
  State.attempted = 0;
  State.correct = 0;
  State.firstTry = 0;

  State.missedIds = new Set();
  State.missedList = [];

  State.runList = [];
  State.runIndex = 0;
  State.current = null;
  State.currentTries = 0;
  State.selectedChoice = null;
  State.started = false;

  updateScores();
  setModePill();
  setActiveToggleButton();

  UI.qBox.style.display = "none";
  UI.resultBox.style.display = "none";
  UI.nextBtn.disabled = true;
  UI.checkBtn.disabled = false;

  setMessage(`Select a podcast, pick a set, then press <b>Start</b>.`);
}

function makeSetRunList(allQs){
  // 50 questions -> sets of 10
  const set = State.activeSetIndex; // 0..4
  const start = set * 10;
  const end = start + 10;
  return allQs.slice(start, end);
}

function startRun(runList){
  State.runList = runList.slice(); // copy
  State.runIndex = 0;
  State.started = true;
  showQuestionAtIndex(0);
}

function showQuestionAtIndex(i){
  if (!State.runList.length){
    UI.qBox.style.display = "none";
    UI.resultBox.style.display = "none";
    State.current = null;
    setMessage(`No questions available for this selection.`);
    return;
  }

  if (i >= State.runList.length){
    // Finished this run
    State.current = null;
    UI.qBox.style.display = "none";
    UI.resultBox.style.display = "none";

    const msg = (State.activeMode === "missed")
      ? `Finished <b>Review Missed</b>. Want another Set? 💪`
      : `Finished <b>Set ${State.activeSetIndex + 1}</b>. You can try another set — or hit <b>Review Missed</b> to clean up mistakes 💪`;

    setMessage(msg);
    State.started = false;
    return;
  }

  State.current = State.runList[i];
  State.currentTries = 0;
  State.selectedChoice = null;

  UI.qBox.style.display = "block";
  UI.resultBox.style.display = "none";
  UI.resultBox.className = "result";

  UI.checkBtn.disabled = false;
  UI.nextBtn.disabled = true;

  UI.qTitle.textContent = `Q${State.current.num}. ${State.current.text}`;
  UI.qMeta.textContent = (State.activeMode === "missed")
    ? `Mode: Review Missed • Question ${i + 1} of ${State.runList.length}`
    : `Set ${State.activeSetIndex + 1} • Question ${i + 1} of ${State.runList.length}`;

  // render options
  UI.options.innerHTML = "";
  ["A","B","C","D"].forEach(letter => {
    const wrap = document.createElement("label");
    wrap.className = "opt";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "mcq";
    radio.value = letter;

    const txt = document.createElement("div");
    txt.className = "txt";
    txt.textContent = `${letter}. ${State.current.options[letter]}`;

    wrap.appendChild(radio);
    wrap.appendChild(txt);

    wrap.addEventListener("click", () => {
      State.selectedChoice = letter;
      [...UI.options.querySelectorAll(".opt")].forEach(x => x.classList.remove("selected"));
      wrap.classList.add("selected");
      radio.checked = true;
    });

    UI.options.appendChild(wrap);
  });
}

function recordMissedIfNeeded(q){
  if (!State.missedIds.has(q.id)){
    State.missedIds.add(q.id);
    State.missedList.push(q);
  }
  updateScores();
}

function showResult(ok, html){
  UI.resultBox.style.display = "block";
  UI.resultBox.className = ok ? "result ok" : "result bad";
  UI.resultBox.innerHTML = html;
}

function finishSummary(){
  UI.qBox.style.display = "none";
  UI.resultBox.style.display = "none";
  State.started = false;

  const summary = `
    <div style="font-weight:800; font-size:18px; margin-bottom:8px;">
      Nice work! ✅
    </div>
    <div style="color:rgba(255,255,255,0.85); line-height:1.55;">
      <div><b>Attempted:</b> ${State.attempted}</div>
      <div><b>Correct:</b> ${State.correct}</div>
      <div><b>First-try correct:</b> ${State.firstTry}</div>
      <div><b>In Review Missed pool:</b> ${State.missedList.length}</div>
      <div style="margin-top:10px; color:rgba(255,255,255,0.72);">
        Want a challenge? Try another Set — or hit <b>Review Missed</b> to clean up mistakes 💪
      </div>
    </div>
  `;
  setMessage(summary);
}

// ------------ Wiring UI events ------------
UI.setToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".tbtn");
  if (!btn) return;

  const val = btn.dataset.set;
  if (val === "missed"){
    State.activeMode = "missed";
  } else {
    State.activeMode = "set";
    State.activeSetIndex = Math.max(0, Math.min(4, parseInt(val, 10) - 1));
  }

  setActiveToggleButton();
  setModePill();

  // Changing set resets only the current run UI, not the counters/missed pool.
  State.started = false;
  UI.qBox.style.display = "none";
  UI.resultBox.style.display = "none";
  UI.nextBtn.disabled = true;
  UI.checkBtn.disabled = false;

  if (State.activeMode === "missed"){
    setMessage(`Review Missed is ready. Press <b>Start</b> to practice questions you didn’t get on the first try.`);
  } else {
    setMessage(`Set ${State.activeSetIndex + 1} is ready. Press <b>Start</b> to begin.`);
  }
});

UI.podcastSelect.addEventListener("change", async () => {
  const filename = UI.podcastSelect.value;
  State.selectedFile = filename;

  // Reset everything when podcast changes
  resetSessionStateForPodcast();

  if (!filename) return;

  setMessage(`Loading <b>${nicePodcastName(filename)}</b>…`);

  try{
    const qs = await loadDocxQuestions(filename);

    if (!qs.length){
      setMessage(
        `Could not parse questions from <b>${filename}</b>.<br/>
         This usually means the DOCX didn’t contain the expected pattern (1., A., B., C., D., Correct Answer, Check).`
      );
      return;
    }

    setMessage(
      `Loaded <b>${qs.length}</b> questions for <b>${nicePodcastName(filename)}</b>.<br/>
       Pick a Set (1–5) or try <b>Review Missed</b>, then press <b>Start</b>.`
    );
  } catch(err){
    setMessage(
      `Error loading <b>${filename}</b>:<br/><span style="color:rgba(255,255,255,0.85)">${String(err.message || err)}</span>`
    );
  }
});

UI.startBtn.addEventListener("click", async () => {
  if (!State.selectedFile){
    setMessage(`Please select a podcast first.`);
    return;
  }

  setMessage(`Preparing quiz…`);

  try{
    const allQs = await loadDocxQuestions(State.selectedFile);
    if (!allQs.length){
      setMessage(`No questions parsed from <b>${State.selectedFile}</b>.`);
      return;
    }

    let runList = [];
    if (State.activeMode === "missed"){
      runList = State.missedList.slice();
      if (!runList.length){
        setMessage(`Your <b>Review Missed</b> pool is empty 🎉 Pick a Set and try it!`);
        return;
      }
    } else {
      runList = makeSetRunList(allQs);
      if (!runList.length){
        setMessage(`This set has no questions (unexpected).`);
        return;
      }
    }

    setModePill();
    startRun(runList);
    setMessage(`Go! Answer correctly to move forward 🙂`);
  } catch(err){
    setMessage(`Could not start the quiz: ${String(err.message || err)}`);
  }
});

UI.checkBtn.addEventListener("click", () => {
  if (!State.started || !State.current){
    setMessage(`Press <b>Start</b> to begin.`);
    return;
  }
  if (!State.selectedChoice){
    showResult(false, `Please pick an option first 🙂`);
    return;
  }

  State.currentTries += 1;
  State.attempted += 1;

  const correctLetter = State.current.answer;
  const isCorrect = (State.selectedChoice === correctLetter);

  if (isCorrect){
    State.correct += 1;
    if (State.currentTries === 1){
      State.firstTry += 1;
    } else {
      // if they missed first try, it should be in missed pool already
    }

    updateScores();
    const praise = randPick(ENCOURAGE_OK);

    // Show the "Check:" explanation after correct (as requested)
    showResult(
      true,
      `<b>${praise}</b><br/><br/>
       <b>Correct:</b> ${correctLetter}<br/>
       <b>Check:</b> ${State.current.check}`
    );

    UI.nextBtn.disabled = false;
    UI.checkBtn.disabled = true;

  } else {
    // Wrong
    // If first attempt wrong, add to missed pool
    if (State.currentTries === 1){
      recordMissedIfNeeded(State.current);
    }
    updateScores();

    const nudge = randPick(ENCOURAGE_BAD);
    showResult(
      false,
      `<b>${nudge}</b><br/>
       That’s not correct. Try again — you’ll get it.`
    );

    // Must not go next until correct
    UI.nextBtn.disabled = true;
    UI.checkBtn.disabled = false;
  }
});

UI.nextBtn.addEventListener("click", () => {
  if (!State.started) return;
  State.runIndex += 1;
  showQuestionAtIndex(State.runIndex);
});

UI.finishBtn.addEventListener("click", () => {
  finishSummary();
});

// ------------ Boot ------------
(async function init(){
  setMessage(`Loading podcasts…`);

  try{
    const files = await listDocxFiles();
    State.files = files;

    fillPodcastDropdown(files);

    // default UI state
    State.activeMode = "set";
    State.activeSetIndex = 0;
    setActiveToggleButton();
    setModePill();
    updateScores();

    setMessage(`Select a podcast, pick a set, then press <b>Start</b>.`);
  } catch(err){
    setMessage(`Failed to load podcast list: ${String(err.message || err)}`);
  }
})();
