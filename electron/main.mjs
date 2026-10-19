import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
  utilityProcess,
} from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const startUrl = process.env.ELECTRON_START_URL
const settingsFile = () => join(app.getPath('userData'), 'settings.json')

let windowRef = null
let tray = null
let bridge = null
let bridgePort = 8787
let forceQuit = false
let settings = {
  minimizeToTray: true,
  launchAtLogin: false,
  memoryEnabled: true,
}

function loadEnvFile() {
  const envPath = join(root, '.env.local')
  if (!existsSync(envPath)) return {}
  const values = {}
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && !match[2].startsWith('#')) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}

async function readSettings() {
  try {
    const parsed = JSON.parse(await readFile(settingsFile(), 'utf8'))
    settings = { ...settings, ...parsed }
  } catch {
    // First run: defaults are intentionally useful without a setup wizard.
  }
}

async function saveSettings() {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(settingsFile(), JSON.stringify(settings, null, 2), 'utf8')
}

function applyLoginSetting() {
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, name: 'JARVIS' })
}

function showWindow() {
  if (!windowRef || windowRef.isDestroyed()) return
  if (windowRef.isMinimized()) windowRef.restore()
  windowRef.show()
  windowRef.focus()
}

function hideWindow() {
  if (windowRef && !windowRef.isDestroyed()) windowRef.hide()
}

function trayImage() {
  const iconPath = join(root, 'public', 'favicon.svg')
  return existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
}

function createTray() {
  tray = new Tray(trayImage())
  tray.setToolTip('J.A.R.V.I.S. — desktop agent')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open JARVIS', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => { forceQuit = true; app.quit() } },
    ]),
  )
  tray.on('click', showWindow)
}

function bridgeEnvironment() {
  const fileEnv = loadEnvFile()
  console.log('[jarvis-electron] bridgeEnvironment called, fileEnv:', fileEnv)

  // Use a high port number that's unlikely to be in use to avoid conflicts
  // with other Electron instances or background processes
  const bridgePort = fileEnv.JARVIS_BRIDGE_PORT ?? process.env.JARVIS_BRIDGE_PORT ?? '18787'

  const env = {
    ...fileEnv,
    ...process.env,
    JARVIS_ALLOW_WRITES: '1',
    JARVIS_ALLOW_NO_ORIGIN: '1',
    JARVIS_VOICE_ID: process.env.JARVIS_VOICE_ID ?? fileEnv.JARVIS_VOICE_ID ?? 'Iqh4r3CPhQwBblCkKe0a',
    JARVIS_BRIDGE_PORT: bridgePort,
    JARVIS_DATA_DIR: app.getPath('userData'),
    JARVIS_MEMORY_ENABLED: settings.memoryEnabled ? '1' : '0',
    JARVIS_DESKTOP_APP: '1',
  }
  console.log('[jarvis-electron] bridge env JARVIS_BRIDGE_PORT:', env.JARVIS_BRIDGE_PORT)
  return env
}

async function bridgeAlreadyRunning(port) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 700)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function startBridge() {
  const bridgePath = join(root, 'bridge', 'server.mjs')
  const env = bridgeEnvironment()
  bridgePort = Number(env.JARVIS_BRIDGE_PORT ?? 8787)

  // Reuse a healthy bridge if the user already has one running. This avoids a
  // second JARVIS process fighting for the port after an app restart.
  if (await bridgeAlreadyRunning(bridgePort)) return
  const nodePath = process.env.JARVIS_NODE_PATH

  if (nodePath) {
    bridge = spawn(nodePath, [bridgePath], { cwd: root, env, stdio: 'pipe' })
    bridge.stdout?.on('data', (data) => console.log(`[bridge] ${data}`))
    bridge.stderr?.on('data', (data) => console.error(`[bridge] ${data}`))
    bridge.on('exit', (code) => console.log(`[jarvis] bridge exited (${code})`))
  } else {
    bridge = utilityProcess.fork(bridgePath, [], { cwd: root, env })
    bridge.on('exit', (code) => console.log(`[jarvis] bridge exited (${code})`))
    bridge.on('error', (err) => console.error(`[jarvis] bridge error:`, err))
  }
}

function stopBridge() {
  if (!bridge) return
  try {
    bridge.kill()
  } catch {
    // Already stopped.
  }
  bridge = null
}

async function createWindow() {
  windowRef = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 650,
    backgroundColor: '#01060c',
    show: false,
    autoHideMenuBar: true,
    title: 'J.A.R.V.I.S. Desktop Agent',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  windowRef.on('ready-to-show', () => windowRef.show())
  windowRef.on('close', (event) => {
    if (!forceQuit && settings.minimizeToTray) {
      event.preventDefault()
      windowRef.hide()
    }
  })

  if (startUrl) {
    const url = new URL(startUrl)
    url.searchParams.set('bridge', `ws://localhost:${bridgePort}`)
    await windowRef.loadURL(url.toString())
  } else {
    await windowRef.loadFile(join(root, 'dist', 'index.html'), {
      query: { bridge: `ws://localhost:${bridgePort}` },
    })
  }
}

ipcMain.handle('desktop:get-settings', () => ({
  ...settings,
  dataPath: app.getPath('userData'),
  writesEnabled: true,
  voiceId: bridgeEnvironment().JARVIS_VOICE_ID,
}))

ipcMain.handle('desktop:set-setting', async (_event, payload) => {
  const key = payload?.key
  if (!['minimizeToTray', 'launchAtLogin', 'memoryEnabled'].includes(key)) return settings
  settings[key] = Boolean(payload.value)
  await saveSettings()
  if (key === 'launchAtLogin') applyLoginSetting()
  if (key === 'memoryEnabled') {
    // The bridge reads this flag at startup so a memory change is applied to the
    // agent session immediately. The renderer reconnects to a fresh session.
    stopBridge()
    void startBridge()
  }
  return settings
})

ipcMain.handle('desktop:open-data-folder', () => shell.openPath(app.getPath('userData')))
ipcMain.handle('desktop:show-window', showWindow)
ipcMain.handle('desktop:hide-window', hideWindow)
ipcMain.handle('desktop:quit', () => { forceQuit = true; app.quit() })

app.commandLine.appendSwitch('disable-renderer-backgrounding')

app.whenReady().then(async () => {
  await readSettings()
  applyLoginSetting()
  await startBridge()
  createTray()
  await createWindow()
  globalShortcut.register('Alt+Space', () => {
    if (windowRef?.isVisible()) hideWindow()
    else showWindow()
  })
})

app.on('window-all-closed', (event) => {
  event.preventDefault()
})

app.on('before-quit', () => {
  forceQuit = true
  globalShortcut.unregisterAll()
  stopBridge()
  tray?.destroy()
})
