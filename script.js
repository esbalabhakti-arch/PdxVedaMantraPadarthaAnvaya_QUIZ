const EXCEL_FILE_PATH = "Images/Panchadis_Meaning_summaries.xlsx";
const STORAGE_KEY = "veda_flashcards_saved_stack_v1";

const state = {
  allCards: [],
  activeCards: [],
  currentIndex: 0,
  currentMode: "sequential",
  currentView: "all",
  isFlipped: false,
  savedIds: new Set()
};

const el = {
  flashcardStage: document.getElementById("flashcardStage"),
  loadingBox: document.getElementById("loadingBox"),
  messageBox: document.getElementById("messageBox"),

  modeSequentialBtn: document.getElementById("modeSequentialBtn"),
  modeRandomBtn: document.getElementById("modeRandomBtn"),

  viewAllBtn: document.getElementById("viewAllBtn"),
  viewSavedBtn: document.getElementById("viewSavedBtn"),

  saveCardBtn: document.getElementById("saveCardBtn"),
  removeSavedBtn: document.getElementById("removeSavedBtn"),

  restartBtn: document.getElementById("restartBtn"),
  flipTopBtn: document.getElementById("flipTopBtn"),
  flipBottomBtn: document.getElementById("flipBottomBtn"),

  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),

  statusMode: document.getElementById("statusMode"),
  statusView: document.getElementById("statusView"),
  statusProgress: document.getElementById("statusProgress"),
  statusSavedCount: document.getElementById("statusSavedCount")
};

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizedKey(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function showMessage(msg = "") {
  el.messageBox.textContent = msg;
}

function saveSavedSetToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.savedIds]));
}

function loadSavedSetFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      state.savedIds = new Set(arr);
    }
  } catch (err) {
    console.warn("Could not read saved stack from localStorage.", err);
  }
}

async function fetchWorkbook() {
  const response = await fetch(EXCEL_FILE_PATH, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load Excel file: ${EXCEL_FILE_PATH}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return XLSX.read(arrayBuffer, { type: "array" });
}

function findLineByLineSheet(workbook) {
  const candidates = workbook.SheetNames || [];
  let best = candidates.find(name => normalizedKey(name) === "linebyline");
  if (best) return best;

  best = candidates.find(name => normalizedKey(name).includes("linebyline"));
  if (best) return best;

  return candidates[0] || null;
}

function findHeaderRow(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].map(normalizeText);
    const joined = row.map(normalizedKey);

    const hasP = joined.includes("p");
    const hasSanskrit = joined.some(x => x.includes("sanskritline"));
    const hasMeaning =
      joined.some(x => x.includes("impliedmeaning")) ||
      joined.some(x => x.includes("meaning")) ||
      joined.some(x => x.includes("description"));

    if (hasP && hasSanskrit && hasMeaning) {
      return i;
    }
  }
  return -1;
}

function mapHeaders(headerRow) {
  const headerMap = {};
  headerRow.forEach((cell, idx) => {
    const key = normalizedKey(cell);
    headerMap[key] = idx;
  });

  const pCol =
    headerMap["p"] ??
    headerMap["panchadi"] ??
    headerMap["panchadinumber"] ??
    null;

  const sanskritCol =
    headerMap["sanskritline"] ??
    headerMap["line"] ??
    headerMap["devanagariline"] ??
    null;

  const impliedMeaningCol =
    headerMap["impliedmeaning"] ??
    null;

  const descriptionCol =
    headerMap["descriptionspeakerexplanation"] ??
    headerMap["description"] ??
    null;

  return { pCol, sanskritCol, impliedMeaningCol, descriptionCol };
}

function parseCardsFromWorkbook(workbook) {
  const sheetName = findLineByLineSheet(workbook);
  if (!sheetName) {
    throw new Error("No worksheet found in the Excel file.");
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: ""
  });

  const headerRowIndex = findHeaderRow(rows);
  if (headerRowIndex < 0) {
    throw new Error("Could not find the header row in the line-by-line sheet.");
  }

  const headers = rows[headerRowIndex];
  const { pCol, sanskritCol, impliedMeaningCol, descriptionCol } = mapHeaders(headers);

  if (pCol === null || sanskritCol === null || (impliedMeaningCol === null && descriptionCol === null)) {
    throw new Error("Required columns are missing. Need Panchadi, Sanskrit line, and meaning column.");
  }

  const dataRows = rows.slice(headerRowIndex + 1);

  const parsed = [];
  let sourceRowNumber = headerRowIndex + 2;

  for (const row of dataRows) {
    const panchadi = safeNumber(row[pCol]);
    const sanskritLine = normalizeText(row[sanskritCol]);
    const impliedMeaning = impliedMeaningCol !== null ? normalizeText(row[impliedMeaningCol]) : "";
    const descriptionMeaning = descriptionCol !== null ? normalizeText(row[descriptionCol]) : "";
    const meaningToUse = impliedMeaning || descriptionMeaning;

    if (!panchadi || !sanskritLine || !meaningToUse) {
      sourceRowNumber++;
      continue;
    }

    parsed.push({
      id: `p${panchadi}_r${sourceRowNumber}`,
      panchadiNumber: panchadi,
      sanskritLine,
      meaning: meaningToUse,
      sourceRow: sourceRowNumber
    });

    sourceRowNumber++;
  }

  parsed.sort((a, b) => {
    if (a.panchadiNumber !== b.panchadiNumber) {
      return a.panchadiNumber - b.panchadiNumber;
    }
    return a.sourceRow - b.sourceRow;
  });

  return parsed;
}

function buildActiveCards() {
  let baseCards = [];

  if (state.currentView === "saved") {
    baseCards = state.allCards.filter(card => state.savedIds.has(card.id));
  } else {
    baseCards = [...state.allCards];
  }

  state.activeCards = state.currentMode === "random" ? shuffleArray(baseCards) : baseCards;
  state.currentIndex = 0;
  state.isFlipped = false;

  updateUI();
  renderCard();
}

function getCurrentCard() {
  if (!state.activeCards.length) return null;
  return state.activeCards[state.currentIndex] || null;
}

function renderEmptyState(title, message) {
  el.flashcardStage.innerHTML = `
    <div class="empty-state">
      <h2>${title}</h2>
      <p>${message}</p>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderCard() {
  const card = getCurrentCard();

  if (!state.allCards.length) {
    renderEmptyState(
      "No flash cards found",
      "The Excel file was loaded, but no usable rows were found in the line-by-line sheet."
    );
    return;
  }

  if (!card) {
    if (state.currentView === "saved") {
      renderEmptyState(
        "Saved stack is empty",
        "Save cards using Save, then switch to Saved Stack to revise them later."
      );
    } else {
      renderEmptyState(
        "No cards available",
        "Please check the Excel sheet contents."
      );
    }
    return;
  }

  el.flashcardStage.innerHTML = `
    <div class="card-wrap">
      <div class="flashcard ${state.isFlipped ? "flipped" : ""}" id="flashcard">
        <div class="card-face card-front">
          <div class="card-head">
            <div class="mini">Front Side</div>
            <h2>Guess the meaning of this line</h2>
          </div>

          <div class="card-body">
            <div class="devanagari-line">${escapeHtml(card.sanskritLine)}</div>
          </div>

          <div class="card-foot">
            <span class="hint">Click card or press Flip</span>
          </div>
        </div>

        <div class="card-face card-back">
          <div class="card-head">
            <div class="mini">Back Side</div>
            <h2>Answer</h2>
          </div>

          <div class="card-body">
            <div class="meaning-block">
              <div class="panchadi">Panchadi #${escapeHtml(String(card.panchadiNumber))}</div>
              <div class="meaning">${escapeHtml(card.meaning)}</div>
            </div>
          </div>

          <div class="card-foot">
            <span class="hint">Click card or press Flip</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const flashcard = document.getElementById("flashcard");
  flashcard.addEventListener("click", flipCard);
}

function flipCard() {
  const card = document.getElementById("flashcard");
  if (!card) return;

  state.isFlipped = !state.isFlipped;
  card.classList.toggle("flipped", state.isFlipped);
}

function goNext() {
  if (!state.activeCards.length) return;

  if (state.currentIndex < state.activeCards.length - 1) {
    state.currentIndex += 1;
    state.isFlipped = false;
    updateUI();
    renderCard();
    showMessage("");
  } else {
    showMessage("You are already at the last card.");
  }
}

function goPrev() {
  if (!state.activeCards.length) return;

  if (state.currentIndex > 0) {
    state.currentIndex -= 1;
    state.isFlipped = false;
    updateUI();
    renderCard();
    showMessage("");
  } else {
    showMessage("You are already at the first card.");
  }
}

function restartOrder() {
  buildActiveCards();
  showMessage(
    state.currentMode === "random"
      ? "Random order restarted."
      : "Sequential order restarted."
  );
}

function saveCurrentCard() {
  const card = getCurrentCard();
  if (!card) return;

  if (state.savedIds.has(card.id)) {
    showMessage("This card is already saved.");
    updateUI();
    return;
  }

  state.savedIds.add(card.id);
  saveSavedSetToStorage();
  updateUI();
  showMessage("Card saved.");
}

function removeCurrentCardFromSaved() {
  const card = getCurrentCard();
  if (!card) return;

  if (!state.savedIds.has(card.id)) {
    showMessage("This card is not in Saved Stack.");
    return;
  }

  state.savedIds.delete(card.id);
  saveSavedSetToStorage();

  if (state.currentView === "saved") {
    const removedIndex = state.currentIndex;
    buildActiveCards();
    if (state.activeCards.length > 0) {
      state.currentIndex = Math.min(removedIndex, state.activeCards.length - 1);
      state.isFlipped = false;
      updateUI();
      renderCard();
    }
  } else {
    updateUI();
    renderCard();
  }

  showMessage("Card removed.");
}

function setMode(mode) {
  if (state.currentMode === mode) return;
  state.currentMode = mode;
  buildActiveCards();
  showMessage(mode === "random" ? "Random mode selected." : "Sequential mode selected.");
}

function setView(view) {
  if (state.currentView === view) return;
  state.currentView = view;
  buildActiveCards();
  showMessage(view === "saved" ? "Showing Saved Stack." : "Showing all cards.");
}

function updateButtonStates() {
  el.modeSequentialBtn.classList.toggle("active", state.currentMode === "sequential");
  el.modeRandomBtn.classList.toggle("active", state.currentMode === "random");

  el.viewAllBtn.classList.toggle("active", state.currentView === "all");
  el.viewSavedBtn.classList.toggle("active", state.currentView === "saved");
}

function updateUI() {
  updateButtonStates();

  el.statusMode.textContent = state.currentMode === "random" ? "Random" : "Sequential";
  el.statusView.textContent = state.currentView === "saved" ? "Saved Stack" : "All Cards";
  el.statusSavedCount.textContent = String(state.savedIds.size);

  const total = state.activeCards.length;
  el.statusProgress.textContent = total ? `${state.currentIndex + 1} / ${total}` : "0 / 0";

  const currentCard = getCurrentCard();
  const isSaved = currentCard ? state.savedIds.has(currentCard.id) : false;

  el.saveCardBtn.disabled = !currentCard || isSaved;
  el.removeSavedBtn.disabled = !currentCard || !isSaved;
  el.prevBtn.disabled = !currentCard || state.currentIndex === 0;
  el.nextBtn.disabled = !currentCard || state.currentIndex >= total - 1;
  el.flipTopBtn.disabled = !currentCard;
  el.flipBottomBtn.disabled = !currentCard;

  el.saveCardBtn.textContent = isSaved ? "Saved" : "Save";
}

function wireEvents() {
  el.modeSequentialBtn.addEventListener("click", () => setMode("sequential"));
  el.modeRandomBtn.addEventListener("click", () => setMode("random"));

  el.viewAllBtn.addEventListener("click", () => setView("all"));
  el.viewSavedBtn.addEventListener("click", () => setView("saved"));

  el.saveCardBtn.addEventListener("click", saveCurrentCard);
  el.removeSavedBtn.addEventListener("click", removeCurrentCardFromSaved);

  el.restartBtn.addEventListener("click", restartOrder);
  el.flipTopBtn.addEventListener("click", flipCard);
  el.flipBottomBtn.addEventListener("click", flipCard);

  el.prevBtn.addEventListener("click", goPrev);
  el.nextBtn.addEventListener("click", goNext);

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();

    if (key === "arrowright") {
      goNext();
    } else if (key === "arrowleft") {
      goPrev();
    } else if (key === " " || key === "enter") {
      event.preventDefault();
      flipCard();
    } else if (key === "s") {
      saveCurrentCard();
    }
  });
}

async function init() {
  try {
    loadSavedSetFromStorage();
    wireEvents();
    updateUI();

    const workbook = await fetchWorkbook();
    state.allCards = parseCardsFromWorkbook(workbook);

    buildActiveCards();
    showMessage(`Loaded ${state.allCards.length} flash cards.`);
  } catch (error) {
    console.error(error);
    el.flashcardStage.innerHTML = `
      <div class="empty-state">
        <h2>Could not load the flash cards</h2>
        <p>${escapeHtml(error.message || "Unknown error.")}</p>
        <p>Please confirm that <strong>${escapeHtml(EXCEL_FILE_PATH)}</strong> exists in your GitHub repo.</p>
      </div>
    `;
    showMessage("Loading failed.");
  }
}

init();
