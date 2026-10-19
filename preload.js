// Preload scripts for Electron
const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('jarvisDesktop', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  saveFileDialog: () => ipcRenderer.invoke('save-file-dialog'),
  openApplication: (appPath) => ipcRenderer.invoke('open-application', appPath),
  searchWeb: (query) => ipcRenderer.invoke('search-web', query),
  readGmail: () => ipcRenderer.invoke('read-gmail'),
  readWhatsApp: () => ipcRenderer.invoke('read-whatsapp')
});

// Expose environment variables to renderer (if needed)
contextBridge.exposeInMainWorld('ENV', {
  NODE_ENV: process.env.NODE_ENV || 'development'
});