const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadWords: () => ipcRenderer.invoke('load-words'),
});
