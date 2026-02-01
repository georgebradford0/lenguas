const STORAGE_KEY = 'srs-german-progress';
const NEW_CARDS_PER_SESSION = 10;

// DOM elements
const wordEl = document.getElementById('word');
const cardInfoEl = document.getElementById('card-info');
const btnShow = document.getElementById('btn-show');
const btnNext = document.getElementById('btn-next');
const cardContainer = document.getElementById('card-container');
const doneMessage = document.getElementById('done-message');
const statDue = document.getElementById('stat-due');
const statNew = document.getElementById('stat-new');
const statReviewed = document.getElementById('stat-reviewed');
const statLearned = document.getElementById('stat-learned');

let cards = []; // all card objects
let queue = [];  // current session queue
let currentCard = null;
let reviewedToday = 0;
let translationCache = {}; // word -> promise of translation result
let audioCache = {}; // word -> promise of base64 audio


// --- Persistence ---

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveProgress() {
  const data = {};
  for (const c of cards) {
    data[c.word] = {
      interval: c.interval,
      repetition: c.repetition,
      easeFactor: c.easeFactor,
      dueDate: c.dueDate,
    };
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// --- SM-2 Algorithm (auto "Good" rating) ---

function nowDay() {
  return Math.floor(Date.now() / (1000 * 60 * 60 * 24));
}

function processCard(card) {
  const today = nowDay();
  card.repetition += 1;
  if (card.repetition === 1) {
    card.interval = 1;
  } else if (card.repetition === 2) {
    card.interval = 6;
  } else {
    card.interval = Math.round(card.interval * card.easeFactor);
  }
  card.dueDate = today + card.interval;
}

// --- Queue Management ---

function buildQueue() {
  const today = nowDay();

  const due = cards.filter(c => c.repetition > 0 && c.dueDate <= today);
  for (let i = due.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [due[i], due[j]] = [due[j], due[i]];
  }

  const newCards = cards.filter(c => c.repetition === 0 && c.dueDate === 0);
  const newBatch = newCards.slice(0, NEW_CARDS_PER_SESSION);

  queue = [...due, ...newBatch];
}

function updateStats() {
  const today = nowDay();
  const dueCount = cards.filter(c => c.repetition > 0 && c.dueDate <= today).length;
  const newCount = cards.filter(c => c.repetition === 0 && c.dueDate === 0).length;
  const learnedCount = cards.filter(c => c.repetition > 0).length;

  statDue.textContent = `Due: ${dueCount}`;
  statNew.textContent = `New: ${newCount}`;
  statReviewed.textContent = `Reviewed: ${reviewedToday}`;
  statLearned.textContent = `Learned: ${learnedCount}`;
}

// --- Preloading (Translation + Audio) ---

function prefetchTranslation(word) {
  if (!translationCache[word]) {
    translationCache[word] = window.api.translate(word);
  }
  return translationCache[word];
}

function prefetchAudio(word) {
  if (!audioCache[word]) {
    audioCache[word] = window.api.speak(word);
  }
  return audioCache[word];
}

async function playAudio(word) {
  try {
    const base64 = await prefetchAudio(word);
    const audio = new Audio(`data:audio/mp3;base64,${base64}`);
    audio.play();
  } catch (err) {
    console.error('Audio playback failed:', err);
  }
}

function prefetchNext() {
  if (queue.length > 0) {
    const nextWord = queue[0].word;
    prefetchTranslation(nextWord);
    prefetchAudio(nextWord);
  }
}

// --- UI ---

function showCard() {
  if (queue.length === 0) {
    cardContainer.classList.add('hidden');
    doneMessage.classList.remove('hidden');
    updateStats();
    return;
  }

  cardContainer.classList.remove('hidden');
  doneMessage.classList.add('hidden');

  currentCard = queue.shift();
  wordEl.textContent = currentCard.word;
  cardInfoEl.classList.add('hidden');

  // Show speaker button
  const btnSpeak = document.getElementById('btn-speak');
  btnSpeak.classList.remove('hidden');

  // Prefetch current card (if not already cached) and next card
  prefetchTranslation(currentCard.word);
  prefetchAudio(currentCard.word);
  prefetchNext();

  // Auto-play audio on first show of word
  playAudio(currentCard.word);

  updateStats();
}

async function revealCard() {
  btnShow.textContent = 'Loading...';
  btnShow.disabled = true;

  try {
    const result = await prefetchTranslation(currentCard.word);
    cardInfoEl.innerHTML = `<div class="translation">${result.translation}</div>`;
  } catch (err) {
    cardInfoEl.textContent = 'Translation unavailable';
  }

  btnShow.textContent = 'Show';
  btnShow.disabled = false;
  cardInfoEl.classList.remove('hidden');
}

function nextCard() {
  processCard(currentCard);
  reviewedToday++;
  saveProgress();
  showCard();
}

// --- Event Listeners ---

btnShow.addEventListener('click', revealCard);
btnNext.addEventListener('click', nextCard);

document.getElementById('btn-speak').addEventListener('click', () => {
  if (currentCard) playAudio(currentCard.word);
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (!currentCard) return;

  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    nextCard();
  } else if (e.key === 's') {
    revealCard();
  }
});

// --- Init ---

async function init() {
  const words = await window.api.loadWords();
  const progress = loadProgress();

  cards = words.map(word => {
    const saved = progress[word];
    if (saved) {
      return { word, ...saved };
    }
    return {
      word,
      interval: 0,
      repetition: 0,
      easeFactor: 2.5,
      dueDate: 0,
    };
  });

  buildQueue();
  updateStats();
  showCard();
}

init();
