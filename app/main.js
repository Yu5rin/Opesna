'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  desktopCapturer,
  nativeImage,
} = require('electron');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

// ─── Root resolution (portable ZIP support) ──────────────────────────────────
// PORTABLE_EXECUTABLE_DIR is set by Electron when built as NSIS portable.
// For ZIP distribution: use the directory containing the exe.
// For development: use project root (parent of app/).
const ROOT = process.env.PORTABLE_EXECUTABLE_DIR
  ? process.env.PORTABLE_EXECUTABLE_DIR
  : app.isPackaged
    ? path.dirname(process.execPath)
    : path.join(__dirname, '..');

const CONFIG_DIR    = path.join(ROOT, 'config');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const DATA_DIR      = path.join(ROOT, 'data');
const PROJECTS_DIR  = path.join(DATA_DIR, 'projects');
const EXPORTS_DIR   = path.join(DATA_DIR, 'exports');
const BACKUPS_DIR   = path.join(DATA_DIR, 'backups');

const SETTINGS_FILE  = path.join(CONFIG_DIR, 'settings.json');
const SHORTCUTS_FILE = path.join(CONFIG_DIR, 'shortcuts.json');
const RECENT_FILE    = path.join(CONFIG_DIR, 'recent.json');

// ─── Default data ─────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  version:      '1.0',
  language:     'ja',
  theme:        'light',
  defaultZoom:  100,
  autoSave:     true,
  autoSaveMin:  5,
  saveDir:      './data/projects',
  exportDir:    './data/exports',
  cursor:       true,
  captureDelay: 0,
  autoAddStep:  true,
  backup:       false,
};

const DEFAULT_SHORTCUTS = {
  capture:          'Ctrl+Shift+S',
  save:             'Ctrl+S',
  open:             'Ctrl+O',
  newProject:       'Ctrl+N',
  undo:             'Ctrl+Z',
  redo:             'Ctrl+Shift+Z',
  export:           'Ctrl+E',
  addStep:          'Ctrl+Enter',
  deleteAnnotation: 'Delete',
  selectTool:       'V',
  arrowTool:        'A',
  rectTool:         'R',
  ellipseTool:      'E',
  calloutTool:      'B',
  textTool:         'T',
  highlightTool:    'H',
  mosaicTool:       'M',
  badgeTool:        'N',
  trimTool:         'Ctrl+T',
  zoomIn:           'Ctrl+Equal',
  zoomOut:          'Ctrl+Minus',
  zoomReset:        'Ctrl+0',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create directory if it does not exist (recursive). */
function mkdirSafe(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Read a JSON file; return fallback on any error. */
function readJSON(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

/** Write a JSON file atomically (write to tmp, rename). */
function writeJSON(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

/** Ensure all required directories and seed config files exist. */
function ensureDirs() {
  mkdirSafe(CONFIG_DIR);
  mkdirSafe(TEMPLATES_DIR);
  mkdirSafe(DATA_DIR);
  mkdirSafe(PROJECTS_DIR);
  mkdirSafe(EXPORTS_DIR);
  mkdirSafe(BACKUPS_DIR);

  if (!fs.existsSync(SETTINGS_FILE)) {
    writeJSON(SETTINGS_FILE, DEFAULT_SETTINGS);
  }
  if (!fs.existsSync(SHORTCUTS_FILE)) {
    writeJSON(SHORTCUTS_FILE, DEFAULT_SHORTCUTS);
  }
  if (!fs.existsSync(RECENT_FILE)) {
    writeJSON(RECENT_FILE, []);
  }
}

// ─── Window ───────────────────────────────────────────────────────────────────
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:     1400,
    height:    900,
    minWidth:  1000,
    minHeight: 600,
    frame:     true,
    show:      false,
    webPreferences: {
      preload:             path.join(__dirname, 'preload.js'),
      contextIsolation:    true,
      nodeIntegration:     false,
      sandbox:             false,
      webSecurity:         true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  ensureDirs();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC: Settings ────────────────────────────────────────────────────────────
ipcMain.handle('get-settings', () => {
  const stored = readJSON(SETTINGS_FILE, {});
  return Object.assign({}, DEFAULT_SETTINGS, stored);
});

ipcMain.handle('save-settings', (_event, settings) => {
  writeJSON(SETTINGS_FILE, settings);
  return true;
});

// ─── IPC: Shortcuts ───────────────────────────────────────────────────────────
ipcMain.handle('get-shortcuts', () => {
  const stored = readJSON(SHORTCUTS_FILE, {});
  return Object.assign({}, DEFAULT_SHORTCUTS, stored);
});

ipcMain.handle('save-shortcuts', (_event, shortcuts) => {
  writeJSON(SHORTCUTS_FILE, shortcuts);
  return true;
});

// ─── IPC: Recent files ────────────────────────────────────────────────────────
ipcMain.handle('get-recent', () => {
  return readJSON(RECENT_FILE, []);
});

ipcMain.handle('add-recent', (_event, filePath) => {
  let list = readJSON(RECENT_FILE, []);
  // Remove existing entry for this path, then add to front
  list = list.filter((p) => p !== filePath);
  list.unshift(filePath);
  // Keep last 20
  if (list.length > 20) list = list.slice(0, 20);
  // Remove paths that no longer exist
  list = list.filter((p) => fs.existsSync(p));
  writeJSON(RECENT_FILE, list);
  return list;
});

// ─── IPC: Templates ───────────────────────────────────────────────────────────
ipcMain.handle('get-templates', () => {
  try {
    const files = fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
      return readJSON(path.join(TEMPLATES_DIR, f), null);
    }).filter(Boolean);
  } catch (err) {
    console.error('get-templates error:', err);
    return [];
  }
});

// ─── IPC: Projects ────────────────────────────────────────────────────────────
ipcMain.handle('get-projects', () => {
  try {
    const files = fs.readdirSync(PROJECTS_DIR).filter((f) => f.endsWith('.opn'));
    const projects = files.map((f) => {
      const filePath = path.join(PROJECTS_DIR, f);
      try {
        const stat = fs.statSync(filePath);
        const data = readJSON(filePath, {});
        return {
          filePath,
          fileName:   f,
          title:      data.title || path.basename(f, '.opn'),
          stepCount:  Array.isArray(data.steps) ? data.steps.length : 0,
          updatedAt:  stat.mtimeMs,
          createdAt:  stat.birthtimeMs || stat.ctimeMs,
        };
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
    // Sort newest first
    projects.sort((a, b) => b.updatedAt - a.updatedAt);
    return projects;
  } catch (err) {
    console.error('get-projects error:', err);
    return [];
  }
});

// ─── IPC: Save project (overwrite known path) ─────────────────────────────────
ipcMain.handle('save-project', (_event, { filePath, data }) => {
  try {
    writeJSON(filePath, data);
    return { ok: true, filePath };
  } catch (err) {
    console.error('save-project error:', err);
    return { ok: false, error: err.message };
  }
});

// ─── IPC: Open project via dialog ────────────────────────────────────────────
ipcMain.handle('open-project-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title:       'プロジェクトを開く',
    defaultPath: PROJECTS_DIR,
    filters:     [{ name: 'Opesna Project', extensions: ['opn'] }],
    properties:  ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  try {
    const data = readJSON(filePath, null);
    if (!data) throw new Error('Invalid project file');
    return { filePath, data };
  } catch (err) {
    console.error('open-project-dialog error:', err);
    return null;
  }
});

// ─── IPC: Save project via dialog ────────────────────────────────────────────
ipcMain.handle('save-project-dialog', async (_event, data) => {
  const defaultName = (data && data.title)
    ? data.title.replace(/[\\/:*?"<>|]/g, '_') + '.opn'
    : 'untitled.opn';

  const result = await dialog.showSaveDialog(mainWindow, {
    title:       'プロジェクトを保存',
    defaultPath: path.join(PROJECTS_DIR, defaultName),
    filters:     [{ name: 'Opesna Project', extensions: ['opn'] }],
  });
  if (result.canceled || !result.filePath) return null;

  try {
    writeJSON(result.filePath, data);
    return { ok: true, filePath: result.filePath };
  } catch (err) {
    console.error('save-project-dialog error:', err);
    return { ok: false, error: err.message };
  }
});

// ─── IPC: Delete project ─────────────────────────────────────────────────────
ipcMain.handle('delete-project', (_event, filePath) => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { ok: true };
  } catch (err) {
    console.error('delete-project error:', err);
    return { ok: false, error: err.message };
  }
});

// ─── IPC: Capture full screen ────────────────────────────────────────────────
ipcMain.handle('capture-screen', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types:             ['screen'],
      thumbnailSize:     { width: 1920, height: 1080 },
      fetchWindowIcons:  false,
    });
    if (sources.length === 0) return null;
    // Use the primary (largest id, or first) source
    const primary = sources[0];
    return primary.thumbnail.toDataURL();
  } catch (err) {
    console.error('capture-screen error:', err);
    return null;
  }
});

// ─── IPC: Capture window list ────────────────────────────────────────────────
ipcMain.handle('capture-window', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types:            ['window'],
      thumbnailSize:    { width: 1280, height: 800 },
      fetchWindowIcons: true,
    });
    return sources
      .filter((s) => s.name && s.name.trim() !== '')
      .map((s) => ({
        id:      s.id,
        name:    s.name,
        dataUrl: s.thumbnail.toDataURL(),
      }));
  } catch (err) {
    console.error('capture-window error:', err);
    return [];
  }
});

// ─── IPC: Import image ───────────────────────────────────────────────────────
ipcMain.handle('import-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title:      '画像を読み込む',
    filters:    [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  try {
    const buf  = fs.readFileSync(filePath);
    const ext  = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return `data:image/${mime};base64,${buf.toString('base64')}`;
  } catch (err) {
    console.error('import-image error:', err);
    return null;
  }
});

// ─── IPC: Export PDF ─────────────────────────────────────────────────────────
ipcMain.handle('export-pdf', async (_event, { html, fileName }) => {
  const defaultName = (fileName || 'export') + '.pdf';
  const result = await dialog.showSaveDialog(mainWindow, {
    title:       'PDFとして保存',
    defaultPath: path.join(EXPORTS_DIR, defaultName),
    filters:     [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return null;

  // Create a hidden BrowserWindow to render the HTML and print to PDF
  const win = new BrowserWindow({
    width:  1200,
    height: 900,
    show:   false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdfData = await win.webContents.printToPDF({
      printBackground:       true,
      pageSize:              'A4',
      landscape:             false,
      marginsType:           1, // minimum margins
    });
    fs.writeFileSync(result.filePath, pdfData);
    return { ok: true, filePath: result.filePath };
  } catch (err) {
    console.error('export-pdf error:', err);
    return { ok: false, error: err.message };
  } finally {
    win.destroy();
  }
});

// ─── IPC: Export HTML ────────────────────────────────────────────────────────
ipcMain.handle('export-html', async (_event, { html, fileName }) => {
  const defaultName = (fileName || 'export') + '.html';
  const result = await dialog.showSaveDialog(mainWindow, {
    title:       'HTMLとして保存',
    defaultPath: path.join(EXPORTS_DIR, defaultName),
    filters:     [{ name: 'HTML', extensions: ['html', 'htm'] }],
  });
  if (result.canceled || !result.filePath) return null;

  try {
    fs.writeFileSync(result.filePath, html, 'utf8');
    return { ok: true, filePath: result.filePath };
  } catch (err) {
    console.error('export-html error:', err);
    return { ok: false, error: err.message };
  }
});

// ─── IPC: Export Markdown ────────────────────────────────────────────────────
ipcMain.handle('export-markdown', async (_event, { markdown, fileName }) => {
  const defaultName = (fileName || 'export') + '.md';
  const result = await dialog.showSaveDialog(mainWindow, {
    title:       'Markdownとして保存',
    defaultPath: path.join(EXPORTS_DIR, defaultName),
    filters:     [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });
  if (result.canceled || !result.filePath) return null;

  try {
    fs.writeFileSync(result.filePath, markdown, 'utf8');
    return { ok: true, filePath: result.filePath };
  } catch (err) {
    console.error('export-markdown error:', err);
    return { ok: false, error: err.message };
  }
});

// ─── IPC: Show item in folder ────────────────────────────────────────────────
ipcMain.handle('show-item-in-folder', (_event, filePath) => {
  try {
    shell.showItemInFolder(filePath);
    return true;
  } catch (err) {
    console.error('show-item-in-folder error:', err);
    return false;
  }
});

// ─── IPC: Set window title ───────────────────────────────────────────────────
ipcMain.on('set-title', (_event, title) => {
  if (mainWindow) mainWindow.setTitle(title || 'Opesna');
});
