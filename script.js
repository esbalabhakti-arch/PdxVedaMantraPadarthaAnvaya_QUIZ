/* Veda Podcast Learning Check Quiz
   - Auto-lists Images/*_quiz.docx via GitHub Contents API
   - Parses DOCX using mammoth.extractRawText
   - Splits 50 Q into 5 sets of 10
   - One question at a time; must answer correctly to advance
   - Tracks attempted/correct/first-try; wrong first attempt -> Review Missed pool
*/

(() => {
  // ---------- DOM ----------
  const podcastSelect = document.getElementById("podcastSelect");
  const setTabs = document.getElementById("setTabs");
  const missedTab = document.getElementById("missedTab");

  const modeStatus = document.getElementById("modeStatus");
  const hintLine = document.getElementById("hintLine");

  const startBtn = document.getElementById("startBtn");
  const finishBtn = document.getElementById("finishBtn");

  const questionBox = document.getElementById("questionBox");
  const qText = document.getElementById("qText");
  const optionsEl = document.getElementById("options");

  const checkBtn = document.getElementById("checkBtn");
  const nextBtn = document.getElementById("nextBtn");

  const feedback = document.getElementById("feedback");
  const explain = document.getElementById("explain");
  const explainText = document.getElementById("explainText");

  const scoreA = document.getElementById("scoreA");
  const scoreB = document.getElementById("scoreB");
  const scoreC = document.getElementById("scoreC");
  const scoreD = document.getElementById("scoreD");

  // ---------- Helpers ----------
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function ownerFromPagesHost() {
    // esbalabhakti-arch.github.io -> esbalabhakti-arch
    const host = window.location.hostname || "";
    return host.split(".")[0];
  }

  function repoFromPath() {
    // /PdxVedaMantraPadarthaAnvaya_QUIZ/ -> "PdxVedaMantraPadarthaAnvaya_QUIZ"
    const seg = (window.location.pathname || "/").split("/").filter(Boolean);
    return seg.length ? seg[0] : "";
  }

  function githubContentsUrl(owner, repo, path) {
    return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
  }

  function rawFileUrl(owner, repo, branch, path) {
    return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${path}`;
  }

  function safeText(s) {
    return (s || "").replace(/[<>]/g, "");
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Motivators
  const GOOD = [
    "Nice work! ✅",
    "Super! Keep going 💪",
    "Correct! 🔥",
    "Great focus 👏",
    "That’s it! 🌟",
    "Boom. Nailed it 💯"
  ];
  const TRY_AGAIN = [
    "Almost — try again 🙂",
    "Not yet — take another shot 💡",
    "Close! Read the options once more 👀",
    "Good effort — one more try 💪",
    "No worries — you’ll get it now ✅"
  ];

  // ---------- State ----------
  const STATE = {
    owner: ownerFromPagesHost(),
    repo: repoFromPath(),
    branch: "main",
    imagesDir: "Images", // IMPORTANT: your folder is "Images" (capital I)
    docxMap: new Map(),  // key: docx filename, value: parsed questions []
    podcasts: [],         // [{file, label}]
    currentPodcastFile: "",
    currentMode: "set",   // "set" | "missed"
    currentSet: 1,        // 1..5
    queue: [],
    qIndex: 0,
    selectedLetter: null,

    // scoring (session-level)
    attempted: 0,         // counts questions completed (answered correctly at least once)
    correct: 0,           // equals attempted (since must be correct to finish each question)
    firstTryCorrect: 0,

    // per-question tries in the current run
    triesByQid: new Map(),  // qid -> tries count in this run

    // Missed pool (global while page is open)
    missedPool: new Map(),  // qid -> question object
  };

  // Question object:
  // { qid, n, question, options:{A,B,C,D}, answerLetter, checkText }

  function updateScores() {
    scoreA.textContent = `Correct: ${STATE.correct}`;
    scoreB.textContent = `Attempted: ${STATE.attempted}`;
    scoreC.textContent = `First-try: ${STATE.firstTryCorrect}`;
    scoreD.textContent = `In Review Missed pool: ${STATE.missedPool.size}`;
    missedTab.textContent = `Review Missed (${STATE.missedPool.size})`;
  }

  function setModeUI(mode, setNum) {
    // tabs visuals
    [...setTabs.querySelectorAll(".tab")].forEach(btn => btn.classList.remove("active"));
    if (mode === "missed") {
      missedTab.classList.add("active");
      STATE.currentMode = "missed";
      modeStatus.textContent = "Review Missed • Ready";
    } else {
      const btn = setTabs.querySelector(`.tab[data-mode="set"][data-set="${setNum}"]`);
      if (btn) btn.classList.add("active");
      STATE.currentMode = "set";
      STATE.currentSet = setNum;
      modeStatus.textContent = `Set ${setNum} • Ready`;
    }

    hintLine.textContent = "Select a podcast, pick a set, then press Start.";
    hideQuestionUI();
  }

  function hideQuestionUI() {
    questionBox.style.display = "none";
    qText.textContent = "";
    optionsEl.innerHTML = "";
    feedback.style.display = "none";
    feedback.className = "feedback";
    explain.style.display = "none";
    explainText.textContent = "";
    checkBtn.disabled = true;
    nextBtn.disabled = true;
    STATE.selectedLetter = null;
  }

  function showFeedback(kind, msg) {
    feedback.style.display = "block";
    feedback.className = `feedback ${kind}`;
    feedback.textContent = msg;
  }

  // ---------- DOCX Listing ----------
  async function loadPodcastList() {
    const owner = STATE.owner;
    const repo = STATE.repo;
    if (!owner || !repo) {
      podcastSelect.innerHTML = `<option value="">Error: cannot detect owner/repo from URL</option>`;
      return;
    }

    const api = githubContentsUrl(owner, repo, STATE.imagesDir);
    const res = await fetch(api, { cache: "no-store" });
    if (!res.ok) {
      podcastSelect.innerHTML = `<option value="">Error loading Images folder (GitHub API)</option>`;
      return;
    }

    const items = await res.json();
    const docx = (items || [])
      .filter(x => x && x.type === "file")
      .map(x => x.name)
      .filter(name => name.toLowerCase().endsWith("_quiz.docx")); // IMPORTANT naming convention

    docx.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    STATE.podcasts = docx.map(file => ({
      file,
      label: labelFromFilename(file),
    }));

    if (!STATE.podcasts.length) {
      podcastSelect.innerHTML = `<option value="">No *_quiz.docx found in Images/</option>`;
      return;
    }

    podcastSelect.innerHTML = `<option value="">Select a podcast…</option>` +
      STATE.podcasts.map(p => `<option value="${encodeURIComponent(p.file)}">${safeText(p.label)}</option>`).join("");

    // preselect first
    podcastSelect.selectedIndex = 1;
    STATE.currentPodcastFile = decodeURIComponent(podcastSelect.value);
  }

  function labelFromFilename(file) {
    // "101_Intro_1_quiz.docx" -> "101 — Intro 1"
    const base = file.replace(/_quiz\.docx$/i, "");
    const parts = base.split("_").filter(Boolean);
    if (!parts.length) return base;

    // nicer: first part numeric becomes id
    const id = parts[0];
    const rest = parts.slice(1).join(" ").replace(/\s+/g, " ").trim();
    if (/^\d+$/.test(id)) return `${id} — ${rest || base}`;
    return base;
  }

  // ---------- DOCX Parsing ----------
  async function ensureParsed(docxFile) {
    if (STATE.docxMap.has(docxFile)) return STATE.docxMap.get(docxFile);

    const url = rawFileUrl(STATE.owner, STATE.repo, STATE.branch, `${STATE.imagesDir}/${docxFile}`);

    let arrayBuffer;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      arrayBuffer = await res.arrayBuffer();
    } catch (e) {
      throw new Error(`Could not fetch DOCX: ${docxFile}. (${e.message})`);
    }

    let raw;
    try {
      const out = await window.mammoth.extractRawText({ arrayBuffer });
      raw = (out && out.value) ? out.value : "";
    } catch (e) {
      throw new Error(`Could not parse DOCX with mammoth: ${docxFile}. (${e.message})`);
    }

    const questions = parseQuestionsFromRawText(raw, docxFile);
    if (!questions.length) {
      throw new Error(`No questions parsed from ${docxFile}. Format may have changed.`);
    }

    // keep stable order by question number
    questions.sort((a, b) => a.n - b.n);

    STATE.docxMap.set(docxFile, questions);
    return questions;
  }

  function parseQuestionsFromRawText(raw, docxFile) {
    // Normalize
    const text = (raw || "")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n");

    // Find question starts: a line that is ONLY "number."
    const re = /(^|\n)\s*(\d+)\.\s*(?=\n)/g;
    const starts = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      starts.push({ idx: m.index + (m[1] ? 1 : 0), n: parseInt(m[2], 10) });
    }
    if (!starts.length) return [];

    const blocks = [];
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i].idx;
      const end = (i + 1 < starts.length) ? starts[i + 1].idx : text.length;
      blocks.push(text.slice(start, end).trim());
    }

    const out = [];
    for (const block of blocks) {
      // block begins with "N."
      const nMatch = block.match(/^\s*(\d+)\.\s*/);
      if (!nMatch) continue;
      const n = parseInt(nMatch[1], 10);
      const body = block.replace(/^\s*\d+\.\s*/, "").trim();

      // Extract Correct Answer letter
      const ansMatch = body.match(/Correct\s*Answer:\s*([ABCD])\b/i);
      if (!ansMatch) continue;
      const answerLetter = ansMatch[1].toUpperCase();

      // Extract Check explanation
      let checkText = "";
      const checkMatch = body.match(/Check:\s*([\s\S]*?)\s*$/i);
      if (checkMatch) checkText = checkMatch[1].trim();

      // Extract options A-D lines
      // We’ll locate each option by "A." "B." "C." "D." at line start.
      const opt = extractOptions(body);
      if (!opt || !opt.A || !opt.B || !opt.C || !opt.D) continue;

      // Question text is everything before "A."
      const qPart = body.split(/\n\s*A\.\s*/i)[0].trim();
      const question = qPart
        .replace(/\[\(Source:[^\]]*\)\]/gi, "") // remove source markers if present
        .replace(/\[\s*Source:[^\]]*\]/gi, "")
        .replace(/\n{2,}/g, "\n")
        .trim();

      const qid = `${docxFile}::${n}`;

      out.push({
        qid,
        n,
        question,
        options: opt,
        answerLetter,
        checkText,
        _docx: docxFile
      });
    }

    return out;
  }

  function extractOptions(body) {
    // Pull A-D blocks robustly:
    // A. ... (until B.)
    // B. ... (until C.)
    // ...
    const get = (letter, nextLetter) => {
      const re = new RegExp(`\\n\\s*${letter}\\.\\s*([\\s\\S]*?)\\n\\s*${nextLetter}\\.\\s*`, "i");
      const m = body.match(re);
      if (!m) return null;
      return m[1].trim().replace(/\n+/g, " ").trim();
    };

    const A = (() => {
      const re = /\n\s*A\.\s*([\s\S]*?)\n\s*B\.\s*/i;
      const m = body.match(re);
      return m ? m[1].trim().replace(/\n+/g, " ").trim() : null;
    })();

    const B = (() => {
      const re = /\n\s*B\.\s*([\s\S]*?)\n\s*C\.\s*/i;
      const m = body.match(re);
      return m ? m[1].trim().replace(/\n+/g, " ").trim() : null;
    })();

    const C = (() => {
      const re = /\n\s*C\.\s*([\s\S]*?)\n\s*D\.\s*/i;
      const m = body.match(re);
      return m ? m[1].trim().replace(/\n+/g, " ").trim() : null;
    })();

    const D = (() => {
      // until "Correct Answer"
      const re = /\n\s*D\.\s*([\s\S]*?)\n\s*Correct\s*Answer:/i;
      const m = body.match(re);
      return m ? m[1].trim().replace(/\n+/g, " ").trim() : null;
    })();

    if (!A || !B || !C || !D) return null;
    return { A, B, C, D };
  }

  // ---------- Quiz Building ----------
  function buildQueue(questions) {
    if (STATE.currentMode === "missed") {
      const pool = [...STATE.missedPool.values()];
      return shuffle(pool);
    }

    // set mode
    const setNum = clamp(STATE.currentSet, 1, 5);
    const start = (setNum - 1) * 10;
    const end = start + 10;
    return questions.slice(start, end);
  }

  function resetRunState() {
    STATE.queue = [];
    STATE.qIndex = 0;
    STATE.selectedLetter = null;
    STATE.triesByQid = new Map();
    hideQuestionUI();
  }

  function renderQuestion() {
    const q = STATE.queue[STATE.qIndex];
    if (!q) {
      // finished
      questionBox.style.display = "none";
      const msg = summaryMessage();
      showEndSummary(msg);
      return;
    }

    questionBox.style.display = "block";
    feedback.style.display = "none";
    feedback.className = "feedback";
    explain.style.display = "none";
    explainText.textContent = "";
    checkBtn.disabled = true;
    nextBtn.disabled = true;
    STATE.selectedLetter = null;

    // In missed mode show (Missed) label, else show set label
    const where = (STATE.currentMode === "missed") ? "Review Missed" : `Set ${STATE.currentSet}`;
    modeStatus.textContent = `${where} • Q${STATE.qIndex + 1}/${STATE.queue.length}`;

    qText.textContent = q.question || `(Question ${q.n})`;

    optionsEl.innerHTML = "";
    const letters = ["A", "B", "C", "D"];
    letters.forEach(L => {
      const div = document.createElement("div");
      div.className = "opt";
      div.dataset.letter = L;
      div.innerHTML = `
        <div class="letter">${L}</div>
        <div class="txt">${safeText(q.options[L] || "")}</div>
      `;
      div.addEventListener("click", () => selectOption(L));
      optionsEl.appendChild(div);
    });

    hintLine.textContent = "Pick an option, then press Check Answer.";
  }

  function selectOption(letter) {
    STATE.selectedLetter = letter;
    [...optionsEl.querySelectorAll(".opt")].forEach(x => x.classList.remove("selected"));
    const picked = optionsEl.querySelector(`.opt[data-letter="${letter}"]`);
    if (picked) picked.classList.add("selected");
    checkBtn.disabled = false;
  }

  function currentQ() {
    return STATE.queue[STATE.qIndex] || null;
  }

  function markTry(qid) {
    const prev = STATE.triesByQid.get(qid) || 0;
    const next = prev + 1;
    STATE.triesByQid.set(qid, next);
    return next;
  }

  function onCheck() {
    const q = currentQ();
    if (!q) return;

    if (!STATE.selectedLetter) {
      showFeedback("bad", "Pick an option first 🙂");
      return;
    }

    const tries = markTry(q.qid);

    if (STATE.selectedLetter === q.answerLetter) {
      // correct
      if (tries === 1) STATE.firstTryCorrect += 1;
      // “attempted/correct” are counted when the question is completed (i.e., correct reached)
      STATE.attempted += 1;
      STATE.correct += 1;

      showFeedback("ok", `${GOOD[Math.floor(Math.random() * GOOD.length)]}  Correct answer: ${q.answerLetter}.`);
      explain.style.display = "block";
      explainText.textContent = q.checkText ? q.checkText : "Good catch — keep going.";

      // allow next
      nextBtn.disabled = false;
      checkBtn.disabled = true;

      hintLine.textContent = "Press Next to move on.";
      updateScores();

      // If missed on first try, keep it in pool (so they can review later).
      // (Requirement: if wrong in first attempt, put into missed section.)
      // That happens in wrong branch below.
    } else {
      // wrong
      if (tries === 1) {
        // add to missed pool if first attempt wrong
        STATE.missedPool.set(q.qid, q);
      }
      updateScores();

      showFeedback("bad", `${TRY_AGAIN[Math.floor(Math.random() * TRY_AGAIN.length)]}  (You chose ${STATE.selectedLetter}.)`);
      explain.style.display = "none";
      explainText.textContent = "";

      // Must not proceed until correct
      nextBtn.disabled = true;
      checkBtn.disabled = false;

      hintLine.textContent = "Try again — you’ve got this.";
    }
  }

  function onNext() {
    const q = currentQ();
    if (!q) return;

    // Move forward
    STATE.qIndex += 1;
    renderQuestion();
  }

  function showEndSummary(msg) {
    // Reuse the feedback box area (clean)
    questionBox.style.display = "block";
    qText.textContent = msg.title;
    optionsEl.innerHTML = "";
    checkBtn.disabled = true;
    nextBtn.disabled = true;

    feedback.style.display = "block";
    feedback.className = "feedback ok";
    feedback.textContent = msg.body;

    explain.style.display = "block";
    explain.querySelector(".label").textContent = "Session summary:";
    explainText.innerHTML = `
      • Attempted: ${STATE.attempted}<br/>
      • Correct: ${STATE.correct}<br/>
      • First-try correct: ${STATE.firstTryCorrect}<br/>
      • In Review Missed pool: ${STATE.missedPool.size}
    `;

    hintLine.textContent = "Pick another set — or hit Review Missed to clean up mistakes 💪";
  }

  function summaryMessage() {
    const missed = STATE.missedPool.size;
    let title = "Nice work! ✅";
    let body = "Set finished. Want a challenge? Try another set — or go to Review Missed.";
    if (STATE.currentMode === "missed") {
      title = "Review complete! ✅";
      body = "You cleared your missed questions. Keep going — consistency wins 💪";
      // optionally clear missed pool after review:
      // STATE.missedPool.clear();
    } else if (missed > 0) {
      body = `Set finished. You have ${missed} question(s) in Review Missed — go finish them off 💪`;
    }
    return { title, body };
  }

  // ---------- Start / Finish ----------
  async function onStart() {
    const podcastFile = STATE.currentPodcastFile;
    if (!podcastFile) {
      showFeedback("bad", "Please select a podcast first 🙂");
      return;
    }

    resetRunState();

    try {
      const questions = await ensureParsed(podcastFile);

      // Build queue based on mode/set
      STATE.queue = buildQueue(questions);
      STATE.qIndex = 0;

      if (!STATE.queue.length) {
        hintLine.textContent = "No questions available for that selection.";
        showFeedback("bad", "No questions found for that set / mode.");
        return;
      }

      // In missed mode, if empty, show helpful message
      if (STATE.currentMode === "missed" && STATE.missedPool.size === 0) {
        showEndSummary({
          title: "All clean ✅",
          body: "No missed questions yet. Do a set first — then come back here."
        });
        return;
      }

      renderQuestion();
      updateScores();
    } catch (e) {
      resetRunState();
      questionBox.style.display = "block";
      qText.textContent = "Could not start the quiz.";
      optionsEl.innerHTML = "";
      showFeedback("bad", e.message);
      explain.style.display = "block";
      explain.querySelector(".label").textContent = "Fix checklist:";
      explainText.innerHTML = `
        1) Ensure files are in <b>Images/</b> (capital I)<br/>
        2) Ensure filename ends with <b>_quiz.docx</b><br/>
        3) Ensure branch is <b>main</b><br/>
        4) In GitHub Pages, wait for deployment to finish<br/>
      `;
    }
  }

  function onFinish() {
    // Just show summary; user can restart anytime
    showEndSummary(summaryMessage());
  }

  // ---------- Events ----------
  setTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;

    const mode = btn.dataset.mode;
    if (mode === "missed") {
      setModeUI("missed", STATE.currentSet);
    } else {
      const setNum = parseInt(btn.dataset.set, 10);
      setModeUI("set", clamp(setNum || 1, 1, 5));
    }
  });

  podcastSelect.addEventListener("change", () => {
    const v = podcastSelect.value ? decodeURIComponent(podcastSelect.value) : "";
    STATE.currentPodcastFile = v;
    hideQuestionUI();
    modeStatus.textContent = (STATE.currentMode === "missed")
      ? "Review Missed • Ready"
      : `Set ${STATE.currentSet} • Ready`;
    hintLine.textContent = "Select a podcast, pick a set, then press Start.";
  });

  startBtn.addEventListener("click", onStart);
  finishBtn.addEventListener("click", onFinish);
  checkBtn.addEventListener("click", onCheck);
  nextBtn.addEventListener("click", onNext);

  // ---------- Boot ----------
  (async function init() {
    // Default UI
    setModeUI("set", 1);
    updateScores();

    // Load podcast list from Images folder
    await loadPodcastList();

    // Update selected podcast file state
    const v = podcastSelect.value ? decodeURIComponent(podcastSelect.value) : "";
    STATE.currentPodcastFile = v;

    // Ensure banner uses correct case and extension (.png)
    const banner = document.getElementById("bannerImg");
    banner.src = `${STATE.imagesDir}/Vedic_podcast_banner_2.png`;
  })();
})();
