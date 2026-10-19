/**
 * Desktop development launcher.
 *
 * Vite owns the renderer and Electron owns the native window/tray. The Electron
 * main process starts the bridge so `npm run desktop` is the only command needed
 * during development.
 */
import { spawn } from 'node:child_process'
import process from 'node:process'
import { resolve } from 'node:path'

const port = Number(process.env.PORT ?? 5173)
const viteCommand = process.execPath
const viteArgs = [resolve('node_modules', 'vite', 'bin', 'vite.js')]
const electronCommand = process.platform === 'win32'
  ? resolve('node_modules', 'electron', 'dist', 'electron.exe')
  : resolve('node_modules', '.bin', 'electron')
const children = []
let stopping = false

function run(command, args, env = {}) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: false,
  })
  children.push(child)
  return child
}

const vite = run(viteCommand, [...viteArgs, '--host', '127.0.0.1', '--port', String(port)])
const electron = run(electronCommand, ['electron/main.mjs'], {
  ELECTRON_START_URL: `http://127.0.0.1:${port}`,
  JARVIS_NODE_PATH: process.execPath,
})

function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    try {
      child.kill()
    } catch {
      // The process may already have exited.
    }
  }
  setTimeout(() => process.exit(code), 250)
}

vite.on('exit', (code) => shutdown(code ?? 0))
electron.on('exit', (code) => shutdown(code ?? 0))
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
