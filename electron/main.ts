const { app, BrowserWindow, ipcMain, dialog, Menu, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')

// Config file for storing settings (API keys are encrypted)
const configPath = path.join(app.getPath('userData'), 'config.json')

function loadConfig(): Record<string, any> {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    }
  } catch (e) {
    console.error('Failed to load config:', e)
  }
  return {}
}

function saveConfig(config: Record<string, any>) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
  } catch (e) {
    console.error('Failed to save config:', e)
  }
}

// Disable GPU cache errors on Windows
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
app.commandLine.appendSwitch('disable-software-rasterizer')

let mainWindow: any = null

const isDev = process.env.NODE_ENV !== 'production' || !app.isPackaged

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  createMenu()
}

function createMenu() {
  const template: any[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu:new-project'),
        },
        {
          label: 'Open Project...',
          accelerator: 'CmdOrCtrl+O',
          click: () => handleOpenProject(),
        },
        { type: 'separator' },
        {
          label: 'Import Model...',
          accelerator: 'CmdOrCtrl+I',
          click: () => handleImportModel(),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save'),
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => handleSaveAs(),
        },
        { type: 'separator' },
        {
          label: 'Export GLB...',
          accelerator: 'CmdOrCtrl+E',
          click: () => handleExportGLB(),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWindow?.webContents.send('menu:undo'),
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Y',
          click: () => mainWindow?.webContents.send('menu:redo'),
        },
        { type: 'separator' },
        {
          label: 'Delete',
          accelerator: 'Delete',
          click: () => mainWindow?.webContents.send('menu:delete'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Wireframe',
          click: () => mainWindow?.webContents.send('menu:toggle-wireframe'),
        },
        {
          label: 'Toggle Grid',
          click: () => mainWindow?.webContents.send('menu:toggle-grid'),
        },
        {
          label: 'Toggle Bones',
          click: () => mainWindow?.webContents.send('menu:toggle-bones'),
        },
        { type: 'separator' },
        {
          label: 'Focus Selected',
          click: () => mainWindow?.webContents.send('menu:focus-selected'),
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' },
      ],
    },
    {
      label: 'Rig',
      submenu: [
        {
          label: 'Add Bone',
          click: () => mainWindow?.webContents.send('menu:add-bone'),
        },
        {
          label: 'Auto-Suggest Bones',
          click: () => mainWindow?.webContents.send('menu:auto-suggest-bones'),
        },
        {
          label: 'Mirror Bones (X)',
          click: () => mainWindow?.webContents.send('menu:mirror-bones'),
        },
        { type: 'separator' },
        {
          label: 'Calculate Weights',
          click: () => mainWindow?.webContents.send('menu:calculate-weights'),
        },
        {
          label: 'Weight Paint Mode',
          click: () => mainWindow?.webContents.send('menu:weight-paint-mode'),
        },
      ],
    },
    {
      label: 'Animation',
      submenu: [
        {
          label: 'New Animation',
          click: () => mainWindow?.webContents.send('menu:new-animation'),
        },
        {
          label: 'AI Generate Animation...',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => mainWindow?.webContents.send('menu:ai-generate-animation'),
        },
        { type: 'separator' },
        {
          label: 'Insert Keyframe',
          click: () => mainWindow?.webContents.send('menu:insert-keyframe'),
        },
        {
          label: 'Delete Keyframe',
          click: () => mainWindow?.webContents.send('menu:delete-keyframe'),
        },
        { type: 'separator' },
        {
          label: 'Play/Pause',
          click: () => mainWindow?.webContents.send('menu:play-pause'),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('menu:show-settings'),
        },
        { type: 'separator' },
        {
          label: 'Keyboard Shortcuts',
          click: () => mainWindow?.webContents.send('menu:show-shortcuts'),
        },
        {
          label: 'About Monster Rigger',
          click: () => mainWindow?.webContents.send('menu:show-about'),
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

async function handleOpenProject() {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Monster Rigger Project', extensions: ['mrig'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0]
    const content = fs.readFileSync(filePath, 'utf-8')
    mainWindow?.webContents.send('file:project-opened', { filePath, content })
  }
}

async function handleImportModel() {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'GLTF/GLB Models', extensions: ['glb', 'gltf'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0]
    mainWindow?.webContents.send('file:model-imported', { filePath })
  }
}

async function handleSaveAs() {
  const result = await dialog.showSaveDialog(mainWindow!, {
    filters: [
      { name: 'Monster Rigger Project', extensions: ['mrig'] },
    ],
  })

  if (!result.canceled && result.filePath) {
    mainWindow?.webContents.send('file:save-as', { filePath: result.filePath })
  }
}

async function handleExportGLB() {
  const result = await dialog.showSaveDialog(mainWindow!, {
    filters: [
      { name: 'GLB Model', extensions: ['glb'] },
    ],
  })

  if (!result.canceled && result.filePath) {
    mainWindow?.webContents.send('file:export-glb', { filePath: result.filePath })
  }
}

// IPC Handlers
ipcMain.handle('dialog:open-model', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'GLTF/GLB Models', extensions: ['glb', 'gltf'] },
    ],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:save-project', async () => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    filters: [
      { name: 'Monster Rigger Project', extensions: ['mrig'] },
    ],
  })
  return result.canceled ? null : result.filePath
})

ipcMain.handle('dialog:export-glb', async () => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    filters: [
      { name: 'GLB Model', extensions: ['glb'] },
    ],
  })
  return result.canceled ? null : result.filePath
})

ipcMain.handle('fs:read-file', async (_: any, filePath: string) => {
  return fs.readFileSync(filePath)
})

ipcMain.handle('fs:read-file-text', async (_: any, filePath: string) => {
  return fs.readFileSync(filePath, 'utf-8')
})

ipcMain.handle('fs:write-file', async (_: any, filePath: string, data: string | Buffer) => {
  fs.writeFileSync(filePath, data)
  return true
})

ipcMain.handle('fs:file-exists', async (_: any, filePath: string) => {
  return fs.existsSync(filePath)
})

ipcMain.handle('path:dirname', async (_: any, filePath: string) => {
  return path.dirname(filePath)
})

ipcMain.handle('path:join', async (_: any, ...paths: string[]) => {
  return path.join(...paths)
})

ipcMain.handle('path:relative', async (_: any, from: string, to: string) => {
  return path.relative(from, to)
})

// API Key Storage (encrypted with safeStorage)
ipcMain.handle('config:set-api-key', async (_: any, provider: string, apiKey: string) => {
  try {
    const config = loadConfig()
    // Encrypt the API key if safeStorage is available
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(apiKey)
      config[`${provider}_api_key_encrypted`] = encrypted.toString('base64')
      delete config[`${provider}_api_key`] // Remove unencrypted if exists
    } else {
      // Fallback to plain text storage (less secure)
      config[`${provider}_api_key`] = apiKey
    }
    saveConfig(config)
    return true
  } catch (e) {
    console.error('Failed to save API key:', e)
    return false
  }
})

ipcMain.handle('config:get-api-key', async (_: any, provider: string) => {
  try {
    const config = loadConfig()
    // Try encrypted first
    const encryptedKey = config[`${provider}_api_key_encrypted`]
    if (encryptedKey && safeStorage.isEncryptionAvailable()) {
      const buffer = Buffer.from(encryptedKey, 'base64')
      return safeStorage.decryptString(buffer)
    }
    // Fallback to plain text
    return config[`${provider}_api_key`] || null
  } catch (e) {
    console.error('Failed to get API key:', e)
    return null
  }
})

ipcMain.handle('config:has-api-key', async (_: any, provider: string) => {
  const config = loadConfig()
  return !!(config[`${provider}_api_key_encrypted`] || config[`${provider}_api_key`])
})

ipcMain.handle('config:delete-api-key', async (_: any, provider: string) => {
  const config = loadConfig()
  delete config[`${provider}_api_key_encrypted`]
  delete config[`${provider}_api_key`]
  saveConfig(config)
  return true
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
