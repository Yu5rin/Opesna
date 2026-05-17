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

/** Get UI element name, control type, and bounding rect at screen (x, y). */
async function getUIElementAt(x, y) {
  if (process.platform !== 'win32') return null;
  const script = `
Add-Type -AssemblyName UIAutomationClient;
try {
  $pt = [System.Windows.Point]::new(${x},${y});
  $el = [System.Windows.Automation.AutomationElement]::FromPoint($pt);
  if ($el) {
    $n  = $el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::NameProperty);
    $ct = $el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::ControlTypeProperty);
    $b  = $el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::BoundingRectangleProperty);
    Write-Output "$n|$($ct.ProgrammaticName)|$($b.Left)|$($b.Top)|$($b.Width)|$($b.Height)"
  }
} catch {}
`.replace(/\n/g, ' ');

  const out = await runPS(script);
  if (!out || out === '') return null;
  const parts = out.split('|');
  if (parts.length < 6) return null;
  return {
    name:        parts[0],
    controlType: parts[1],
    bounds: {
      left:   parseFloat(parts[2]) || 0,
      top:    parseFloat(parts[3]) || 0,
      width:  parseFloat(parts[4]) || 0,
      height: parseFloat(parts[5]) || 0,
    },
  };
}

/** Get title of the currently active foreground window. */
async function getActiveWindowTitle() {
  if (process.platform !== 'win32') return '';
  const out = await runPS(
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | Out-Null; (Get-Process | Where-Object {$_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne ''} | Sort-Object -Property CPU -Descending | Select-Object -First 1).MainWindowTitle`
  );
  return out || '';
}

/** Return bounds of the current foreground window via Win32 GetWindowRect. */
async function getActiveWindowRect() {
  if (process.platform !== 'win32') return null;
  const script = `
Add-Type @"
using System;using System.Runtime.InteropServices;
public class W32Rect{
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
  public struct RECT{public int Left,Top,Right,Bottom;}
}
"@
$h=[W32Rect]::GetForegroundWindow()
$r=New-Object W32Rect+RECT
[W32Rect]::GetWindowRect($h,[ref]$r)|Out-Null
"$($r.Left),$($r.Top),$($r.Right-$r.Left),$($r.Bottom-$r.Top)"
`.trim();
  try {
    const out = await runPS(script);
    const p = out.trim().split(',').map(Number);
    if (p.length === 4 && p[2] > 0 && p[3] > 0) {
      return { left: p[0], top: p[1], width: p[2], height: p[3] };
    }
  } catch (_) {}
  return null;
}

/** Generate a Japanese description of the click action. */
function generateDescription(el) {
  if (!el || !el.name) return 'クリックする';
  const name = el.name;
  const ct   = el.controlType || '';
  if (ct.includes('CheckBox'))    return `「${name}」チェックボックスにチェックを入れる`;
  if (ct.includes('RadioButton')) return `「${name}」を選択する`;
  if (ct.includes('Button'))      return `「${name}」ボタンをクリックする`;
  if (ct.includes('MenuItem'))    return `「${name}」メニューを選択する`;
  if (ct.includes('Hyperlink'))   return `「${name}」リンクをクリックする`;
  if (ct.includes('Edit'))        return `「${name}」フィールドに入力する`;
  if (ct.includes('ComboBox'))    return `「${name}」を選択する`;
  if (ct.includes('ListItem'))    return `「${name}」を選択する`;
  if (ct.includes('Tab'))         return `「${name}」タブをクリックする`;
  return `「${name}」をクリックする`;
}

/**
 * Take a screenshot. If windowRect is provided and the window is not fullscreen,
 * capture the full screen then crop to the window bounds via NativeImage.crop().
 */
async function captureForRecording(windowRect) {
  const primary = screen.getPrimaryDisplay();
  const sf      = primary.scaleFactor || 1;
  const physW   = primary.bounds.width  * sf;
  const physH   = primary.bounds.height * sf;
  const CAP_W   = 1920;
  const CAP_H   = 1080;

  const sources = await desktopCapturer.getSources({
    types:         ['screen'],
    thumbnailSize: { width: CAP_W, height: CAP_H },
  });
  if (!sources.length) return null;

  const fullImg = sources[0].thumbnail;

  if (windowRect && windowRect.width > 50 && windowRect.height > 50) {
    const coverage = (windowRect.width * windowRect.height) / (physW * physH);
    if (coverage < 0.92) {
      const scaleX = CAP_W / physW;
      const scaleY = CAP_H / physH;
      const cx = Math.max(0, Math.round(windowRect.left * scaleX));
      const cy = Math.max(0, Math.round(windowRect.top  * scaleY));
      const cw = Math.min(CAP_W - cx, Math.round(windowRect.width  * scaleX));
      const ch = Math.min(CAP_H - cy, Math.round(windowRect.height * scaleY));
      if (cw > 20 && ch > 20) {
        const cropped = fullImg.crop({ x: cx, y: cy, width: cw, height: ch });
        return {
          dataUrl:     cropped.toDataURL(),
          type:        'window',
          imgWidth:    cw,
          imgHeight:   ch,
          scaleX,
          scaleY,
          cropOffsetX: cx,
          cropOffsetY: cy,
        };
      }
    }
  }

  return {
    dataUrl:     fullImg.toDataURL(),
    type:        'screen',
    imgWidth:    CAP_W,
    imgHeight:   CAP_H,
    scaleX:      CAP_W / physW,
    scaleY:      CAP_H / physH,
    cropOffsetX: 0,
    cropOffsetY: 0,
  };
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

  let lastCapture  = 0;
  const DEBOUNCE   = 800; // ms

  uIOhook.on('mousedown', async (event) => {
    if (!isRecording) return;
    if (event.button !== 1) return; // left click only

    const now = Date.now();
    if (now - lastCapture < DEBOUNCE) return;
    lastCapture = now;

    const { x, y } = event;

    // Skip if clicking our indicator
    if (recordIndicatorWindow && !recordIndicatorWindow.isDestroyed()) {
      const b = recordIndicatorWindow.getBounds();
      if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return;
    }

    // Wait briefly for UI to respond
    await new Promise(r => setTimeout(r, 200));

    const [el, windowRect] = await Promise.all([
      getUIElementAt(x, y),
      getActiveWindowRect(),
    ]);

    const capture = await captureForRecording(windowRect);
    if (!capture) return;

    const { scaleX, scaleY, cropOffsetX, cropOffsetY, imgWidth, imgHeight } = capture;

    let ann = null;
    if (el && el.bounds && el.bounds.width > 4 && el.bounds.height > 4) {
      ann = {
        id:          Math.random().toString(36).slice(2),
        type:        'rect',
        x:           el.bounds.left  * scaleX - cropOffsetX,
        y:           el.bounds.top   * scaleY - cropOffsetY,
        x2:          (el.bounds.left + el.bounds.width)  * scaleX - cropOffsetX,
        y2:          (el.bounds.top  + el.bounds.height) * scaleY - cropOffsetY,
        color:       '#c0392b',
        strokeWidth: 3,
        opacity:     1.0,
      };
    } else {
      const cx = x * scaleX - cropOffsetX;
      const cy = y * scaleY - cropOffsetY;
      const r  = 40;
      ann = {
        id:          Math.random().toString(36).slice(2),
        type:        'ellipse',
        x:           cx - r, y: cy - r,
        x2:          cx + r, y2: cy + r,
        color:       '#c0392b',
        strokeWidth: 3,
        opacity:     1.0,
      };
    }

    const description = generateDescription(el);
    const step = {
      id:           Math.random().toString(36).slice(2),
      title:        description,
      description:  description,
      imageDataUrl: capture.dataUrl,
      imageWidth:   imgWidth,
      imageHeight:  imgHeight,
      annotations:  [ann],
    };
    capturedSteps.push(step);

    // Update indicator
    if (recordIndicatorWindow && !recordIndicatorWindow.isDestroyed()) {
      recordIndicatorWindow.webContents.send('step-count', capturedSteps.length);
    }
  });

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

  const steps   = [...capturedSteps];
  capturedSteps = [];

  // Send steps to the main renderer window
  if (mainWindow) mainWindow.webContents.send('recording-finished', steps);

  return steps;
});

ipcMain.handle('get-cursor-pos', () => screen.getCursorScreenPoint());
