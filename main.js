const { app, BrowserWindow, Tray, Menu, shell, dialog } = require('electron');
const path = require('node:path');
const { Bridge } = require('./bridge/server.mjs');

let mainWindow;
let tray;
let bridge;

function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'public', 'jarvis-icon.png')
  });

  // Load the Jarvis app
  mainWindow.loadURL('http://localhost:5173');

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Handle window closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
    return true;
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'public', 'jarvis-icon.png'));
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show JARVIS',
      click: () => {
        mainWindow.show();
      }
    },
    {
      label: 'Hide JARVIS',
      click: () => {
        mainWindow.hide();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setToolTip('JARVIS - Your AI Assistant');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow.show();
  });
}

async function startBridge() {
  try {
    // Start the bridge server
    bridge = await Bridge();
    console.log('[Jarvis Desktop] Bridge started successfully');
  } catch (error) {
    console.error('[Jarvis Desktop] Failed to start bridge:', error);
  }
}

app.whenReady().then(async () => {
  await startBridge();
  createWindow();
  createTray();

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

// IPC handlers for desktop capabilities
const { ipcMain } = require('electron');

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile']
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('save-file-dialog', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {});
  return result.filePath || null;
});

ipcMain.handle('open-application', async (event, appPath) => {
  try {
    await shell.openPath(appPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('search-web', async (event, query) => {
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('read-gmail', async () => {
  try {
    // This would typically use MCP servers or other integrations
    // For now, we'll open Gmail in the browser
    await shell.openExternal('https://mail.google.com');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('read-whatsapp', async () => {
  try {
    // This would typically use MCP servers or other integrations
    // For now, we'll open WhatsApp Web in the browser
    await shell.openExternal('https://web.whatsapp.com');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});