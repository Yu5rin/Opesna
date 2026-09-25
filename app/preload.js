'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('opesna', {
  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings:    ()  => ipcRenderer.invoke('get-settings'),
  saveSettings:   (s) => ipcRenderer.invoke('save-settings', s),

  // ── Shortcuts ─────────────────────────────────────────────────────────────
  getShortcuts:   ()  => ipcRenderer.invoke('get-shortcuts'),
  saveShortcuts:  (s) => ipcRenderer.invoke('save-shortcuts', s),

  // ── Recent files ──────────────────────────────────────────────────────────
  getRecent:      ()  => ipcRenderer.invoke('get-recent'),
  addRecent:      (p) => ipcRenderer.invoke('add-recent', p),

  // ── Templates ─────────────────────────────────────────────────────────────
  getTemplates:   ()  => ipcRenderer.invoke('get-templates'),

  // ── Projects ──────────────────────────────────────────────────────────────
  getProjects:         ()       => ipcRenderer.invoke('get-projects'),
  getProjectFolders:   ()       => ipcRenderer.invoke('get-project-folders'),
  createProjectFolder: (n)      => ipcRenderer.invoke('create-project-folder', n),
  saveProject:         (d)      => ipcRenderer.invoke('save-project', d),
  openProjectDialog:   ()       => ipcRenderer.invoke('open-project-dialog'),
  openProjectByPath:   (p)      => ipcRenderer.invoke('open-project-by-path', p),
  saveProjectDialog:   (d)      => ipcRenderer.invoke('save-project-dialog', d),
  deleteProject:       (p)      => ipcRenderer.invoke('delete-project', p),

  // ── Capture ───────────────────────────────────────────────────────────────
  captureScreen:  ()  => ipcRenderer.invoke('capture-screen'),
  captureWindow:  ()  => ipcRenderer.invoke('capture-window'),
  importImage:    ()  => ipcRenderer.invoke('import-image'),

  // ── Export ────────────────────────────────────────────────────────────────
  exportPDF:      (d) => ipcRenderer.invoke('export-pdf', d),
  exportHTML:     (d) => ipcRenderer.invoke('export-html', d),
  exportMarkdown: (d) => ipcRenderer.invoke('export-markdown', d),

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
});
