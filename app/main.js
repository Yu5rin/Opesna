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
//
// ROOT は読み取り専用の場所（Program Files 等）に置かれることがあり、その場合は
// 書き込めるかどうかを起動時に確かめ、書けなければ userData（%APPDATA%\Opesna）へ
// 切り替える（F2）。そのため let にして applyRootPaths() で従属パスを作り直せるようにする。
let ROOT = process.env.PORTABLE_EXECUTABLE_DIR
  ? process.env.PORTABLE_EXECUTABLE_DIR
  : app.isPackaged
    ? path.dirname(process.execPath)
    : path.join(__dirname, '..');

// 同梱テンプレートは書き込み先（ROOT）に依存せず、アプリ本体と一緒に配置された場所から読む
// （F2）。以前は ROOT/templates から読んでおり、パッケージ版では extraResources で
// resources/templates に置かれるため、実際には空の ROOT/templates を見て何も出ない状態だった。
const TEMPLATES_RESOURCE_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'templates')
  : path.join(__dirname, '..', 'templates');

let CONFIG_DIR, DATA_DIR, PROJECTS_DIR, EXPORTS_DIR, AUTOSAVE_DIR;
let SETTINGS_FILE, SHORTCUTS_FILE, RECENT_FILE;

function applyRootPaths() {
  CONFIG_DIR   = path.join(ROOT, 'config');
  DATA_DIR     = path.join(ROOT, 'data');
  PROJECTS_DIR = path.join(DATA_DIR, 'projects');
  EXPORTS_DIR  = path.join(DATA_DIR, 'exports');
  AUTOSAVE_DIR = path.join(DATA_DIR, 'autosave');

  SETTINGS_FILE  = path.join(CONFIG_DIR, 'settings.json');
  SHORTCUTS_FILE = path.join(CONFIG_DIR, 'shortcuts.json');
  RECENT_FILE    = path.join(CONFIG_DIR, 'recent.json');
}
applyRootPaths();

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

  // ── 自動更新（WP8） ──────────────────────────────────────────────────────────
  // 問い合わせ先はコードに直書きせず設定に持つ（どこへ通信するのか利用者から見えるように。仕様書 U-02）。
  updateFeedUrl:            'https://github.com/Yu5rin/Opesna/releases.atom',
  checkUpdatesOnStartup:    true,   // 仕様書 U-06。オフなら起動時の通信は一切しない
  updateFeedEtag:           '',     // Atom の ETag（U-07a）。次回 If-None-Match に使う
  updateFeedLatestTag:      '',     // ETag が 304 を返したときに使う、前回読み取ったタグ
  updatePendingTag:         '',     // 起動時に見つけた新しい版のタグ（U-06a）。次の起動でも帯を出せるよう控える
  updateDismissedTag:       '',     // ［×］で閉じた版のタグ。同じ版では次に出さない
};

// ショートカットの既定値は app/shortcuts.js の1か所に置き、renderer.js と共有する
// （以前は main.js と renderer.js で値が食い違っていた。経緯は app/shortcuts.js の冒頭）
const {
  DEFAULT_SHORTCUTS,
  withDefaults: shortcutsWithDefaults,
  toAccelerator,
} = require('./shortcuts');
// ファイル名の無害化・拡張子付与は app/fileName.js に共通化（経緯は同ファイルの冒頭）
const { sanitizeFileName, ensureExt } = require('./fileName');
const { toUserMessage } = require('./errorMessages');
const { isValidPngDataUrl } = require('./exportGuard');

// IPC が受け付けてよいパスかどうかの判定は app/pathPolicy.js に切り出す（経緯は同ファイルの冒頭）
const pathPolicy = require('./pathPolicy');

// ダイアログ・エクスポートで得た、今回のセッション中は「開いてよい・書いてよい」と扱うパス。
// アプリを跨いでは保持しない（S2）。
const sessionAllowedPaths = new Set();
function registerAllowedPath(filePath) {
  if (typeof filePath === 'string' && filePath !== '') {
    sessionAllowedPaths.add(path.resolve(filePath));
  }
}

// 自動更新（WP8）。判断は app/updateLogic.js、通信・ファイル・プロセスは app/updater.js、
// ログは app/logger.js に分けてある。経緯・仕様は scratchpad/wp8.md 参照。
const { createLogger } = require('./logger');
const { createUpdater } = require('./updater');
const { isNewer: updateIsNewer, shouldShowPending } = require('./updateLogic');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create directory if it does not exist (recursive). */
function mkdirSafe(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** dir に実際に書き込めるかを確かめる（存在しなければ作成も試みる）。 */
function canWriteDir(dir) {
  try {
    mkdirSafe(dir);
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch (_) {
    return false;
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

/**
 * プロジェクト（.opn）専用の読み込み。本体が読めなければ、直前の版を残した
 * <名前>.bak を試す（F6。壊れかけの保存や、書き込み中の強制終了からの復旧）。
 * どちらも読めなければ null。
 */
function readProjectJSON(filePath) {
  const MISSING = Symbol('missing');
  const primary = readJSON(filePath, MISSING);
  if (primary !== MISSING) return primary;
  const bak = filePath + '.bak';
  if (fs.existsSync(bak)) {
    const fromBak = readJSON(bak, MISSING);
    if (fromBak !== MISSING) return fromBak;
  }
  return null;
}

/**
 * Write a JSON file atomically (write to tmp, fsync, optionally back up the previous
 * version, then rename). opts.backup: true でプロジェクトファイルのように前の版を
 * 1つだけ <名前>.bak として残す（F6）。.bak は data/ 配下のプロジェクトにのみ使う。
 */
function writeJSON(filePath, data, opts) {
  const options = opts || {};
  const tmp = filePath + '.tmp';
  const json = JSON.stringify(data, null, 2);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, json, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (options.backup && fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, filePath + '.bak');
    } catch (_) {
      // バックアップ自体に失敗しても、本体の保存は続ける
    }
  }
  fs.renameSync(tmp, filePath);
}

/** Ensure all required directories and seed config files exist. */
function ensureDirs() {
  mkdirSafe(CONFIG_DIR);
  mkdirSafe(DATA_DIR);
  mkdirSafe(PROJECTS_DIR);
  mkdirSafe(EXPORTS_DIR);
  mkdirSafe(AUTOSAVE_DIR);
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

/**
 * 起動時の土台づくり。ROOT（既定は exe の隣）に書き込めなければ userData に切り替えてから
 * ensureDirs() する（F2）。ここで投げた例外は呼び出し側（app.whenReady）で拾い、
 * ダイアログを出して終了する。
 */
function initRootAndData() {
  if (!canWriteDir(ROOT)) {
    const fallback = app.getPath('userData');
    ROOT = fallback;
    applyRootPaths();
    try {
      dialog.showMessageBoxSync({
        type:    'info',
        title:   'Opesna',
        message: '実行ファイルのフォルダに書き込めないため、データは次の場所に保存します:',
        detail:  ROOT,
        buttons: ['OK'],
      });
    } catch (_) { /* ダイアログを表示できなくても続行する */ }
  }
  ensureDirs();
}

// ─── 自動更新（WP8） ────────────────────────────────────────────────────────────
// ログは ROOT/logs/update.log（開発中は project 直下の logs/）。
const updateLogger = createLogger(ROOT);
const updater = createUpdater({ getAppVersion: () => app.getVersion(), logger: updateLogger });

/** 現在の設定を読み、パッチをマージして書き戻す（部分更新用）。 */
function patchSettings(patch) {
  if (!patch || Object.keys(patch).length === 0) return;
  const current = Object.assign({}, DEFAULT_SETTINGS, readJSON(SETTINGS_FILE, {}));
  writeJSON(SETTINGS_FILE, Object.assign(current, patch));
}

function getMergedSettings() {
  return Object.assign({}, DEFAULT_SETTINGS, readJSON(SETTINGS_FILE, {}));
}

let lastUpdateCheckResult = null; // update-open-release-page / update-test-connection / update-get-state で使う
let applyingUpdate = false;       // 入れ替え中は close ガードを通さず終了する

/** 起動直後、通信の完了を待たずに、控えた版があれば帯を出す（仕様書 U-06a）。 */
function showPendingBannerIfDue() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const settings = getMergedSettings();
  const currentVersion = app.getVersion();
  if (shouldShowPending({
    pendingTag:    settings.updatePendingTag,
    dismissedTag:  settings.updateDismissedTag,
    currentVersion,
  })) {
    mainWindow.webContents.send('update-available', { tag: settings.updatePendingTag });
  } else if (settings.updatePendingTag && updateIsNewer(settings.updatePendingTag, currentVersion) !== true) {
    // 控えていた版がすでに現在の版以下（更新済み等）になっていたら控えを消す
    patchSettings({ updatePendingTag: '' });
  }
}

/** 設定「起動時に新しい版があるか確認する」がオンのときだけ、起動5秒後に呼ぶ。 */
async function runStartupUpdateCheck() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const settings = getMergedSettings();
  const result = await updater.checkForUpdate(settings);
  lastUpdateCheckResult = result;
  patchSettings(result.settingsPatch);

  if (result.status === 'available') {
    patchSettings({ updatePendingTag: result.latestTag });
    const latest = getMergedSettings();
    if (shouldShowPending({
      pendingTag:   result.latestTag,
      dismissedTag: latest.updateDismissedTag,
      currentVersion: app.getVersion(),
    }) && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', { tag: result.latestTag });
    }
  } else if (result.status === 'latest') {
    patchSettings({ updatePendingTag: '' }); // 最新版なら控えを消す
  }
  // status === 'error' のときは何もしない。失敗のたびに帯を出して騒がしくしないため
  // （settings.updatePendingTag はそのまま。次回の確認まで前回分かっていた状態を保つ）
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
    // 更新の適用は、renderer 側ですでに保存確認を済ませてから呼ばれる（仕様書 U-04）。
    // ここで改めて保存を尋ねると、待ち役の起動と終了が二重に絡み合うため通さない。
    if (applyingUpdate) return;
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

  // 画面（レンダラープロセス）がクラッシュ等で異常終了したとき。
  // 「未保存の変更あり」のままだと、その後の終了確認で既に失われた内容を保存しようとするため戻す。
  // 自動保存の復旧ファイルが残っていれば、再読み込み後の起動確認から復元できる（F6・F4後半）。
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    hasUnsavedChanges = false;
    logFatalError(new Error(`render-process-gone: reason=${details && details.reason}`));
    try {
      dialog.showErrorBox(
        'Opesna',
        '画面の処理が異常終了しました。未保存の内容は自動保存から復元できる場合があります。',
      );
    } catch (_) { /* ダイアログ表示不可の場合は無視 */ }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
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
        { label: '前回と同じ設定でエクスポート', accelerator: toAccelerator(DEFAULT_SHORTCUTS.exportRepeat), click: send('export-repeat') },
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
          label: '更新を確認...',
          click: send('open-update-check'),
        },
        { type: 'separator' },
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

/** error.log に1行追記する（書き込めなくても無視する）。 */
function logFatalError(err) {
  try {
    fs.appendFileSync(
      path.join(ROOT, 'error.log'),
      `[${new Date().toISOString()}] ${(err && (err.stack || err.message)) || err}\n`,
    );
  } catch (_) { /* ログ書き込み失敗は無視 */ }
}

/** 予期しない例外・拒否をユーザー向けメッセージで通知する（生スタックはダイアログに出さない）。 */
function showFatalDialog(err) {
  try {
    dialog.showErrorBox(
      'Opesna — エラー',
      '予期しないエラーが発生しました。\n' +
      '作業内容は保存されていない可能性があります。\n\n' +
      `詳細: ${(err && err.message) || err}\n` +
      '(error.log に記録しました)',
    );
  } catch (_) { /* ダイアログ表示不可の場合は無視 */ }
}

process.on('uncaughtException', (err) => {
  logFatalError(err);
  showFatalDialog(err);
});

// Promise の unhandled rejection も、uncaughtException と同じ扱いにする（F2）。
// これまでは何も出ず、原因不明のまま操作が止まって見えることがあった。
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logFatalError(err);
  showFatalDialog(err);
});

app.whenReady().then(() => {
  try {
    initRootAndData();
  } catch (err) {
    logFatalError(err);
    try {
      dialog.showErrorBox(
        'Opesna — 起動できません',
        'データの保存先を用意できなかったため、起動できません。\n\n' +
        '別のフォルダに置き直すか、管理者に書き込み権限を確認してください。\n' +
        '(error.log に記録しました)',
      );
    } catch (_) { /* ダイアログ表示不可の場合は無視 */ }
    app.quit();
    return;
  }

  createWindow();
  Menu.setApplicationMenu(buildJapaneseMenu());

  // 前回の更新の後始末（仕様書7）。通信は一切しない。
  updater.cleanupLeftovers();

  mainWindow.once('ready-to-show', () => {
    showPendingBannerIfDue();
  });

  const settings = getMergedSettings();
  if (settings.checkUpdatesOnStartup) {
    setTimeout(runStartupUpdateCheck, 5000);
  }

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
// recent.json が壊れて配列以外（オブジェクトや文字列など）になっていても、誤って
// エラー扱いにせず空の一覧として扱う（F23）。
function readRecentList() {
  const list = readJSON(RECENT_FILE, []);
  return Array.isArray(list) ? list : [];
}

ipcMain.handle('get-recent', () => {
  return readRecentList();
});

ipcMain.handle('add-recent', (_event, filePath) => {
  let list = readRecentList();
  // Remove existing entry for this path, then add to front
  list = list.filter((p) => p !== filePath);
  list.unshift(filePath);
  // Keep last 20
  if (list.length > 20) list = list.slice(0, 20);
  // Remove paths that no longer exist
  list = list.filter((p) => fs.existsSync(p));
  // 一覧の更新に失敗しても、これは「最近使った項目」の付随処理であり、
  // 保存・読み込み自体の成否とは切り離す（F23）。
  try {
    writeJSON(RECENT_FILE, list);
  } catch (err) {
    console.error('add-recent error:', err);
  }
  return list;
});

// ─── IPC: Templates ───────────────────────────────────────────────────────────
// 同梱テンプレートは resources 配下（TEMPLATES_RESOURCE_DIR）から読む。ROOT が
// 書き込み不可で userData に切り替わっていても、テンプレート一覧は変わらない（F2）。
ipcMain.handle('get-templates', () => {
  try {
    const files = fs.readdirSync(TEMPLATES_RESOURCE_DIR).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
      return readJSON(path.join(TEMPLATES_RESOURCE_DIR, f), null);
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
// filePath は renderer のメモリ上の値をそのまま受け取るため、書き込んでよい場所か
// pathPolicy で確かめる（S2）。失敗時は投げずに {ok:false, code, error} を返す
// （renderer 側で戻り値を見て「未保存」のまま残すため。F1）。
ipcMain.handle('save-project', (_event, { filePath, data } = {}) => {
  try {
    if (!pathPolicy.canSaveProject(filePath, {
      projectsDir:  PROJECTS_DIR,
      sessionPaths: Array.from(sessionAllowedPaths),
    })) {
      return { ok: false, code: 'EPERM', error: 'このファイルへの保存は許可されていません' };
    }
    // .bak は data/ 配下のプロジェクトにのみ作る。ユーザーが「上書き保存」を続けている
    // ファイルが偶然 PROJECTS_DIR の外にあっても、任意の場所に .bak を散らかさない（F6）。
    writeJSON(filePath, data, { backup: pathPolicy.isWithinDir(filePath, PROJECTS_DIR) });
    registerAllowedPath(filePath);
    return { ok: true, filePath };
  } catch (err) {
    console.error('save-project error:', err);
    return { ok: false, code: err.code, error: err.message };
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
    // 本体が壊れていても .bak が読めればそちらを返す（F6）。中身の検証・正規化は
    // renderer 側の normalizeProject が、state を置き換える前に行う（F17）。
    const data = readProjectJSON(filePath);
    if (!data) throw new Error('Invalid project file');
    registerAllowedPath(filePath);
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
// filePath は renderer が持つ最近使った項目・プロジェクト一覧の値で、パス制限の対象（S2）。
ipcMain.handle('open-project-by-path', async (_event, filePath) => {
  try {
    if (!pathPolicy.canOpenProjectByPath(filePath, {
      projectsDir:  PROJECTS_DIR,
      recentPaths:  readRecentList(),
      sessionPaths: Array.from(sessionAllowedPaths),
    })) {
      return null;
    }
    const data = readProjectJSON(filePath);
    if (!data) return null;
    registerAllowedPath(filePath);
    return { filePath, data };
  } catch (err) {
    console.error('open-project-by-path error:', err);
    return null;
  }
});

// ─── IPC: Save project via dialog ────────────────────────────────────────────
ipcMain.handle('save-project-dialog', async (_event, { data, folder } = {}) => {
  const rawName      = (data && (data.name || data.title)) || '無題';
  const defaultName  = ensureExt(rawName, 'opn');

  // folder に "." ".." やパス区切りが含まれる場合は無視して PROJECTS_DIR 直下にする（F24・S2）。
  const folderLooksUnsafe = typeof folder === 'string' &&
    (folder === '.' || folder === '..' || folder.includes('/') || folder.includes('\\'));
  let saveDir = PROJECTS_DIR;
  if (folder && !folderLooksUnsafe) {
    const safeFolder = sanitizeFileName(folder, '');
    if (safeFolder) {
      saveDir = path.join(PROJECTS_DIR, safeFolder);
      mkdirSafe(saveDir);
    }
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title:       'プロジェクトを保存',
    defaultPath: path.join(saveDir, defaultName),
    filters:     [{ name: 'Opesna Project', extensions: ['opn'] }],
  });
  if (result.canceled || !result.filePath) return null;

  try {
    // .bak は data/ 配下のプロジェクトにのみ作る（F6）。ダイアログはユーザーが
    // PROJECTS_DIR の外を選ぶこともできるため、実際の保存先で判定する。
    writeJSON(result.filePath, data, { backup: pathPolicy.isWithinDir(result.filePath, PROJECTS_DIR) });
    registerAllowedPath(result.filePath);
    return { ok: true, filePath: result.filePath };
  } catch (err) {
    console.error('save-project-dialog error:', err);
    return { ok: false, code: err.code, error: err.message };
  }
});

// ─── IPC: Delete project ─────────────────────────────────────────────────────
ipcMain.handle('delete-project', (_event, filePath) => {
  try {
    // プロジェクトフォルダー配下のみ削除を許可 (誤指定・不正パスの保険。S2)
    if (!pathPolicy.isWithinDir(filePath || '', PROJECTS_DIR)) {
      return { ok: false, code: 'EPERM', error: 'プロジェクトフォルダー外のファイルは削除できません' };
    }
    const resolved = path.resolve(filePath);
    if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
    // 削除した本体に対応する .bak が残っていると、次に同名で保存したときに
    // 古い内容が紛れ込むため、一緒に消す。
    try { if (fs.existsSync(resolved + '.bak')) fs.unlinkSync(resolved + '.bak'); } catch (_) {}
    return { ok: true };
  } catch (err) {
    console.error('delete-project error:', err);
    return { ok: false, code: err.code, error: err.message };
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
// 大きすぎる画像は取り込みを断る（F25）。ここでの上限はファイルサイズのみで、
// 長辺 4096px を超える画像の縮小は renderer 側（setStepImage の前）で行う。
const IMPORT_IMAGE_MAX_BYTES = 50 * 1024 * 1024;

ipcMain.handle('import-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title:      '画像を読み込む',
    filters:    [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > IMPORT_IMAGE_MAX_BYTES) {
      return { ok: false, code: 'TOO_LARGE', error: '画像ファイルが大きすぎます（50MBまで）' };
    }
    const buf  = fs.readFileSync(filePath);
    const ext  = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return { ok: true, dataUrl: `data:image/${mime};base64,${buf.toString('base64')}` };
  } catch (err) {
    console.error('import-image error:', err);
    return { ok: false, code: err.code, error: err.message };
  }
});

// ─── IPC: Export ──────────────────────────────────────────────────────────────
// 保存先フォルダーを覚え、次回の保存ダイアログの初期フォルダにする（E5）。
function getLastExportDir() {
  const settings = readJSON(SETTINGS_FILE, {});
  return settings.lastExportDir && fs.existsSync(settings.lastExportDir) ? settings.lastExportDir : EXPORTS_DIR;
}
function rememberExportDir(filePath) {
  rememberExportDirPath(path.dirname(filePath));
}
function rememberExportDirPath(dir) {
  try {
    const settings = Object.assign({}, DEFAULT_SETTINGS, readJSON(SETTINGS_FILE, {}));
    settings.lastExportDir = dir;
    writeJSON(SETTINGS_FILE, settings);
  } catch (err) {
    console.error('rememberExportDir error:', err);
  }
}

/**
 * overwritePath が指定され、かつその親フォルダーが実在するときだけそのパスへ上書きする
 * （「前回と同じ設定でエクスポート」用。存在しないフォルダーへは書けないので通常のダイアログに
 * フォールバックする）。それ以外は保存ダイアログを表示する。戻り値は選ばれた絶対パス、
 * キャンセル時は null。
 */
async function resolveExportPath(overwritePath, { title, defaultName, extensions, extName }) {
  if (overwritePath && fs.existsSync(path.dirname(overwritePath))) {
    return overwritePath;
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    title,
    defaultPath: path.join(getLastExportDir(), defaultName),
    filters:     [{ name: extName, extensions }],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

// ─── IPC: Export PDF ─────────────────────────────────────────────────────────
ipcMain.handle('export-pdf', async (_event, { html, fileName, pageSize, landscape, pageNumbers, overwritePath }) => {
  const defaultName = ensureExt(fileName, 'pdf');
  const filePath = await resolveExportPath(overwritePath, {
    title: 'PDFとして保存', defaultName, extensions: ['pdf'], extName: 'PDF',
  });
  if (!filePath) return null;

  // Create a hidden BrowserWindow to render the HTML and print to PDF.
  // javascript: false — 出力する HTML に script が紛れ込んでいても隠しウィンドウで実行させない（多層防御, S1）。
  const win = new BrowserWindow({
    width:  1200,
    height: 900,
    show:   false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, javascript: false },
  });

  // data: URL は URL 長制限があり、画像入り複数ステップの HTML で確実に破綻する。
  // 一時ファイル経由で読み込む。
  const tmpHtml = path.join(os.tmpdir(), `opesna_export_${process.pid}_${Date.now()}.html`);
  try {
    fs.writeFileSync(tmpHtml, html, 'utf8');
    await win.loadFile(tmpHtml);
    const validSizes = new Set(['A4', 'A3', 'B5', 'Letter']);
    const pdfData = await win.webContents.printToPDF({
      printBackground: true,
      pageSize:        validSizes.has(pageSize) ? pageSize : 'A4', // F11: renderer から渡された用紙サイズを反映
      landscape:       !!landscape,
      margins:         { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }, // インチ（現状値を維持）
      displayHeaderFooter: !!pageNumbers,
      headerTemplate:  '<div></div>',
      footerTemplate:  pageNumbers
        ? '<div style="font-size:9px;width:100%;text-align:center;color:#666"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
        : '<div></div>',
    });
    fs.writeFileSync(filePath, pdfData);
    registerAllowedPath(filePath); // フォルダで表示（S2）で許可するため
    rememberExportDir(filePath);
    return { ok: true, filePath };
  } catch (err) {
    console.error('export-pdf error:', err);
    return { ok: false, error: toUserMessage(err, 'エクスポート'), code: err && err.code };
  } finally {
    win.destroy();
    try { fs.unlinkSync(tmpHtml); } catch (_) {}
  }
});

// ─── IPC: Export HTML ────────────────────────────────────────────────────────
ipcMain.handle('export-html', async (_event, { html, fileName, overwritePath }) => {
  const defaultName = ensureExt(fileName, 'html');
  const filePath = await resolveExportPath(overwritePath, {
    title: 'HTMLとして保存', defaultName, extensions: ['html', 'htm'], extName: 'HTML',
  });
  if (!filePath) return null;

  try {
    fs.writeFileSync(filePath, html, 'utf8');
    registerAllowedPath(filePath); // フォルダで表示（S2）で許可するため
    rememberExportDir(filePath);
    return { ok: true, filePath };
  } catch (err) {
    console.error('export-html error:', err);
    return { ok: false, error: toUserMessage(err, 'エクスポート'), code: err && err.code };
  }
});

// ─── IPC: Export Markdown ────────────────────────────────────────────────────
// images は [{ dataUrl }]（PNG の data URL のみ）。ファイル名は index（step-01.png …）から
// ここで固定の形式に作り直す。renderer から来た名前をそのまま使わない（F12）。
ipcMain.handle('export-markdown', async (_event, { markdown, fileName, images, overwritePath }) => {
  const defaultName = ensureExt(fileName, 'md');
  const filePath = await resolveExportPath(overwritePath, {
    title: 'Markdownとして保存', defaultName, extensions: ['md', 'markdown'], extName: 'Markdown',
  });
  if (!filePath) return null;

  try {
    const baseName = path.basename(filePath).replace(/\.(md|markdown)$/i, '');
    const imagesDirName = sanitizeFileName(baseName, 'export') + '_images';
    const imagesDir = path.join(path.dirname(filePath), imagesDirName);

    const validImages = Array.isArray(images) ? images.filter(im => im && isValidPngDataUrl(im.dataUrl)) : [];
    if (validImages.length > 0) {
      mkdirSafe(imagesDir);
      validImages.forEach((im, i) => {
        const stepName = 'step-' + String(i + 1).padStart(2, '0') + '.png';
        const base64 = im.dataUrl.slice(im.dataUrl.indexOf(',') + 1);
        fs.writeFileSync(path.join(imagesDir, stepName), Buffer.from(base64, 'base64'));
      });
    }

    const finalMarkdown = markdown.split('{{IMAGES_DIR}}').join(imagesDirName);
    fs.writeFileSync(filePath, finalMarkdown, 'utf8');
    registerAllowedPath(filePath); // フォルダで表示（S2）で許可するため
    rememberExportDir(filePath);
    return { ok: true, filePath };
  } catch (err) {
    console.error('export-markdown error:', err);
    return { ok: false, error: toUserMessage(err, 'エクスポート'), code: err && err.code };
  }
});

// ─── IPC: Export PNG ──────────────────────────────────────────────────────────
// images は [{ dataUrl }]（PNG の data URL のみ）。1枚なら1ファイルの保存ダイアログ、
// 複数なら保存ダイアログで決めた名前を元に `<名前>-01.png …` を同じフォルダーに書く（F12）。
// ブラウザのダウンロードリンクは使わず、必ずこの IPC 経由で書き込む。
ipcMain.handle('export-png', async (_event, { fileName, images, overwritePath }) => {
  const validImages = Array.isArray(images) ? images.filter(im => im && isValidPngDataUrl(im.dataUrl)) : [];
  if (validImages.length === 0) {
    return { ok: false, error: '書き出せる画像がありません', code: 'NO_IMAGE' };
  }

  const defaultName = ensureExt(fileName, 'png');
  const filePath = await resolveExportPath(overwritePath, {
    title: 'PNGとして保存', defaultName, extensions: ['png'], extName: 'PNG',
  });
  if (!filePath) return null;

  try {
    if (validImages.length === 1) {
      const base64 = validImages[0].dataUrl.slice(validImages[0].dataUrl.indexOf(',') + 1);
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
      rememberExportDir(filePath);
      return { ok: true, filePath };
    }

    // 複数枚: 保存ダイアログで決めた名前を基準に <名前>-01.png … を同じフォルダーに書く
    const dir = path.dirname(filePath);
    const baseName = sanitizeFileName(path.basename(filePath).replace(/\.png$/i, ''), 'export');
    validImages.forEach((im, i) => {
      const stepPath = path.join(dir, `${baseName}-${String(i + 1).padStart(2, '0')}.png`);
      const base64 = im.dataUrl.slice(im.dataUrl.indexOf(',') + 1);
      fs.writeFileSync(stepPath, Buffer.from(base64, 'base64'));
    });
    rememberExportDirPath(dir);
    return { ok: true, filePath: dir };
  } catch (err) {
    console.error('export-png error:', err);
    return { ok: false, error: toUserMessage(err, 'エクスポート'), code: err && err.code };
  }
});

// ─── IPC: Show item in folder ────────────────────────────────────────────────
// エクスポート・保存で main が返したパス、または PROJECTS_DIR・autosave・recent
// の対象だけ許す（S2）。
ipcMain.handle('show-item-in-folder', (_event, filePath) => {
  try {
    if (!pathPolicy.canShowInFolder(filePath, {
      projectsDir:  PROJECTS_DIR,
      autosaveDir:  AUTOSAVE_DIR,
      recentPaths:  readRecentList(),
      sessionPaths: Array.from(sessionAllowedPaths),
    })) {
      return false;
    }
    shell.showItemInFolder(filePath);
    return true;
  } catch (err) {
    console.error('show-item-in-folder error:', err);
    return false;
  }
});

// ─── IPC: Autosave（未保存プロジェクトの復旧用。F6） ────────────────────────
// filePath ではなくプロジェクトの id で管理する。id はファイル名として無害化してから使う。
function autosaveFilePath(id) {
  return path.join(AUTOSAVE_DIR, sanitizeFileName(id, '') + '.opn');
}

ipcMain.handle('autosave-save', (_event, { id, data } = {}) => {
  try {
    if (typeof id !== 'string' || id === '') return { ok: false };
    mkdirSafe(AUTOSAVE_DIR);
    writeJSON(autosaveFilePath(id), data);
    return { ok: true };
  } catch (err) {
    console.error('autosave-save error:', err);
    return { ok: false, code: err.code, error: err.message };
  }
});

ipcMain.handle('autosave-list', () => {
  try {
    mkdirSafe(AUTOSAVE_DIR);
    return fs.readdirSync(AUTOSAVE_DIR)
      .filter((f) => f.endsWith('.opn'))
      .map((f) => {
        const filePath = path.join(AUTOSAVE_DIR, f);
        try {
          const stat = fs.statSync(filePath);
          const data = readJSON(filePath, {});
          return {
            id:        path.basename(f, '.opn'),
            name:      (data && data.name) || '無題',
            updatedAt: stat.mtimeMs,
          };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    console.error('autosave-list error:', err);
    return [];
  }
});

ipcMain.handle('autosave-load', (_event, id) => {
  try {
    if (typeof id !== 'string' || id === '') return null;
    return readJSON(autosaveFilePath(id), null);
  } catch (err) {
    console.error('autosave-load error:', err);
    return null;
  }
});

ipcMain.handle('autosave-clear', (_event, id) => {
  try {
    if (typeof id !== 'string' || id === '') return { ok: false };
    const filePath = autosaveFilePath(id);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { ok: true };
  } catch (err) {
    console.error('autosave-clear error:', err);
    return { ok: false };
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
    buttons: buttons || ['はい', 'いいえ', 'キャンセル'],
    defaultId: 0,
    cancelId:  2,
    noLink: true,
  });
  return result.response; // 0=はい, 1=いいえ, 2=キャンセル
});

// ─── IPC: 自動更新（WP8） ───────────────────────────────────────────────────────

ipcMain.handle('update-check', async () => {
  const settings = getMergedSettings();
  const result = await updater.checkForUpdate(settings);
  lastUpdateCheckResult = result;
  patchSettings(result.settingsPatch);
  return {
    status:      result.status,
    currentVersion: result.currentVersion,
    latestTag:   result.latestTag,
    message:     result.message,
    canApply:    result.status === 'available' && !!result.downloadUrl,
  };
});

ipcMain.handle('update-download-and-apply', async () => {
  // 画面を開いたまま長く待たせている間にズレが出ないよう、直前にもう一度確かめてから使う
  const settings = getMergedSettings();
  const info = await updater.checkForUpdate(settings);
  lastUpdateCheckResult = info;
  patchSettings(info.settingsPatch);

  if (info.status !== 'available' || !info.downloadUrl) {
    return { ok: false, reason: 'not-available', message: info.message };
  }

  const result = await updater.downloadAndApply(info, (percent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-progress', percent);
    }
  });

  if (result.ok) {
    applyingUpdate = true;
    // 待ち役はすでに detached で起動済み。close ガードを通さず終了する（すでに保存済みのため）。
    setImmediate(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
      app.quit();
    });
  }
  return result;
});

ipcMain.handle('update-cancel', () => {
  updater.cancelDownload();
  return true;
});

// 開く URL は main 側が直前の確認結果から組み立てたものだけを使う。
// renderer から URL を受け取る口は作らない（仕様書 U-05）。
ipcMain.handle('update-open-release-page', () => {
  const url = lastUpdateCheckResult && lastUpdateCheckResult.releaseUrl;
  if (!url) return false;
  return updater.openReleasePage(url);
});

ipcMain.handle('update-test-connection', async () => {
  const settings = getMergedSettings();
  const latestTag = lastUpdateCheckResult && lastUpdateCheckResult.status === 'available'
    ? lastUpdateCheckResult.latestTag
    : null;
  return updater.testConnection(settings, latestTag);
});

ipcMain.handle('update-get-state', () => ({
  currentVersion:   app.getVersion(),
  isPortableBuild:  updater.isPortableBuild(),
  lastCheck:        lastUpdateCheckResult,
}));

// ［×］で帯を閉じたとき。今控えている版（updatePendingTag）を「その版では次に出さない」対象にする。
// タグは renderer から受け取らず、main が持っている値だけを使う。
ipcMain.handle('update-dismiss-pending', () => {
  const settings = getMergedSettings();
  if (settings.updatePendingTag) {
    patchSettings({ updateDismissedTag: settings.updatePendingTag });
  }
  return true;
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
