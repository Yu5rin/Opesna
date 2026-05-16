'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('opesna', {
  getSettings:       ()  => ipcRenderer.invoke('get-settings'),
  saveSettings:      (s) => ipcRenderer.invoke('save-settings', s),
  getShortcuts:      ()  => ipcRenderer.invoke('get-shortcuts'),
  saveShortcuts:     (s) => ipcRenderer.invoke('save-shortcuts', s),
  getRecent:         ()  => ipcRenderer.invoke('get-recent'),
  addRecent:         (p) => ipcRenderer.invoke('add-recent', p),
  getTemplates:      ()  => ipcRenderer.invoke('get-templates'),
  getProjects:       ()  => ipcRenderer.invoke('get-projects'),
  saveProject:       (d) => ipcRenderer.invoke('save-project', d),
  openProjectDialog: ()  => ipcRenderer.invoke('open-project-dialog'),
  saveProjectDialog: (d) => ipcRenderer.invoke('save-project-dialog', d),
  deleteProject:     (p) => ipcRenderer.invoke('delete-project', p),
  captureScreen:     ()  => ipcRenderer.invoke('capture-screen'),
  captureWindow:     ()  => ipcRenderer.invoke('capture-window'),
  importImage:       ()  => ipcRenderer.invoke('import-image'),
  exportPDF:         (d) => ipcRenderer.invoke('export-pdf', d),
  exportHTML:        (d) => ipcRenderer.invoke('export-html', d),
  exportMarkdown:    (d) => ipcRenderer.invoke('export-markdown', d),
  showItemInFolder:  (p) => ipcRenderer.invoke('show-item-in-folder', p),
  setTitle:          (t) => ipcRenderer.send('set-title', t),
});
