/* 20260119_txt_based_quiz_v1 */

(() => {
  const QUIZ_TXT_URL = "./Images/Quiz_file.txt";   // you said you'll upload here
  const DEBUG = false; // set true if you want debug visible

  // ---------- DOM ----------
  const podcastSelect = document.getElementById("podcastSelect");
  const setTabs = document.getElementById("setTabs");
  const startBtn = document.getElementById("startBtn");
  const finishBtn = document.getElementById("finishBtn");

  const qHeader = document.getElementById("qHeader");
  const qText = document.getElementById("qText");
  const optionsEl = document.getElementById("options");
  const statusBox = document.getElementById("statusBox");
  const debugBox = document.getElementById("debugBox");

  const chipCorrect = document.getElementById("chipCorrect");
  const chipAttempted = document.getElementById("chipAttempted");
  const chipFirstTry = document.getElementById("chipFirstTry");
  const chipMissedPool = document.getElementById("chipMissedPool");

  // ---------- STATE ----------
  let podcasts = []; // [{ key, label, questions: [...] }]
  let podcastIndex = 0;

  let activeSet = 0; // 0..4 or "missed"
  let running = false;

  let viewList = []; // questions currently being played (set slice or missed)
  let viewPos = 0;

  let stats = {
    correct: 0,
    attempted: 0,
    firstTry: 0,
  };

  // per podcast tracking
  let attemptedIds = new Set();   // question unique id that was attempted at least once
  let firstTryEligible = new Set(); // question ids not yet tried (for first-try)
  let missedIds = new Set();      // question ids that were answered wrong at least once
  let wrongOnceIds = new Set();   // question ids wrong at least once (same as missedIds, but kept explicit)

  // ---------- UTILS ----------
  function log(msg) {
    if (!DEBUG) return;
    debugBox.style.display = "block";
    debugBox.textContent += (msg + "\n");
  }

  function baseUrlSafeFetch(url) {
    // cache-bust so GitHub Pages doesn't serve stale content
    const u = new URL(url, window.location.href);
    u.searchParams.set("cb", Date.now().toString());
    return fetch(u.toString(), { cache: "no-store" });
  }

  function normalizePodcastKeyFromSource(sourceFile) {
    // example:
    // 101_Intro_1_transcription.docx -> 101_Intro_1
    // 101_Intro_1_summary.docx       -> 101_Intro_1
    // 104_2nd_Panchadi_Part1_transcription.docx -> 104_2nd_Panchadi_Part1
    let s = (sourceFile || "").trim();

    // strip trailing bracket noise just in case
    s = s.replace(/[\]\)]$/g, "");
    s = s.replace(/^\s*[\[\(]\s*/g, "");

    // keep only filename part if something like path appears
    s = s.split("/").pop();

    // remove extension
    s = s.replace(/\.docx$/i, "");

    // remove a single trailing _transcription or _summary
    s = s.replace(/_(transcription|summary)$/i, "");

    return s.trim();
  }

  function labelFromPodcastKey(key) {
    // "101_Intro_1" -> "101 — Intro 1"
    // "104_2nd_Panchadi_Part1" -> "104 — 2nd Panchadi Part1"
    const parts = key.split("_").filter(Boolean);
    if (parts.length === 0) return key;
    const num = parts[0];
    const rest = parts.slice(1).join(" ");
    return rest ? `${num} — ${rest}` : `${num}`;
  }

  function getActivePodcast() {
    return podcasts[podcastIndex] || null;
  }

  function updateMissedTabCount() {
    const missedTab = setTabs.querySelector('.tab[data-set="missed"]');
    if (missedTab) missedTab.textContent = `Missed (${missedIds.size})`;
    chipMissedPool.textContent = `Missed pool: ${missedIds.size}`;
  }

  function resetRunStateForPodcast() {
    running = false;
    activeSet = 0;
    viewList = [];
    viewPos = 0;

    stats = { correct: 0, attempted: 0, firstTry: 0 };

    attemptedIds = new Set();
    wrongOnceIds = new Set();
    missedIds = new Set();

    // firstTryEligible gets filled from the chosen viewList when Start happens
    firstTryEligible = new Set();

    chipCorrect.textContent = "Correct: 0";
    chipAttempted.textContent = "Attempted: 0";
    chipFirstTry.textContent = "First-try: 0";
    chipMissedPool.textContent = "Missed pool: 0";

    updateMissedTabCount();

    qHeader.textContent = "Ready.";
    qText.style.display = "none";
    optionsEl.style.display = "none";
    statusBox.textContent = "Load the quiz by pressing Start.";
    clearOptions();
  }

  function clearOptions() {
    optionsEl.innerHTML = "";
  }

  function setStatus(text, tone = "muted") {
    statusBox.textContent = text;
    if (tone === "good") {
      statusBox.style.borderColor = "rgba(54,211,153,0.50)";
      statusBox.style.color = "rgba(255,255,255,0.92)";
      statusBox.style.background = "rgba(54,211,153,0.08)";
    } else if (tone === "bad") {
      statusBox.style.borderColor = "rgba(255,92,122,0.50)";
      statusBox.style.color = "rgba(255,255,255,0.92)";
      statusBox.style.background = "rgba(255,92,122,0.08)";
    } else {
      statusBox.style.borderColor = "rgba(255,255,255,0.10)";
      statusBox.style.color = "rgba(255,255,255,0.72)";
      statusBox.style.background = "rgba(0,0,0,0.20)";
    }
  }

  function markTabActive(setValue) {
    setTabs.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    const sel = setTabs.querySelector(`.tab[data-set="${setValue}"]`);
    if (sel) sel.classList.add("active");
  }

  // ---------- PARSER ----------
  function parseQuizText(raw) {
    // Your file uses separator lines: ________________________________________
    const blocks = raw
      .split(/_{10,}/g)
      .map(b => b.trim())
      .filter(Boolean);

    const questions = [];

    for (const b of blocks) {
      // Quickly skip if no "Correct Answer:"
      if (!/Correct\s*Answer\s*:\s*[A-D]/i.test(b)) continue;

      const lines = b.split(/\r?\n/).map(x => x.trim()).filter(x => x.length > 0);

      // Source line format: [(Source: xxx.docx)]
      const sourceMatch = b.match(/\[\(Source:\s*([^)]+)\)\]/i);
      const sourceFile = sourceMatch ? sourceMatch[1].trim() : "";

      // Find correct answer
      const correctMatch = b.match(/Correct\s*Answer\s*:\s*([A-D])/i);
      const correct = correctMatch ? correctMatch[1].toUpperCase() : "";

      // Extract options A-D
      const options = {};
      for (const L of lines) {
        const m = L.match(/^([A-D])\.\s*(.+)$/);
        if (m) options[m[1].toUpperCase()] = m[2].trim();
      }

      // Question number: first line like "1." or "1."
      let qNum = "";
      const numMatch = lines[0] && lines[0].match(/^(\d+)\.?$/);
      if (numMatch) qNum = numMatch[1];

      // Question text: everything between number line and source line, excluding options/correct/check
      // We’ll build from the raw block for reliability.
      // Approach: remove option lines, remove Correct Answer line, remove Check line, remove Source line, remove the leading number line.
      let text = b;

      // remove check line (can be long)
      text = text.replace(/^Check:\s*.*$/gmi, "");

      // remove Correct Answer line
      text = text.replace(/^Correct\s*Answer\s*:\s*[A-D]\s*$/gmi, "");

      // remove options lines
      text = text.replace(/^[A-D]\.\s*.*$/gmi, "");

      // remove source line
      text = text.replace(/\[\(Source:\s*([^)]+)\)\]\s*/gi, "");

      // remove leading number line
      text = text.replace(/^\s*\d+\.\s*$/m, "");

      text = text
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean)
        .join(" ");

      // final sanity
      if (!text || !correct || !options.A || !options.B || !options.C || !options.D) continue;

      const q = {
        id: `${sourceFile}__${qNum}__${text.slice(0, 40)}`, // stable enough
        qNum: qNum || "",
        text,
        sourceFile,
        correct,
        options: {
          A: options.A,
          B: options.B,
          C: options.C,
          D: options.D
        }
      };

      questions.push(q);
    }

    return questions;
  }

  function buildPodcastsFromQuestions(allQuestions) {
    const map = new Map(); // key -> { key, label, questions }

    for (const q of allQuestions) {
      const key = normalizePodcastKeyFromSource(q.sourceFile);
      const label = labelFromPodcastKey(key);

      if (!map.has(key)) map.set(key, { key, label, questions: [] });
      map.get(key).questions.push(q);
    }

    // Sort podcasts by numeric prefix if present
    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      const an = parseInt(a.key.split("_")[0], 10);
      const bn = parseInt(b.key.split("_")[0], 10);
      if (!isNaN(an) && !isNaN(bn)) return an - bn;
      return a.key.localeCompare(b.key);
    });

    // Within each podcast, keep original order (file already in order)
    return arr;
  }

  // ---------- QUIZ VIEW ----------
  function setViewToActiveSet() {
    const p = getActivePodcast();
    if (!p) return;

    if (activeSet === "missed") {
      viewList = p.questions.filter(q => missedIds.has(q.id));
    } else {
      const start = activeSet * 10;
      const end = start + 10;
      viewList = p.questions.slice(start, end);
    }

    viewPos = 0;
    firstTryEligible = new Set(viewList.map(q => q.id));
    updateMissedTabCount();
  }

  function renderCurrent() {
    clearOptions();

    const p = getActivePodcast();
    if (!p) {
      qHeader.textContent = "No podcast data found.";
      qText.style.display = "none";
      optionsEl.style.display = "none";
      setStatus("Could not load quiz data.", "bad");
      return;
    }

    if (!running) {
      qHeader.textContent = "Ready.";
      qText.style.display = "none";
      optionsEl.style.display = "none";
      setStatus("Press Start.", "muted");
      return;
    }

    if (!viewList.length) {
      const msg = (activeSet === "missed")
        ? "No missed questions yet. 🎉"
        : "This set has no questions (unexpected).";
      qHeader.textContent = msg;
      qText.style.display = "none";
      optionsEl.style.display = "none";
      setStatus(msg, "muted");
      return;
    }

    if (viewPos >= viewList.length) {
      qHeader.textContent = "Set complete ✅";
      qText.style.display = "none";
      optionsEl.style.display = "none";
      setStatus("You finished this set. Pick another set, or Finish.", "good");
      return;
    }

    const q = viewList[viewPos];

    qHeader.textContent = `Question ${viewPos + 1} of ${viewList.length}` + (activeSet === "missed" ? " (Missed Review)" : "");
    qText.textContent = q.text;
    qText.style.display = "block";
    optionsEl.style.display = "grid";

    setStatus("Pick an option. (Auto-check enabled)", "muted");

    const order = ["A", "B", "C", "D"];
    for (const letter of order) {
      const opt = document.createElement("div");
      opt.className = "opt";
      opt.dataset.letter = letter;

      const badge = document.createElement("div");
      badge.className = "optBadge";
      badge.textContent = letter;

      const txt = document.createElement("div");
      txt.className = "optText";
      txt.textContent = q.options[letter];

      opt.appendChild(badge);
      opt.appendChild(txt);

      opt.addEventListener("click", () => onPickOption(letter, opt));

      optionsEl.appendChild(opt);
    }
  }

  function disableOptions() {
    optionsEl.querySelectorAll(".opt").forEach(el => {
      el.classList.add("disabled");
      el.style.pointerEvents = "none";
    });
  }

  function onPickOption(letter, optEl) {
    if (!running) return;
    const q = viewList[viewPos];
    if (!q) return;

    // Count attempted (once per question)
    if (!attemptedIds.has(q.id)) {
      attemptedIds.add(q.id);
      stats.attempted += 1;
      chipAttempted.textContent = `Attempted: ${stats.attempted}`;
    }

    const isCorrect = (letter === q.correct);

    if (isCorrect) {
      // First-try?
      if (firstTryEligible.has(q.id)) {
        stats.firstTry += 1;
        chipFirstTry.textContent = `First-try: ${stats.firstTry}`;
      }
      firstTryEligible.delete(q.id);

      stats.correct += 1;
      chipCorrect.textContent = `Correct: ${stats.correct}`;

      optEl.classList.add("good");
      setStatus("Correct ✅ Moving to next…", "good");

      disableOptions();

      // Advance after a short delay
      setTimeout(() => {
        viewPos += 1;
        renderCurrent();
      }, 450);

    } else {
      // Mark missed
      wrongOnceIds.add(q.id);
      missedIds.add(q.id);
      updateMissedTabCount();

      // Once wrong, it can never be first-try anymore
      firstTryEligible.delete(q.id);

      optEl.classList.add("bad");
      setStatus("Wrong ❌ Try again (stay on same question).", "bad");
    }
  }

  // ---------- EVENTS ----------
  function onTabClick(setValue) {
    activeSet = setValue;
    markTabActive(setValue);
    if (running) {
      setViewToActiveSet();
      renderCurrent();
    } else {
      // not running yet, just update hint
      setStatus("Press Start to begin this set.", "muted");
    }
  }

  async function init() {
    debugBox.style.display = DEBUG ? "block" : "none";
    log("Debug: init()");

    qHeader.textContent = "Loading quiz file...";
    setStatus("Loading Quiz_file.txt ...", "muted");

    let raw = "";
    try {
      const res = await baseUrlSafeFetch(QUIZ_TXT_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${QUIZ_TXT_URL}`);
      raw = await res.text();
    } catch (e) {
      qHeader.textContent = "No questions loaded yet.";
      setStatus("FAILED to load Quiz_file.txt. Check that it exists at Images/Quiz_file.txt", "bad");
      if (DEBUG) log(String(e));
      return;
    }

    const allQuestions = parseQuizText(raw);
    log(`Parsed questions: ${allQuestions.length}`);

    if (!allQuestions.length) {
      qHeader.textContent = "No questions loaded yet.";
      setStatus("Loaded text file, but parser found 0 questions. (Format mismatch)", "bad");
      if (DEBUG) log("Parser found 0. Check text format exactly like your sample.");
      return;
    }

    podcasts = buildPodcastsFromQuestions(allQuestions);
    log(`Podcasts found: ${podcasts.length}`);

    // Populate dropdown
    podcastSelect.innerHTML = "";
    podcasts.forEach((p, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = p.label;
      podcastSelect.appendChild(opt);
    });

    // default selection
    podcastIndex = 0;
    podcastSelect.value = "0";
    resetRunStateForPodcast();

    qHeader.textContent = "Loaded ✅";
    setStatus("Select a podcast, pick a set, then press Start.", "good");
  }

  // Wiring tabs
  setTabs.addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (!t) return;
    const setValue = t.dataset.set;
    if (setValue === "missed") onTabClick("missed");
    else onTabClick(Number(setValue));
  });

  podcastSelect.addEventListener("change", () => {
    const idx = Number(podcastSelect.value);
    if (!Number.isFinite(idx)) return;
    podcastIndex = idx;
    resetRunStateForPodcast();
    setStatus("Podcast changed. Pick a set and press Start.", "muted");
  });

  startBtn.addEventListener("click", () => {
    const p = getActivePodcast();
    if (!p) {
      setStatus("No podcast loaded.", "bad");
      return;
    }

    // Enforce exactly 50 as you described (but don’t hard-fail if not exactly)
    if (p.questions.length < 1) {
      setStatus("This podcast has 0 questions.", "bad");
      return;
    }

    running = true;
    setViewToActiveSet();
    renderCurrent();
  });

  finishBtn.addEventListener("click", () => {
    resetRunStateForPodcast();
    setStatus("Finished. You can start again any time.", "muted");
  });

  // Start
  document.addEventListener("DOMContentLoaded", init);
})();
