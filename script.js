// Veda Podcast Quiz - Complete Rewrite
// GitHub Configuration
const CONFIG = {
  owner: 'esbalabhakti-arch',
  repo: 'PdxVedaMantraPadarthaAnvaya_QUIZ',
  branch: 'main',
  folder: 'Images'
};

// State Management
const state = {
  allQuestions: [],
  currentSet: 1,
  currentQuestionIndex: 0,
  selectedAnswer: null,
  stats: {
    correct: 0,
    attempted: 0,
    firstTry: 0
  },
  isAnswered: false,
  quizActive: false
};

// DOM Elements
const elements = {
  podcastSelect: document.getElementById('podcastSelect'),
  setsContainer: document.getElementById('setsContainer'),
  startBtn: document.getElementById('startBtn'),
  finishBtn: document.getElementById('finishBtn'),
  messageArea: document.getElementById('messageArea'),
  questionContainer: document.getElementById('questionContainer'),
  questionNumber: document.getElementById('questionNumber'),
  questionText: document.getElementById('questionText'),
  optionsContainer: document.getElementById('optionsContainer'),
  checkBtn: document.getElementById('checkBtn'),
  nextBtn: document.getElementById('nextBtn'),
  feedbackArea: document.getElementById('feedbackArea'),
  statCorrect: document.getElementById('statCorrect'),
  statAttempted: document.getElementById('statAttempted'),
  statFirstTry: document.getElementById('statFirstTry')
};

// Utility Functions
function log(message, data = '') {
  console.log(`[QUIZ] ${message}`, data);
}

function showMessage(text) {
  elements.messageArea.textContent = text;
  elements.messageArea.style.display = 'block';
  elements.questionContainer.classList.remove('active');
}

function hideMessage() {
  elements.messageArea.style.display = 'none';
}

function updateStats() {
  elements.statCorrect.textContent = `Correct: ${state.stats.correct}`;
  elements.statAttempted.textContent = `Attempted: ${state.stats.attempted}`;
  elements.statFirstTry.textContent = `First-try: ${state.stats.firstTry}`;
}

// GitHub API Functions
async function fetchQuizFiles() {
  const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.folder}?ref=${CONFIG.branch}`;
  log('Fetching file list from:', url);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }
    
    const files = await response.json();
    const quizFiles = files
      .filter(file => file.name.toLowerCase().endsWith('_quiz.docx'))
      .map(file => ({
        name: file.name,
        downloadUrl: file.download_url,
        displayName: formatFileName(file.name)
      }));
    
    log('Found quiz files:', quizFiles);
    return quizFiles;
  } catch (error) {
    log('Error fetching files:', error);
    throw error;
  }
}

function formatFileName(filename) {
  // Remove _quiz.docx and format nicely
  const base = filename.replace(/_quiz\.docx$/i, '');
  const parts = base.split('_');
  
  // Check if starts with number
  if (/^\d+$/.test(parts[0])) {
    const num = parts[0];
    const rest = parts.slice(1).join(' ');
    return `${num} — ${titleCase(rest)}`;
  }
  
  return titleCase(base.replace(/_/g, ' '));
}

function titleCase(str) {
  return str.split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// DOCX Parsing Functions
async function loadDocxFile(url) {
  log('Loading DOCX from:', url);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch DOCX: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    
    log('DOCX loaded, text length:', result.value.length);
    return result.value;
  } catch (error) {
    log('Error loading DOCX:', error);
    throw error;
  }
}

function parseQuestions(text) {
  log('Parsing questions from text...');
  const questions = [];
  
  // Split by question numbers (e.g., "1.", "2.", etc.)
  const questionBlocks = text.split(/\n\s*(\d+)\.\s*\n/);
  
  for (let i = 1; i < questionBlocks.length; i += 2) {
    const questionNum = parseInt(questionBlocks[i]);
    const questionText = questionBlocks[i + 1];
    
    if (!questionText) continue;
    
    try {
      const question = parseQuestionBlock(questionNum, questionText);
      if (question) {
        questions.push(question);
      }
    } catch (error) {
      log(`Error parsing question ${questionNum}:`, error);
    }
  }
  
  log('Parsed questions:', questions.length);
  return questions;
}

function parseQuestionBlock(num, text) {
  // Extract question stem (before option A)
  const optionAMatch = text.match(/\n\s*A\.\s/);
  if (!optionAMatch) return null;
  
  const questionStem = text.substring(0, optionAMatch.index).trim();
  const optionsText = text.substring(optionAMatch.index);
  
  // Extract options A, B, C, D
  const options = {};
  const optionPattern = /\n\s*([A-D])\.\s*([^\n]+)/g;
  let match;
  
  while ((match = optionPattern.exec(optionsText)) !== null) {
    options[match[1]] = match[2].trim();
  }
  
  // Must have at least 2 options
  if (Object.keys(options).length < 2) return null;
  
  // Extract correct answer
  const answerMatch = text.match(/Correct Answer:\s*([A-D])/i);
  if (!answerMatch) return null;
  
  const correctAnswer = answerMatch[1].toUpperCase();
  
  // Extract explanation (optional)
  const checkMatch = text.match(/Check:\s*(.+?)(?:\n\n|\n\d+\.|$)/s);
  const explanation = checkMatch ? checkMatch[1].trim() : '';
  
  return {
    number: num,
    question: cleanText(questionStem),
    options: options,
    correctAnswer: correctAnswer,
    explanation: explanation,
    attempts: 0
  };
}

function cleanText(text) {
  return text
    .replace(/\[\(Source:[^\]]+\)\]/g, '') // Remove source citations
    .replace(/\s+/g, ' ')
    .trim();
}

// Quiz Logic Functions
function getQuestionsForSet(setNum) {
  const start = (setNum - 1) * 10;
  const end = start + 10;
  return state.allQuestions.slice(start, end);
}

function startQuiz() {
  if (state.allQuestions.length === 0) {
    showMessage('⚠️ No questions loaded. Please select a podcast first.');
    return;
  }
  
  const setQuestions = getQuestionsForSet(state.currentSet);
  if (setQuestions.length === 0) {
    showMessage(`⚠️ Set ${state.currentSet} has no questions.`);
    return;
  }
  
  state.quizActive = true;
  state.currentQuestionIndex = 0;
  hideMessage();
  displayQuestion();
}

function displayQuestion() {
  const setQuestions = getQuestionsForSet(state.currentSet);
  const question = setQuestions[state.currentQuestionIndex];
  
  if (!question) {
    endSet();
    return;
  }
  
  // Reset state
  state.selectedAnswer = null;
  state.isAnswered = false;
  
  // Show question container
  elements.questionContainer.classList.add('active');
  
  // Update question info
  elements.questionNumber.textContent = `Set ${state.currentSet} - Question ${state.currentQuestionIndex + 1} of ${setQuestions.length}`;
  elements.questionText.textContent = question.question;
  
  // Create options
  elements.optionsContainer.innerHTML = '';
  const letters = Object.keys(question.options).sort();
  
  letters.forEach(letter => {
    const option = document.createElement('div');
    option.className = 'option';
    option.dataset.letter = letter;
    
    option.innerHTML = `
      <div class="option-letter">${letter}.</div>
      <div class="option-text">${question.options[letter]}</div>
    `;
    
    option.addEventListener('click', () => selectOption(letter));
    elements.optionsContainer.appendChild(option);
  });
  
  // Reset buttons
  elements.checkBtn.disabled = true;
  elements.nextBtn.disabled = true;
  
  // Hide feedback
  elements.feedbackArea.classList.remove('show', 'correct', 'incorrect');
  elements.feedbackArea.textContent = '';
}

function selectOption(letter) {
  if (state.isAnswered) return;
  
  // Remove previous selection
  document.querySelectorAll('.option').forEach(opt => {
    opt.classList.remove('selected');
  });
  
  // Add new selection
  const selectedOption = document.querySelector(`.option[data-letter="${letter}"]`);
  if (selectedOption) {
    selectedOption.classList.add('selected');
    state.selectedAnswer = letter;
    elements.checkBtn.disabled = false;
  }
}

function checkAnswer() {
  if (!state.selectedAnswer || state.isAnswered) return;
  
  const setQuestions = getQuestionsForSet(state.currentSet);
  const question = setQuestions[state.currentQuestionIndex];
  
  question.attempts++;
  state.stats.attempted++;
  
  const isCorrect = state.selectedAnswer === question.correctAnswer;
  
  if (isCorrect) {
    state.stats.correct++;
    if (question.attempts === 1) {
      state.stats.firstTry++;
    }
    
    state.isAnswered = true;
    elements.checkBtn.disabled = true;
    elements.nextBtn.disabled = false;
    
    // Show success feedback
    elements.feedbackArea.className = 'feedback show correct';
    let feedbackText = `✅ Correct! The answer is ${question.correctAnswer}.`;
    if (question.explanation) {
      feedbackText += `\n\n${question.explanation}`;
    }
    elements.feedbackArea.textContent = feedbackText;
  } else {
    // Show error feedback
    elements.feedbackArea.className = 'feedback show incorrect';
    elements.feedbackArea.textContent = '❌ Not quite. Try again!\n\nTip: Re-read the question carefully and pick the best match.';
  }
  
  updateStats();
}

function nextQuestion() {
  if (!state.isAnswered) return;
  
  state.currentQuestionIndex++;
  const setQuestions = getQuestionsForSet(state.currentSet);
  
  if (state.currentQuestionIndex >= setQuestions.length) {
    endSet();
  } else {
    displayQuestion();
  }
}

function endSet() {
  elements.questionContainer.classList.remove('active');
  
  // Check if all 50 questions are done
  const totalQuestions = state.allQuestions.length;
  const questionsAnswered = state.currentSet * 10;
  
  if (questionsAnswered >= totalQuestions) {
    // All questions done
    showMessage(`🎉 All questions done!\n\nFinal Statistics:\n• Total Correct: ${state.stats.correct}\n• Total Attempted: ${state.stats.attempted}\n• First-try Correct: ${state.stats.firstTry}\n\nNow click the Finish button.`);
  } else {
    // Set complete, more sets available
    showMessage(`✅ Congratulations, 10 question set complete!\n\nMove to the next set to continue.`);
  }
  
  state.quizActive = false;
}

function finishQuiz() {
  state.quizActive = false;
  elements.questionContainer.classList.remove('active');
  
  showMessage(`✅ Quiz finished!\n\nFinal Statistics:\n• Correct: ${state.stats.correct}\n• Attempted: ${state.stats.attempted}\n• First-try Correct: ${state.stats.firstTry}\n\nKeep going — consistency beats intensity! 🌟`);
}

// Event Listeners
elements.podcastSelect.addEventListener('change', async (e) => {
  const selectedFile = e.target.value;
  if (!selectedFile) return;
  
  showMessage('⏳ Loading questions...');
  
  try {
    const text = await loadDocxFile(selectedFile);
    state.allQuestions = parseQuestions(text);
    
    if (state.allQuestions.length === 0) {
      showMessage('⚠️ No questions found in this file.');
      return;
    }
    
    // Reset stats
    state.stats = { correct: 0, attempted: 0, firstTry: 0 };
    updateStats();
    
    // Update set buttons
    updateSetButtons();
    
    showMessage(`✅ Loaded ${state.allQuestions.length} questions.\n\nSelect a set and click Start Quiz.`);
  } catch (error) {
    showMessage(`❌ Error loading file: ${error.message}`);
    log('Load error:', error);
  }
});

elements.setsContainer.addEventListener('click', (e) => {
  if (e.target.classList.contains('set-btn') && !e.target.disabled) {
    const setNum = parseInt(e.target.dataset.set);
    state.currentSet = setNum;
    
    // Update active button
    document.querySelectorAll('.set-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    e.target.classList.add('active');
  }
});

elements.startBtn.addEventListener('click', startQuiz);
elements.finishBtn.addEventListener('click', finishQuiz);
elements.checkBtn.addEventListener('click', checkAnswer);
elements.nextBtn.addEventListener('click', nextQuestion);

function updateSetButtons() {
  const buttons = document.querySelectorAll('.set-btn');
  buttons.forEach((btn, index) => {
    const setNum = index + 1;
    const setQuestions = getQuestionsForSet(setNum);
    
    if (setQuestions.length > 0) {
      const start = (setNum - 1) * 10 + 1;
      const end = start + setQuestions.length - 1;
      btn.textContent = `Set ${setNum} (Q${start}-${end})`;
      btn.disabled = false;
    } else {
      btn.textContent = `Set ${setNum}`;
      btn.disabled = true;
    }
  });
}

// Initialize
async function init() {
  log('Initializing quiz application...');
  showMessage('⏳ Loading available podcasts...');
  
  try {
    const files = await fetchQuizFiles();
    
    elements.podcastSelect.innerHTML = '';
    
    if (files.length === 0) {
      elements.podcastSelect.innerHTML = '<option value="">No quiz files found</option>';
      showMessage('❌ No quiz files found in the repository.');
      return;
    }
    
    // Populate dropdown
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '-- Select a Podcast --';
    elements.podcastSelect.appendChild(defaultOption);
    
    files.forEach(file => {
      const option = document.createElement('option');
      option.value = file.downloadUrl;
      option.textContent = file.displayName;
      elements.podcastSelect.appendChild(option);
    });
    
    showMessage('✅ Ready! Select a podcast to begin.');
    log('Initialization complete');
  } catch (error) {
    showMessage(`❌ Failed to load: ${error.message}`);
    log('Init error:', error);
  }
}

// Start the application
init();
