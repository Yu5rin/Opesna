'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('opesna', {
  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings:    ()  => ipcRenderer.invoke('get-settings'),
  saveSettings:   (s) => ipcRenderer.invoke('save-settings', s),

  // ── Shortcuts ─────────────────────────────────────────────────────────────
  getShortcuts:   ()  => ipcRenderer.invoke('get-shortcuts'),
  saveShortcuts:  (s) => ipcRenderer.invoke('save-shortcuts', s),
  // 保存後にメニューのアクセラレータを作り直してもらう通知（E13）
  notifyShortcutsChanged: () => ipcRenderer.send('shortcuts-changed'),

  // ── Recent files ──────────────────────────────────────────────────────────
  getRecent:      ()  => ipcRenderer.invoke('get-recent'),
  addRecent:      (p) => ipcRenderer.invoke('add-recent', p),

  // ── Templates ─────────────────────────────────────────────────────────────
  getTemplates:   ()  => ipcRenderer.invoke('get-templates'),

  // ── Projects ──────────────────────────────────────────────────────────────
  getProjects:         ()       => ipcRenderer.invoke('get-projects'),
  getRecentProjects:   ()       => ipcRenderer.invoke('get-recent-projects'),
  getProjectFolders:   ()       => ipcRenderer.invoke('get-project-folders'),
  createProjectFolder: (n)      => ipcRenderer.invoke('create-project-folder', n),
  renameProjectFolder: (o, n)   => ipcRenderer.invoke('rename-project-folder', { oldName: o, newName: n }),
  deleteProjectFolder: (n)      => ipcRenderer.invoke('delete-project-folder', n),
  saveProject:         (d)      => ipcRenderer.invoke('save-project', d),
  openProjectDialog:   ()       => ipcRenderer.invoke('open-project-dialog'),
  openProjectByPath:   (p)      => ipcRenderer.invoke('open-project-by-path', p),
  saveProjectDialog:   (d)      => ipcRenderer.invoke('save-project-dialog', d),
  deleteProject:       (p)      => ipcRenderer.invoke('delete-project', p),
  moveProject:         (d)      => ipcRenderer.invoke('move-project', d),
  renameProject:       (d)      => ipcRenderer.invoke('rename-project', d),

  // ── Capture ───────────────────────────────────────────────────────────────
  captureScreen:     ()   => ipcRenderer.invoke('capture-screen'),
  captureWindow:      ()  => ipcRenderer.invoke('capture-window'),
  captureWindowFull:  (id) => ipcRenderer.invoke('capture-window-full', id),
  importImage:        ()  => ipcRenderer.invoke('import-image'),

  // ── Export ────────────────────────────────────────────────────────────────
  exportPDF:      (d) => ipcRenderer.invoke('export-pdf', d),
  exportHTML:     (d) => ipcRenderer.invoke('export-html', d),
  exportMarkdown: (d) => ipcRenderer.invoke('export-markdown', d),
  exportPNG:      (d) => ipcRenderer.invoke('export-png', d),

  // ── Shell ─────────────────────────────────────────────────────────────────
  showItemInFolder: (p) => ipcRenderer.invoke('show-item-in-folder', p),

  // ── Autosave（未保存プロジェクトの復旧用） ──────────────────────────────────
  autosaveSave:  (id, data) => ipcRenderer.invoke('autosave-save', { id, data }),
  autosaveList:  ()         => ipcRenderer.invoke('autosave-list'),
  autosaveLoad:  (id)       => ipcRenderer.invoke('autosave-load', id),
  autosaveClear: (id)       => ipcRenderer.invoke('autosave-clear', id),

  // ── Window title ──────────────────────────────────────────────────────────
  setTitle: (t) => ipcRenderer.send('set-title', t),

  // ── Unsaved-changes flag (native close guard) ─────────────────────────────
  setModified: (v) => ipcRenderer.send('set-modified', v),

  // ── Window controls ───────────────────────────────────────────────────────
  windowClose: () => ipcRenderer.invoke('window-close'),

  // ── Dialogs ───────────────────────────────────────────────────────────────
  showConfirmDialog: (opts) => ipcRenderer.invoke('show-confirm-dialog', opts),

  // ── Recording ─────────────────────────────────────────────────────────────
  startRecording: ()  => ipcRenderer.invoke('start-recording'),
  stopRecording:  ()  => ipcRenderer.invoke('stop-recording'),

  // ── 自動更新（WP8） ───────────────────────────────────────────────────────────
  updateCheck:            ()  => ipcRenderer.invoke('update-check'),
  updateDownloadAndApply: ()  => ipcRenderer.invoke('update-download-and-apply'),
  updateCancel:           ()  => ipcRenderer.invoke('update-cancel'),
  // URL は main 側が直前の確認結果から組み立てたものだけを使う。ここでは渡さない（仕様書 U-05）。
  updateOpenReleasePage:  ()  => ipcRenderer.invoke('update-open-release-page'),
  updateTestConnection:   ()  => ipcRenderer.invoke('update-test-connection'),
  updateGetState:         ()  => ipcRenderer.invoke('update-get-state'),
  updateDismissPending:   ()  => ipcRenderer.invoke('update-dismiss-pending'),

  // ── Event listeners (one-way from main → renderer) ────────────────────────
  /** Called by the recording indicator window to receive step counts. */
  onStepCount: (cb) => {
    ipcRenderer.on('step-count', (_event, count) => cb(count));
  },

  /** Called by the main renderer to receive menu action commands. */
  onMenuAction: (cb) => {
    ipcRenderer.on('menu-action', (_event, action) => cb(action));
  },

  /** Called when uiohook-napi is unavailable. */
  onRecordingNoHook: (cb) => {
    ipcRenderer.on('recording-no-hook', () => cb());
  },

  /** Called when recording starts — renderer should prepare project for incoming steps. */
  onRecordingStart: (cb) => {
    ipcRenderer.on('recording-start', () => cb());
  },

  /** Called for each captured step in real-time during recording. */
  onStepCaptured: (cb) => {
    ipcRenderer.on('step-captured', (_event, step) => cb(step));
  },

  /** Called by the recording indicator to show a short status（例:「保存中…」）. */
  onRecordingStatus: (cb) => {
    ipcRenderer.on('recording-status', (_event, message) => cb(message));
  },

  /** Called once per recording when the clicked element's info could not be read. */
  onRecordingUiaUnavailable: (cb) => {
    ipcRenderer.on('recording-uia-unavailable', () => cb());
  },

  /** Called when a double-click upgrades a previously recorded step's title. */
  onStepTitleUpdate: (cb) => {
    ipcRenderer.on('step-title-update', (_event, payload) => cb(payload));
  },

  /** Called when recording stops; payload is the total step count (steps already sent in real-time). */
  onRecordingFinished: (cb) => {
    ipcRenderer.on('recording-finished', (_event, count) => cb(count));
  },

  /** Called when the user chose 「保存して終了」 in the native close dialog. */
  onSaveAndQuit: (cb) => {
    ipcRenderer.on('save-and-quit', () => cb());
  },

  /** 起動時の確認・「更新を確認」の再確認で、新しい版が見つかったとき（帯の表示用）。 */
  onUpdateAvailable: (cb) => {
    ipcRenderer.on('update-available', (_event, payload) => cb(payload));
  },

  /** ダウンロード中の進み具合（0〜100）。 */
  onUpdateProgress: (cb) => {
    ipcRenderer.on('update-progress', (_event, percent) => cb(percent));
  },
});
