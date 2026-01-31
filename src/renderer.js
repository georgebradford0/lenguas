const STORAGE_KEY = 'srs-german-progress';
const NEW_CARDS_PER_SESSION = 10;

// DOM elements
const wordEl = document.getElementById('word');
const cardInfoEl = document.getElementById('card-info');
const btnShow = document.getElementById('btn-show');
const showContainer = document.getElementById('show-container');
const ratingContainer = document.getElementById('rating-container');
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

// --- SM-2 Algorithm ---

function nowDay() {
  // Day number since epoch (for simple day-based scheduling)
  return Math.floor(Date.now() / (1000 * 60 * 60 * 24));
}

function processRating(card, rating) {
  // rating: 0=Again, 1=Hard, 2=Good, 3=Easy
  const today = nowDay();

  if (rating === 0) {
    // Again: reset
    card.repetition = 0;
    card.interval = 0; // show again this session
    card.easeFactor = Math.max(1.3, card.easeFactor - 0.2);
    card.dueDate = today; // due now
  } else if (rating === 1) {
    // Hard
    card.repetition += 1;
    if (card.repetition === 1) {
      card.interval = 1;
    } else {
      card.interval = Math.max(1, Math.round(card.interval * 1.2));
    }
    card.easeFactor = Math.max(1.3, card.easeFactor - 0.15);
    card.dueDate = today + card.interval;
  } else if (rating === 2) {
    // Good
    card.repetition += 1;
    if (card.repetition === 1) {
      card.interval = 1;
    } else if (card.repetition === 2) {
      card.interval = 6;
    } else {
      card.interval = Math.round(card.interval * card.easeFactor);
    }
    card.dueDate = today + card.interval;
  } else {
    // Easy
    card.repetition += 1;
    if (card.repetition === 1) {
      card.interval = 4;
    } else {
      card.interval = Math.round(card.interval * card.easeFactor * 1.3);
    }
    card.easeFactor += 0.15;
    card.dueDate = today + card.interval;
  }
}

// --- Queue Management ---

function buildQueue() {
  const today = nowDay();

  // Due cards (already seen, due today or earlier)
  const due = cards.filter(c => c.repetition > 0 && c.dueDate <= today);
  // Shuffle due cards
  for (let i = due.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [due[i], due[j]] = [due[j], due[i]];
  }

  // New cards (never seen)
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
  showContainer.classList.remove('hidden');
  ratingContainer.classList.add('hidden');

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
    cardInfoEl.innerHTML = `<div class="translation">${result.translation}</div><div class="example">${result.example}</div>`;
  } catch (err) {
    cardInfoEl.textContent = 'Translation unavailable';
  }

  btnShow.textContent = 'Show';
  btnShow.disabled = false;
  cardInfoEl.classList.remove('hidden');
  showContainer.classList.add('hidden');
  ratingContainer.classList.remove('hidden');
}

function rateCard(rating) {
  processRating(currentCard, rating);
  reviewedToday++;

  // If "Again", put card back in queue
  if (rating === 0) {
    // Insert at a random position in the back half of queue
    const pos = Math.floor(queue.length / 2) + Math.floor(Math.random() * (Math.ceil(queue.length / 2) + 1));
    queue.splice(pos, 0, currentCard);
  }

  saveProgress();
  showCard();
}

// --- Event Listeners ---

btnShow.addEventListener('click', revealCard);

document.getElementById('btn-speak').addEventListener('click', () => {
  if (currentCard) playAudio(currentCard.word);
});

document.querySelectorAll('.rate-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    rateCard(parseInt(btn.dataset.rating, 10));
  });
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (!currentCard) return;

  if (e.key === ' ' || e.key === 'Enter') {
    if (!ratingContainer.classList.contains('hidden')) return;
    e.preventDefault();
    revealCard();
  } else if (e.key === '1') rateCard(0);
  else if (e.key === '2') rateCard(1);
  else if (e.key === '3') rateCard(2);
  else if (e.key === '4') rateCard(3);
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
