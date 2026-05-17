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

  // ── Window title ──────────────────────────────────────────────────────────
  setTitle: (t) => ipcRenderer.send('set-title', t),

  // ── Window controls ───────────────────────────────────────────────────────
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose:    () => ipcRenderer.invoke('window-close'),

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

  /** Called when recording stops; payload is the total step count (steps already sent in real-time). */
  onRecordingFinished: (cb) => {
    ipcRenderer.on('recording-finished', (_event, count) => cb(count));
  },
});
