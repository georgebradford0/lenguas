const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: 'YOUR_OPENAI_API_KEY'});

if (require('electron-squirrel-startup')) {
  app.quit();
}

ipcMain.handle('translate', async (_event, word) => {
  const response = await openai.responses.create({
    model: 'gpt-4o-mini',
    input: [
      { role: 'system', content: 'You are a German-English dictionary. Given a German word, return a JSON object with "word" (the German word) and "translation" (brief English translation, 1-5 words).' },
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
          },
          required: ['word', 'translation'],
          additionalProperties: false,
        },
        strict: true,
      },
    },
  });
  return JSON.parse(response.output_text);
});

ipcMain.handle('speak', async (_event, text) => {
  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice: 'nova',
    input: text,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString('base64');
});

ipcMain.handle('load-words', async () => {
  const csvPath = path.join(__dirname, '..', 'german_words.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  // Skip header
  return lines.slice(1);
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
