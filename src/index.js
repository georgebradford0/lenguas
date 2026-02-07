require('dotenv').config();
const { app, BrowserWindow, ipcMain, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const OpenAI = require('openai');
const API_BASE = 'http://localhost:3000';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

if (require('electron-squirrel-startup')) {
  app.quit();
}

ipcMain.handle('translate', async (_event, word) => {
  const response = await openai.responses.create({
    model: 'gpt-4o-mini',
    input: [
      { role: 'system', content: 'You are a German-English dictionary. Given a German word, return a JSON object with "word" (the German word), "translation" (brief English translation, 1-5 words), and "wrong" (an array of exactly 3 plausible but incorrect English translations that could trick a learner).' },
      { role: 'user', content: word },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'translation',
        schema: {
          type: 'object',
          properties: {
            word: { type: 'string' },
            translation: { type: 'string' },
            wrong: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
          },
          required: ['word', 'translation', 'wrong'],
          additionalProperties: false,
        },
        strict: true,
      },
    },
  });
  return JSON.parse(response.output_text);
});

ipcMain.handle('speak', async (_event, text) => {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE}/speak/${encodeURIComponent(text)}`;
    const request = net.request(url);
    const chunks = [];
    request.on('response', (response) => {
      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
});

ipcMain.handle('load-words', async () => {
  const csvPath = path.join(__dirname, '..', 'german_words.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  // Skip header
  return lines.slice(1);
});

// --- API proxy handlers ---

function fetchJSON(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE}${urlPath}`;
    const request = net.request({
      url,
      method: options.method || 'GET',
    });
    if (options.body) {
      request.setHeader('Content-Type', 'application/json');
    }
    let body = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => { body += chunk.toString(); });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve(body); }
      });
    });
    request.on('error', reject);
    if (options.body) {
      request.write(JSON.stringify(options.body));
    }
    request.end();
  });
}

ipcMain.handle('load-progress', async () => {
  try {
    const records = await fetchJSON('/progress');
    const progress = {};
    for (const r of records) {
      progress[r.word] = {
        timesShown: r.timesShown,
        correctCount: r.correctCount,
      };
    }
    return progress;
  } catch (err) {
    console.error('Failed to load progress from API:', err);
    return {};
  }
});

ipcMain.handle('save-progress', async (_event, word, data) => {
  try {
    await fetchJSON(`/progress/${encodeURIComponent(word)}`, {
      method: 'PUT',
      body: data,
    });
  } catch (err) {
    console.error('Failed to save progress:', err);
  }
});

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
