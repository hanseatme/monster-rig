interface ElectronAPI {
  // Dialogs
  openModelDialog: () => Promise<string | null>
  saveProjectDialog: () => Promise<string | null>
  exportGLBDialog: () => Promise<string | null>

  // File System
  readFile: (filePath: string) => Promise<ArrayBuffer | Uint8Array | { type: string; data: number[] }>
  readFileText: (filePath: string) => Promise<string>
  writeFile: (filePath: string, data: string | Buffer) => Promise<boolean>
  fileExists: (filePath: string) => Promise<boolean>

  // Path
  dirname: (filePath: string) => Promise<string>
  joinPath: (...paths: string[]) => Promise<string>
  relativePath: (from: string, to: string) => Promise<string>

  // API Key Config
  setApiKey: (provider: string, apiKey: string) => Promise<boolean>
  getApiKey: (provider: string) => Promise<string | null>
  hasApiKey: (provider: string) => Promise<boolean>
  deleteApiKey: (provider: string) => Promise<boolean>

  // Menu Events
  onNewProject: (callback: () => void) => void
  onSave: (callback: () => void) => void
  onUndo: (callback: () => void) => void
  onRedo: (callback: () => void) => void
  onDelete: (callback: () => void) => void
  onToggleWireframe: (callback: () => void) => void
  onToggleGrid: (callback: () => void) => void
  onToggleBones: (callback: () => void) => void
  onFocusSelected: (callback: () => void) => void
  onAddBone: (callback: () => void) => void
  onAutoSuggestBones: (callback: () => void) => void
  onMirrorBones: (callback: () => void) => void
  onCalculateWeights: (callback: () => void) => void
  onWeightPaintMode: (callback: () => void) => void
  onNewAnimation: (callback: () => void) => void
  onInsertKeyframe: (callback: () => void) => void
  onDeleteKeyframe: (callback: () => void) => void
  onPlayPause: (callback: () => void) => void
  onShowShortcuts: (callback: () => void) => void
  onShowAbout: (callback: () => void) => void
  onShowSettings: (callback: () => void) => void
  onAIGenerateAnimation: (callback: () => void) => void

  // File Events
  onProjectOpened: (callback: (data: { filePath: string; content: string }) => void) => void
  onModelImported: (callback: (data: { filePath: string }) => void) => void
  onSaveAs: (callback: (data: { filePath: string }) => void) => void
  onExportGLB: (callback: (data: { filePath: string }) => void) => void

  // Cleanup
  removeAllListeners: () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
