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
  globalShortcut,
} = require('electron');
const path         = require('path');
const fs           = require('fs');
const os           = require('os');
const { execFile } = require('child_process');

// クリックの確定順序・キュー・ダブルクリック判定は外の世界に触れない判断ロジックとして
// app/recordingLogic.js に切り出してある（経緯は同ファイルの冒頭）。
const { isDoubleClick, createClickQueue } = require('./recordingLogic');

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
  captureDelay: 0,
  recordingNoticeHidden: false,
  // backup（自動バックアップ）は処理が無いまま設定画面に出ていたため、項目ごと外した（renderer.js の PREFS_CONFIG）
  // cursor（カーソルを含める）は desktopCapturer では実現できず、切り替えても何も起きなかったため外した。
  // autoAddStep（キャプチャ後に自動でステップ追加）は setStepImage の新しい決め方に置き換えたため外した。
};

// ショートカットの既定値は app/shortcuts.js の1か所に置き、renderer.js と共有する
// （以前は main.js と renderer.js で値が食い違っていた。経緯は app/shortcuts.js の冒頭）
const {
  DEFAULT_SHORTCUTS,
  withDefaults: shortcutsWithDefaults,
  toAccelerator,
} = require('./shortcuts');

// ファイル名の無害化・拡張子付与は app/fileName.js に共通化（経緯は同ファイルの冒頭）
const { ensureExt } = require('./fileName');

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

  // ネイティブの×ボタンで閉じるとき、未保存の変更があれば確認する
  mainWindow.on('close', (e) => {
    if (!hasUnsavedChanges) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type:      'warning',
      title:     '未保存の変更',
      message:   '保存されていない変更があります。',
      detail:    '終了する前に保存しますか？',
      buttons:   ['保存して終了', '保存せず終了', 'キャンセル'],
      defaultId: 0,
      cancelId:  2,
      noLink:    true,
    });
    if (choice === 2) {           // キャンセル
      e.preventDefault();
      return;
    }
    if (choice === 0) {           // 保存して終了 → レンダラーに依頼
      e.preventDefault();
      mainWindow.webContents.send('save-and-quit');
    }
    // choice === 1: そのまま閉じる
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// レンダラーから通知される「未保存の変更あり」フラグ
let hasUnsavedChanges = false;
ipcMain.on('set-modified', (_event, modified) => {
  hasUnsavedChanges = !!modified;
});

// ─── Japanese application menu ───────────────────────────────────────────────
function buildJapaneseMenu() {
  const send = (action) => () => mainWindow && mainWindow.webContents.send('menu-action', action);
  // アクセラレータはショートカットの既定値（app/shortcuts.js）から作り、表示と既定値を食い違わせない。
  // レンダラーの keydown で preventDefault された組み合わせはメニューに届かない（Electron の挙動）。
  // そのため「名前を付けて保存」の Ctrl+Shift+S は、既定のキャプチャ（Ctrl+Shift+S）と重なり、
  // エディタでは押してもキャプチャが開く。どちらのキーを変えるかは未決定で、ここでは変えていない。
  return Menu.buildFromTemplate([
    {
      label: 'ファイル',
      submenu: [
        { label: '新規作成',           accelerator: toAccelerator(DEFAULT_SHORTCUTS.newProject), click: send('new') },
        { label: 'ファイルを開く...', accelerator: toAccelerator(DEFAULT_SHORTCUTS.open),       click: send('open') },
        { type: 'separator' },
        { label: '保存',               accelerator: toAccelerator(DEFAULT_SHORTCUTS.save),       click: send('save') },
        { label: '名前を付けて保存...', accelerator: 'CmdOrCtrl+Shift+S', click: send('save-as') },
        { type: 'separator' },
        { label: '記録を開始',         click: send('start-recording') },
        { type: 'separator' },
        { label: 'エクスポート...',    accelerator: toAccelerator(DEFAULT_SHORTCUTS.export),     click: send('export') },
        { type: 'separator' },
        { label: '終了',               accelerator: 'Alt+F4',             role: 'quit' },
      ],
    },
    {
      label: '編集',
      submenu: [
        { label: '元に戻す',   accelerator: toAccelerator(DEFAULT_SHORTCUTS.undo), click: send('undo') },
        { label: 'やり直し',   accelerator: toAccelerator(DEFAULT_SHORTCUTS.redo), click: send('redo') },
        { type: 'separator' },
        { label: 'ステップを追加', accelerator: toAccelerator(DEFAULT_SHORTCUTS.addStep), click: send('add-step') },
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
        { label: '拡大',         accelerator: toAccelerator(DEFAULT_SHORTCUTS.zoomIn),    click: send('zoom-in') },
        { label: '縮小',         accelerator: toAccelerator(DEFAULT_SHORTCUTS.zoomOut),   click: send('zoom-out') },
        { label: '実際のサイズ', accelerator: toAccelerator(DEFAULT_SHORTCUTS.zoomReset), click: send('zoom-reset') },
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
              message: `Opesna v${app.getVersion()}`,
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
// クリック座標は引数で渡す固定スクリプト。呼び出しごとの書き込みをなくし、
// 連続クリック時に同一ファイルへ同時書き込みして壊れるレースを防ぐ。
const UIA_SCRIPT = `param([int]$px, [int]$py)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W32 {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT pt);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flag);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
}
"@
try {
  $pt = New-Object System.Windows.Point($px, $py)
  $el = [System.Windows.Automation.AutomationElement]::FromPoint($pt)
  if ($el -eq $null) { Write-Output "NULL"; exit }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

  # Descend: FromPoint sometimes returns a parent container (toolbar, list view)
  # instead of the specific item under the cursor. Walk down to the smallest
  # descendant whose bounds still contain the click point.
  for ($depth = 0; $depth -lt 25; $depth++) {
    $child = $walker.GetFirstChild($el)
    $best = $null
    $bestArea = [double]::MaxValue
    while ($child -ne $null) {
      try {
        $cb = $child.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::BoundingRectangleProperty)
        if ($cb.Width -gt 0 -and $cb.Height -gt 0 -and
            $px -ge $cb.X -and $py -ge $cb.Y -and
            $px -lt ($cb.X + $cb.Width) -and $py -lt ($cb.Y + $cb.Height)) {
          $area = $cb.Width * $cb.Height
          if ($area -lt $bestArea) {
            $bestArea = $area
            $best = $child
          }
        }
      } catch {}
      $child = $walker.GetNextSibling($child)
    }
    if ($best -eq $null) { break }
    $el = $best
  }

  $b = $el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::BoundingRectangleProperty)

  # パスワード欄（IsPasswordProperty）は入力内容が名前に出ることがあるため、名前を空にする。
  $isPassword = $false
  try {
    $pw = $el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsPasswordProperty)
    if ($pw -eq $true) { $isPassword = $true }
  } catch {}

  # Extract a human-readable name for the clicked element. Try Name first,
  # then fall back to LegacyIAccessible.Name, AutomationId, or HelpText.
  $elName = ""
  if (-not $isPassword) {
    try {
      $n = $el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::NameProperty)
      if ($n) { $elName = [string]$n }
    } catch {}
    if (-not $elName) {
      try {
        $n = $el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::HelpTextProperty)
        if ($n) { $elName = [string]$n }
      } catch {}
    }
  }
  # Sanitize: remove pipe characters (delimiter) and newlines, then trim
  $elName = ($elName -replace '[|]', ' ' -replace '[\r\n]', ' ').Trim()
  if ($elName.Length -gt 80) { $elName = $elName.Substring(0, 80) }

  # Get top-level window via Win32 (more reliable than UIA tree walking for
  # apps that don't expose ControlType::Window, e.g. Python/tkinter).
  $wl = 0; $wt = 0; $ww = 0; $wh = 0
  $wpt = New-Object W32+POINT
  $wpt.X = $px; $wpt.Y = $py
  $hwnd = [W32]::WindowFromPoint($wpt)
  if ($hwnd -ne [IntPtr]::Zero) {
    $root = [W32]::GetAncestor($hwnd, 2)  # GA_ROOT
    if ($root -eq [IntPtr]::Zero) { $root = $hwnd }
    $r = New-Object W32+RECT
    if ([W32]::GetWindowRect($root, [ref]$r)) {
      $wl = $r.Left; $wt = $r.Top
      $ww = $r.Right - $r.Left; $wh = $r.Bottom - $r.Top
    }
  }
  Write-Output "$([int]$b.Left)|$([int]$b.Top)|$([int]$b.Width)|$([int]$b.Height)|$wl|$wt|$ww|$wh|$elName"
} catch { Write-Output "NULL" }
`;

// PowerShell スクリプトの置き場所。予測できる固定名（旧: opesna_uia_<pid>.ps1）は
// 他プロセス・他人から中身を差し替えられる余地があったため、mkdtempSync で作った
// アプリ専用フォルダに置く。アプリ終了時（will-quit）にフォルダごと削除する。
let uiaScriptDir  = null;
let uiaScriptPath = null;

function ensureUiaScript() {
  try {
    if (!uiaScriptDir) {
      uiaScriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opesna-'));
    }
    const p = uiaScriptPath || path.join(uiaScriptDir, 'uia.ps1');
    // 前回書き込んだファイルが消されていることがある（一時フォルダの掃除ソフト等）ので、
    // 呼び出しのたびに存在を確かめ、無ければ書き直す。
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, UIA_SCRIPT, 'utf8');
    }
    uiaScriptPath = p;
    return p;
  } catch (_) {
    return null;
  }
}

function cleanupUiaScriptDir() {
  if (uiaScriptDir) {
    try { fs.rmSync(uiaScriptDir, { recursive: true, force: true }); } catch (_) {}
  }
  uiaScriptDir  = null;
  uiaScriptPath = null;
}

// PowerShell の同時起動数を抑える（連続クリックで大量に立ち上がるのを防ぐ）。
// 超えた分は待たせるだけで、確定の順序は recordingLogic のキューが別に保証する。
const MAX_CONCURRENT_POWERSHELL = 2;
let runningPowerShellCount = 0;
const powerShellWaiters = [];

function acquirePowerShellSlot() {
  if (runningPowerShellCount < MAX_CONCURRENT_POWERSHELL) {
    runningPowerShellCount++;
    return Promise.resolve();
  }
  return new Promise(resolve => powerShellWaiters.push(resolve));
}

function releasePowerShellSlot() {
  const next = powerShellWaiters.shift();
  if (next) {
    next();
  } else {
    runningPowerShellCount = Math.max(0, runningPowerShellCount - 1);
  }
}

async function getElementInfoAt(x, y) {
  if (process.platform !== 'win32') return null;

  const scriptPath = ensureUiaScript();
  if (!scriptPath) return null;

  await acquirePowerShellSlot();
  let out;
  try {
    out = await new Promise(resolve => {
      execFile(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
          String(Math.round(x)), String(Math.round(y))],
        { timeout: 5000 },
        (_err, stdout) => resolve((stdout || '').trim()),
      );
    });
  } finally {
    releasePowerShellSlot();
  }
  if (!out || out === 'NULL' || out === '') return null;
  const parts = out.split('|');
  if (parts.length < 8) return null;
  const p = parts.slice(0, 8).map(v => parseInt(v) || 0);
  const name = parts.length >= 9 ? parts.slice(8).join('|').trim() : '';
  return {
    bounds:     { left: p[0], top: p[1], width: p[2], height: p[3] },
    windowRect: p[6] > 0 ? { left: p[4], top: p[5], width: p[6], height: p[7] } : null,
    name,
  };
}

/**
 * 指定ディスプレイ（省略時は主ディスプレイ）を物理解像度で撮影する。
 * 切り抜き用に生データのまま返す。
 */
async function captureScreenRaw(display) {
  const target = display || screen.getPrimaryDisplay();
  const sf      = target.scaleFactor || 1;
  const physW   = Math.round(target.bounds.width  * sf);
  const physH   = Math.round(target.bounds.height * sf);

  const sources = await desktopCapturer.getSources({
    types:         ['screen'],
    thumbnailSize: { width: physW, height: physH },
  });
  if (!sources.length) return null;

  // 複数ディスプレイのときは display_id で対象の画面を選ぶ。一致するものが無ければ
  // （環境によって display_id が来ないことがあるため）先頭にフォールバックする。
  const matched = sources.find(s => String(s.display_id) === String(target.id));
  const source  = matched || sources[0];

  const fullImg           = source.thumbnail;
  const { width: CAP_W, height: CAP_H } = fullImg.getSize();
  // scaleX/Y: logical coords → physical image pixels
  const scaleX = CAP_W / (physW / sf);
  const scaleY = CAP_H / (physH / sf);

  return { fullImg, CAP_W, CAP_H, scaleX, scaleY, physW, physH, sf, display: target };
}

/**
 * Crop a raw capture to a window rect (with DWM shadow trimming).
 * windowRect はディスプレイをまたいだ絶対座標なので、raw.display の原点を引いてから使う。
 * Falls back to full screen if no windowRect or if window covers >85% of screen.
 */
function cropCapture(raw, windowRect) {
  if (!raw) return null;
  const { fullImg, CAP_W, CAP_H, scaleX, scaleY, display } = raw;
  const originX = display ? display.bounds.x : 0;
  const originY = display ? display.bounds.y : 0;

  if (windowRect && windowRect.width > 100 && windowRect.height > 100) {
    const SHADOW  = 8; // DWM invisible shadow border (logical px)
    const adjLeft = windowRect.left   - originX + SHADOW;
    const adjTop  = windowRect.top    - originY + SHADOW;
    const adjW    = windowRect.width  - SHADOW * 2;
    const adjH    = windowRect.height - SHADOW * 2;

    const cx = Math.max(0, Math.round(adjLeft * scaleX));
    const cy = Math.max(0, Math.round(adjTop  * scaleY));
    const cw = Math.min(CAP_W - cx, Math.round(adjW * scaleX));
    const ch = Math.min(CAP_H - cy, Math.round(adjH * scaleY));

    if (cw > 40 && ch > 40) {
      const cropped = fullImg.crop({ x: cx, y: cy, width: cw, height: ch });
      return { dataUrl: cropped.toDataURL(), imgWidth: cw, imgHeight: ch,
               scaleX, scaleY, cropOffsetX: cx, cropOffsetY: cy, originX, originY };
    }
  }

  return { dataUrl: fullImg.toDataURL(), imgWidth: CAP_W, imgHeight: CAP_H,
           scaleX, scaleY, cropOffsetX: 0, cropOffsetY: 0, originX, originY };
}

/** カーソルのあるディスプレイを返す（全画面キャプチャで使う）。 */
function getDisplayAtCursor() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

/** 指定した論理座標（記録のクリック位置）を含むディスプレイを返す。 */
function getDisplayAtPoint(x, y) {
  return screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

// 二重起動防止: 2つ目のインスタンスは既存ウィンドウをフォーカスして終了
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// 予期しない例外はユーザー向けメッセージで通知し、生スタックのダイアログを出さない
process.on('uncaughtException', (err) => {
  try {
    fs.appendFileSync(
      path.join(ROOT, 'error.log'),
      `[${new Date().toISOString()}] ${err.stack || err.message || err}\n`,
    );
  } catch (_) { /* ログ書き込み失敗は無視 */ }
  try {
    dialog.showErrorBox(
      'Opesna — エラー',
      '予期しないエラーが発生しました。\n' +
      '作業内容は保存されていない可能性があります。\n\n' +
      `詳細: ${err.message || err}\n` +
      '(error.log に記録しました)',
    );
  } catch (_) { /* ダイアログ表示不可の場合は無視 */ }
});

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

// 記録中に使う一時フォルダ（UIA スクリプト置き場）は終了時に消す
app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch (_) {}
  cleanupUiaScriptDir();
});

// ─── IPC: Settings ────────────────────────────────────────────────────────────
ipcMain.handle('get-settings', () => {
  const stored = readJSON(SETTINGS_FILE, {});
  return Object.assign({}, DEFAULT_SETTINGS, stored);
});

ipcMain.handle('save-settings', (_event, settings) => {
  try {
    writeJSON(SETTINGS_FILE, settings);
    return true;
  } catch (err) {
    console.error('save-settings error:', err);
    return false;
  }
});

// ─── IPC: Shortcuts ───────────────────────────────────────────────────────────
ipcMain.handle('get-shortcuts', () => {
  return shortcutsWithDefaults(readJSON(SHORTCUTS_FILE, {}));
});

ipcMain.handle('save-shortcuts', (_event, shortcuts) => {
  try {
    writeJSON(SHORTCUTS_FILE, shortcuts);
    return true;
  } catch (err) {
    console.error('save-shortcuts error:', err);
    return false;
  }
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
  try {
    writeJSON(RECENT_FILE, list);
  } catch (err) {
    console.error('add-recent error:', err);
  }
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

  // 書き込み失敗はキャンセル (null) と区別できるよう投げる → レンダラー側の
  // try/catch が「保存に失敗しました」トーストを表示する
  writeJSON(result.filePath, data);
  return result.filePath;
});

// ─── IPC: Delete project ─────────────────────────────────────────────────────
ipcMain.handle('delete-project', (_event, filePath) => {
  try {
    // プロジェクトフォルダー配下のみ削除を許可 (誤指定・不正パスの保険)
    const resolved = path.resolve(filePath || '');
    if (!resolved.startsWith(PROJECTS_DIR + path.sep) && resolved !== PROJECTS_DIR) {
      return { ok: false, error: 'プロジェクトフォルダー外のファイルは削除できません' };
    }
    if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
    return { ok: true };
  } catch (err) {
    console.error('delete-project error:', err);
    return { ok: false, error: err.message };
  }
});

// ─── IPC: Capture full screen ────────────────────────────────────────────────
// Opesna 自身が写り込まないよう、撮影前にメインウィンドウを最小化してから撮る。
// 最小化のアニメーション分だけ待ってから撮影し、撮影後は前面に戻す。
const MINIMIZE_WAIT_MS = 250;

ipcMain.handle('capture-screen', async () => {
  const wasVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
    && !mainWindow.isMinimized();
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
    await new Promise(r => setTimeout(r, MINIMIZE_WAIT_MS));

    // マウスカーソルのあるディスプレイを、そのディスプレイの解像度で撮る
    const display = getDisplayAtCursor();
    const raw = await captureScreenRaw(display);
    return raw ? raw.fullImg.toDataURL() : null;
  } catch (err) {
    console.error('capture-screen error:', err);
    return null;
  } finally {
    if (wasVisible && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.restore();
      mainWindow.focus();
    }
  }
});

// ─── IPC: Capture window list ────────────────────────────────────────────────
// 一覧の取得中はメインウィンドウを隠さない（利用者が一覧から選ぶ操作のため）。
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

// ─── IPC: Re-capture a chosen window at higher resolution ────────────────────
// 一覧のサムネイルは低解像度（capture-window 参照）なので、選択後にその1枚だけ
// 高解像度で撮り直す。失敗時は null を返し、呼び出し側は一覧のサムネイルを使う。
ipcMain.handle('capture-window-full', async (_event, sourceId) => {
  try {
    const sources = await desktopCapturer.getSources({
      types:            ['window'],
      thumbnailSize:    { width: 3840, height: 2160 },
      fetchWindowIcons: false,
    });
    const found = sources.find((s) => s.id === sourceId);
    return found ? found.thumbnail.toDataURL() : null;
  } catch (err) {
    console.error('capture-window-full error:', err);
    return null;
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
  const defaultName = ensureExt(fileName, 'pdf');
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

  // data: URL は URL 長制限があり、画像入り複数ステップの HTML で確実に破綻する。
  // 一時ファイル経由で読み込む。
  const tmpHtml = path.join(os.tmpdir(), `opesna_export_${process.pid}_${Date.now()}.html`);
  try {
    fs.writeFileSync(tmpHtml, html, 'utf8');
    await win.loadFile(tmpHtml);
    const pdfData = await win.webContents.printToPDF({
      printBackground: true,
      pageSize:        'A4',
      landscape:       false,
      margins:         { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }, // インチ
    });
    fs.writeFileSync(result.filePath, pdfData);
    return { ok: true, filePath: result.filePath };
  } catch (err) {
    console.error('export-pdf error:', err);
    return { ok: false, error: err.message };
  } finally {
    win.destroy();
    try { fs.unlinkSync(tmpHtml); } catch (_) {}
  }
});

// ─── IPC: Export HTML ────────────────────────────────────────────────────────
ipcMain.handle('export-html', async (_event, { html, fileName }) => {
  const defaultName = ensureExt(fileName, 'html');
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
  const defaultName = ensureExt(fileName, 'md');
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
ipcMain.handle('window-close', () => {
  // レンダラー側で保存確認済みなので、close ガードを通さず直接閉じる
  if (mainWindow) mainWindow.destroy();
});

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

const STOP_RECORDING_ACCELERATOR = 'CommandOrControl+Shift+F9';
const DBL_MS = 350; // ダブルクリックと認める時間差 (ms)
const DBL_PX = 20;  // ダブルクリックと認める距離 (論理px)
const STOP_DRAIN_TIMEOUT_MS = 15000; // 停止時、確定待ちのキューを待つ上限

let pendingClick          = null; // { x, y, clickType, time, uiaPromise, rawAtClickPromise, targetDisplay, timer }
let clickQueue            = null; // recordingLogic の createClickQueue()。確定処理を1件ずつ順に流す
let bufferedCaptures      = new Map(); // displayId -> 直近の撮影結果（クリック前フレーム用）
let lastClickDisplayId    = null;
let uiaUnavailableNotified = false; // F22: 要素情報が取れない旨のトーストは記録中に1回だけ
let stopRecordingPromise  = null;   // stopRecordingFlow の多重呼び出しをまとめる

function registerStopShortcut() {
  try {
    if (!globalShortcut.isRegistered(STOP_RECORDING_ACCELERATOR)) {
      globalShortcut.register(STOP_RECORDING_ACCELERATOR, () => { stopRecordingFlow(); });
    }
  } catch (_) { /* 登録に失敗しても記録自体は続けられるので無視する */ }
}

function unregisterStopShortcut() {
  try { globalShortcut.unregister(STOP_RECORDING_ACCELERATOR); } catch (_) {}
}

/** クリックの確定処理（撮影・UIA照会・注釈作成・送信）を1件行う。 */
async function commitClick(click, isDouble) {
  let raw = await click.rawAtClickPromise.catch(() => null);
  if (!raw) raw = await captureScreenRaw(click.targetDisplay).catch(() => null);
  if (!raw) return;

  const elementInfo = await click.uiaPromise.catch(() => null);
  if (!elementInfo && process.platform === 'win32' && !uiaUnavailableNotified) {
    uiaUnavailableNotified = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recording-uia-unavailable');
    }
  }

  const capture = cropCapture(raw, elementInfo?.windowRect);
  if (!capture) return;

  const { scaleX, scaleY, cropOffsetX, cropOffsetY, imgWidth, imgHeight, originX, originY } = capture;
  const isRight = click.clickType === 'right';
  const annColor = isRight ? '#7f3fbf' : '#c0392b';
  const annotations = [];

  // Rectangle around the clicked element (button, file, folder, etc.)
  const eb = elementInfo?.bounds;
  if (eb && eb.width > 4 && eb.height > 4) {
    annotations.push({
      id:          Math.random().toString(36).slice(2),
      type:        'rect',
      x:           (eb.left              - originX) * scaleX - cropOffsetX,
      y:           (eb.top               - originY) * scaleY - cropOffsetY,
      x2:          (eb.left + eb.width   - originX) * scaleX - cropOffsetX,
      y2:          (eb.top  + eb.height  - originY) * scaleY - cropOffsetY,
      color:       annColor,
      strokeWidth: 3,
      opacity:     1.0,
    });
  }

  const actionText = isRight ? '右クリック' : (isDouble ? '左ダブルクリック' : '左クリック');
  const rawName = (elementInfo?.name || '').trim();
  const elementName = rawName.replace(/\s+/g, ' ');
  const title = elementName
    ? `「${elementName}」を${actionText}する`
    : `${actionText}する`;

  const step = {
    id:           Math.random().toString(36).slice(2),
    title,
    // E10: 記録したステップは題名と説明が同じ文にならないよう、説明は空にする
    description:  '',
    imageDataUrl: capture.dataUrl,
    imageWidth:   imgWidth,
    imageHeight:  imgHeight,
    annotations,
  };
  capturedSteps.push(step);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('step-captured', step);
  }
  if (recordIndicatorWindow && !recordIndicatorWindow.isDestroyed()) {
    recordIndicatorWindow.webContents.send('step-count', capturedSteps.length);
  }
}

/** クリックの確定を、キューに積んで順番どおりに実行させる。 */
function enqueueCommit(click, isDouble) {
  if (!clickQueue) return;
  clickQueue.enqueue(() => commitClick(click, isDouble));
}

/**
 * mousedown ハンドラ。判定（シングル/ダブル）は recordingLogic.isDoubleClick に任せ、
 * 確定処理は必ず enqueueCommit 経由でキューに積む（呼ばれた順に1件ずつ実行される）。
 */
function onRecordingMouseDown(event) {
  if (!isRecording) return;
  const { x, y, button } = event;
  if (button !== 1 && button !== 2) return;
  const clickType = button === 1 ? 'left' : 'right';
  const now = Date.now();

  // Skip clicks on our recording indicator
  if (recordIndicatorWindow && !recordIndicatorWindow.isDestroyed()) {
    const b = recordIndicatorWindow.getBounds();
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return;
  }

  // F10: クリックした点を含むディスプレイの画面を使う
  const targetDisplay = getDisplayAtPoint(x, y);
  lastClickDisplayId = targetDisplay.id;
  const buffered = bufferedCaptures.get(targetDisplay.id);
  const rawAtClickPromise = buffered ? Promise.resolve(buffered) : captureScreenRaw(targetDisplay);

  // Kick off the UIA query IMMEDIATELY — before the click is processed by the
  // target window. This ensures we get the correct element/window bounds even
  // for clicks that close or transform the UI (e.g. × close buttons).
  const uiaPromise = getElementInfoAt(x, y).catch(() => null);

  // Right click: capture immediately, no double-click upgrade
  if (clickType === 'right') {
    if (pendingClick) {
      clearTimeout(pendingClick.timer);
      const p = pendingClick;
      pendingClick = null;
      enqueueCommit(p, false);
    }
    enqueueCommit({ x, y, clickType: 'right', time: now, uiaPromise, rawAtClickPromise, targetDisplay }, false);
    return;
  }

  const next = { clickType, x, y, time: now };

  // Left click: check if this is the 2nd click of a double-click
  if (isDoubleClick(pendingClick, next, { doubleClickMs: DBL_MS, doubleClickPx: DBL_PX })) {
    clearTimeout(pendingClick.timer);
    const p = pendingClick;
    pendingClick = null;
    enqueueCommit(p, true); // use FIRST click's UIA result for accuracy
    return;
  }

  // Flush any prior pending click that didn't pair up
  if (pendingClick) {
    clearTimeout(pendingClick.timer);
    const p = pendingClick;
    pendingClick = null;
    enqueueCommit(p, false);
  }

  // Start a new pending click; timer commits it as a single click if no
  // second click arrives within DBL_MS
  const click = { x, y, clickType: 'left', time: now, uiaPromise, rawAtClickPromise, targetDisplay, timer: null };
  click.timer = setTimeout(() => {
    if (pendingClick === click) {
      pendingClick = null;
      enqueueCommit(click, false);
    }
  }, DBL_MS);
  pendingClick = click;
}

/** start-recording の途中失敗時、副作用を最小限に巻き戻す（キューはまだ無いので待たない）。 */
function cleanupAfterFailedStart() {
  isRecording = false;
  if (uIOhook) { try { uIOhook.stop(); } catch (_) {} uIOhook = null; }
  unregisterStopShortcut();
  if (recordIndicatorWindow && !recordIndicatorWindow.isDestroyed()) recordIndicatorWindow.close();
  recordIndicatorWindow = null;
  clickQueue   = null;
  pendingClick = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.restore();
    mainWindow.focus();
  }
}

/**
 * 記録の停止処理を1つにまとめたもの。IPC の stop-recording・インジケーターの closed・
 * 停止ホットキーのすべてからここを呼ぶ。多重に呼ばれても実際の停止処理は1回だけ動く。
 */
function stopRecordingFlow() {
  if (stopRecordingPromise) return stopRecordingPromise; // 二重呼び出し: 進行中のものを返す
  if (!isRecording) return Promise.resolve(0);            // すでに停止済み
  stopRecordingPromise = doStopRecordingFlow().finally(() => { stopRecordingPromise = null; });
  return stopRecordingPromise;
}

async function doStopRecordingFlow() {
  isRecording = false; // 新しいクリックを受け付けない・背景撮影ループもこれで止まる
  unregisterStopShortcut();
  if (uIOhook) { try { uIOhook.stop(); } catch (_) {} uIOhook = null; }

  // F9: 判定待ち（ダブルクリックかどうかのタイマー待ち）のクリックは捨てず、
  // シングルクリックとして確定させてキューに入れる
  if (pendingClick) {
    clearTimeout(pendingClick.timer);
    const p = pendingClick;
    pendingClick = null;
    enqueueCommit(p, false);
  }

  if (recordIndicatorWindow && !recordIndicatorWindow.isDestroyed()) {
    try { recordIndicatorWindow.webContents.send('recording-status', '保存中…'); } catch (_) {}
  }

  // キューが空になるまで待ってから終了を知らせる（最大 15 秒）
  if (clickQueue) {
    await clickQueue.drain(STOP_DRAIN_TIMEOUT_MS);
  }

  const count   = capturedSteps.length; // 実際に送ったステップ数と一致させる
  capturedSteps = [];
  clickQueue    = null;

  if (recordIndicatorWindow && !recordIndicatorWindow.isDestroyed()) {
    recordIndicatorWindow.removeAllListeners('closed');
    recordIndicatorWindow.close();
  }
  recordIndicatorWindow = null;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('recording-finished', count);
  }

  return count;
}

ipcMain.handle('start-recording', async () => {
  if (isRecording) return false;

  // フックが使えない場合は一切の副作用なしで即返す (最小化やインジケーター表示前)
  uIOhook = loadUiohook();
  if (!uIOhook) {
    if (mainWindow) mainWindow.webContents.send('recording-no-hook');
    return 'no-hook';
  }

  // S5: 記録を始める前に、初回だけ確認ダイアログを出す
  const settings = Object.assign({}, DEFAULT_SETTINGS, readJSON(SETTINGS_FILE, {}));
  if (!settings.recordingNoticeHidden) {
    const notice = await dialog.showMessageBox(mainWindow, {
      type:    'info',
      title:   '記録について',
      message: '記録中は、クリックのたびに画面を撮影します。パスワードや個人情報が画面に出ていないか確かめてください。撮影した画像は、エクスポートするまでこのパソコンの外には出ません。モザイクで隠すこともできます。',
      buttons: ['記録を開始', 'キャンセル'],
      defaultId:     0,
      cancelId:      1,
      checkboxLabel: '次回から表示しない',
      noLink: true,
    });
    if (notice.response !== 0) {
      uIOhook = null;
      return 'cancelled'; // 利用者がキャンセルした（失敗ではないので警告トーストは出さない）
    }
    if (notice.checkboxChecked) {
      settings.recordingNoticeHidden = true;
      try { writeJSON(SETTINGS_FILE, settings); } catch (_) {}
    }
  }

  isRecording            = true;
  capturedSteps          = [];
  pendingClick           = null;
  clickQueue             = createClickQueue();
  bufferedCaptures       = new Map();
  lastClickDisplayId     = null;
  uiaUnavailableNotified = false;

  try {
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
      skipTaskbar: true, // F3: 記録中もタスクバーに出さない
      webPreferences: {
        preload:          path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration:  false,
        sandbox:          false,
      },
    });
    // インジケーター自身がキャプチャに写り込まないようにする（F3 / S5）
    try { recordIndicatorWindow.setContentProtection(true); } catch (_) {}
    recordIndicatorWindow.loadFile(path.join(__dirname, 'recording-indicator.html'));
    // Position bottom-right
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    recordIndicatorWindow.setPosition(sw - 220, sh - 80);

    // F3: インジケーターが閉じられたら（Alt+F4 等）、stop-recording と同じ停止処理を行う
    recordIndicatorWindow.on('closed', () => {
      if (isRecording) stopRecordingFlow();
    });

    // Start background capture loop — keeps the freshest screenshot ready in memory
    // so that on mousedown we can use a frame from BEFORE the click was processed.
    // 負荷を抑えるため、主ディスプレイと「前回クリックしたディスプレイ」だけを撮る。
    (async () => {
      while (isRecording) {
        try {
          const primary = screen.getPrimaryDisplay();
          const targets = [primary];
          if (lastClickDisplayId != null && lastClickDisplayId !== primary.id) {
            const extra = screen.getAllDisplays().find(d => d.id === lastClickDisplayId);
            if (extra) targets.push(extra);
          }
          for (const d of targets) {
            const cap = await captureScreenRaw(d);
            if (cap) bufferedCaptures.set(d.id, { ...cap, capturedAt: Date.now() });
          }
        } catch (_) { /* ignore */ }
        await new Promise(r => setTimeout(r, 200));
      }
      bufferedCaptures.clear();
    })();

    // uIOhook is a singleton — remove old listeners to prevent duplicate steps on re-recording
    uIOhook.removeAllListeners('mousedown');
    uIOhook.on('mousedown', onRecordingMouseDown);

    // E12: 記録中だけ有効な停止ホットキー
    registerStopShortcut();

    // Notify renderer that recording has started (so it can prepare the project)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recording-start');
    }

    uIOhook.start();
    return true;

  } catch (err) {
    // 途中失敗 (アクセシビリティ権限拒否等) で幽霊録画状態にならないよう巻き戻す
    cleanupAfterFailedStart();
    try {
      fs.appendFileSync(path.join(ROOT, 'error.log'),
        `[${new Date().toISOString()}] start-recording failed: ${err.stack || err}\n`);
    } catch (_) {}
    return false;
  }
});

ipcMain.handle('stop-recording', () => stopRecordingFlow());
