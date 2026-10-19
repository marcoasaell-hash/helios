import { useEffect, useState, type FormEvent } from 'react'
import { useStore } from '../store'

type DesktopSettings = {
  minimizeToTray: boolean
  launchAtLogin: boolean
  memoryEnabled: boolean
  dataPath: string
  writesEnabled: boolean
  voiceId: string
}

export function DesktopDock({ onCommand }: { onCommand: (text: string) => void }) {
  const phase = useStore((s) => s.phase)
  const connected = useStore((s) => s.connected)
  const [command, setCommand] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<DesktopSettings | null>(null)

  useEffect(() => {
    const api = window.jarvisDesktop
    if (api) void api.getSettings().then(setSettings)
  }, [])

  if (phase === 'offline' || phase === 'boot') return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const text = command.trim()
    if (!text) return
    onCommand(text)
    setCommand('')
  }

  const updateSetting = async (key: keyof Pick<DesktopSettings, 'minimizeToTray' | 'launchAtLogin' | 'memoryEnabled'>, value: boolean) => {
    const next = await window.jarvisDesktop?.setSetting(key, value)
    if (next) setSettings((current) => (current ? { ...current, ...next } : current))
  }

  return (
    <>
      <div className="desktop-dock">
        <div className="desktop-dock-head">
          <span className="desktop-live" />
          <span className="desktop-dock-title">DESKTOP AGENT</span>
          <span className="desktop-dock-state">{window.jarvisDesktop ? 'NATIVE LINK' : 'BROWSER LINK'}</span>
          <button className="desktop-dock-btn" onClick={() => setSettingsOpen((open) => !open)} aria-label="Open desktop settings">
            ◈
          </button>
        </div>
        <form className="desktop-command" onSubmit={submit}>
          <span className="desktop-command-mark">⌁</span>
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="Type a command or press Space to speak..."
            aria-label="Type a command for JARVIS"
          />
          <button type="submit">SEND</button>
        </form>
        <div className="desktop-dock-meta">
          <span>{settings?.writesEnabled ? 'READ + WRITE' : 'READ ONLY'}</span>
          <span>{settings?.memoryEnabled ? 'MEMORY LOCAL' : 'MEMORY OFF'}</span>
          <span>{connected.length ? `${connected.length} SYSTEMS` : 'BRIDGE READY'}</span>
        </div>
      </div>

      {settingsOpen && (
        <section className="desktop-settings" aria-label="JARVIS desktop settings">
          <div className="desktop-settings-head">
            <div>
              <span className="desktop-settings-kicker">LOCAL CONTROL PLANE</span>
              <h2>Desktop settings</h2>
            </div>
            <button className="desktop-close" onClick={() => setSettingsOpen(false)} aria-label="Close settings">×</button>
          </div>
          <div className="desktop-permission-grid">
            <div className="desktop-permission active"><span />FILE READ</div>
            <div className="desktop-permission active"><span />FILE WRITE</div>
            <div className="desktop-permission active"><span />APP LAUNCH</div>
            <div className="desktop-permission active"><span />BACKGROUND</div>
          </div>
          <label className="desktop-toggle">
            <span><b>Minimise to tray</b><small>Keep JARVIS running when the window closes.</small></span>
            <input type="checkbox" checked={settings?.minimizeToTray ?? true} onChange={(event) => void updateSetting('minimizeToTray', event.target.checked)} />
          </label>
          <label className="desktop-toggle">
            <span><b>Start with Windows</b><small>Launch the agent in the background at sign-in.</small></span>
            <input type="checkbox" checked={settings?.launchAtLogin ?? false} onChange={(event) => void updateSetting('launchAtLogin', event.target.checked)} />
          </label>
          <label className="desktop-toggle">
            <span><b>Remember conversations</b><small>Keep searchable exchanges in local memory.</small></span>
            <input type="checkbox" checked={settings?.memoryEnabled ?? true} onChange={(event) => void updateSetting('memoryEnabled', event.target.checked)} />
          </label>
          <div className="desktop-settings-foot">
            <span>VOICE · {settings?.voiceId ?? 'Iqh4r3CPhQwBblCkKe0a'}</span>
            <button onClick={() => void window.jarvisDesktop?.openDataFolder()}>OPEN DATA FOLDER</button>
          </div>
        </section>
      )}
    </>
  )
}
