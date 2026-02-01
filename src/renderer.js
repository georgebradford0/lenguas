const STORAGE_KEY = 'srs-german-progress';
const NEW_CARDS_PER_SESSION = 10;
const BASE_GAP = 1;
const ADVANCE_DELAY = 1200; // ms after answer before next card

// DOM elements
const wordEl = document.getElementById('word');
const choicesEl = document.getElementById('choices');
const cardContainer = document.getElementById('card-container');
const doneMessage = document.getElementById('done-message');
const statDue = document.getElementById('stat-due');
const statNew = document.getElementById('stat-new');
const statReviewed = document.getElementById('stat-reviewed');
const statLearned = document.getElementById('stat-learned');

let cards = [];
let currentCard = null;
let sessionCounter = 0;
let reviewedCount = 0;
let answering = false; // prevent double-clicks during delay
let translationCache = {};
let audioCache = {};

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
      correctStreak: c.correctStreak,
      totalReviews: c.totalReviews,
      nextShowAfter: c.nextShowAfter,
    };
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// --- Adaptive Frequency ---

function getNextCard() {
  // Find due cards (nextShowAfter <= sessionCounter)
  const due = cards.filter(c => c.totalReviews > 0 && c.nextShowAfter <= sessionCounter);

  if (due.length > 0) {
    // Pick the one with lowest nextShowAfter (most overdue)
    due.sort((a, b) => a.nextShowAfter - b.nextShowAfter);
    return due[0];
  }

  // No due cards — introduce a new card
  const newCards = cards.filter(c => c.totalReviews === 0);
  if (newCards.length > 0) {
    return newCards[0];
  }

  return null; // all done
}

function processAnswer(card, correct) {
  card.totalReviews++;
  sessionCounter++;

  if (correct) {
    card.correctStreak++;
    card.nextShowAfter = sessionCounter + BASE_GAP * Math.pow(2, card.correctStreak);
  } else {
    card.correctStreak = 0;
    card.nextShowAfter = sessionCounter + 1;
  }
}

// --- Stats ---

function updateStats() {
  const dueCount = cards.filter(c => c.totalReviews > 0 && c.nextShowAfter <= sessionCounter).length;
  const newCount = cards.filter(c => c.totalReviews === 0).length;
  const learnedCount = cards.filter(c => c.totalReviews > 0).length;

  statDue.textContent = `Due: ${dueCount}`;
  statNew.textContent = `New: ${newCount}`;
  statReviewed.textContent = `Reviewed: ${reviewedCount}`;
  statLearned.textContent = `Learned: ${learnedCount}`;
}

// --- Preloading ---

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

function prefetchNextCard() {
  const next = getNextCard();
  if (next) {
    prefetchTranslation(next.word);
    prefetchAudio(next.word);
  }
}

// --- Shuffle utility ---

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- UI ---

async function showCard() {
  currentCard = getNextCard();

  if (!currentCard) {
    cardContainer.classList.add('hidden');
    doneMessage.classList.remove('hidden');
    updateStats();
    return;
  }

  cardContainer.classList.remove('hidden');
  doneMessage.classList.add('hidden');
  answering = false;

  wordEl.textContent = currentCard.word;

  // Show speaker button
  document.getElementById('btn-speak').classList.remove('hidden');

  // Clear choices and show loading
  choicesEl.innerHTML = '<div style="color:#5a6080;text-align:center;padding:1rem;">Loading...</div>';

  // Prefetch audio and play
  prefetchAudio(currentCard.word);
  playAudio(currentCard.word);

  // Load translation with choices
  try {
    const result = await prefetchTranslation(currentCard.word);
    const options = shuffle([
      { text: result.translation, correct: true },
      { text: result.wrong[0], correct: false },
      { text: result.wrong[1], correct: false },
      { text: result.wrong[2], correct: false },
    ]);

    choicesEl.innerHTML = '';
    options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.innerHTML = `<span class="key-hint">${i + 1}</span>${opt.text}`;
      btn.dataset.correct = opt.correct;
      btn.dataset.text = opt.text;
      btn.addEventListener('click', () => handleChoice(btn, opt.correct));
      choicesEl.appendChild(btn);
    });
  } catch (err) {
    choicesEl.innerHTML = '<div style="color:#e74c3c;text-align:center;padding:1rem;">Failed to load choices</div>';
  }

  // Prefetch next card
  prefetchNextCard();
  updateStats();
}

function handleChoice(clickedBtn, correct) {
  if (answering) return;
  answering = true;

  const allBtns = choicesEl.querySelectorAll('.choice-btn');

  if (correct) {
    clickedBtn.classList.add('correct');
  } else {
    clickedBtn.classList.add('wrong');
    // Reveal the correct answer
    allBtns.forEach(btn => {
      if (btn.dataset.correct === 'true') {
        btn.classList.add('reveal');
      }
    });
  }

  // Disable all buttons
  allBtns.forEach(btn => btn.classList.add('disabled'));

  // Update card state
  processAnswer(currentCard, correct);
  reviewedCount++;
  saveProgress();

  // Prefetch next during delay
  prefetchNextCard();

  // Auto-advance
  setTimeout(() => {
    showCard();
  }, ADVANCE_DELAY);
}

// --- Event Listeners ---

document.getElementById('btn-speak').addEventListener('click', () => {
  if (currentCard) playAudio(currentCard.word);
});

// Keyboard shortcuts: 1-4 to select choice
document.addEventListener('keydown', (e) => {
  if (!currentCard || answering) return;

  const num = parseInt(e.key, 10);
  if (num >= 1 && num <= 4) {
    const btns = choicesEl.querySelectorAll('.choice-btn');
    if (btns[num - 1]) {
      btns[num - 1].click();
    }
  }
});

// --- Init ---

async function init() {
  const words = await window.api.loadWords();
  const progress = loadProgress();

  // Restore sessionCounter from saved state
  let maxNextShow = 0;

  cards = words.map(word => {
    const saved = progress[word];
    // Only restore if it has the new schema fields
    if (saved && typeof saved.totalReviews === 'number') {
      if (saved.nextShowAfter > maxNextShow) maxNextShow = saved.nextShowAfter;
      return { word, ...saved };
    }
    return {
      word,
      correctStreak: 0,
      totalReviews: 0,
      nextShowAfter: 0,
    };
  });

  // Resume sessionCounter so saved nextShowAfter values make sense
  sessionCounter = maxNextShow;

  updateStats();
  showCard();
}

init();
