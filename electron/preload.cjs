const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('jarvisDesktop', {
  isDesktop: true,
  getSettings: () => ipcRenderer.invoke('desktop:get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('desktop:set-setting', { key, value }),
  openDataFolder: () => ipcRenderer.invoke('desktop:open-data-folder'),
  showWindow: () => ipcRenderer.invoke('desktop:show-window'),
  hideWindow: () => ipcRenderer.invoke('desktop:hide-window'),
  quit: () => ipcRenderer.invoke('desktop:quit'),
})
