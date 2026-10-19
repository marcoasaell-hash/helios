import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, parse, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { z } from 'zod'

const APP_ALIASES = {
  calculator: 'calc.exe',
  calc: 'calc.exe',
  notepad: 'notepad.exe',
  paint: 'mspaint.exe',
  explorer: 'explorer.exe',
  files: 'explorer.exe',
  chrome: 'chrome.exe',
  edge: 'msedge.exe',
  vscode: 'code.exe',
  'visual studio code': 'code.exe',
  whatsapp: 'WhatsApp.exe',
  outlook: 'outlook.exe',
}

const ok = (text, extra = {}) => ({ content: [{ type: 'text', text }], ...extra })
const fail = (text) => ({ isError: true, content: [{ type: 'text', text }] })

function cleanPath(value) {
  const raw = String(value ?? '').trim()
  if (!raw) throw new Error('A path is required.')
  const expanded = raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')
    ? join(homedir(), raw.slice(2))
    : raw
  return resolve(expanded)
}

function protectRoot(target) {
  const absolute = cleanPath(target)
  if (absolute === parse(absolute).root || absolute === resolve(homedir())) {
    throw new Error('That location is too broad for a single desktop action.')
  }
  return absolute
}

function detach(command, args = []) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', () => {})
  child.unref()
}

function openTarget(target) {
  const value = String(target ?? '').trim()
  if (!value) throw new Error('An application, file, or URL is required.')

  if (platform() === 'win32') {
    // `start` is the Windows-native way to open files, .lnk shortcuts and URLs
    // with the user's default handler. The empty title is required by cmd.exe.
    detach('cmd.exe', ['/d', '/c', 'start', '', value])
    return
  }
  detach(platform() === 'darwin' ? 'open' : 'xdg-open', [value])
}

function openApplication(name, args = []) {
  const raw = String(name ?? '').trim()
  if (!raw) throw new Error('An application name is required.')
  const alias = APP_ALIASES[raw.toLowerCase()]
  if (alias) {
    detach(alias, Array.isArray(args) ? args.map(String) : [])
    return alias
  }
  if (isAbsolute(raw) || extname(raw)) {
    detach(raw, Array.isArray(args) ? args.map(String) : [])
    return raw
  }
  openTarget(raw)
  return raw
}

async function listDirectory(directory) {
  const target = cleanPath(directory || homedir())
  const entries = await readdir(target, { withFileTypes: true })
  return entries
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, 200)
    .map((entry) => `${entry.isDirectory() ? '[DIR] ' : '      '}${entry.name}`)
}

async function searchFiles(directory, query, maxResults = 50) {
  const root = cleanPath(directory || homedir())
  const wanted = String(query ?? '').toLowerCase()
  if (!wanted) throw new Error('A file name or search term is required.')
  const results = []
  const ignored = new Set(['node_modules', '.git', 'AppData\\Local\\Temp'])

  async function walk(current, depth) {
    if (depth > 8 || results.length >= maxResults) return
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= maxResults) return
      if (entry.name.startsWith('.') || ignored.has(entry.name)) continue
      const full = join(current, entry.name)
      if (entry.name.toLowerCase().includes(wanted)) results.push(full)
      if (entry.isDirectory()) await walk(full, depth + 1)
    }
  }
  await walk(root, 0)
  return results
}

function canReadText(info, target) {
  const ext = extname(target).toLowerCase()
  const binary = new Set(['.exe', '.dll', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.mp4', '.zip', '.pdf'])
  return info.size <= 2 * 1024 * 1024 && !binary.has(ext)
}

export function desktopServer({ allowWrites = false } = {}) {
  const tools = [
    tool(
      'desktop_list_directory',
      'List a local folder. Use this before changing files when the exact name is uncertain.',
      { path: z.string().optional().catch('') },
      async (args) => {
        try {
          const lines = await listDirectory(args.path)
          return ok(lines.length ? lines.join('\n') : 'The folder is empty.')
        } catch (error) {
          return fail(`Could not list that folder: ${error.message}`)
        }
      },
    ),
    tool(
      'desktop_search_files',
      'Search local file and folder names. Returns paths, not file contents.',
      {
        query: z.string(),
        path: z.string().optional().catch(''),
        max_results: z.union([z.number(), z.string()]).optional().catch(50),
      },
      async (args) => {
        try {
          const found = await searchFiles(args.path, args.query, Number(args.max_results) || 50)
          return ok(found.length ? found.join('\n') : 'No matching files were found.')
        } catch (error) {
          return fail(`Could not search files: ${error.message}`)
        }
      },
    ),
    tool(
      'desktop_read_file',
      'Read a small text file from this computer. Use it to answer questions about local notes, documents, or code.',
      { path: z.string() },
      async (args) => {
        try {
          const target = cleanPath(args.path)
          const info = await stat(target)
          if (!info.isFile()) return fail('That path is not a file.')
          if (!canReadText(info, target)) return fail('That file is binary or too large for a text read.')
          return ok(await readFile(target, 'utf8'))
        } catch (error) {
          return fail(`Could not read that file: ${error.message}`)
        }
      },
    ),
  ]

  if (allowWrites) {
    tools.push(
      tool(
        'desktop_open_app',
        'Open a Windows application by name. Common names include Chrome, Edge, WhatsApp, Outlook, Calculator, Notepad, Paint, Explorer, and VS Code.',
        {
          app: z.string(),
          args: z.array(z.string()).optional().catch([]),
        },
        async (args) => {
          try {
            const opened = openApplication(args.app, args.args)
            return ok(`Opened ${opened}.`)
          } catch (error) {
            return fail(`Could not open that application: ${error.message}`)
          }
        },
      ),
      tool(
        'desktop_open_url',
        'Open a web address in the user\'s default browser. Use this when they explicitly ask to open a search or page.',
        { url: z.string() },
        async (args) => {
          try {
            const url = new URL(args.url)
            if (!['http:', 'https:'].includes(url.protocol)) return fail('Only web URLs can be opened.')
            openTarget(url.href)
            return ok('Opened the page in the default browser.')
          } catch (error) {
            return fail(`Could not open that URL: ${error.message}`)
          }
        },
      ),
      tool(
        'desktop_open_file',
        'Open a local file or folder with its Windows default application.',
        { path: z.string() },
        async (args) => {
          try {
            const target = cleanPath(args.path)
            openTarget(target)
            return ok(`Opened ${basename(target)}.`)
          } catch (error) {
            return fail(`Could not open that path: ${error.message}`)
          }
        },
      ),
      tool(
        'desktop_write_file',
        'Create or overwrite a UTF-8 text file. Create parent folders when needed.',
        { path: z.string(), content: z.string() },
        async (args) => {
          try {
            const target = cleanPath(args.path)
            await mkdir(dirname(target), { recursive: true })
            await writeFile(target, args.content, 'utf8')
            return ok(`Saved ${basename(target)}.`)
          } catch (error) {
            return fail(`Could not save that file: ${error.message}`)
          }
        },
      ),
      tool(
        'desktop_delete_file',
        'Delete one local file, or a folder only when recursive is explicitly true. Use the exact path and never guess.',
        { path: z.string(), recursive: z.boolean().optional().catch(false) },
        async (args) => {
          try {
            const target = protectRoot(args.path)
            const info = await stat(target)
            if (info.isDirectory() && !args.recursive) return fail('That is a folder. Set recursive true only if the whole folder should be deleted.')
            await rm(target, { recursive: Boolean(args.recursive), force: false })
            return ok(`Deleted ${basename(target)}.`)
          } catch (error) {
            return fail(`Could not delete that path: ${error.message}`)
          }
        },
      ),
      tool(
        'desktop_create_folder',
        'Create a local folder and any missing parent folders.',
        { path: z.string() },
        async (args) => {
          try {
            const target = cleanPath(args.path)
            await mkdir(target, { recursive: true })
            return ok(`Folder ready: ${basename(target)}.`)
          } catch (error) {
            return fail(`Could not create that folder: ${error.message}`)
          }
        },
      ),
      tool(
        'desktop_move_file',
        'Move or rename a local file or folder.',
        { from: z.string(), to: z.string() },
        async (args) => {
          try {
            await rename(cleanPath(args.from), cleanPath(args.to))
            return ok(`Moved ${basename(args.from)}.`)
          } catch (error) {
            return fail(`Could not move that item: ${error.message}`)
          }
        },
      ),
      tool(
        'desktop_copy_file',
        'Copy a local file to another path.',
        { from: z.string(), to: z.string() },
        async (args) => {
          try {
            const target = cleanPath(args.to)
            await mkdir(dirname(target), { recursive: true })
            await copyFile(cleanPath(args.from), target)
            return ok(`Copied ${basename(args.from)}.`)
          } catch (error) {
            return fail(`Could not copy that item: ${error.message}`)
          }
        },
      ),
    )
  }

  return createSdkMcpServer({
    name: 'jarvis_desktop',
    version: '1.0.0',
    alwaysLoad: true,
    instructions:
      'Local Windows desktop tools. Read/list/search are available for local files. ' +
      (allowWrites
        ? 'Open, save, move, copy, create, and delete actions are enabled. Use exact paths and never guess a destructive target.'
        : 'Actions that change the computer are disabled.'),
    tools,
  })
}
