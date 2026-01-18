// Veda Podcast Quiz - Fixed Implementation
console.log('=== Quiz Application Starting ===');

// Configuration - HARDCODED FILE LIST
const QUIZ_FILES = [
  {
    name: '101_Intro_1_quiz.docx',
    title: '101 — Introduction (Part 1)',
    url: 'https://raw.githubusercontent.com/esbalabhakti-arch/PdxVedaMantraPadarthaAnvaya_QUIZ/main/Images/101_Intro_1_quiz.docx'
  },
  {
    name: '102_Intro_2_quiz.docx',
    title: '102 — Introduction (Part 2)',
    url: 'https://raw.githubusercontent.com/esbalabhakti-arch/PdxVedaMantraPadarthaAnvaya_QUIZ/main/Images/102_Intro_2_quiz.docx'
  },
  {
    name: '103_1st_Panchadi_quiz.docx',
    title: '103 — First Pañcati of Aruṇam',
    url: 'https://raw.githubusercontent.com/esbalabhakti-arch/PdxVedaMantraPadarthaAnvaya_QUIZ/main/Images/103_1st_Panchadi_quiz.docx'
  }
];

// State
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
function showMessage(text) {
  console.log('Message:', text);
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

// DOCX Loading and Parsing
async function loadDocxFile(url) {
  console.log('Loading DOCX from:', url);
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-cache'
    });
    
    console.log('Fetch response status:', response.status);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    console.log('ArrayBuffer size:', arrayBuffer.byteLength);
    
    if (!window.mammoth) {
      throw new Error('Mammoth library not loaded');
    }
    
    const result = await mammoth.extractRawText({ arrayBuffer });
    console.log('Text extracted, length:', result.value.length);
    console.log('First 500 chars:', result.value.substring(0, 500));
    
    return result.value;
  } catch (error) {
    console.error('Error loading DOCX:', error);
    throw error;
  }
}

function parseQuestions(text) {
  console.log('=== Starting to parse questions ===');
  console.log('Text length:', text.length);
  
  const questions = [];
  
  // Split text by question numbers
  const lines = text.split('\n');
  let currentQuestion = null;
  let currentSection = 'question'; // question, options, answer, check
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Detect question number (e.g., "1." at start of line)
    const questionMatch = line.match(/^(\d+)\.\s*$/);
    if (questionMatch) {
      // Save previous question if exists
      if (currentQuestion && currentQuestion.correctAnswer) {
        questions.push(currentQuestion);
      }
      
      // Start new question
      currentQuestion = {
        number: parseInt(questionMatch[1]),
        question: '',
        options: {},
        correctAnswer: null,
        explanation: '',
        attempts: 0
      };
      currentSection = 'question';
      continue;
    }
    
    if (!currentQuestion) continue;
    
    // Detect options (A., B., C., D.)
    const optionMatch = line.match(/^([A-D])\.\s*(.+)$/);
    if (optionMatch) {
      currentQuestion.options[optionMatch[1]] = optionMatch[2].trim();
      currentSection = 'options';
      continue;
    }
    
    // Detect correct answer
    const answerMatch = line.match(/^Correct Answer:\s*([A-D])/i);
    if (answerMatch) {
      currentQuestion.correctAnswer = answerMatch[1].toUpperCase();
      currentSection = 'answer';
      continue;
    }
    
    // Detect explanation
    const checkMatch = line.match(/^Check:\s*(.+)$/i);
    if (checkMatch) {
      currentQuestion.explanation = checkMatch[1].trim();
      currentSection = 'check';
      continue;
    }
    
    // Append to current section
    if (line.length > 0) {
      if (currentSection === 'question') {
        currentQuestion.question += (currentQuestion.question ? ' ' : '') + line;
      } else if (currentSection === 'check') {
        currentQuestion.explanation += ' ' + line;
      }
    }
  }
  
  // Save last question
  if (currentQuestion && currentQuestion.correctAnswer) {
    questions.push(currentQuestion);
  }
  
  // Clean up questions
  questions.forEach(q => {
    q.question = q.question.replace(/\[\(Source:[^\]]+\)\]/g, '').trim();
    q.explanation = q.explanation.trim();
  });
  
  console.log(`Parsed ${questions.length} questions`);
  if (questions.length > 0) {
    console.log('First question:', questions[0]);
  }
  
  return questions;
}

// Set Management
function getQuestionsForSet(setNum) {
  const start = (setNum - 1) * 10;
  const end = start + 10;
  return state.allQuestions.slice(start, end);
}

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

// Quiz Logic
function startQuiz() {
  console.log('Starting quiz...');
  console.log('Total questions loaded:', state.allQuestions.length);
  
  if (state.allQuestions.length === 0) {
    showMessage('⚠️ No questions loaded. Please select a podcast first.');
    return;
  }
  
  const setQuestions = getQuestionsForSet(state.currentSet);
  console.log('Questions in current set:', setQuestions.length);
  
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
  
  console.log('Displaying question:', question.number);
  
  state.selectedAnswer = null;
  state.isAnswered = false;
  
  elements.questionContainer.classList.add('active');
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
  
  elements.checkBtn.disabled = true;
  elements.nextBtn.disabled = true;
  elements.feedbackArea.classList.remove('show', 'correct', 'incorrect');
  elements.feedbackArea.textContent = '';
}

function selectOption(letter) {
  if (state.isAnswered) return;
  
  document.querySelectorAll('.option').forEach(opt => {
    opt.classList.remove('selected');
  });
  
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
  
  console.log('Checking answer:', state.selectedAnswer, 'Correct:', question.correctAnswer, 'Result:', isCorrect);
  
  if (isCorrect) {
    state.stats.correct++;
    if (question.attempts === 1) {
      state.stats.firstTry++;
    }
    
    state.isAnswered = true;
    elements.checkBtn.disabled = true;
    elements.nextBtn.disabled = false;
    
    elements.feedbackArea.className = 'feedback show correct';
    let feedbackText = `✅ Correct! The answer is ${question.correctAnswer}.`;
    if (question.explanation) {
      feedbackText += `\n\n${question.explanation}`;
    }
    elements.feedbackArea.textContent = feedbackText;
  } else {
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
  
  const totalQuestions = state.allQuestions.length;
  const questionsAnswered = state.currentSet * 10;
  
  if (questionsAnswered >= totalQuestions) {
    showMessage(`🎉 All questions done!\n\nFinal Statistics:\n• Total Correct: ${state.stats.correct}\n• Total Attempted: ${state.stats.attempted}\n• First-try Correct: ${state.stats.firstTry}\n\nNow click the Finish button.`);
  } else {
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
  const selectedUrl = e.target.value;
  if (!selectedUrl) return;
  
  console.log('Selected podcast URL:', selectedUrl);
  showMessage('⏳ Loading questions...');
  
  try {
    const text = await loadDocxFile(selectedUrl);
    state.allQuestions = parseQuestions(text);
    
    console.log('Questions loaded:', state.allQuestions.length);
    
    if (state.allQuestions.length === 0) {
      showMessage('⚠️ No questions found in this file. Check console for details.');
      return;
    }
    
    // Reset stats
    state.stats = { correct: 0, attempted: 0, firstTry: 0 };
    updateStats();
    updateSetButtons();
    
    showMessage(`✅ Loaded ${state.allQuestions.length} questions.\n\nSelect a set and click Start Quiz.`);
  } catch (error) {
    console.error('Error:', error);
    showMessage(`❌ Error loading file:\n${error.message}\n\nCheck browser console for details.`);
  }
});

elements.setsContainer.addEventListener('click', (e) => {
  if (e.target.classList.contains('set-btn') && !e.target.disabled) {
    const setNum = parseInt(e.target.dataset.set);
    state.currentSet = setNum;
    
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

// Initialize
function init() {
  console.log('Initializing quiz application...');
  
  elements.podcastSelect.innerHTML = '';
  
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = '-- Select a Podcast --';
  elements.podcastSelect.appendChild(defaultOption);
  
  QUIZ_FILES.forEach(file => {
    const option = document.createElement('option');
    option.value = file.url;
    option.textContent = file.title;
    elements.podcastSelect.appendChild(option);
  });
  
  showMessage('✅ Ready! Select a podcast to begin.');
  updateStats();
  console.log('Initialization complete');
}

// Check if mammoth is loaded
if (window.mammoth) {
  console.log('Mammoth library loaded successfully');
  init();
} else {
  console.error('Mammoth library not loaded!');
  showMessage('❌ Error: Required library not loaded. Please refresh the page.');
}
