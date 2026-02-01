const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadWords: () => ipcRenderer.invoke('load-words'),
  translate: (word) => ipcRenderer.invoke('translate', word),
  speak: (text) => ipcRenderer.invoke('speak', text),
  loadProgress: () => ipcRenderer.invoke('load-progress'),
  saveProgress: (word, data) => ipcRenderer.invoke('save-progress', word, data),
});
