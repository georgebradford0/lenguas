const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadWords: () => ipcRenderer.invoke('load-words'),
  translate: (word) => ipcRenderer.invoke('translate', word),
  speak: (text) => ipcRenderer.invoke('speak', text),
});
