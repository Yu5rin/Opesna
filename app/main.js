'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  desktopCapturer,
  nativeImage,
  Menu,
  screen,
} = require('electron');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const { exec } = require('child_process');

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
  // Default project subfolders
  ['仕事', '個人'].forEach(name => mkdirSafe(path.join(PROJECTS_DIR, name)));

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

// ─── Japanese application menu ───────────────────────────────────────────────
function buildJapaneseMenu() {
  const send = (action) => () => mainWindow && mainWindow.webContents.send('menu-action', action);
  return Menu.buildFromTemplate([
    {
      label: 'ファイル',
      submenu: [
        { label: '新規作成',           accelerator: 'CmdOrCtrl+N',       click: send('new') },
        { label: 'ファイルを開く...', accelerator: 'CmdOrCtrl+O',       click: send('open') },
        { type: 'separator' },
        { label: '保存',               accelerator: 'CmdOrCtrl+S',       click: send('save') },
        { label: '名前を付けて保存...', accelerator: 'CmdOrCtrl+Shift+S', click: send('save-as') },
        { type: 'separator' },
        { label: 'エクスポート...',    accelerator: 'CmdOrCtrl+E',       click: send('export') },
        { type: 'separator' },
        { label: '終了',               accelerator: 'Alt+F4',             role: 'quit' },
      ],
    },
    {
      label: '編集',
      submenu: [
        { label: '元に戻す',   accelerator: 'CmdOrCtrl+Z',       click: send('undo') },
        { label: 'やり直し',   accelerator: 'CmdOrCtrl+Shift+Z', click: send('redo') },
        { type: 'separator' },
        { label: 'ステップを追加', accelerator: 'CmdOrCtrl+Return', click: send('add-step') },
        { type: 'separator' },
        { label: '切り取り',   role: 'cut' },
        { label: 'コピー',     role: 'copy' },
        { label: '貼り付け',   role: 'paste' },
        { label: 'すべて選択', role: 'selectAll' },
      ],
    },
    {
      label: '表示',
      submenu: [
        { label: '拡大',         accelerator: 'CmdOrCtrl+=', click: send('zoom-in') },
        { label: '縮小',         accelerator: 'CmdOrCtrl+-', click: send('zoom-out') },
        { label: '実際のサイズ', accelerator: 'CmdOrCtrl+0', click: send('zoom-reset') },
        { type: 'separator' },
        { label: '全画面表示',   role: 'togglefullscreen' },
        { type: 'separator' },
        { label: '開発者ツール', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'ヘルプ',
      submenu: [
        {
          label: 'Opesna について',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type:    'info',
              title:   'Opesna について',
              message: 'Opesna v1.0.0',
              detail:  '個人向け操作説明資料作成アプリ\nローカル完結型・登録不要\n\n© 2026 Opesna',
            });
          },
        },
      ],
    },
  ]);
}

// ─── Recording mode ───────────────────────────────────────────────────────────
let isRecording          = false;
let recordIndicatorWindow = null;
let capturedSteps        = [];
let uIOhook              = null;

function loadUiohook() {
  try {
    const mod = require('uiohook-napi');
    return mod.uIOhook;
  } catch (_) {
    return null;
  }
}

/** Run a PowerShell command and return stdout. */
function runPS(script) {
  return new Promise((resolve) => {
    exec(
      `powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
      { timeout: 3000 },
      (_err, stdout) => resolve((stdout || '').trim()),
    );
  });
}

/** Get UI element info AND parent window bounds at screen (x, y) via UIAutomation. */
/**
 * Get the window rect (logical pixels) of the window under the cursor at (x, y).
 * x, y are in logical screen coordinates (as reported by uiohook on DPI-unaware Windows).
 * Returns { left, top, width, height } or null.
 */
/**
 * Get both the clicked element's bounding rect AND the window rect at (x, y).
 * x, y are in logical screen coordinates (uiohook + PowerShell share the same space).
 * Returns { bounds: {left,top,width,height}, windowRect: {left,top,width,height} } or null.
 */
async function getElementInfoAt(x, y) {
  if (process.platform !== 'win32') return null;

  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
try {
  $pt = New-Object System.Windows.Point(${Math.round(x)}, ${Math.round(y)})
  $el = [System.Windows.Automation.AutomationElement]::FromPoint($pt)
  if ($el -eq $null) { Write-Output "NULL"; exit }
  $b = $el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::BoundingRectangleProperty)
  $wType  = [System.Windows.Automation.ControlType]::Window
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $cur = $el
  $wl = 0; $wt = 0; $ww = 0; $wh = 0
  for ($i = 0; $i -lt 50; $i++) {
    $t = $cur.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::ControlTypeProperty)
    if ($t -eq $wType) {
      $wb = $cur.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::BoundingRectangleProperty)
      $wl = [int]$wb.Left; $wt = [int]$wb.Top; $ww = [int]$wb.Width; $wh = [int]$wb.Height
      break
    }
    $p = $walker.GetParent($cur)
    if ($p -eq $null) { break }
    $cur = $p
  }
  Write-Output "$([int]$b.Left)|$([int]$b.Top)|$([int]$b.Width)|$([int]$b.Height)|$wl|$wt|$ww|$wh"
} catch { Write-Output "NULL" }
`;

  const tmpPath = path.join(os.tmpdir(), 'opesna_uia.ps1');
  try { fs.writeFileSync(tmpPath, script, 'utf8'); } catch (_) { return null; }

  const out = await new Promise(resolve => {
    exec(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpPath}"`,
      { timeout: 5000 },
      (_err, stdout) => resolve((stdout || '').trim()),
    );
  });
  if (!out || out === 'NULL' || out === '') return null;
  const p = out.split('|').map(v => parseInt(v) || 0);
  if (p.length < 8) return null;
  return {
    bounds:     { left: p[0], top: p[1], width: p[2], height: p[3] },
    windowRect: p[6] > 0 ? { left: p[4], top: p[5], width: p[6], height: p[7] } : null,
  };
}

/**
 * Capture full screen at physical resolution. Returns raw capture data for later cropping.
 */
async function captureScreenRaw() {
  const primary = screen.getPrimaryDisplay();
  const sf      = primary.scaleFactor || 1;
  const physW   = Math.round(primary.bounds.width  * sf);
  const physH   = Math.round(primary.bounds.height * sf);

  const sources = await desktopCapturer.getSources({
    types:         ['screen'],
    thumbnailSize: { width: physW, height: physH },
  });
  if (!sources.length) return null;

  const fullImg           = sources[0].thumbnail;
  const { width: CAP_W, height: CAP_H } = fullImg.getSize();
  // scaleX/Y: logical coords → physical image pixels
  const scaleX = CAP_W / (physW / sf);
  const scaleY = CAP_H / (physH / sf);

  return { fullImg, CAP_W, CAP_H, scaleX, scaleY, physW, physH, sf };
}

/**
 * Crop a raw capture to a window rect (with DWM shadow trimming).
 * Falls back to full screen if no windowRect or if window covers >85% of screen.
 */
function cropCapture(raw, windowRect) {
  if (!raw) return null;
  const { fullImg, CAP_W, CAP_H, scaleX, scaleY, physW, physH, sf } = raw;

  if (windowRect && windowRect.width > 50 && windowRect.height > 50) {
    const logW     = physW / sf;
    const logH     = physH / sf;
    const coverage = (windowRect.width * windowRect.height) / (logW * logH);
    if (coverage < 0.85) {
      const SHADOW   = 8; // DWM invisible shadow (logical px)
      const adjLeft  = windowRect.left   + SHADOW;
      const adjTop   = windowRect.top    + SHADOW;
      const adjW     = windowRect.width  - SHADOW * 2;
      const adjH     = windowRect.height - SHADOW * 2;

      const cx = Math.max(0, Math.round(adjLeft * scaleX));
      const cy = Math.max(0, Math.round(adjTop  * scaleY));
      const cw = Math.min(CAP_W - cx, Math.round(adjW * scaleX));
      const ch = Math.min(CAP_H - cy, Math.round(adjH * scaleY));

      if (cw > 20 && ch > 20) {
        const cropped = fullImg.crop({ x: cx, y: cy, width: cw, height: ch });
        return { dataUrl: cropped.toDataURL(), imgWidth: cw, imgHeight: ch,
                 scaleX, scaleY, cropOffsetX: cx, cropOffsetY: cy };
      }
    }
  }

  return { dataUrl: fullImg.toDataURL(), imgWidth: CAP_W, imgHeight: CAP_H,
           scaleX, scaleY, cropOffsetX: 0, cropOffsetY: 0 };
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  ensureDirs();
  createWindow();
  Menu.setApplicationMenu(buildJapaneseMenu());

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
function scanProjectsInDir(dir, folderName) {
  const results = [];
  try {
    fs.readdirSync(dir).filter(f => f.endsWith('.opn')).forEach(f => {
      const filePath = path.join(dir, f);
      try {
        const stat = fs.statSync(filePath);
        const data = readJSON(filePath, {});
        const name = data.name || data.title || path.basename(f, '.opn');
        results.push({
          filePath,
          fileName:  f,
          name,
          title:     name,
          folder:    folderName,
          category:  folderName || data.category || null,
          steps:     Array.isArray(data.steps) ? data.steps.length : 0,
          stepCount: Array.isArray(data.steps) ? data.steps.length : 0,
          updatedAt: stat.mtimeMs,
          modified:  data.savedAt ? new Date(data.savedAt).getTime() : stat.mtimeMs,
        });
      } catch (_) {}
    });
  } catch (_) {}
  return results;
}

ipcMain.handle('get-projects', () => {
  try {
    const all = [...scanProjectsInDir(PROJECTS_DIR, '')];
    // Scan all subdirectories
    fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .forEach(d => {
        all.push(...scanProjectsInDir(path.join(PROJECTS_DIR, d.name), d.name));
      });
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    return all;
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

// ─── IPC: Project folders ────────────────────────────────────────────────────
ipcMain.handle('get-project-folders', () => {
  try {
    return fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort((a, b) => a.localeCompare(b, 'ja'));
  } catch { return []; }
});

ipcMain.handle('create-project-folder', (_event, name) => {
  const safe = (name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!safe) return { ok: false, error: 'Invalid name' };
  try {
    mkdirSafe(path.join(PROJECTS_DIR, safe));
    return { ok: true, name: safe };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ─── IPC: Open project by path (for recent files) ────────────────────────────
ipcMain.handle('open-project-by-path', async (_event, filePath) => {
  try {
    const data = readJSON(filePath, null);
    if (!data) return null;
    return { filePath, data };
  } catch (err) {
    console.error('open-project-by-path error:', err);
    return null;
  }
});

// ─── IPC: Save project via dialog ────────────────────────────────────────────
ipcMain.handle('save-project-dialog', async (_event, { data, folder } = {}) => {
  const rawName   = (data && (data.name || data.title)) || '無題';
  const defaultName = rawName.replace(/[\\/:*?"<>|]/g, '_') + '.opn';
  const saveDir   = folder ? path.join(PROJECTS_DIR, folder) : PROJECTS_DIR;
  if (folder) mkdirSafe(saveDir);

  const result = await dialog.showSaveDialog(mainWindow, {
    title:       'プロジェクトを保存',
    defaultPath: path.join(saveDir, defaultName),
    filters:     [{ name: 'Opesna Project', extensions: ['opn'] }],
  });
  if (result.canceled || !result.filePath) return null;

  try {
    writeJSON(result.filePath, data);
    return result.filePath;
  } catch (err) {
    console.error('save-project-dialog error:', err);
    return null;
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

// ─── IPC: Window controls ─────────────────────────────────────────────────────
ipcMain.handle('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.handle('window-close', () => { if (mainWindow) mainWindow.close(); });

// ─── IPC: Confirmation dialog (unsaved changes, delete, etc.) ─────────────────
ipcMain.handle('show-confirm-dialog', async (_event, { title, message, detail, buttons }) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type:    'warning',
    title:   title   || '確認',
    message: message || '続行しますか？',
    detail:  detail  || '',
    buttons: buttons || ['はい', 'いいえ', '取消し'],
    defaultId: 0,
    cancelId:  2,
    noLink: true,
  });
  return result.response; // 0=はい, 1=いいえ, 2=取消し
});

// ─── IPC: Recording ──────────────────────────────────────────────────────────
ipcMain.handle('start-recording', async () => {
  if (isRecording) return false;
  isRecording   = true;
  capturedSteps = [];

  // Minimize main window
  if (mainWindow) mainWindow.minimize();

  // Create floating indicator
  recordIndicatorWindow = new BrowserWindow({
    width:       200,
    height:      60,
    frame:       false,
    alwaysOnTop: true,
    transparent: true,
    resizable:   false,
    skipTaskbar: false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  });
  recordIndicatorWindow.loadFile(path.join(__dirname, 'recording-indicator.html'));
  // Position bottom-right
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  recordIndicatorWindow.setPosition(sw - 220, sh - 80);

  // Load uiohook
  uIOhook = loadUiohook();
  if (!uIOhook) {
    // uiohook unavailable: notify renderer to use manual mode
    if (mainWindow) mainWindow.webContents.send('recording-no-hook');
    return 'no-hook';
  }

  let lastCapture   = 0;
  let isCapturing   = false;
  let lastClickX    = -9999;
  let lastClickY    = -9999;
  let lastClickTime = 0;
  const DEBOUNCE     = 800; // ms between captures
  const DBL_MS       = 400; // double-click detection window (ms)
  const DBL_PX       = 20;  // double-click max distance (logical px)

  // uIOhook is a singleton — remove old listeners to prevent duplicate steps on re-recording
  uIOhook.removeAllListeners('mousedown');

  async function handleClick(x, y, clickType) {
    // Skip if clicking our indicator
    if (recordIndicatorWindow && !recordIndicatorWindow.isDestroyed()) {
      const b = recordIndicatorWindow.getBounds();
      if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return;
    }

    const now = Date.now();
    const nearLast = Math.abs(x - lastClickX) < DBL_PX && Math.abs(y - lastClickY) < DBL_PX;

    // Left-click double-click detection: second click near same position while capture runs
    if (clickType === 'left' && isCapturing && nearLast && (now - lastClickTime) < DBL_MS) {
      if (capturedSteps.length > 0) {
        const last = capturedSteps[capturedSteps.length - 1];
        last.title       = '左ダブルクリックする';
        last.description = '左ダブルクリックする';
        // Notify renderer of the title update
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('step-title-update', { id: last.id, title: last.title });
        }
      }
      return;
    }

    if (isCapturing) return;
    if (now - lastCapture < DEBOUNCE) return;

    lastCapture   = now + 8000;
    isCapturing   = true;
    lastClickX    = x;
    lastClickY    = y;
    lastClickTime = now;

    try {
      // Screenshot and UIAutomation run in parallel.
      // Screenshot fires immediately (before UI responds to click) to capture PRE-click state.
      const [raw, elementInfo] = await Promise.all([
        captureScreenRaw(),
        getElementInfoAt(x, y),
      ]);
      if (!raw) return;

      // Crop to the window the user clicked in
      const capture = cropCapture(raw, elementInfo?.windowRect);
      if (!capture) return;

      const { scaleX, scaleY, cropOffsetX, cropOffsetY, imgWidth, imgHeight } = capture;
      const annColor = clickType === 'right' ? '#7f3fbf' : '#c0392b';

      // Build rectangle annotation around the clicked element.
      // Falls back to a small rect at click position if element bounds unavailable.
      let ann;
      const eb = elementInfo?.bounds;
      if (eb && eb.width > 4 && eb.height > 4) {
        ann = {
          id:          Math.random().toString(36).slice(2),
          type:        'rect',
          x:           eb.left                * scaleX - cropOffsetX,
          y:           eb.top                 * scaleY - cropOffsetY,
          x2:          (eb.left + eb.width)   * scaleX - cropOffsetX,
          y2:          (eb.top  + eb.height)  * scaleY - cropOffsetY,
          color:       annColor,
          strokeWidth: 3,
          opacity:     1.0,
        };
      } else {
        const ax = x * scaleX - cropOffsetX;
        const ay = y * scaleY - cropOffsetY;
        const r  = 30;
        ann = {
          id:          Math.random().toString(36).slice(2),
          type:        'rect',
          x:           ax - r, y: ay - r,
          x2:          ax + r, y2: ay + r,
          color:       annColor,
          strokeWidth: 3,
          opacity:     1.0,
        };
      }

      const title = clickType === 'right' ? '右クリックする' : '左クリックする';
      const step  = {
        id:           Math.random().toString(36).slice(2),
        title,
        description:  title,
        imageDataUrl: capture.dataUrl,
        imageWidth:   imgWidth,
        imageHeight:  imgHeight,
        annotations:  [ann],
      };
      capturedSteps.push(step);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('step-captured', step);
      }
      if (recordIndicatorWindow && !recordIndicatorWindow.isDestroyed()) {
        recordIndicatorWindow.webContents.send('step-count', capturedSteps.length);
      }
    } finally {
      lastCapture = Date.now();
      isCapturing = false;
    }
  }

  uIOhook.on('mousedown', (event) => {
    if (!isRecording) return;
    const { x, y, button } = event;
    if (button === 1) handleClick(x, y, 'left');
    if (button === 2) handleClick(x, y, 'right');
  });

  // Notify renderer that recording has started (so it can prepare the project)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('recording-start');
  }

  uIOhook.start();
  return true;
});

ipcMain.handle('stop-recording', async () => {
  isRecording = false;

  if (uIOhook) {
    try { uIOhook.stop(); } catch (_) {}
    uIOhook = null;
  }

  if (recordIndicatorWindow && !recordIndicatorWindow.isDestroyed()) {
    recordIndicatorWindow.close();
    recordIndicatorWindow = null;
  }

  if (mainWindow) {
    mainWindow.restore();
    mainWindow.focus();
  }

  const count   = capturedSteps.length;
  capturedSteps = [];

  // Steps are already sent in real-time; just notify with final count
  if (mainWindow) mainWindow.webContents.send('recording-finished', count);

  return count;
});

ipcMain.handle('get-cursor-pos', () => screen.getCursorScreenPoint());
