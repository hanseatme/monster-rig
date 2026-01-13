const { contextBridge, ipcRenderer } = require('electron')

const electronAPI = {
  // Dialogs
  openModelDialog: () => ipcRenderer.invoke('dialog:open-model'),
  saveProjectDialog: () => ipcRenderer.invoke('dialog:save-project'),
  exportGLBDialog: () => ipcRenderer.invoke('dialog:export-glb'),

  // File System
  readFile: (filePath: string) => ipcRenderer.invoke('fs:read-file', filePath),
  readFileText: (filePath: string) => ipcRenderer.invoke('fs:read-file-text', filePath),
  writeFile: (filePath: string, data: string | Buffer) => ipcRenderer.invoke('fs:write-file', filePath, data),
  fileExists: (filePath: string) => ipcRenderer.invoke('fs:file-exists', filePath),

  // Path
  dirname: (filePath: string) => ipcRenderer.invoke('path:dirname', filePath),
  joinPath: (...paths: string[]) => ipcRenderer.invoke('path:join', ...paths),
  relativePath: (from: string, to: string) => ipcRenderer.invoke('path:relative', from, to),

  // API Key Config
  setApiKey: (provider: string, apiKey: string) => ipcRenderer.invoke('config:set-api-key', provider, apiKey),
  getApiKey: (provider: string) => ipcRenderer.invoke('config:get-api-key', provider),
  hasApiKey: (provider: string) => ipcRenderer.invoke('config:has-api-key', provider),
  deleteApiKey: (provider: string) => ipcRenderer.invoke('config:delete-api-key', provider),

  // Menu Events
  onNewProject: (callback: () => void) => ipcRenderer.on('menu:new-project', callback),
  onSave: (callback: () => void) => ipcRenderer.on('menu:save', callback),
  onUndo: (callback: () => void) => ipcRenderer.on('menu:undo', callback),
  onRedo: (callback: () => void) => ipcRenderer.on('menu:redo', callback),
  onDelete: (callback: () => void) => ipcRenderer.on('menu:delete', callback),
  onToggleWireframe: (callback: () => void) => ipcRenderer.on('menu:toggle-wireframe', callback),
  onToggleGrid: (callback: () => void) => ipcRenderer.on('menu:toggle-grid', callback),
  onToggleBones: (callback: () => void) => ipcRenderer.on('menu:toggle-bones', callback),
  onFocusSelected: (callback: () => void) => ipcRenderer.on('menu:focus-selected', callback),
  onAddBone: (callback: () => void) => ipcRenderer.on('menu:add-bone', callback),
  onAutoSuggestBones: (callback: () => void) => ipcRenderer.on('menu:auto-suggest-bones', callback),
  onMirrorBones: (callback: () => void) => ipcRenderer.on('menu:mirror-bones', callback),
  onCalculateWeights: (callback: () => void) => ipcRenderer.on('menu:calculate-weights', callback),
  onWeightPaintMode: (callback: () => void) => ipcRenderer.on('menu:weight-paint-mode', callback),
  onNewAnimation: (callback: () => void) => ipcRenderer.on('menu:new-animation', callback),
  onInsertKeyframe: (callback: () => void) => ipcRenderer.on('menu:insert-keyframe', callback),
  onDeleteKeyframe: (callback: () => void) => ipcRenderer.on('menu:delete-keyframe', callback),
  onPlayPause: (callback: () => void) => ipcRenderer.on('menu:play-pause', callback),
  onShowShortcuts: (callback: () => void) => ipcRenderer.on('menu:show-shortcuts', callback),
  onShowAbout: (callback: () => void) => ipcRenderer.on('menu:show-about', callback),
  onShowSettings: (callback: () => void) => ipcRenderer.on('menu:show-settings', callback),
  onAIGenerateAnimation: (callback: () => void) => ipcRenderer.on('menu:ai-generate-animation', callback),

  // File Events
  onProjectOpened: (callback: (data: { filePath: string; content: string }) => void) => ipcRenderer.on('file:project-opened', (_: any, data: any) => callback(data)),
  onModelImported: (callback: (data: { filePath: string }) => void) => ipcRenderer.on('file:model-imported', (_: any, data: any) => callback(data)),
  onSaveAs: (callback: (data: { filePath: string }) => void) => ipcRenderer.on('file:save-as', (_: any, data: any) => callback(data)),
  onExportGLB: (callback: (data: { filePath: string }) => void) => ipcRenderer.on('file:export-glb', (_: any, data: any) => callback(data)),

  // Cleanup
  removeAllListeners: () => {
    const events = [
      'menu:new-project', 'menu:save', 'menu:undo', 'menu:redo', 'menu:delete',
      'menu:toggle-wireframe', 'menu:toggle-grid', 'menu:toggle-bones', 'menu:focus-selected',
      'menu:add-bone', 'menu:auto-suggest-bones', 'menu:mirror-bones',
      'menu:calculate-weights', 'menu:weight-paint-mode',
      'menu:new-animation', 'menu:insert-keyframe', 'menu:delete-keyframe', 'menu:play-pause',
      'menu:show-shortcuts', 'menu:show-about', 'menu:show-settings', 'menu:ai-generate-animation',
      'file:project-opened', 'file:model-imported', 'file:save-as', 'file:export-glb'
    ]
    events.forEach((event: string) => ipcRenderer.removeAllListeners(event))
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
