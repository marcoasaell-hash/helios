export {}

declare global {
  interface Window {
    jarvisDesktop?: {
      isDesktop: boolean
      getSettings: () => Promise<{
        minimizeToTray: boolean
        launchAtLogin: boolean
        memoryEnabled: boolean
        dataPath: string
        writesEnabled: boolean
        voiceId: string
      }>
      setSetting: (key: string, value: boolean) => Promise<Record<string, boolean>>
      openDataFolder: () => Promise<string>
      showWindow: () => Promise<void>
      hideWindow: () => Promise<void>
      quit: () => Promise<void>
    }
  }
}
