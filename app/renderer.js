'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  screen: 'home',
  homeView: 'home',
  project: {
    filePath: null,
    name: '無題',
    category: null,
    modified: false,
    template: 'simple',
    steps: []
  },
  editor: {
    currentStep: -1,
    tool: 'select',
    color: '#c0392b',
    strokeWidth: 3,
    opacity: 0.8,
    badgeShape: 'circle',
    badgeSize: 'medium',
    badgeColor: '#1f4e8c',
    badgeNextNum: 1,
    zoom: 1.0,
    selectedAnnotation: null,
    drawing: false,
    dragMode: null,
    dragStart: null,
    dragAnnSnap: null,
    dragUndoPushed: false,
    arrowHead: 'filled',
    arrowTail: 'none',
    lineStyle: 'solid',
    fontSize: 14,
    drawStart: { x: 0, y: 0 },
    undoStack: [],
    redoStack: []
  },
  settings: {},
  shortcuts: {},
  recent: [],
  templates: [],
  projectFolders: [],
  selectedTemplate: null,
  editingShortcutKey: null,
  currentPrefsTab: 'general',
  recording: false
};

// ─────────────────────────────────────────────────────────────────────────────
// BUILT-IN TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────

const BUILTIN_TEMPLATES = [
  {
    id: 'simple',
    name: 'シンプル',
    category: 'standard',
    description: '番号・画像・説明が縦に並ぶ標準レイアウト',
    preview: 'simple',
    headerColor: '#1f4e8c',
    badgeColor: '#1f4e8c',
    badgeShape: 'circle',
    layout: 'single',
    background: '#ffffff',
    fontSize: 13
  },
  {
    id: 'compact',
    name: 'コンパクト',
    category: 'standard',
    description: '画像を小さく、テキスト中心のコンパクトな表示',
    preview: 'compact',
    headerColor: '#1a1714',
    badgeColor: '#1f4e8c',
    badgeShape: 'circle',
    layout: 'compact',
    background: '#ffffff',
    fontSize: 12
  },
  {
    id: 'business-dark',
    name: 'ビジネス（ダーク）',
    category: 'business',
    description: 'ダークヘッダーのビジネス向けフォーマル資料',
    preview: 'business',
    headerColor: '#1e2a3a',
    badgeColor: '#1f5fa8', // JSON（正）と同じ色に（白文字とのコントラストを 4.5:1 以上にするため, U3）
    badgeShape: 'circle',
    layout: 'business',
    // background は templates/business-dark.json（正）と揃える。以前は内蔵側だけ #f0f4f8 になっており、
    // JSON を読めない環境で予備として使われたときに「暗い背景に明るい文字」の想定と食い違っていた（U3）。
    background: '#1e2a3a',
    // 「暗い背景に明るい文字」のテンプレートなので、コントラスト比の自動判定に任せず明示する。
    textColor: '#f5f3ef',
    mutedColor: '#c8ccd4',
    fontSize: 13
  },
  {
    id: 'two-column',
    name: '2カラム',
    category: 'standard',
    description: 'ステップを2列グリッドで並べて表示',
    preview: '2col',
    headerColor: '#27ae60',
    badgeColor: '#1f4e8c',
    badgeShape: 'circle',
    layout: 'two-column',
    background: '#ffffff',
    fontSize: 12
  },
  {
    id: 'large-number',
    name: '番号大きめ',
    category: 'standard',
    description: '大きな番号バッジが目立つわかりやすいレイアウト',
    preview: 'numbi',
    headerColor: '#faf8f5',
    badgeColor: '#c0392b',
    badgeShape: 'circle',
    layout: 'large-number',
    background: '#faf8f5',
    fontSize: 13
  },
  {
    id: 'casual-memo',
    name: 'メモ帳風',
    category: 'casual',
    description: '手書き風のカジュアルなメモ帳スタイル',
    preview: 'memo',
    headerColor: '#f0ad4e',
    badgeColor: '#f0ad4e',
    badgeShape: 'circle',
    layout: 'memo',
    background: '#fffef7',
    fontSize: 13
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS GLOBALS
// ─────────────────────────────────────────────────────────────────────────────

let canvas = null;
let ctx = null;
let autoSaveTimer = null;

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  try {
    [state.settings, state.shortcuts, state.recent, state.templates] = await Promise.all([
      window.opesna.getSettings(),
      window.opesna.getShortcuts(),
      window.opesna.getRecent(),
      window.opesna.getTemplates()
    ]);
  } catch (e) {
    console.warn('Failed to load initial data:', e);
    state.settings = state.settings || {};
    state.shortcuts = state.shortcuts || {};
    state.recent = state.recent || [];
    state.templates = state.templates || [];
  }

  if (!state.templates || state.templates.length === 0) {
    state.templates = BUILTIN_TEMPLATES;
  }

  try {
    state.projectFolders = await window.opesna.getProjectFolders();
  } catch (e) {
    state.projectFolders = [];
  }

  renderSidebarFolders();
  populateCategoryDropdown();
  renderHome();
  setupEventListeners();
  setupKeyboardShortcuts();
  applyShortcutTooltips();
  startAutoSaveTimer();
  updateUndoRedoButtons();
});

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  state.screen = name;

  if (name === 'editor') {
    // Defer canvas init until DOM is visible
    requestAnimationFrame(() => {
      initCanvas();
      renderCanvas();
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HOME SCREEN
// ─────────────────────────────────────────────────────────────────────────────

function renderSidebarFolders() {
  const container = document.getElementById('sidebar-folders');
  if (!container) return;
  container.innerHTML = '';

  (state.projectFolders || []).forEach(folderName => {
    const item = document.createElement('div');
    item.className = 'sidebar-item';
    item.dataset.view = 'folder:' + folderName;
    item.textContent = '📂 ' + folderName;
    if (state.homeView === 'folder:' + folderName) item.classList.add('active');
    item.addEventListener('click', () => {
      state.homeView = 'folder:' + folderName;
      renderHome();
    });
    container.appendChild(item);
  });

  // "＋ フォルダを追加" button
  const addBtn = document.createElement('div');
  addBtn.className = 'sidebar-add-folder';
  addBtn.textContent = '＋ フォルダを追加';
  addBtn.addEventListener('click', async () => {
    const name = prompt('新しいフォルダ名を入力してください:');
    if (!name || !name.trim()) return;
    try {
      await window.opesna.createProjectFolder(name.trim());
      await refreshProjectFolders();
      state.homeView = 'folder:' + name.trim();
      renderHome();
    } catch (err) {
      showToast('フォルダの作成に失敗しました', 'error');
    }
  });
  container.appendChild(addBtn);
}

async function refreshProjectFolders() {
  try {
    state.projectFolders = await window.opesna.getProjectFolders();
  } catch (e) {
    state.projectFolders = [];
  }
  renderSidebarFolders();
  populateCategoryDropdown();
}

function populateCategoryDropdown() {
  const catEl = document.getElementById('prop-category');
  if (!catEl) return;
  const current = catEl.value;
  catEl.innerHTML = '<option value="">なし</option>';
  (state.projectFolders || []).forEach(folderName => {
    const opt = document.createElement('option');
    opt.value = folderName;
    opt.textContent = '📂 ' + folderName;
    catEl.appendChild(opt);
  });
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '＋ 新しいフォルダを作成...';
  catEl.appendChild(newOpt);
  catEl.value = current || state.project.category || '';
}

async function renderHome() {
  const grid = document.getElementById('file-grid');

  // Update sidebar active state
  document.querySelectorAll('.sidebar-item[data-view]').forEach(item => {
    item.classList.toggle('active', item.dataset.view === state.homeView);
  });

  // Update section label
  let sectionLabel = '最近使ったファイル';
  if (state.homeView === 'all') sectionLabel = 'すべてのファイル';
  else if (state.homeView.startsWith('folder:')) sectionLabel = state.homeView.slice(7);
  const labelEl = document.querySelector('.section-label');
  if (labelEl) labelEl.textContent = sectionLabel;

  // Remove existing file cards (not the new button)
  grid.querySelectorAll('.file-card').forEach(c => c.remove());
  const emptyMsg = grid.querySelector('.file-card-empty');
  if (emptyMsg) emptyMsg.remove();

  const newBtn = grid.querySelector('.file-card-new');

  let projects = [];
  try {
    projects = await window.opesna.getProjects();
  } catch (e) {
    console.warn('getProjects failed:', e);
  }
  projects = projects || [];

  // Filter by view
  if (state.homeView === 'recent' || state.homeView === 'home') {
    projects = projects.slice(0, 20);
  } else if (state.homeView.startsWith('folder:')) {
    const folderName = state.homeView.slice(7);
    projects = projects.filter(p => p.folder === folderName);
  }
  // 'all' shows everything (no filter)

  if (projects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'file-card-empty';
    if (state.homeView.startsWith('folder:')) {
      empty.textContent = `「${state.homeView.slice(7)}」フォルダにプロジェクトはありません`;
    } else {
      empty.textContent = 'プロジェクトがありません';
    }
    empty.style.cssText = 'color:#9c9690;font-size:12px;grid-column:1/-1;padding:20px 0;';
    grid.insertBefore(empty, newBtn);
    return;
  }

  const colors = [
    'linear-gradient(135deg,#e5edf8,#c0d0f0)',
    'linear-gradient(135deg,#e8f5ee,#c0ddd0)',
    'linear-gradient(135deg,#fff3e0,#f0d8b0)',
    'linear-gradient(135deg,#fde8e8,#f0c0c0)'
  ];

  projects.forEach(proj => {
    const card = document.createElement('div');
    card.className = 'file-card';
    const date = proj.modified
      ? new Date(proj.modified).toLocaleDateString('ja-JP')
      : '—';
    const colorIdx = (proj.name || '').length % colors.length;
    const stepLabel = (proj.steps || 0) > 0 ? proj.steps + ' steps' : '0 steps';
    const catIcon = proj.folder ? ` 📂${proj.folder}` : '';

    card.innerHTML = `
      <div class="file-thumb" style="background:${colors[colorIdx]}">
        📋
        <div class="file-thumb-badge">${stepLabel}</div>
      </div>
      <div class="file-info">
        <div class="file-name" title="${escapeHtml(proj.name || '無題')}">${escapeHtml(proj.name || '無題')}</div>
        <div class="file-meta">${date}${catIcon}</div>
      </div>
    `;

    // Left click: open directly by path
    card.addEventListener('click', async () => {
      if (!(await confirmDiscardChanges())) return;
      if (proj.filePath) {
        await openProjectByPath(proj.filePath);
      } else {
        openProject();
      }
    });

    // Right click: context menu
    card.addEventListener('contextmenu', e => {
      e.preventDefault();
      showFileCardContextMenu(proj, card, e);
    });

    grid.insertBefore(card, newBtn);
  });
}

function showFileCardContextMenu(proj, card, e) {
  const existing = document.querySelector('.context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999;background:#fff;border:1px solid #d4cfc7;border-radius:6px;padding:4px 0;box-shadow:0 6px 20px rgba(0,0,0,.12);min-width:140px`;

  const items = [
    {
      label: '開く',
      action: () => proj.filePath ? openProjectByPath(proj.filePath) : openProject()
    },
    {
      label: 'フォルダで表示',
      action: () => {
        if (proj.filePath) window.opesna.showItemInFolder(proj.filePath);
      }
    },
    { separator: true },
    {
      label: '削除',
      danger: true,
      action: async () => {
        if (!proj.filePath) return;
        const res = await window.opesna.showConfirmDialog({
          title:   '削除の確認',
          message: `「${proj.name}」を削除しますか？`,
          detail:  'この操作は元に戻せません。',
          buttons: ['削除', 'キャンセル'],
        });
        if (res !== 0) return;
        try {
          await window.opesna.deleteProject(proj.filePath);
          showToast('削除しました', 'ok');
          renderHome();
        } catch (err) {
          showToast('削除に失敗しました', 'error');
        }
      }
    }
  ];

  items.forEach(item => {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:#e8e4df;margin:3px 0';
      menu.appendChild(sep);
      return;
    }
    const div = document.createElement('div');
    div.textContent = item.label;
    div.style.cssText = `padding:8px 16px;cursor:pointer;font-size:12px;color:${item.danger ? '#c0392b' : '#18150f'}`;
    div.addEventListener('click', () => {
      item.action();
      if (menu.parentNode) menu.parentNode.removeChild(menu);
    });
    div.addEventListener('mouseenter', () => { div.style.background = '#f7f4ef'; });
    div.addEventListener('mouseleave', () => { div.style.background = ''; });
    menu.appendChild(div);
  });

  document.body.appendChild(menu);

  const closeMenu = ev => {
    if (!menu.contains(ev.target)) {
      if (menu.parentNode) menu.parentNode.removeChild(menu);
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('contextmenu', closeMenu);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeMenu);
    document.addEventListener('contextmenu', closeMenu);
  }, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 未保存の変更がある場合に確認する。
 * @returns {Promise<boolean>} true = 続行してよい / false = キャンセル
 */
async function confirmDiscardChanges() {
  if (!state.project.modified) return true;
  const res = await window.opesna.showConfirmDialog({
    title:   '未保存の変更',
    message: '保存されていない変更があります。',
    detail:  '続行する前に保存しますか？',
    buttons: ['保存して続行', '保存せず続行', 'キャンセル'],
  });
  if (res === 2) return false;
  if (res === 0) {
    await saveProject();
    if (state.project.modified) return false; // 保存ダイアログがキャンセルされた
  }
  return true;
}

function newProject(initialImage = null, folderHint = null) {
  // Inherit the currently selected folder from the home sidebar
  const folder = folderHint ||
    (state.homeView && state.homeView.startsWith('folder:') ? state.homeView.slice(7) : null);

  state.project = {
    filePath: null,
    name: '無題',
    category: folder || null,
    modified: false,
    template: 'simple',
    steps: []
  };
  state.editor.undoStack = [];
  state.editor.redoStack = [];
  state.editor.selectedAnnotation = null;
  state.editor.badgeNextNum = 1;
  updateUndoRedoButtons();

  const firstStep = createStep('ステップ 1');
  if (initialImage) {
    firstStep.imageDataUrl = initialImage.dataUrl;
    firstStep.imageWidth = initialImage.width || 0;
    firstStep.imageHeight = initialImage.height || 0;
  }
  state.project.steps.push(firstStep);

  showScreen('editor');
  state.editor.currentStep = 0;

  renderStepList();
  loadStepProps();
  updateTitleBar();
  updateStatusBar();
}

function createStep(title) {
  return {
    id: crypto.randomUUID(),
    title: title || 'ステップ',
    description: '',
    imageDataUrl: null,
    imageWidth: 0,
    imageHeight: 0,
    annotations: []
  };
}

function getCurrentStep() {
  const idx = state.editor.currentStep;
  if (idx < 0 || idx >= state.project.steps.length) return null;
  return state.project.steps[idx];
}

async function saveProject({ silent = false } = {}) {
  saveCurrentStepProps();

  const data = {
    version: '1.0',
    name: state.project.name,
    category: state.project.category || null,
    template: state.project.template,
    steps: state.project.steps,
    exportSettings: state.project.exportSettings || null, // エクスポートのモーダル設定を .opn に持たせる（E5）
    savedAt: new Date().toISOString()
  };

  try {
    if (state.project.filePath) {
      await window.opesna.saveProject({ filePath: state.project.filePath, data });
      state.project.modified = false;
      updateTitleBar();
      updateModifiedIndicator();
      await window.opesna.addRecent(state.project.filePath);
      if (!silent) showToast('保存しました', 'ok');
    } else {
      const filePath = await window.opesna.saveProjectDialog({ data, folder: state.project.category || null });
      if (filePath) {
        state.project.filePath = filePath;
        // Keep user-set name; fall back to filename only if name is still default
        if (!state.project.name || state.project.name === '無題') {
          state.project.name = filePath.split(/[\\/]/).pop().replace(/\.opn$/i, '');
          const nameInput = document.getElementById('prop-name');
          if (nameInput) nameInput.value = state.project.name;
        }
        state.project.modified = false;
        updateTitleBar();
        updateModifiedIndicator();
        await window.opesna.addRecent(filePath);
        showToast('保存しました', 'ok');
      }
    }
  } catch (e) {
    showToast('保存に失敗しました: ' + e.message, 'error');
  }
}

async function saveProjectAs() {
  saveCurrentStepProps();
  const data = {
    version: '1.0',
    name: state.project.name,
    category: state.project.category || null,
    template: state.project.template,
    steps: state.project.steps,
    exportSettings: state.project.exportSettings || null, // エクスポートのモーダル設定を .opn に持たせる（E5）
    savedAt: new Date().toISOString()
  };
  try {
    const filePath = await window.opesna.saveProjectDialog({ data, folder: state.project.category || null });
    if (filePath) {
      state.project.filePath = filePath;
      state.project.name = filePath.split(/[\\/]/).pop().replace(/\.opn$/i, '');
      const nameInput = document.getElementById('prop-name');
      if (nameInput) nameInput.value = state.project.name;
      state.project.modified = false;
      updateTitleBar();
      updateModifiedIndicator();
      await window.opesna.addRecent(filePath);
      showToast('保存しました', 'ok');
    }
  } catch (e) {
    showToast('保存に失敗しました: ' + e.message, 'error');
  }
}

async function openProjectByPath(filePath) {
  try {
    const result = await window.opesna.openProjectByPath(filePath);
    if (!result) { showToast('ファイルを開けませんでした', 'error'); return; }
    const { data } = result;
    state.project = {
      filePath,
      name:     data.name || filePath.split(/[\\/]/).pop().replace(/\.opn$/i, ''),
      category: data.category || null,
      modified: false,
      template: data.template || 'simple',
      steps:    data.steps || []
    };
    if (state.project.steps.length === 0) {
      state.project.steps.push(createStep('ステップ 1'));
    }
    state.editor.currentStep = 0;
    state.editor.undoStack   = [];
    state.editor.redoStack   = [];
    state.editor.selectedAnnotation = null;
    state.editor.badgeNextNum = 1;
    updateUndoRedoButtons();
    state.project.steps.forEach(step => {
      step.annotations.forEach(ann => {
        if (ann.type === 'badge' && ann.badgeNumber >= state.editor.badgeNextNum) {
          state.editor.badgeNextNum = ann.badgeNumber + 1;
        }
      });
    });
    showScreen('editor');
    renderStepList();
    renderCanvas();
    loadStepProps();
    updateTitleBar();
    updateStatusBar();
    await window.opesna.addRecent(filePath);
  } catch (e) {
    showToast('ファイルを開けませんでした', 'error');
  }
}

async function openProject() {
  try {
    const result = await window.opesna.openProjectDialog();
    if (!result) return;

    const { filePath, data } = result;

    state.project = {
      filePath,
      name:     data.name || filePath.split(/[\\/]/).pop().replace(/\.opn$/i, ''),
      category: data.category || null,
      modified: false,
      template: data.template || 'simple',
      steps:    data.steps || []
    };

    if (state.project.steps.length === 0) {
      state.project.steps.push(createStep('ステップ 1'));
    }

    state.editor.currentStep = 0;
    state.editor.undoStack = [];
    state.editor.redoStack = [];
    state.editor.selectedAnnotation = null;
    state.editor.badgeNextNum = 1;
    updateUndoRedoButtons();

    // Recalculate badge next num from existing annotations
    state.project.steps.forEach(step => {
      step.annotations.forEach(ann => {
        if (ann.type === 'badge' && ann.badgeNumber >= state.editor.badgeNextNum) {
          state.editor.badgeNextNum = ann.badgeNumber + 1;
        }
      });
    });

    showScreen('editor');
    renderStepList();
    loadStepProps();
    updateTitleBar();
    updateStatusBar();

    await window.opesna.addRecent(filePath);
  } catch (e) {
    showToast('ファイルを開けませんでした: ' + e.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS INIT & RENDER
// ─────────────────────────────────────────────────────────────────────────────

function initCanvas() {
  if (canvas) return; // already initialized
  canvas = document.getElementById('main-canvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');

  canvas.addEventListener('mousedown', onCanvasMouseDown);
  canvas.addEventListener('mousemove', onCanvasMouseMove);
  canvas.addEventListener('mouseup', onCanvasMouseUp);
  canvas.addEventListener('dblclick', onCanvasDoubleClick);
}

// ステップ画像のデコード済みキャッシュ。同期描画を可能にし、
// ドラッグ中のプレビュー (drawPreview) が非同期 onload に消される問題を防ぐ。
const stepImageCache = new Map(); // stepId → HTMLImageElement

function getStepImage(step) {
  const cached = stepImageCache.get(step.id);
  if (cached && cached._src === step.imageDataUrl) return cached;
  const img = new Image();
  img._src = step.imageDataUrl;
  img.src = step.imageDataUrl;
  stepImageCache.set(step.id, img);
  // キャッシュ肥大防止: 直近50枚まで
  if (stepImageCache.size > 50) {
    const firstKey = stepImageCache.keys().next().value;
    stepImageCache.delete(firstKey);
  }
  return img;
}

function renderCanvas() {
  if (!canvas || !ctx) {
    canvas = document.getElementById('main-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
  }

  const step = getCurrentStep();
  const emptyEl = document.getElementById('canvas-empty');

  if (!step || !step.imageDataUrl) {
    canvas.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  canvas.style.display = 'block';

  const img = getStepImage(step);
  const paint = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    canvas.style.width = (img.naturalWidth * state.editor.zoom) + 'px';
    canvas.style.height = (img.naturalHeight * state.editor.zoom) + 'px';

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    step.annotations.forEach(ann => {
      const isSelected = state.editor.selectedAnnotation &&
        state.editor.selectedAnnotation.id === ann.id;
      drawAnnotation(ann, isSelected);
    });
  };

  if (img.complete && img.naturalWidth > 0) {
    paint(); // キャッシュ済み → 同期描画 (プレビューを消さない)
  } else {
    img.onload = paint;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DRAWING PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

function drawAnnotation(ann, isSelected) {
  if (!ctx) return;
  ctx.save();
  ctx.strokeStyle = ann.color || '#c0392b';
  ctx.fillStyle = ann.color || '#c0392b';
  ctx.lineWidth = ann.strokeWidth || 3;
  ctx.globalAlpha = ann.opacity !== undefined ? ann.opacity : 1.0;

  switch (ann.type) {
    case 'arrow':
      drawArrow(ann.x, ann.y, ann.x2, ann.y2, ann);
      break;

    case 'rect':
      ctx.strokeRect(ann.x, ann.y, ann.x2 - ann.x, ann.y2 - ann.y);
      if (ann.fill) {
        ctx.globalAlpha = (ann.opacity !== undefined ? ann.opacity : 1.0) * 0.2;
        ctx.fillRect(ann.x, ann.y, ann.x2 - ann.x, ann.y2 - ann.y);
      }
      break;

    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(
        (ann.x + ann.x2) / 2,
        (ann.y + ann.y2) / 2,
        Math.abs(ann.x2 - ann.x) / 2,
        Math.abs(ann.y2 - ann.y) / 2,
        0, 0, Math.PI * 2
      );
      if (ann.filled) {
        ctx.fillStyle = ann.color || '#c0392b';
        ctx.fill();
      }
      ctx.stroke();
      break;

    case 'highlight':
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = ann.color || '#f39c12';
      ctx.fillRect(ann.x, ann.y, ann.x2 - ann.x, ann.y2 - ann.y);
      ctx.globalAlpha = ann.opacity !== undefined ? ann.opacity : 1.0;
      ctx.strokeStyle = ann.color || '#f39c12';
      ctx.lineWidth = 1;
      ctx.strokeRect(ann.x, ann.y, ann.x2 - ann.x, ann.y2 - ann.y);
      break;

    case 'mosaic': {
      const mx = Math.min(ann.x, ann.x2), my = Math.min(ann.y, ann.y2);
      const mw = Math.abs(ann.x2 - ann.x), mh = Math.abs(ann.y2 - ann.y);
      if (mw > 0 && mh > 0) applyMosaicOnCtx(ctx, mx, my, mw, mh);
      break;
    }

    case 'text':
      ctx.globalAlpha = 1.0;
      ctx.font = `bold ${ann.fontSize || 16}px sans-serif`;
      ctx.fillStyle = ann.color || '#c0392b';
      ctx.fillText(ann.text || '', ann.x, ann.y);
      break;

    case 'callout':
      drawCallout(ann);
      break;

    case 'badge':
      drawBadge(ann);
      break;
  }

  if (isSelected) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#0080ff';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 4]);
    const padding = 6;
    const bx1 = Math.min(ann.x, ann.x2 !== undefined ? ann.x2 : ann.x) - padding;
    const by1 = Math.min(ann.y, ann.y2 !== undefined ? ann.y2 : ann.y) - padding;
    const bw  = Math.abs((ann.x2 !== undefined ? ann.x2 : ann.x) - ann.x) + padding * 2;
    const bh  = Math.abs((ann.y2 !== undefined ? ann.y2 : ann.y) - ann.y) + padding * 2;
    ctx.strokeRect(bx1, by1, bw || 20, bh || 20);
    ctx.setLineDash([]);

    // Draw resize handles
    const handles = getHandlePositions(ann);
    handles.forEach(h => {
      ctx.fillStyle   = '#fff';
      ctx.strokeStyle = '#0080ff';
      ctx.lineWidth   = 1.5;
      ctx.fillRect(h.x - 5, h.y - 5, 10, 10);
      ctx.strokeRect(h.x - 5, h.y - 5, 10, 10);
    });
    ctx.restore();
  }

  ctx.restore();
}

function drawArrowHead(targetCtx, fromX, fromY, toX, toY, headLen, style) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  if (style === 'filled') {
    targetCtx.beginPath();
    targetCtx.moveTo(toX, toY);
    targetCtx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
    targetCtx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
    targetCtx.closePath();
    targetCtx.fill();
  } else if (style === 'open') {
    targetCtx.beginPath();
    targetCtx.moveTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
    targetCtx.lineTo(toX, toY);
    targetCtx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
    targetCtx.stroke();
  } else if (style === 'diamond') {
    targetCtx.beginPath();
    targetCtx.moveTo(toX, toY);
    targetCtx.lineTo(toX - headLen / 2 * Math.cos(angle - Math.PI / 2), toY - headLen / 2 * Math.sin(angle - Math.PI / 2));
    targetCtx.lineTo(toX - headLen * Math.cos(angle), toY - headLen * Math.sin(angle));
    targetCtx.lineTo(toX - headLen / 2 * Math.cos(angle + Math.PI / 2), toY - headLen / 2 * Math.sin(angle + Math.PI / 2));
    targetCtx.closePath();
    targetCtx.fill();
  }
}

function drawArrow(x1, y1, x2, y2, ann) {
  const head  = (ann && ann.arrowHead)  || 'filled';
  const tail  = (ann && ann.arrowTail)  || 'none';
  const style = (ann && ann.lineStyle)  || 'solid';
  const sw    = (ann && ann.strokeWidth) || 3;
  const headLen = 12 + sw * 2.5;

  ctx.setLineDash(style === 'dashed' ? [12, 6] : style === 'dotted' ? [3, 6] : []);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);

  if (tail !== 'none') drawArrowHead(ctx, x2, y2, x1, y1, headLen, tail);
  if (head !== 'none') drawArrowHead(ctx, x1, y1, x2, y2, headLen, head);
}

function drawCallout(ann) {
  const text = ann.text || 'テキスト';
  const fontSize = ann.fontSize || 13;
  ctx.font = `bold ${fontSize}px sans-serif`;
  const metrics = ctx.measureText(text);
  const w = metrics.width + 16;
  const h = fontSize + 12;
  const x = ann.x;
  const y = ann.y;

  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff3cd';
  roundRect(ctx, x, y, w, h, 5);
  ctx.fill();

  ctx.strokeStyle = '#f0ad4e';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 5);
  ctx.stroke();

  // Tail
  ctx.beginPath();
  ctx.fillStyle = '#f0ad4e';
  ctx.moveTo(x + 10, y + h);
  ctx.lineTo(x + 4, y + h + 8);
  ctx.lineTo(x + 18, y + h);
  ctx.closePath();
  ctx.fill();

  // Text
  ctx.fillStyle = '#7a5400';
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillText(text, x + 8, y + h - 6);
}

function drawBadge(ann) {
  const sizes = { small: 20, medium: 28, large: 36 };
  const diameter = sizes[ann.badgeSize || 'medium'] || 28;
  const r = diameter / 2;
  const cx = ann.x;
  const cy = ann.y;
  const color = ann.badgeColor || '#1f4e8c';
  const shape = ann.badgeShape || 'circle';

  ctx.globalAlpha = 1;
  ctx.fillStyle = color;

  if (shape === 'circle') {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  ctx.fillStyle = '#fff';
  ctx.font = `bold ${r}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(ann.badgeNumber || 1), cx, cy);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/**
 * Render step image + all annotations to an offscreen canvas and return dataURL.
 * This ensures annotations appear in PDF/HTML exports.
 */
async function getCompositeImageDataUrl(step) {
  if (!step || !step.imageDataUrl) return null;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const offscreen = document.createElement('canvas');
      offscreen.width  = img.width;
      offscreen.height = img.height;
      const offCtx = offscreen.getContext('2d');
      offCtx.drawImage(img, 0, 0);

      // Replay all annotations on the offscreen canvas
      (step.annotations || []).forEach(ann => {
        drawAnnotationOnCtx(offCtx, ann, img.width, img.height);
      });

      resolve(offscreen.toDataURL('image/png'));
    };
    // onerror では元の値をそのまま返さない。細工された imageDataUrl が画像として
    // デコードできない場合に、その不正な値がそのまま出力 HTML の img src に流れるのを防ぐ（S1）。
    img.onerror = () => resolve(null);
    img.src = step.imageDataUrl;
  });
}

/**
 * Draw a single annotation on any CanvasRenderingContext2D.
 * This is shared between the live canvas render and composite export.
 */
function drawAnnotationOnCtx(offCtx, ann, canvasW, canvasH) {
  offCtx.save();
  offCtx.strokeStyle = ann.color || '#c0392b';
  offCtx.fillStyle   = ann.color || '#c0392b';
  offCtx.lineWidth   = ann.strokeWidth || 3;
  offCtx.globalAlpha = ann.opacity !== undefined ? ann.opacity : 1.0;

  const x  = ann.x,  y  = ann.y;
  const x2 = ann.x2, y2 = ann.y2;
  const w  = x2 - x, h  = y2 - y;

  switch (ann.type) {
    case 'arrow':
      drawArrowOnCtx(offCtx, x, y, x2, y2, ann);
      break;

    case 'rect':
      offCtx.strokeRect(Math.min(x,x2), Math.min(y,y2), Math.abs(w), Math.abs(h));
      break;

    case 'ellipse': {
      offCtx.beginPath();
      offCtx.ellipse(
        (x + x2) / 2, (y + y2) / 2,
        Math.abs(w) / 2, Math.abs(h) / 2,
        0, 0, Math.PI * 2
      );
      if (ann.filled) {
        offCtx.fillStyle = ann.color || '#c0392b';
        offCtx.fill();
      }
      offCtx.stroke();
      break;
    }

    case 'highlight': {
      const alpha = offCtx.globalAlpha;
      offCtx.globalAlpha = 0.35;
      offCtx.fillRect(Math.min(x,x2), Math.min(y,y2), Math.abs(w), Math.abs(h));
      offCtx.globalAlpha = alpha;
      offCtx.lineWidth = 1.5;
      offCtx.strokeRect(Math.min(x,x2), Math.min(y,y2), Math.abs(w), Math.abs(h));
      break;
    }

    case 'mosaic': {
      const mx = Math.min(x, x2), my = Math.min(y, y2);
      const mw = Math.abs(w),     mh = Math.abs(h);
      if (mw > 0 && mh > 0) {
        applyMosaicOnCtx(offCtx, mx, my, mw, mh);
      }
      break;
    }

    case 'text':
      if (ann.text) {
        offCtx.globalAlpha = 1;
        offCtx.font = `bold ${ann.fontSize || 15}px 'Meiryo UI', 'Yu Gothic UI', sans-serif`;
        offCtx.fillText(ann.text, x, y);
      }
      break;

    case 'callout':
      if (ann.text) drawCalloutOnCtx(offCtx, ann);
      break;

    case 'badge':
      drawBadgeOnCtx(offCtx, ann);
      break;
  }
  offCtx.restore();
}

function drawArrowHeadOnCtx(offCtx, fromX, fromY, toX, toY, headLen, style) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  if (style === 'filled') {
    offCtx.beginPath();
    offCtx.moveTo(toX, toY);
    offCtx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
    offCtx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
    offCtx.closePath();
    offCtx.fill();
  } else if (style === 'open') {
    offCtx.beginPath();
    offCtx.moveTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
    offCtx.lineTo(toX, toY);
    offCtx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
    offCtx.stroke();
  } else if (style === 'diamond') {
    offCtx.beginPath();
    offCtx.moveTo(toX, toY);
    offCtx.lineTo(toX - headLen / 2 * Math.cos(angle - Math.PI / 2), toY - headLen / 2 * Math.sin(angle - Math.PI / 2));
    offCtx.lineTo(toX - headLen * Math.cos(angle), toY - headLen * Math.sin(angle));
    offCtx.lineTo(toX - headLen / 2 * Math.cos(angle + Math.PI / 2), toY - headLen / 2 * Math.sin(angle + Math.PI / 2));
    offCtx.closePath();
    offCtx.fill();
  }
}

function drawArrowOnCtx(offCtx, x1, y1, x2, y2, ann) {
  const head    = (ann && ann.arrowHead)   || 'filled';
  const tail    = (ann && ann.arrowTail)   || 'none';
  const style   = (ann && ann.lineStyle)   || 'solid';
  const sw      = (ann && ann.strokeWidth) || 3;
  const headLen = 12 + sw * 2.5;

  offCtx.setLineDash(style === 'dashed' ? [12, 6] : style === 'dotted' ? [3, 6] : []);
  offCtx.beginPath();
  offCtx.moveTo(x1, y1);
  offCtx.lineTo(x2, y2);
  offCtx.stroke();
  offCtx.setLineDash([]);

  if (tail !== 'none') drawArrowHeadOnCtx(offCtx, x2, y2, x1, y1, headLen, tail);
  if (head !== 'none') drawArrowHeadOnCtx(offCtx, x1, y1, x2, y2, headLen, head);
}

function applyMosaicOnCtx(offCtx, x, y, w, h) {
  try {
    const imgData = offCtx.getImageData(x, y, w, h);
    const block = 14;
    for (let bx = 0; bx < w; bx += block) {
      for (let by = 0; by < h; by += block) {
        const bw = Math.min(block, w - bx);
        const bh = Math.min(block, h - by);
        const pi = (by * w + bx) * 4;
        const r = imgData.data[pi], g = imgData.data[pi+1], b = imgData.data[pi+2];
        for (let fx = 0; fx < bw; fx++) {
          for (let fy = 0; fy < bh; fy++) {
            const idx = ((by + fy) * w + (bx + fx)) * 4;
            imgData.data[idx]   = r;
            imgData.data[idx+1] = g;
            imgData.data[idx+2] = b;
          }
        }
      }
    }
    offCtx.putImageData(imgData, x, y);
  } catch (_) {}
}

function drawCalloutOnCtx(offCtx, ann) {
  const text = ann.text || '';
  const fs = ann.fontSize || 13;
  offCtx.font = `bold ${fs}px 'Meiryo UI', 'Yu Gothic UI', sans-serif`;
  const metrics = offCtx.measureText(text);
  const cw = metrics.width + 18;
  const ch = fs + 14;
  const cx = ann.x, cy = ann.y;

  offCtx.globalAlpha = 1;
  offCtx.fillStyle = '#fff3cd';
  offCtx.beginPath();
  offCtx.roundRect ? offCtx.roundRect(cx, cy, cw, ch, 5) : offCtx.rect(cx, cy, cw, ch);
  offCtx.fill();
  offCtx.strokeStyle = '#f0ad4e';
  offCtx.lineWidth = 1.5;
  offCtx.stroke();

  // Tail
  offCtx.beginPath();
  offCtx.fillStyle = '#f0ad4e';
  offCtx.moveTo(cx + 10, cy + ch);
  offCtx.lineTo(cx + 4,  cy + ch + 8);
  offCtx.lineTo(cx + 20, cy + ch);
  offCtx.closePath();
  offCtx.fill();

  offCtx.fillStyle = '#7a5400';
  offCtx.font = `bold ${fs}px 'Meiryo UI', 'Yu Gothic UI', sans-serif`;
  offCtx.fillText(text, cx + 9, cy + ch - 6);
}

function drawBadgeOnCtx(offCtx, ann) {
  const sizes = { small: 22, medium: 30, large: 40 };
  const r = (sizes[ann.badgeSize || 'medium'] || 30) / 2;
  const cx = ann.x, cy = ann.y;
  const color = ann.badgeColor || '#1f4e8c';

  offCtx.globalAlpha = 1;
  offCtx.fillStyle = color;

  if ((ann.badgeShape || 'circle') === 'circle') {
    offCtx.beginPath();
    offCtx.arc(cx, cy, r, 0, Math.PI * 2);
    offCtx.fill();
  } else {
    offCtx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  offCtx.fillStyle = '#ffffff';
  offCtx.font = `bold ${r * 1.1}px monospace`;
  offCtx.textAlign    = 'center';
  offCtx.textBaseline = 'middle';
  offCtx.fillText(String(ann.badgeNumber || 1), cx, cy);
  offCtx.textAlign    = 'left';
  offCtx.textBaseline = 'alphabetic';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ─────────────────────────────────────────────────────────────────────────────
// MOUSE EVENTS
// ─────────────────────────────────────────────────────────────────────────────

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function onCanvasMouseDown(e) {
  if (e.button !== 0) return;
  const pos = getCanvasPos(e);
  state.editor.drawing = true;
  state.editor.drawStart = pos;

  if (state.editor.tool === 'select') {
    const step = getCurrentStep();
    if (!step) return;

    // Check resize/move handles on currently selected annotation first
    // (undo は実際に動かし始めた時点で積む — 選択だけで redo が消えるのを防ぐ)
    if (state.editor.selectedAnnotation) {
      const dir = hitHandle(state.editor.selectedAnnotation, pos);
      if (dir) {
        state.editor.dragMode      = dir === 'move' ? 'move' : 'resize-' + dir;
        state.editor.dragStart     = pos;
        state.editor.dragAnnSnap   = { ...state.editor.selectedAnnotation };
        state.editor.dragUndoPushed = false;
        return;
      }
    }

    // Pick a new annotation
    const found = step.annotations.slice().reverse().find(a => hitTest(a, pos));
    state.editor.selectedAnnotation = found || null;
    if (found) {
      state.editor.dragMode      = 'move';
      state.editor.dragStart     = pos;
      state.editor.dragAnnSnap   = { ...found };
      state.editor.dragUndoPushed = false;
      syncPropsToSelectedAnnotation(found);
    } else {
      state.editor.dragMode  = null;
      state.editor.dragStart = null;
    }
    renderCanvas();
    return;
  }

  if (state.editor.tool === 'badge') {
    addAnnotation({
      id: crypto.randomUUID(),
      type: 'badge',
      x: pos.x,
      y: pos.y,
      x2: pos.x + 30,
      y2: pos.y + 30,
      badgeNumber: state.editor.badgeNextNum,
      badgeShape: state.editor.badgeShape,
      badgeSize: state.editor.badgeSize,
      badgeColor: state.editor.badgeColor,
      color: state.editor.badgeColor
    });
    state.editor.badgeNextNum++;
    const badgeNumInput = document.getElementById('prop-badge-num');
    if (badgeNumInput) badgeNumInput.value = state.editor.badgeNextNum;
    state.editor.drawing = false;
    return;
  }

  if (state.editor.tool === 'text' || state.editor.tool === 'callout') {
    state.editor.drawing = false;
    showTextInput(e.clientX, e.clientY, state.editor.tool, pos);
    return;
  }
}

function onCanvasMouseMove(e) {
  if (state.editor.tool === 'select') {
    const pos = getCanvasPos(e);

    // Update cursor based on hovered handle
    if (state.editor.selectedAnnotation && !state.editor.dragMode) {
      const dir = hitHandle(state.editor.selectedAnnotation, pos);
      const cursorMap = {
        nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
        e:  'e-resize',  se: 'se-resize', s: 's-resize',
        sw: 'sw-resize', w: 'w-resize',  move: 'move'
      };
      canvas.style.cursor = dir ? (cursorMap[dir] || 'move')
        : hitTest(state.editor.selectedAnnotation, pos) ? 'move' : 'default';
    }

    if (!state.editor.dragMode || !state.editor.dragAnnSnap || !state.editor.dragStart) return;

    const ann  = state.editor.selectedAnnotation;
    if (!ann) return;

    const dx = pos.x - state.editor.dragStart.x;
    const dy = pos.y - state.editor.dragStart.y;
    if (dx === 0 && dy === 0) return;

    // 実際に動き始めた最初のフレームで undo を1回だけ積む
    if (!state.editor.dragUndoPushed) {
      pushUndo();
      state.editor.dragUndoPushed = true;
    }

    const snap = state.editor.dragAnnSnap;

    if (state.editor.dragMode === 'move') {
      ann.x = snap.x + dx;
      ann.y = snap.y + dy;
      if (snap.x2 !== undefined) ann.x2 = snap.x2 + dx;
      if (snap.y2 !== undefined) ann.y2 = snap.y2 + dy;
    } else {
      const mode = state.editor.dragMode;            // e.g. 'resize-se'
      const dir  = mode.startsWith('resize-') ? mode.slice(7) : mode;
      if (dir.includes('n')) ann.y  = snap.y  + dy;
      if (dir.includes('s')) ann.y2 = snap.y2 + dy;
      if (dir.includes('w')) ann.x  = snap.x  + dx;
      if (dir.includes('e')) ann.x2 = snap.x2 + dx;
    }

    state.project.modified = true;
    renderCanvas();
    return;
  }

  if (!state.editor.drawing) return;
  if (state.editor.tool === 'badge') return;
  if (state.editor.tool === 'text' || state.editor.tool === 'callout') return;

  const pos = getCanvasPos(e);
  renderCanvas();
  drawPreview(state.editor.drawStart, pos);
}

function onCanvasMouseUp(e) {
  if (state.editor.tool === 'select') {
    if (state.editor.dragMode) {
      const actuallyMoved = state.editor.dragUndoPushed;
      state.editor.dragMode      = null;
      state.editor.dragStart     = null;
      state.editor.dragAnnSnap   = null;
      state.editor.dragUndoPushed = false;
      if (canvas) canvas.style.cursor = 'default';
      // 単なる選択クリックではサムネイル一覧を再描画しない (ちらつき防止)
      if (actuallyMoved) {
        updateStatusBar();
        updateModifiedIndicator();
        renderStepList();
      }
    }
    state.editor.drawing = false;
    return;
  }
  if (!state.editor.drawing) return;
  if (state.editor.tool === 'badge') {
    state.editor.drawing = false;
    return;
  }
  if (state.editor.tool === 'text' || state.editor.tool === 'callout') {
    state.editor.drawing = false;
    return;
  }

  const pos = getCanvasPos(e);
  const start = state.editor.drawStart;
  state.editor.drawing = false;

  if (Math.abs(pos.x - start.x) < 3 && Math.abs(pos.y - start.y) < 3) return;

  if (state.editor.tool === 'trim') {
    applyTrimToStep(start, pos);
    return;
  }

  const ann = {
    id: crypto.randomUUID(),
    type: state.editor.tool,
    x: start.x,
    y: start.y,
    x2: pos.x,
    y2: pos.y,
    color: state.editor.color,
    strokeWidth: state.editor.strokeWidth,
    opacity: state.editor.opacity,
    ...(state.editor.tool === 'arrow' ? {
      arrowHead: state.editor.arrowHead || 'filled',
      arrowTail: state.editor.arrowTail || 'none',
      lineStyle: state.editor.lineStyle || 'solid',
    } : {}),
    ...(state.editor.tool === 'text' || state.editor.tool === 'callout' ? {
      fontSize: state.editor.fontSize || 14,
    } : {}),
  };

  addAnnotation(ann);
}

function onCanvasDoubleClick(e) {
  const pos = getCanvasPos(e);
  if (state.editor.tool === 'text' || state.editor.tool === 'callout') {
    showTextInput(e.clientX, e.clientY, state.editor.tool, pos);
  }
}

function drawPreview(start, end) {
  if (!ctx) return;
  ctx.save();
  ctx.strokeStyle = state.editor.color;
  ctx.fillStyle = state.editor.color;
  ctx.lineWidth = state.editor.strokeWidth;
  ctx.globalAlpha = 0.8;
  ctx.setLineDash([4, 4]);

  switch (state.editor.tool) {
    case 'arrow':
      ctx.setLineDash([]);
      drawArrow(start.x, start.y, end.x, end.y);
      break;
    case 'rect':
      ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(
        (start.x + end.x) / 2,
        (start.y + end.y) / 2,
        Math.abs(end.x - start.x) / 2,
        Math.abs(end.y - start.y) / 2,
        0, 0, Math.PI * 2
      );
      ctx.stroke();
      break;
    case 'highlight':
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = state.editor.color;
      ctx.fillRect(start.x, start.y, end.x - start.x, end.y - start.y);
      break;
    case 'mosaic':
      ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      break;
    case 'trim': {
      const sx = Math.min(start.x, end.x);
      const sy = Math.min(start.y, end.y);
      const sw = Math.abs(end.x - start.x);
      const sh = Math.abs(end.y - start.y);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // Darken area outside selection
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, canvas.width, sy);
      ctx.fillRect(0, sy + sh, canvas.width, canvas.height - sy - sh);
      ctx.fillRect(0, sy, sx, sh);
      ctx.fillRect(sx + sw, sy, canvas.width - sx - sw, sh);
      // Bright dashed border around selection
      ctx.setLineDash([8, 5]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.setLineDash([8, 5]);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.lineDashOffset = 8;
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.lineDashOffset = 0;
      // Size label
      if (sw > 60 && sh > 30) {
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(sx, sy, 90, 18);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px monospace';
        ctx.fillText(`${Math.round(sw)} × ${Math.round(sh)}`, sx + 4, sy + 13);
      }
      break;
    }
  }

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIM TOOL
// ─────────────────────────────────────────────────────────────────────────────

function applyTrimToStep(start, end) {
  const step = getCurrentStep();
  if (!step || !step.imageDataUrl) return;

  const x = Math.round(Math.min(start.x, end.x));
  const y = Math.round(Math.min(start.y, end.y));
  const w = Math.round(Math.abs(end.x - start.x));
  const h = Math.round(Math.abs(end.y - start.y));
  if (w < 5 || h < 5) return;

  const img = new Image();
  img.onload = () => {
    const offscreen = document.createElement('canvas');
    offscreen.width  = w;
    offscreen.height = h;
    const offCtx = offscreen.getContext('2d');
    offCtx.drawImage(img, -x, -y);

    pushUndo();

    step.imageDataUrl = offscreen.toDataURL('image/png');
    step.imageWidth   = w;
    step.imageHeight  = h;

    // Adjust annotation positions relative to the crop origin; drop out-of-bounds ones
    step.annotations = (step.annotations || []).map(ann => ({
      ...ann,
      x:  ann.x  - x,
      y:  ann.y  - y,
      x2: ann.x2 - x,
      y2: ann.y2 - y,
    })).filter(ann =>
      ann.x2 > 0 && ann.y2 > 0 && ann.x < w && ann.y < h
    );

    // 旧オブジェクトへの参照は無効 (座標オフセット前のもの) なので解除
    state.editor.selectedAnnotation = null;

    state.project.modified = true;
    renderCanvas();
    renderStepList();
    updateStatusBar();
    updateModifiedIndicator();
    showToast('トリミングしました', 'ok');
  };
  img.src = step.imageDataUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEXT / CALLOUT INPUT OVERLAY
// ─────────────────────────────────────────────────────────────────────────────

// clientX/clientY: viewport mouse position; canvasPos: canvas-pixel position
function showTextInput(clientX, clientY, type, canvasPos) {
  const overlay = document.getElementById('text-input-overlay');
  const textarea = document.getElementById('text-input-area');
  if (!overlay || !textarea) return;

  // Use fixed positioning so the overlay always appears at the click point
  // regardless of canvas zoom or scroll state.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const OW = 200, OH = 60; // approximate overlay size
  const left = Math.min(clientX, vw - OW - 8);
  const top  = Math.min(clientY, vh - OH - 8);

  overlay.style.position = 'fixed';
  overlay.style.left = left + 'px';
  overlay.style.top  = top  + 'px';
  overlay.style.display = 'block';
  overlay.style.zIndex = '9999';

  const pos = canvasPos || { x: 0, y: 0 };

  textarea.value = '';
  // Use setTimeout to avoid blur from the current click being processed first
  setTimeout(() => textarea.focus(), 0);

  let committed = false;

  function commit() {
    if (committed) return;
    committed = true;

    const text = textarea.value.trim();
    if (text) {
      addAnnotation({
        id: crypto.randomUUID(),
        type,
        x: pos.x,
        y: pos.y,
        x2: pos.x + 150,
        y2: pos.y + 40,
        color: state.editor.color,
        strokeWidth: state.editor.strokeWidth,
        opacity: 1.0,
        text,
        fontSize: state.editor.fontSize || 14
      });
    }
    overlay.style.display = 'none';
    overlay.style.position = '';
    overlay.style.zIndex   = '';
    textarea.removeEventListener('keydown', onKey);
    textarea.removeEventListener('blur', commit);
  }

  function cancel() {
    committed = true;
    overlay.style.display  = 'none';
    overlay.style.position = '';
    overlay.style.zIndex   = '';
    textarea.removeEventListener('keydown', onKey);
    textarea.removeEventListener('blur', commit);
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { cancel(); }
  }

  textarea.addEventListener('keydown', onKey);
  textarea.addEventListener('blur', commit);
}

// ─────────────────────────────────────────────────────────────────────────────
// ANNOTATION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

function addAnnotation(ann) {
  const step = getCurrentStep();
  if (!step) return;

  pushUndo();
  if (!ann.id) ann.id = crypto.randomUUID();
  step.annotations.push(ann);
  state.project.modified = true;

  renderCanvas();
  renderStepList();
  updateStatusBar();
  updateModifiedIndicator();
}

function makeUndoSnapshot() {
  return {
    steps:        JSON.parse(JSON.stringify(state.project.steps)),
    currentStep:  state.editor.currentStep,
    badgeNextNum: state.editor.badgeNextNum,
  };
}

function restoreUndoSnapshot(snap) {
  state.project.steps = snap.steps;
  state.editor.currentStep = Math.max(0, Math.min(snap.currentStep, state.project.steps.length - 1));
  if (snap.badgeNextNum) state.editor.badgeNextNum = snap.badgeNextNum;
  const badgeNumInput = document.getElementById('prop-badge-num');
  if (badgeNumInput) badgeNumInput.value = state.editor.badgeNextNum;
  state.editor.selectedAnnotation = null;
  state.project.modified = true;
  renderCanvas();
  renderStepList();
  loadStepProps();
  updateStatusBar();
  updateModifiedIndicator();
  updateUndoRedoButtons();
}

function pushUndo() {
  state.editor.undoStack.push(makeUndoSnapshot());
  if (state.editor.undoStack.length > 30) state.editor.undoStack.shift();
  state.editor.redoStack = [];
  updateUndoRedoButtons();
}

function undo() {
  if (state.editor.undoStack.length === 0) return;
  state.editor.redoStack.push(makeUndoSnapshot());
  restoreUndoSnapshot(state.editor.undoStack.pop());
}

function redo() {
  if (state.editor.redoStack.length === 0) return;
  state.editor.undoStack.push(makeUndoSnapshot());
  restoreUndoSnapshot(state.editor.redoStack.pop());
}

/** ツールバーの元に戻す/やり直しボタンの有効状態をスタックと同期する。 */
function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('btn-undo');
  const redoBtn = document.getElementById('btn-redo');
  if (undoBtn) undoBtn.disabled = state.editor.undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = state.editor.redoStack.length === 0;
}

function deleteSelectedAnnotation() {
  const step = getCurrentStep();
  if (!step || !state.editor.selectedAnnotation) return;

  pushUndo();
  const id = state.editor.selectedAnnotation.id;
  step.annotations = step.annotations.filter(a => a.id !== id);
  state.editor.selectedAnnotation = null;
  state.project.modified = true;

  renderCanvas();
  renderStepList();
  updateStatusBar();
  updateModifiedIndicator();
}

function getHandlePositions(ann) {
  const isSimple = ann.type === 'badge' || ann.type === 'text' || ann.type === 'callout';
  if (isSimple) {
    return [{ x: ann.x, y: ann.y, dir: 'move' }];
  }
  const x1 = Math.min(ann.x, ann.x2), y1 = Math.min(ann.y, ann.y2);
  const x2 = Math.max(ann.x, ann.x2), y2 = Math.max(ann.y, ann.y2);
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  return [
    { x: x1, y: y1, dir: 'nw' }, { x: cx, y: y1, dir: 'n' }, { x: x2, y: y1, dir: 'ne' },
    { x: x2, y: cy, dir: 'e'  },
    { x: x2, y: y2, dir: 'se' }, { x: cx, y: y2, dir: 's' }, { x: x1, y: y2, dir: 'sw' },
    { x: x1, y: cy, dir: 'w'  },
  ];
}

function hitTest(ann, pos) {
  const padding = 8;
  if (ann.type === 'badge' || ann.type === 'text' || ann.type === 'callout') {
    const r = 30;
    return pos.x >= ann.x - r && pos.x <= ann.x + r &&
           pos.y >= ann.y - r && pos.y <= ann.y + r;
  }
  const x1 = Math.min(ann.x, ann.x2 !== undefined ? ann.x2 : ann.x) - padding;
  const y1 = Math.min(ann.y, ann.y2 !== undefined ? ann.y2 : ann.y) - padding;
  const x2 = Math.max(ann.x, ann.x2 !== undefined ? ann.x2 : ann.x) + padding;
  const y2 = Math.max(ann.y, ann.y2 !== undefined ? ann.y2 : ann.y) + padding;
  return pos.x >= x1 && pos.x <= x2 && pos.y >= y1 && pos.y <= y2;
}

function hitHandle(ann, pos) {
  const handles = getHandlePositions(ann);
  for (const h of handles) {
    if (Math.abs(pos.x - h.x) <= 8 && Math.abs(pos.y - h.y) <= 8) return h.dir;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP LIST
// ─────────────────────────────────────────────────────────────────────────────

function renderStepList() {
  const list = document.getElementById('step-list');
  if (!list) return;
  list.innerHTML = '';

  // 空状態の表示
  if (state.project.steps.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'step-list-empty';
    empty.textContent = 'ステップがありません';
    list.appendChild(empty);
    return;
  }

  let dragSrcIdx = null;

  state.project.steps.forEach((step, idx) => {
    const div = document.createElement('div');
    div.className = 'step-item' + (idx === state.editor.currentStep ? ' active' : '');
    div.dataset.index = idx;
    div.setAttribute('role', 'listitem');
    div.setAttribute('aria-label', `ステップ ${idx + 1}: ${step.title || ''}`);
    div.setAttribute('tabindex', '0');
    div.setAttribute('draggable', 'true');

    const stepTitle = step.title || 'ステップ ' + (idx + 1);
    div.innerHTML = `
      <div class="step-thumb">
        <canvas class="step-thumb-canvas" data-step="${idx}" width="150" height="90"></canvas>
        <div class="step-num-badge">${idx + 1}</div>
      </div>
      <div class="step-info">
        <div class="step-item-title" title="${escapeHtml(stepTitle)}">${escapeHtml(stepTitle)}</div>
        <div class="step-item-sub">${step.annotations.length}個の注釈</div>
      </div>
      <button class="step-menu-btn" data-index="${idx}" title="メニュー" aria-label="ステップメニュー">⋮</button>
    `;

    div.addEventListener('click', e => {
      if (e.target.classList.contains('step-menu-btn')) return;
      div.focus();
      selectStep(idx);
    });

    div.addEventListener('keydown', e => {
      // stopPropagation: グローバルショートカット (Delete=注釈削除) への
      // 伝播による二重処理を防ぐ
      if (e.key === 'Delete') { e.preventDefault(); e.stopPropagation(); deleteStep(idx); }
    });

    div.querySelector('.step-menu-btn').addEventListener('click', e => {
      e.stopPropagation();
      showStepContextMenu(idx, e);
    });

    // Drag-and-drop reordering
    div.addEventListener('dragstart', e => {
      dragSrcIdx = idx;
      e.dataTransfer.effectAllowed = 'move';
      div.classList.add('dragging');
    });
    div.addEventListener('dragend', () => {
      div.classList.remove('dragging');
      list.querySelectorAll('.step-item').forEach(el => el.classList.remove('drag-over'));
    });
    div.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      list.querySelectorAll('.step-item').forEach(el => el.classList.remove('drag-over'));
      div.classList.add('drag-over');
    });
    div.addEventListener('drop', e => {
      e.preventDefault();
      div.classList.remove('drag-over');
      if (dragSrcIdx !== null && dragSrcIdx !== idx) {
        moveStep(dragSrcIdx, idx);
      }
      dragSrcIdx = null;
    });

    list.appendChild(div);

    // Draw thumbnail
    if (step.imageDataUrl) {
      const thumbCanvas = div.querySelector('.step-thumb-canvas');
      const tctx = thumbCanvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        tctx.clearRect(0, 0, thumbCanvas.width, thumbCanvas.height);
        tctx.drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);
        const sx = thumbCanvas.width / img.width;
        const sy = thumbCanvas.height / img.height;
        step.annotations.forEach(ann => drawAnnotationScaled(tctx, ann, sx, sy));
      };
      img.src = step.imageDataUrl;
    }
  });

  const countEl = document.getElementById('step-count');
  if (countEl) countEl.textContent = state.project.steps.length;
}

function selectStep(idx) {
  saveCurrentStepProps();

  state.editor.currentStep = idx;
  state.editor.selectedAnnotation = null;

  renderStepList();
  renderCanvas();
  loadStepProps();
  updateStatusBar();
}

function loadStepProps() {
  const step = getCurrentStep();
  const titleInput = document.getElementById('step-title-input');
  const descInput = document.getElementById('step-desc-input');
  if (!titleInput || !descInput) return;

  if (step) {
    titleInput.value = step.title || '';
    descInput.value = step.description || '';
  } else {
    titleInput.value = '';
    descInput.value = '';
  }

  // Sync project name
  const nameEl = document.getElementById('prop-name');
  if (nameEl) nameEl.value = state.project.name || '';

  // Sync category selector
  populateCategoryDropdown();
  const catEl = document.getElementById('prop-category');
  if (catEl) catEl.value = state.project.category || '';

  updateExportPreview();
}

function saveCurrentStepProps() {
  const step = getCurrentStep();
  if (!step) return;
  const titleInput = document.getElementById('step-title-input');
  const descInput = document.getElementById('step-desc-input');
  if (titleInput) step.title = titleInput.value;
  if (descInput) step.description = descInput.value;
}

function addStep() {
  saveCurrentStepProps();
  pushUndo();
  const step = createStep('ステップ ' + (state.project.steps.length + 1));
  state.project.steps.push(step);
  state.editor.currentStep = state.project.steps.length - 1;
  state.editor.selectedAnnotation = null;
  state.project.modified = true;

  renderStepList();
  renderCanvas();
  loadStepProps();
  updateStatusBar();
  updateModifiedIndicator();
}

function deleteStep(idx) {
  if (state.project.steps.length <= 1) {
    showToast('最低1つのステップが必要です', 'warn');
    return;
  }
  pushUndo();
  state.project.steps.splice(idx, 1);
  if (state.editor.currentStep >= state.project.steps.length) {
    state.editor.currentStep = state.project.steps.length - 1;
  }
  state.editor.selectedAnnotation = null;
  state.project.modified = true;

  renderStepList();
  renderCanvas();
  loadStepProps();
  updateStatusBar();
  updateModifiedIndicator();
}

function duplicateStep(idx) {
  pushUndo();
  const orig = state.project.steps[idx];
  const copy = JSON.parse(JSON.stringify(orig));
  copy.id = crypto.randomUUID();
  copy.title = copy.title + ' (コピー)';
  copy.annotations = copy.annotations.map(a => ({ ...a, id: crypto.randomUUID() }));
  state.project.steps.splice(idx + 1, 0, copy);
  state.editor.currentStep = idx + 1;
  state.editor.selectedAnnotation = null;
  state.project.modified = true;

  renderStepList();
  renderCanvas();
  loadStepProps();
  updateStatusBar();
  updateModifiedIndicator();
}

function moveStep(fromIdx, toIdx) {
  if (toIdx < 0 || toIdx >= state.project.steps.length) return;
  pushUndo();
  const [step] = state.project.steps.splice(fromIdx, 1);
  state.project.steps.splice(toIdx, 0, step);
  state.editor.currentStep = toIdx;
  state.editor.selectedAnnotation = null;
  state.project.modified = true;

  renderStepList();
  renderCanvas();
  loadStepProps();
  updateStatusBar();
  updateModifiedIndicator();
}


function showStepContextMenu(idx, e) {
  const existing = document.querySelector('.context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999;background:#fff;border:1px solid #d4cfc7;border-radius:6px;padding:4px 0;box-shadow:0 6px 20px rgba(0,0,0,.12);min-width:140px`;

  const items = [
    { label: '複製', action: () => duplicateStep(idx) },
    { label: '上へ移動', action: () => moveStep(idx, idx - 1), disabled: idx === 0 },
    { label: '下へ移動', action: () => moveStep(idx, idx + 1), disabled: idx === state.project.steps.length - 1 },
    { separator: true },
    { label: '削除', action: () => deleteStep(idx), danger: true }
  ];

  items.forEach(item => {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:#e8e4df;margin:3px 0';
      menu.appendChild(sep);
      return;
    }
    const div = document.createElement('div');
    div.textContent = item.label;
    if (item.disabled) {
      div.style.cssText = 'padding:8px 16px;font-size:12px;color:#bbb;cursor:default';
    } else {
      div.style.cssText = `padding:8px 16px;cursor:pointer;font-size:12px;color:${item.danger ? '#c0392b' : '#18150f'}`;
      div.addEventListener('click', () => {
        item.action();
        if (menu.parentNode) menu.parentNode.removeChild(menu);
      });
      div.addEventListener('mouseenter', () => { div.style.background = '#f7f4ef'; });
      div.addEventListener('mouseleave', () => { div.style.background = ''; });
    }
    menu.appendChild(div);
  });

  document.body.appendChild(menu);

  const close = ev => {
    if (!menu.contains(ev.target)) {
      if (menu.parentNode) menu.parentNode.removeChild(menu);
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 0);
}

// Scaled annotation draw for thumbnails
function drawAnnotationScaled(tctx, ann, sx, sy) {
  tctx.save();
  tctx.strokeStyle = ann.color || '#c0392b';
  tctx.fillStyle = ann.color || '#c0392b';
  tctx.lineWidth = Math.max(1, (ann.strokeWidth || 2) * sx);
  tctx.globalAlpha = ann.opacity !== undefined ? ann.opacity : 1.0;

  const x  = ann.x  * sx;
  const y  = ann.y  * sy;
  const x2 = (ann.x2 !== undefined ? ann.x2 : ann.x) * sx;
  const y2 = (ann.y2 !== undefined ? ann.y2 : ann.y) * sy;

  switch (ann.type) {
    case 'rect':
      tctx.strokeRect(x, y, x2 - x, y2 - y);
      break;
    case 'ellipse':
      tctx.beginPath();
      tctx.ellipse((x + x2) / 2, (y + y2) / 2, Math.abs(x2 - x) / 2, Math.abs(y2 - y) / 2, 0, 0, Math.PI * 2);
      if (ann.filled) { tctx.fillStyle = ann.color || '#c0392b'; tctx.fill(); }
      tctx.stroke();
      break;
    case 'arrow': {
      const headLen = 8 * sx;
      const angle = Math.atan2(y2 - y, x2 - x);
      tctx.beginPath();
      tctx.moveTo(x, y);
      tctx.lineTo(x2, y2);
      tctx.stroke();
      tctx.beginPath();
      tctx.moveTo(x2, y2);
      tctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
      tctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
      tctx.closePath();
      tctx.fill();
      break;
    }
    case 'highlight':
      tctx.globalAlpha = 0.3;
      tctx.fillStyle = ann.color || '#f39c12';
      tctx.fillRect(x, y, x2 - x, y2 - y);
      break;
    case 'badge': {
      const r = 6 * sx;
      tctx.fillStyle = ann.badgeColor || '#1f4e8c';
      tctx.beginPath();
      tctx.arc(x, y, r, 0, Math.PI * 2);
      tctx.fill();
      tctx.fillStyle = '#fff';
      tctx.font = `bold ${Math.max(6, r)}px monospace`;
      tctx.textAlign = 'center';
      tctx.textBaseline = 'middle';
      tctx.fillText(String(ann.badgeNumber || 1), x, y);
      tctx.textAlign = 'left';
      tctx.textBaseline = 'alphabetic';
      break;
    }
  }

  tctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPTURE
// ─────────────────────────────────────────────────────────────────────────────

async function startCapture(mode) {
  closeModal('modal-capture');

  if (mode === 'import') {
    try {
      const dataUrl = await window.opesna.importImage();
      if (dataUrl) await setStepImage(dataUrl);
    } catch (e) {
      showToast('画像の読み込みに失敗しました', 'error');
    }
    return;
  }

  if (mode === 'window') {
    // 列挙には時間がかかるためローディング表示を先に出す
    const grid = document.getElementById('window-grid');
    if (grid) grid.innerHTML = '<div class="window-grid-loading">ウィンドウを取得中…</div>';
    openModal('modal-window-select');
    try {
      const windows = await window.opesna.captureWindow();
      if (windows && windows.length > 0) {
        showWindowSelectModal(windows);
      } else {
        closeModal('modal-window-select');
        showToast('ウィンドウが見つかりませんでした', 'warn');
      }
    } catch (e) {
      closeModal('modal-window-select');
      showToast('ウィンドウキャプチャに失敗しました', 'error');
    }
    return;
  }

  // fullscreen
  const delay = parseInt(document.getElementById('capture-delay')?.value || '0', 10);
  setTimeout(async () => {
    try {
      const dataUrl = await window.opesna.captureScreen();
      if (dataUrl) await setStepImage(dataUrl);
    } catch (e) {
      showToast('キャプチャに失敗しました', 'error');
    }
  }, delay * 1000 + 300);
}

async function setStepImage(dataUrl) {
  const step = getCurrentStep();
  if (!step) return;

  const loaded = await new Promise(resolve => {
    const img = new Image();
    img.onload  = () => {
      step.imageDataUrl = dataUrl;
      step.imageWidth = img.width;
      step.imageHeight = img.height;
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });

  // デコード失敗時は壊れた画像を設定せず、次ステップも追加しない
  if (!loaded) {
    showToast('画像の読み込みに失敗しました', 'error');
    return;
  }

  state.project.modified = true;
  renderCanvas();
  renderStepList();
  updateStatusBar();
  updateModifiedIndicator();
  showToast('画像を設定しました', 'ok');

  // Auto add next step if setting enabled
  if (state.settings.autoAddStep) {
    addStep();
  }
}

function showWindowSelectModal(windows) {
  const grid = document.getElementById('window-grid');
  if (!grid) return;
  grid.innerHTML = '';

  windows.forEach(w => {
    const card = document.createElement('div');
    card.dataset.url = w.dataUrl;
    card.setAttribute('role', 'listitem');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', w.name || 'ウィンドウ');
    card.style.cssText = 'cursor:pointer;border:1.5px solid #d4cfc7;border-radius:6px;overflow:hidden;transition:border-color .14s';
    card.innerHTML = `
      <img src="${w.dataUrl}" style="width:100%;display:block;pointer-events:none" alt="${escapeHtml(w.name || '')}">
      <div style="padding:6px 8px;font-size:11px;font-weight:600;text-overflow:ellipsis;overflow:hidden;white-space:nowrap">${escapeHtml(w.name || '')}</div>
    `;
    card.addEventListener('mouseenter', () => { card.style.borderColor = '#1f4e8c'; });
    card.addEventListener('mouseleave', () => { card.style.borderColor = '#d4cfc7'; });
    card.addEventListener('click', () => {
      closeModal('modal-window-select');
      setStepImage(w.dataUrl);
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        closeModal('modal-window-select');
        setStepImage(w.dataUrl);
      }
    });
    grid.appendChild(card);
  });

  openModal('modal-window-select');
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────

// テンプレートの色検証・コントラストに基づく文字色の自動選択（U3）は app/templateColors.js
// に置き、test/templates.test.js と判定ロジックを共有する。
const resolveTemplateColors = window.OpesnaTemplateColors.resolveTemplateColors;

function getCurrentTemplate() {
  return (state.templates || BUILTIN_TEMPLATES).find(t => t.id === state.project.template)
      || BUILTIN_TEMPLATES[0]
      || {};
}

async function buildExportHTML() {
  const guard = window.OpesnaExportGuard;
  const tmpl = resolveTemplateColors(getCurrentTemplate());

  saveCurrentStepProps();

  const toc = document.getElementById('export-toc')?.checked;
  const header = document.getElementById('export-header')?.checked;

  // Build composite images for all steps (image + annotations)
  const compositeImages = await Promise.all(
    state.project.steps.map(step => getCompositeImageDataUrl(step))
  );

  let tocHtml = '';
  if (toc && state.project.steps.length > 1) {
    tocHtml = `
      <nav class="toc" style="margin-bottom:32px;padding:16px;background:#f7f4ef;border-radius:6px">
        <div style="font-weight:700;margin-bottom:8px;font-size:13px;color:#18150f">目次</div>
        <ol style="margin:0;padding-left:20px;font-size:12px;line-height:2">
          ${state.project.steps.map((s, i) =>
            `<li><a href="#step-${i + 1}" style="color:#1f4e8c;text-decoration:none">${escapeHtml(s.title || 'ステップ ' + (i + 1))}</a></li>`
          ).join('')}
        </ol>
      </nav>
    `;
  }

  let stepsHtml = '';
  state.project.steps.forEach((step, i) => {
    // 画像 src は data URL の形式チェックを通ったものだけを使う（多層防御, S1）。
    const rawSrc = compositeImages[i];
    const imgSrc = guard.isValidImageDataUrl(rawSrc) ? rawSrc : '';
    stepsHtml += `
      <div class="step" id="step-${i + 1}" style="margin-bottom:40px;page-break-inside:avoid">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="width:28px;height:28px;border-radius:${tmpl.badgeShape === 'square' ? '4px' : '50%'};background:${tmpl.badgeColor};color:${tmpl.badgeTextColor};font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:monospace">${i + 1}</div>
          <h3 style="margin:0;font-size:${tmpl.fontSize + 2}px;color:${tmpl.textColor}">${escapeHtml(step.title || 'ステップ ' + (i + 1))}</h3>
        </div>
        ${imgSrc ? `<img src="${imgSrc}" alt="ステップ${i + 1}" style="max-width:100%;border-radius:4px;margin-bottom:10px;border:1px solid #d4cfc7;display:block">` : ''}
        ${step.description ? `<p style="margin:0;color:${tmpl.mutedColor};font-size:${tmpl.fontSize}px;line-height:1.7">${escapeHtml(step.description).replace(/\n/g, '<br>')}</p>` : ''}
      </div>
    `;
  });

  const headerHtml = header
    ? `<h1 style="background:${tmpl.headerColor};color:${tmpl.headerTextColor};padding:16px 24px;margin:-32px -32px 32px;font-size:20px;font-weight:700">${escapeHtml(state.project.name || '操作マニュアル')}</h1>`
    : `<h1 style="font-size:20px;margin-bottom:24px;color:${tmpl.textColor}">${escapeHtml(state.project.name || '操作マニュアル')}</h1>`;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
${guard.CSP_META}
<title>${escapeHtml(state.project.name || 'エクスポート')}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic UI', sans-serif;
    margin: 0;
    padding: 32px;
    background: ${tmpl.background};
    color: ${tmpl.textColor};
    font-size: ${tmpl.fontSize}px;
    line-height: 1.7;
  }
  h3 { color: ${tmpl.textColor}; }
  img { border: 1px solid #d4cfc7; }
  .toc a:hover { text-decoration: underline; }
</style>
</head>
<body>
${headerHtml}
${tocHtml}
${stepsHtml}
</body>
</html>`;
}

/**
 * Markdown を組み立てる。画像は main 側が書き出す `<名前>_images/step-01.png …`
 * を参照するトークン {{IMAGES_DIR}} を使う（実際のフォルダ名は main が保存ダイアログで
 * 決まった名前から作るため、renderer 側ではまだ分からない）。main の export-markdown が
 * 書き込み前にこのトークンを実際のフォルダ名へ置き換える（F12）。
 */
function buildExportMarkdown() {
  const escape = window.OpesnaMarkdownEscape.escapeMarkdown;
  saveCurrentStepProps();
  const toc = document.getElementById('export-toc')?.checked;

  let md = `# ${escape(state.project.name || '操作マニュアル')}\n\n`;

  if (toc && state.project.steps.length > 1) {
    state.project.steps.forEach((s, i) => {
      md += `${i + 1}. ${escape(s.title || 'ステップ ' + (i + 1))}\n`;
    });
    md += '\n';
  }

  state.project.steps.forEach((step, i) => {
    const n = String(i + 1).padStart(2, '0');
    md += `## ${i + 1}. ${escape(step.title || 'ステップ ' + (i + 1))}\n\n`;
    if (step.description) md += `${escape(step.description)}\n\n`;
    if (step.imageDataUrl) md += `![ステップ${i + 1}]({{IMAGES_DIR}}/step-${n}.png)\n\n`;
  });
  return md;
}

function getTimestampString() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
         `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function defaultExportName() {
  // Use the project title if set and not the placeholder; otherwise YYYYMMDD-HHmmss
  const title = (state.project.name || '').trim();
  if (title && title !== '無題') return title;
  return getTimestampString();
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT MODAL — open/close, format切替, プレビュー更新, 実行
// ─────────────────────────────────────────────────────────────────────────────

/**
 * エクスポートのモーダルを開く唯一の入口。ツールバーボタン・ショートカット・
 * メニューのどこから呼ばれても、ここを通す（E17）。ホーム画面では何もしない。
 */
function openExportModal() {
  if (state.screen !== 'editor') return;
  applyExportSettingsToForm(state.project.exportSettings);
  populateExportTemplateSelect();
  const filenameEl = document.getElementById('export-filename');
  if (filenameEl) filenameEl.value = defaultExportName(); // E18: 見本を実際の既定名にする
  openModal('modal-export');
  updateExportModalPreview();
}

/** state.project.exportSettings（前回の選択）をモーダルの各コントロールへ復元する（E5）。 */
function applyExportSettingsToForm(settings) {
  const s = settings || {};
  const fmt = s.format || 'pdf';
  document.querySelectorAll('.export-fmt').forEach(f => {
    const active = f.dataset.fmt === fmt;
    f.classList.toggle('active', active);
    f.setAttribute('aria-checked', String(active));
  });
  const pageSizeEl    = document.getElementById('export-pagesize');
  const orientationEl = document.getElementById('export-orientation');
  const tocEl         = document.getElementById('export-toc');
  const pagenumsEl    = document.getElementById('export-pagenums');
  const headerEl      = document.getElementById('export-header');
  const pngRangeEl    = document.getElementById('export-png-range');
  if (pageSizeEl)    pageSizeEl.value    = s.pageSize || 'A4';
  if (orientationEl) orientationEl.value = s.orientation || 'portrait';
  if (tocEl)      tocEl.checked      = s.toc        !== false;
  if (pagenumsEl) pagenumsEl.checked = s.pageNumbers !== false;
  if (headerEl)   headerEl.checked   = s.header      !== false;
  if (pngRangeEl) pngRangeEl.value   = s.pngRange || 'current';
  updateExportFormatVisibility(fmt);
}

/** 形式ごとに関係のある項目だけを表示する（E6）。 */
function updateExportFormatVisibility(fmt) {
  document.querySelectorAll('[class*="export-row-for-"]').forEach(el => {
    el.style.display = el.classList.contains('export-row-for-' + fmt) ? '' : 'none';
  });
}

/** エクスポートモーダル内のテンプレート選択（セレクト）を state.templates で埋める。 */
function populateExportTemplateSelect() {
  const sel = document.getElementById('export-template-select');
  if (!sel) return;
  const list = state.templates && state.templates.length ? state.templates : BUILTIN_TEMPLATES;
  sel.innerHTML = list.map(t =>
    `<option value="${escapeHtml(t.id)}"${t.id === state.project.template ? ' selected' : ''}>${escapeHtml(t.name)}</option>`
  ).join('');
}

/**
 * エクスポートモーダルのプレビュー更新を 300ms デバウンスする（F20）。
 * モーダルが開いていないときは何もしない（閉じている間は合成しない）。
 */
function scheduleExportPreviewUpdate() {
  const modal = document.getElementById('modal-export');
  if (!modal || !modal.classList.contains('open')) return;
  clearTimeout(scheduleExportPreviewUpdate._timer);
  scheduleExportPreviewUpdate._timer = setTimeout(updateExportModalPreview, 300);
}

async function doExport() {
  const btn = document.getElementById('btn-do-export');
  if (btn && btn.disabled) return; // 二重実行を防ぐ（U4）

  const fmtEl = document.querySelector('.export-fmt.active');
  const fmt = fmtEl ? fmtEl.dataset.fmt : 'pdf';
  const inputName = (document.getElementById('export-filename')?.value || '').trim();
  const filename = inputName || defaultExportName();

  const pageSize    = document.getElementById('export-pagesize')?.value || 'A4';
  const orientation  = document.getElementById('export-orientation')?.value || 'portrait';
  const toc          = !!document.getElementById('export-toc')?.checked;
  const pageNumbers  = !!document.getElementById('export-pagenums')?.checked;
  const header       = !!document.getElementById('export-header')?.checked;
  const pngRange     = document.getElementById('export-png-range')?.value || 'current';

  // 次回モーダルを開いたときに同じ設定を復元できるよう、プロジェクトに持たせる（E5）
  state.project.exportSettings = { format: fmt, pageSize, orientation, toc, pageNumbers, header, pngRange };

  await runExport({ fmt, filename, pageSize, orientation, pageNumbers, pngRange, overwritePath: null });
}

/**
 * 「前回と同じ設定でエクスポート」。前回のエクスポート（state.project.lastExport）が無ければ
 * 通常のモーダルを開く。あるときは保存ダイアログを出さず、前回と同じパスへ上書きする。
 */
async function exportWithSameSettings() {
  if (state.screen !== 'editor') return;
  const last = state.project.lastExport;
  if (!last || !last.filePath) {
    openExportModal();
    return;
  }
  applyExportSettingsToForm(last.settings);
  const filenameEl = document.getElementById('export-filename');
  if (filenameEl && !filenameEl.value.trim()) filenameEl.value = defaultExportName();

  const s = last.settings || {};
  await runExport({
    fmt: last.format,
    filename: filenameEl ? (filenameEl.value.trim() || defaultExportName()) : defaultExportName(),
    pageSize: s.pageSize || 'A4',
    orientation: s.orientation || 'portrait',
    pageNumbers: s.pageNumbers !== false,
    pngRange: s.pngRange || 'current',
    overwritePath: last.filePath,
  });
}

/**
 * エクスポートの実処理。ボタンを「エクスポート中…」にして進行中は多重実行を防ぎ、
 * 完了・失敗・キャンセルまでモーダルは閉じない。overwritePath を渡すと、保存ダイアログを
 * 出さずそのパスへ上書きする（「前回と同じ設定でエクスポート」用）。
 */
async function runExport({ fmt, filename, pageSize, orientation, pageNumbers, pngRange, overwritePath }) {
  const btn = document.getElementById('btn-do-export');
  const originalLabel = btn ? btn.textContent : '';
  const setBusy = (busy) => {
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? 'エクスポート中…' : originalLabel;
  };
  setBusy(true);

  // PDF は生成に時間がかかるので、進行中であることが分かる持続トーストを出す（U4）
  const progressToast = fmt === 'pdf'
    ? showToast('PDFを生成中…', 'info', { persistent: true })
    : null;

  let succeeded = false;
  const errMsg = window.OpesnaErrorMessages && window.OpesnaErrorMessages.toUserMessage;
  const toUserMsg = (err) => (typeof errMsg === 'function' ? errMsg(err, 'エクスポート') : 'エクスポートに失敗しました。');

  // 結果判定: null=ユーザーキャンセル (無通知) / {ok:false}=失敗 / {ok:true}=成功
  const reportResult = (result, okMsg) => {
    if (result === null || result === undefined) return false; // キャンセル
    if (result.ok) {
      const opts = result.filePath
        ? { actionLabel: 'フォルダを開く', onAction: () => window.opesna.showItemInFolder(result.filePath) }
        : undefined;
      showToast(okMsg, 'ok', opts);
      state.project.lastExport = { format: fmt, filePath: result.filePath, settings: state.project.exportSettings };
      return true;
    }
    showToast(toUserMsg({ message: result.error, code: result.code }), 'error');
    return false;
  };

  try {
    if (fmt === 'pdf') {
      const html = await buildExportHTML();
      const result = await window.opesna.exportPDF({
        html, fileName: filename, pageSize, landscape: orientation === 'landscape', pageNumbers, overwritePath,
      });
      succeeded = reportResult(result, 'PDFをエクスポートしました');
    } else if (fmt === 'html') {
      const html = await buildExportHTML();
      const result = await window.opesna.exportHTML({ html, fileName: filename, overwritePath });
      succeeded = reportResult(result, 'HTMLをエクスポートしました');
    } else if (fmt === 'markdown') {
      const markdown = buildExportMarkdown();
      const guard = window.OpesnaExportGuard;
      const composites = await Promise.all(state.project.steps.map(s => getCompositeImageDataUrl(s)));
      const images = composites
        .filter(dataUrl => guard.isValidPngDataUrl(dataUrl))
        .map(dataUrl => ({ dataUrl }));
      const result = await window.opesna.exportMarkdown({ markdown, fileName: filename, images, overwritePath });
      succeeded = reportResult(result, 'Markdownをエクスポートしました');
    } else if (fmt === 'png') {
      const guard = window.OpesnaExportGuard;
      let composites;
      if (pngRange === 'all') {
        composites = await Promise.all(state.project.steps.map(s => getCompositeImageDataUrl(s)));
      } else {
        const step = getCurrentStep();
        composites = step && step.imageDataUrl ? [await getCompositeImageDataUrl(step)] : [];
      }
      const images = composites.filter(dataUrl => guard.isValidPngDataUrl(dataUrl)).map(dataUrl => ({ dataUrl }));
      if (images.length === 0) {
        showToast('画像がありません', 'warn');
      } else {
        const result = await window.opesna.exportPNG({ fileName: filename, images, overwritePath });
        succeeded = reportResult(result, 'PNGをエクスポートしました');
      }
    }
  } catch (e) {
    showToast(toUserMsg(e), 'error');
  } finally {
    if (progressToast) progressToast.close();
    setBusy(false);
  }

  if (succeeded) closeModal('modal-export');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE MODAL
// ─────────────────────────────────────────────────────────────────────────────

function renderTemplateGrid(cat) {
  const grid = document.getElementById('template-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const filtered = (!cat || cat === 'all')
    ? state.templates
    : state.templates.filter(t => t.category === cat);

  filtered.forEach(tmpl => {
    const card = document.createElement('div');
    // CSS 側は .template-card.active しか定義が無く、旧コードが付けていた .selected は
    // 何のスタイルも当たらず選択中のカードが強調されなかった（U1）。.active に統一する。
    card.className = 'template-card' +
      (tmpl.id === (state.selectedTemplate || state.project.template) ? ' active' : '');
    card.dataset.id = tmpl.id;
    card.setAttribute('role', 'listitem');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', tmpl.name);

    card.innerHTML = `
      <div class="template-preview">${buildTemplatePreviewHTML(tmpl)}</div>
      <div class="template-info">
        <div class="template-name">${escapeHtml(tmpl.name)}</div>
        <div class="template-desc">${escapeHtml(tmpl.description || '')}</div>
      </div>
    `;

    const select = () => {
      document.querySelectorAll('.template-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      state.selectedTemplate = tmpl.id;
      const nameEl = document.getElementById('selected-template-name');
      if (nameEl) nameEl.textContent = tmpl.name;
    };

    card.addEventListener('click', select);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') select();
    });

    grid.appendChild(card);
  });
}

function buildTemplatePreviewHTML(tmpl) {
  const t = resolveTemplateColors(tmpl);

  return `<div style="padding:6px;height:100%;background:${t.background};border-radius:3px;overflow:hidden">
    <div style="height:10px;background:${t.headerColor};border-radius:2px;margin-bottom:5px"></div>
    ${[1, 2].map(n => `
      <div style="display:flex;gap:5px;margin-bottom:4px;align-items:flex-start">
        <div style="width:14px;height:14px;border-radius:${t.badgeShape === 'square' ? '2px' : '50%'};background:${t.badgeColor};flex-shrink:0;margin-top:1px;display:flex;align-items:center;justify-content:center;color:${t.badgeTextColor};font-size:8px;font-family:monospace;font-weight:700">${n}</div>
        <div style="flex:1">
          <div style="height:4px;background:#e0e4ea;border-radius:2px;margin-bottom:3px;width:80%"></div>
          <div style="height:3px;background:#e0e4ea;border-radius:2px;width:60%"></div>
        </div>
      </div>
    `).join('')}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHORTCUT SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

const SHORTCUT_LABELS = {
  capture:          'キャプチャ',
  save:             '保存',
  open:             'ファイルを開く',
  newProject:       '新規作成',
  undo:             '元に戻す',
  redo:             'やり直し',
  export:           'エクスポート',
  exportRepeat:     '前回と同じ設定でエクスポート',
  addStep:          'ステップを追加',
  deleteAnnotation: '注釈を削除',
  selectTool:       '選択ツール',
  arrowTool:        '矢印ツール',
  rectTool:         '四角形ツール',
  ellipseTool:      '楕円ツール',
  calloutTool:      '吹き出しツール',
  textTool:         'テキストツール',
  highlightTool:    'ハイライトツール',
  mosaicTool:       'モザイクツール',
  badgeTool:        '番号バッジツール',
  trimTool:         'トリミング',
  zoomIn:           'ズームイン',
  zoomOut:          'ズームアウト',
  zoomReset:        'ズームリセット'
};

// 既定値と表記の処理は app/shortcuts.js に置き、main.js と共有する（index.html で先に読み込む）。
// 以前はここにも別の既定値があり、main.js と食い違っていた（経緯は app/shortcuts.js の冒頭）。
const {
  DEFAULT_SHORTCUTS,
  withDefaults: shortcutsWithDefaults,
  comboFromKeyEvent,
  labelWithShortcut,
} = window.OpesnaShortcuts;

function ensureShortcuts() {
  // 足りない割り当てを既定値で補う
  state.shortcuts = shortcutsWithDefaults(state.shortcuts);
}

// ツールバーのツールチップに、いま割り当てられているキーを出す。
// 以前は index.html に「やり直し (Ctrl+Y)」と直に書かれ、実際のキー（Ctrl+Shift+Z）と違っていた。
const SHORTCUT_TOOLTIPS = [
  ['btn-editor-save', '保存',     'save'],
  ['btn-undo',        '元に戻す', 'undo'],
  ['btn-redo',        'やり直し', 'redo'],
  ['btn-zoom-out',    '縮小',     'zoomOut'],
  ['btn-zoom-in',     '拡大',     'zoomIn'],
];

function applyShortcutTooltips() {
  ensureShortcuts();
  SHORTCUT_TOOLTIPS.forEach(([id, label, key]) => {
    const el = document.getElementById(id);
    if (el) el.title = labelWithShortcut(label, state.shortcuts[key]);
  });
}

function renderShortcutsTable() {
  ensureShortcuts();
  const tbody = document.getElementById('shortcuts-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  Object.entries(state.shortcuts).forEach(([key, value]) => {
    const label = SHORTCUT_LABELS[key] || key;
    const tr = document.createElement('tr');
    tr.dataset.key = key;
    tr.innerHTML = `
      <td>${escapeHtml(label)}</td>
      <td><span class="key-display">${escapeHtml(value || '—')}</span></td>
      <td><button class="btn-edit-shortcut" data-key="${key}">変更</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-edit-shortcut').forEach(btn => {
    btn.addEventListener('click', () => startEditShortcut(btn.dataset.key));
  });
}

function startEditShortcut(key) {
  state.editingShortcutKey = key;

  // Cancel any ongoing edit
  document.querySelectorAll('.key-display.capturing').forEach(el => {
    el.classList.remove('capturing');
    el.textContent = state.shortcuts[el.closest('tr')?.dataset.key] || '—';
  });

  const tr = document.querySelector(`tr[data-key="${key}"]`);
  if (!tr) return;
  const display = tr.querySelector('.key-display');
  display.textContent = 'キーを入力してください...';
  display.classList.add('capturing');

  function onKeyDown(e) {
    e.preventDefault();
    e.stopPropagation();

    // 修飾キーだけが押された間は待つ。表記は押したときの照合（buildCombo）と同じ関数で作り、
    // 登録した表記と押したときの表記がずれないようにする
    if (!['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
      const combo = comboFromKeyEvent(e);
      state.shortcuts[state.editingShortcutKey] = combo;
      display.textContent = combo;
      display.classList.remove('capturing');
      document.removeEventListener('keydown', onKeyDown, true);
      state.editingShortcutKey = null;
    }
  }

  document.addEventListener('keydown', onKeyDown, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// PREFERENCES
// ─────────────────────────────────────────────────────────────────────────────

const PREFS_CONFIG = {
  general: [
    {
      key: 'language',
      label: '言語',
      type: 'select',
      options: [{ value: 'ja', label: '日本語' }]
    },
    {
      key: 'theme',
      label: 'テーマ',
      type: 'select',
      options: [
        { value: 'light',  label: 'ライト' },
        { value: 'dark',   label: 'ダーク' },
        { value: 'system', label: 'システム' }
      ]
    },
    {
      key: 'defaultZoom',
      label: 'デフォルトズーム',
      type: 'select',
      options: [
        { value: 75,  label: '75%' },
        { value: 100, label: '100%' },
        { value: 125, label: '125%' },
        { value: 150, label: '150%' }
      ]
    }
  ],
  capture: [
    { key: 'cursor',       label: 'カーソルを含める',           type: 'toggle' },
    {
      key: 'captureDelay',
      label: 'キャプチャ遅延',
      type: 'select',
      options: [
        { value: 0, label: 'なし' },
        { value: 2, label: '2秒' },
        { value: 3, label: '3秒' },
        { value: 5, label: '5秒' }
      ]
    },
    { key: 'autoAddStep',  label: 'キャプチャ後に自動でステップ追加', type: 'toggle' }
  ],
  save: [
    { key: 'autoSave',    label: '自動保存',     type: 'toggle' },
    {
      key: 'autoSaveMin',
      label: '自動保存の間隔',
      type: 'select',
      options: [
        { value: 1,  label: '1分' },
        { value: 5,  label: '5分' },
        { value: 10, label: '10分' },
        { value: 30, label: '30分' }
      ]
    }
    // 「自動バックアップ」の項目は外した。切り替えても何も起きなかった（読む処理が無かった）うえ、
    // いつ・何を・何世代残すかの定めも無いため、実装せずに項目を外して誤解を招かないようにした。
    // 手元の控えは README のとおり data と config のフォルダをコピーして取る。
  ],
  display: [
    {
      key: 'defaultZoom',
      label: '初期ズーム',
      type: 'select',
      options: [
        { value: 75,  label: '75%' },
        { value: 100, label: '100%' },
        { value: 125, label: '125%' }
      ]
    }
  ]
};

function renderPrefs(tab) {
  const content = document.getElementById('prefs-content');
  if (!content) return;
  content.innerHTML = '';

  const items = PREFS_CONFIG[tab || 'general'] || [];

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'pref-row';

    const val = state.settings[item.key];
    let control = '';

    if (item.type === 'toggle') {
      const isOn = val === true || val === 'true';
      control = `<button class="toggle${isOn ? ' on' : ''}" data-key="${item.key}" data-type="toggle" role="switch" aria-checked="${isOn}" aria-label="${item.label}"></button>`;
    } else if (item.type === 'select') {
      const opts = item.options.map(o =>
        `<option value="${o.value}"${val == o.value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
      ).join('');
      control = `<select class="pref-select" data-key="${item.key}" aria-label="${escapeHtml(item.label)}">${opts}</select>`;
    }

    row.innerHTML = `
      <div class="pref-row-label">${escapeHtml(item.label)}</div>
      ${control}
    `;

    content.appendChild(row);
  });

  content.querySelectorAll('.toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('on');
      const isOn = btn.classList.contains('on');
      state.settings[btn.dataset.key] = isOn;
      btn.setAttribute('aria-checked', String(isOn));
    });
  });

  content.querySelectorAll('select[data-key]').forEach(sel => {
    sel.addEventListener('change', () => {
      const raw = sel.value;
      state.settings[sel.dataset.key] = isNaN(raw) || raw === '' ? raw : Number(raw);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// モーダルを開いたときのフォーカス管理: 呼び出し元を記憶し、
// ダイアログ内の最初のフォーカス可能要素へ移し、Tab をダイアログ内で循環させる
let modalPrevFocus = null;

function getFocusables(container) {
  return Array.from(container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter(el => !el.disabled && el.offsetParent !== null);
}

function trapModalTab(e) {
  if (e.key !== 'Tab') return;
  const open = document.querySelector('.modal-backdrop.open .modal');
  if (!open) return;
  const focusables = getFocusables(open);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last  = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
}
document.addEventListener('keydown', trapModalTab, true);

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');

  modalPrevFocus = document.activeElement;
  const dialog = el.querySelector('.modal') || el;
  const focusables = getFocusables(dialog);
  if (focusables.length) focusables[0].focus();

  if (id === 'modal-shortcuts') renderShortcutsTable();
  if (id === 'modal-prefs')     renderPrefs(state.currentPrefsTab);
  if (id === 'modal-template') {
    state.selectedTemplate = state.project.template;
    renderTemplateGrid('all');
    const nameEl = document.getElementById('selected-template-name');
    if (nameEl) {
      const tmpl = state.templates.find(t => t.id === state.project.template);
      if (tmpl) nameEl.textContent = tmpl.name;
    }
  }
  if (id === 'modal-export') {
    updateExportPreview();
  }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
  // フォーカスを開く前の要素へ戻す
  if (modalPrevFocus && typeof modalPrevFocus.focus === 'function') {
    modalPrevFocus.focus();
  }
  modalPrevFocus = null;
}

function selectTool(tool) {
  state.editor.tool = tool;
  document.querySelectorAll('.ann-btn[data-tool]').forEach(btn => {
    const isActive = btn.dataset.tool === tool;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });

  const cursors = {
    select:    'default',
    arrow:     'crosshair',
    rect:      'crosshair',
    ellipse:   'crosshair',
    callout:   'text',
    text:      'text',
    highlight: 'crosshair',
    mosaic:    'crosshair',
    badge:     'cell',
    trim:      'crosshair'
  };
  const showStyle = tool === 'arrow' || tool === 'rect' || tool === 'ellipse' ||
                    tool === 'highlight' || tool === 'mosaic' || tool === 'text' || tool === 'callout';
  const showFs    = tool === 'text' || tool === 'callout' || tool === 'badge';
  const showArrow = tool === 'arrow';
  const showBadge = tool === 'badge';

  const styleSection = document.getElementById('prop-section-style');
  const fsRow        = document.getElementById('prop-row-fontsize');
  const arrowSection = document.getElementById('prop-section-arrow');
  const badgeSection = document.getElementById('prop-section-badge');

  if (styleSection) styleSection.style.display = showStyle ? '' : 'none';
  if (fsRow)        fsRow.style.display        = showFs    ? '' : 'none';
  if (arrowSection) arrowSection.style.display = showArrow ? '' : 'none';
  if (badgeSection) badgeSection.style.display = showBadge ? '' : 'none';

  if (canvas) canvas.style.cursor = cursors[tool] || 'default';
}

function setZoom(z) {
  state.editor.zoom = Math.max(0.25, Math.min(4, Math.round(z * 100) / 100));
  const zoomValEl = document.getElementById('zoom-val');
  if (zoomValEl) zoomValEl.textContent = Math.round(state.editor.zoom * 100) + '%';
  // 上限/下限に達したらボタンを無効化
  const zoomInBtn  = document.getElementById('btn-zoom-in');
  const zoomOutBtn = document.getElementById('btn-zoom-out');
  if (zoomInBtn)  zoomInBtn.disabled  = state.editor.zoom >= 4;
  if (zoomOutBtn) zoomOutBtn.disabled = state.editor.zoom <= 0.25;
  renderCanvas();
}

function updateTitleBar() {
  const name   = state.project.name || '無題';
  const suffix = state.project.modified ? ' (未保存)' : '';
  const full   = `Opesna — ${name}${suffix}`;
  try { window.opesna.setTitle(full); } catch (e) {}
  // ネイティブ×ボタンの終了ガード用に未保存フラグをメインプロセスへ通知
  try { window.opesna.setModified?.(!!state.project.modified); } catch (e) {}
}

function updateStatusBar() {
  const step = getCurrentStep();
  const total = state.project.steps.length;
  const idx = state.editor.currentStep;

  const stepEl = document.getElementById('status-step');
  const annEl  = document.getElementById('status-annotations');
  const sizeEl = document.getElementById('status-size');
  const savedEl = document.getElementById('status-saved');

  if (stepEl) stepEl.textContent = `STEP ${idx + 1} / ${total}`;
  if (annEl)  annEl.textContent  = `注釈 ${step ? step.annotations.length : 0}個`;
  if (sizeEl) {
    sizeEl.textContent = (step && step.imageWidth)
      ? `${step.imageWidth}×${step.imageHeight}`
      : '—';
  }
  if (savedEl) savedEl.textContent = state.project.modified ? '未保存 ●' : '保存済み';
}

function updateModifiedIndicator() {
  updateTitleBar();
  updateStatusBar();
}

/** プロジェクトを「未保存の変更あり」にして表示を更新する。 */
function markModified() {
  state.project.modified = true;
  updateModifiedIndicator();
}

/**
 * トーストを表示する。opts.actionLabel/onAction でアクション付きボタンを、
 * opts.persistent で自動的には消えないトースト（PDF生成中などの進行表示用）を出せる。
 * 戻り値の close()/update() で、呼び出し側から明示的に閉じたり文言を差し替えたりできる。
 */
function showToast(msg, type, opts) {
  const o = opts || {};
  const toast = document.getElementById('toast');
  if (!toast) return { close() {}, update() {} };

  toast.innerHTML = '';
  clearTimeout(toast._timer);

  const textEl = document.createElement('span');
  textEl.className = 'toast-text';
  textEl.textContent = msg;
  toast.appendChild(textEl);

  if (o.actionLabel && typeof o.onAction === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = o.actionLabel;
    btn.addEventListener('click', () => o.onAction());
    toast.appendChild(btn);
  }

  toast.className = 'toast ' + (type || 'ok') + ' show';

  const close = () => toast.classList.remove('show');

  if (!o.persistent) {
    const duration = typeof o.duration === 'number' ? o.duration : 2500;
    toast._timer = setTimeout(close, duration);
  }

  return {
    close,
    update(newMsg, newType) {
      textEl.textContent = newMsg;
      if (newType) toast.className = 'toast ' + newType + ' show';
    },
  };
}

/**
 * 右パネルの「出力プレビュー」を更新する。説明を1文字打つたびに呼ばれるため、
 * ここでは画像の合成（getCompositeImageDataUrl）はせず、元画像と題名だけを軽く描く。
 * エクスポートモーダルの本プレビュー（合成あり）はモーダルが開いているときだけ、
 * デバウンスして更新する（F20）。
 */
function updateExportPreview() {
  const guard = window.OpesnaExportGuard;
  const sidePreview = document.getElementById('preview-body');
  if (sidePreview) {
    const tmpl = resolveTemplateColors(getCurrentTemplate());
    const badgeRadius = tmpl.badgeShape === 'square' ? '2px' : '50%';
    sidePreview.innerHTML = state.project.steps.slice(0, 4).map((step, i) => `
      <div class="preview-step-row">
        <div class="preview-step-badge" style="border-radius:${badgeRadius};background:${tmpl.badgeColor};color:${tmpl.badgeTextColor}">${i + 1}</div>
        ${step.imageDataUrl && guard.isValidImageDataUrl(step.imageDataUrl)
          ? `<div class="preview-step-thumb"><img src="${step.imageDataUrl}" alt=""></div>`
          : ''}
        <div class="preview-step-title">${escapeHtml(step.title || 'ステップ ' + (i + 1))}</div>
      </div>
    `).join('');
  }

  scheduleExportPreviewUpdate();
}

async function updateExportModalPreview() {
  const iframe = document.getElementById('export-preview-iframe');
  if (!iframe) return;
  const modal = document.getElementById('modal-export');
  if (!modal || !modal.classList.contains('open')) return; // モーダルが開いているときだけ合成する（F20）

  // #999（白地でコントラスト約2.8:1）は使わず --text-mid 相当の色にする（U10）。
  const MUTED = '#5c5650';

  if (!state.project.steps || state.project.steps.length === 0) {
    iframe.srcdoc = `<html><body style="font-family:sans-serif;color:${MUTED};padding:40px;text-align:center">ステップがありません</body></html>`;
    return;
  }

  iframe.srcdoc = `<html><body style="font-family:sans-serif;color:${MUTED};padding:40px;text-align:center">プレビューを生成しています…</body></html>`;

  const fmtEl = document.querySelector('.export-fmt.active');
  const fmt = fmtEl ? fmtEl.dataset.fmt : 'pdf';

  try {
    let html;
    if (fmt === 'markdown') {
      // Markdown はレイアウトを持たないため、本文をそのまま簡易表示する
      const md = buildExportMarkdown();
      html = `<html><body style="font-family:monospace;white-space:pre-wrap;padding:16px;font-size:12px">${escapeHtml(md)}</body></html>`;
    } else if (fmt === 'png') {
      const guard = window.OpesnaExportGuard;
      const step = getCurrentStep();
      const dataUrl = step ? await getCompositeImageDataUrl(step) : null;
      html = guard.isValidImageDataUrl(dataUrl)
        ? `<html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f4f1ec"><img src="${dataUrl}" style="max-width:100%;max-height:100vh"></body></html>`
        : `<html><body style="font-family:sans-serif;color:${MUTED};padding:40px;text-align:center">画像がありません</body></html>`;
    } else {
      html = await buildExportHTML();
    }
    iframe.srcdoc = html;
  } catch (e) {
    const msg = window.OpesnaErrorMessages ? window.OpesnaErrorMessages.toUserMessage(e, 'プレビュー生成') : 'プレビューの生成に失敗しました。';
    iframe.srcdoc = `<html><body style="font-family:sans-serif;color:#c0392b;padding:20px">${escapeHtml(msg)}</body></html>`;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-SAVE
// ─────────────────────────────────────────────────────────────────────────────

function startAutoSaveTimer() {
  if (autoSaveTimer) clearInterval(autoSaveTimer);

  const check = () => {
    // filePath 必須: 未保存の新規プロジェクトで保存ダイアログが
    // 勝手に開くのを避ける。silent: タイマー保存でトーストを出さない。
    if (
      state.settings.autoSave &&
      state.screen === 'editor' &&
      state.project.modified &&
      state.project.filePath
    ) {
      saveProject({ silent: true });
    }
  };

  const minutes = Number(state.settings.autoSaveMin) || 5;
  autoSaveTimer = setInterval(check, minutes * 60 * 1000);
}

function syncPropsToSelectedAnnotation(ann) {
  if (!ann) return;

  const showStyle = ann.type !== 'badge';
  const showFs    = ann.type === 'text' || ann.type === 'callout' || ann.type === 'badge';
  const showArrow = ann.type === 'arrow';
  const showBadge = ann.type === 'badge';

  const styleSection = document.getElementById('prop-section-style');
  const fsRow        = document.getElementById('prop-row-fontsize');
  const arrowSection = document.getElementById('prop-section-arrow');
  const badgeSection = document.getElementById('prop-section-badge');

  if (styleSection) styleSection.style.display = showStyle ? '' : 'none';
  if (fsRow)        fsRow.style.display        = showFs    ? '' : 'none';
  if (arrowSection) arrowSection.style.display = showArrow ? '' : 'none';
  if (badgeSection) badgeSection.style.display = showBadge ? '' : 'none';

  // Color
  const colorDots = document.querySelectorAll('#prop-color-palette .color-dot');
  colorDots.forEach(d => {
    const match = d.dataset.color === ann.color;
    d.classList.toggle('active', match);
    d.setAttribute('aria-checked', String(match));
  });

  // Stroke width
  const swEl = document.getElementById('prop-stroke-width');
  if (swEl && ann.strokeWidth) swEl.value = String(ann.strokeWidth);

  // Opacity
  const opEl = document.getElementById('prop-opacity');
  const opVal = document.getElementById('prop-opacity-val');
  if (opEl && ann.opacity !== undefined) {
    const pct = Math.round(ann.opacity * 100);
    opEl.value = String(pct);
    if (opVal) opVal.textContent = pct + '%';
  }

  // Font size
  const fsEl = document.getElementById('prop-font-size');
  if (fsEl && ann.fontSize) fsEl.value = String(ann.fontSize);

  // Arrow styles
  if (showArrow) {
    const ahEl = document.getElementById('prop-arrow-head');
    const atEl = document.getElementById('prop-arrow-tail');
    const lsEl = document.getElementById('prop-line-style');
    if (ahEl) ahEl.value = ann.arrowHead || 'filled';
    if (atEl) atEl.value = ann.arrowTail || 'none';
    if (lsEl) lsEl.value = ann.lineStyle || 'solid';
  }

  // Badge settings — 選択中バッジの実際の値をパネルに反映
  if (showBadge) {
    const shapeEl = document.getElementById('prop-badge-shape');
    const sizeEl  = document.getElementById('prop-badge-size');
    if (shapeEl) shapeEl.value = ann.badgeShape || 'circle';
    if (sizeEl)  sizeEl.value  = ann.badgeSize  || 'medium';
    document.querySelectorAll('#prop-badge-color .color-dot').forEach(d => {
      const match = d.dataset.color === (ann.badgeColor || ann.color);
      d.classList.toggle('active', match);
      d.setAttribute('aria-checked', String(match));
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────────────────

function setupEventListeners() {
  // ── Native menu actions ────────────────────────────────────────────────────
  if (window.opesna.onMenuAction) {
    window.opesna.onMenuAction((action) => {
      switch (action) {
        case 'new':      (async () => { if (await confirmDiscardChanges()) newProject(); })(); break;
        case 'open':     (async () => { if (await confirmDiscardChanges()) openProject(); })(); break;
        case 'save':     saveProject(); break;
        case 'save-as':  saveProjectAs(); break;
        case 'export':        openExportModal(); break;
        case 'export-repeat': exportWithSameSettings(); break;
        case 'undo':     undo(); break;
        case 'redo':     redo(); break;
        case 'add-step': if (state.screen === 'editor') addStep(); break;
        case 'zoom-in':  setZoom(state.editor.zoom + 0.25); break;
        case 'zoom-out': setZoom(state.editor.zoom - 0.25); break;
        case 'zoom-reset': setZoom(1.0); break;
      }
    });
  }

  // ── Recording: real-time step pipeline ────────────────────────────────────
  if (window.opesna && window.opesna.onRecordingStart) {
    window.opesna.onRecordingStart(() => {
      // Prepare the project to receive incoming real-time steps
      const isEffectivelyEmpty =
        state.project.steps.length === 1 && !state.project.steps[0].imageDataUrl;

      if (state.screen !== 'editor' || isEffectivelyEmpty) {
        // New project: snapshot the old state so this whole recording is undoable.
        // Preserve folder selection from the previous project or current home view.
        pushUndo();
        const preservedFolder = state.project.category ||
          (state.homeView && state.homeView.startsWith('folder:') ? state.homeView.slice(7) : null);
        state.project = {
          filePath: null,
          name:     '記録 ' + getTimestampString(),
          category: preservedFolder,
          modified: false,
          template: 'simple',
          steps:    [],
        };
        state.editor.currentStep    = -1;
        state.editor.selectedAnnotation = null;
      }
      // If already in editor with content, steps will be appended
    });
  }

  if (window.opesna && window.opesna.onStepCaptured) {
    window.opesna.onStepCaptured(step => {
      // 記録中はステップごとに undo を積まない。全ステップの base64 画像を
      // 毎回ディープコピーすると O(n²) でメモリが膨張するため。
      // (録画開始時に onRecordingStart 側で1回だけ積んである)
      const s = {
        id:           step.id || crypto.randomUUID(),
        title:        step.title || 'クリックする',
        description:  step.description || 'クリックする',
        imageDataUrl: step.imageDataUrl || null,
        imageWidth:   step.imageWidth   || 1920,
        imageHeight:  step.imageHeight  || 1080,
        annotations:  step.annotations  || [],
      };
      state.project.steps.push(s);
      state.project.modified     = true;
      state.editor.currentStep   = state.project.steps.length - 1;

      // Show editor on first step (window is minimized but DOM updates fine)
      if (state.screen !== 'editor') showScreen('editor');

      renderStepList();
      updateTitleBar();
      updateStatusBar();
      updateModifiedIndicator();
    });
  }

  // ── Step title update (double-click upgrades last step title in real-time) ──
  if (window.opesna && window.opesna.onStepTitleUpdate) {
    window.opesna.onStepTitleUpdate(({ id, title }) => {
      const step = state.project.steps.find(s => s.id === id);
      if (step) {
        step.title       = title;
        step.description = title;
        renderStepList();
      }
    });
  }

  // ── Recording finished ─────────────────────────────────────────────────────
  if (window.opesna && window.opesna.onRecordingFinished) {
    window.opesna.onRecordingFinished((count) => {
      state.recording = false;
      const btnRecord = document.getElementById('btn-record');
      if (btnRecord) {
        btnRecord.classList.remove('recording');
        btnRecord.textContent = '⏺ 記録';
        btnRecord.disabled = false;
      }
      // Steps already added in real-time; just render the current step and notify user
      renderCanvas();
      loadStepProps();
      if (count > 0) showToast(`${count}ステップを記録しました`, 'ok');
    });
  }

  // ── Home screen ────────────────────────────────────────────────────────────
  document.getElementById('btn-new')?.addEventListener('click', async () => {
    if (await confirmDiscardChanges()) newProject();
  });
  document.getElementById('btn-new-2')?.addEventListener('click', async () => {
    if (await confirmDiscardChanges()) newProject();
  });
  document.getElementById('btn-open')?.addEventListener('click', openProject);

  document.getElementById('btn-from-image')?.addEventListener('click', async () => {
    try {
      const dataUrl = await window.opesna.importImage();
      if (dataUrl) {
        const img = new Image();
        img.onload = () => {
          newProject({ dataUrl, width: img.width, height: img.height });
        };
        img.src = dataUrl;
      }
    } catch (e) {
      showToast('画像の読み込みに失敗しました', 'error');
    }
  });

  document.getElementById('btn-prefs')?.addEventListener('click', () => openModal('modal-prefs'));

  // Sidebar navigation — filter home view
  document.querySelectorAll('.sidebar-item[data-view]').forEach(item => {
    item.addEventListener('click', () => {
      state.homeView = item.dataset.view || 'home';
      renderHome();
    });
  });

  // ── Editor toolbar ──────────────────────────────────────────────────────────
  document.getElementById('btn-capture')?.addEventListener('click', () => openModal('modal-capture'));
  document.getElementById('btn-capture-empty')?.addEventListener('click', () => openModal('modal-capture'));

  // ── Recording ──────────────────────────────────────────────────────────────
  const btnRecord = document.getElementById('btn-record');
  if (btnRecord) {
    btnRecord.addEventListener('click', async () => {
      if (state.recording) return;
      state.recording = true;
      btnRecord.classList.add('recording');
      btnRecord.textContent = '● 記録中...';
      btnRecord.disabled = true;

      let result = null;
      try {
        result = await window.opesna.startRecording();
      } catch (_) {
        result = false;
      }
      if (result !== true) {
        // no-hook / 起動失敗 — ボタン状態を戻してユーザーに通知
        showToast(
          result === 'no-hook'
            ? '記録ライブラリが見つかりません。npm install uiohook-napi を実行してください。'
            : '記録を開始できませんでした。',
          'warn',
        );
        state.recording = false;
        btnRecord.classList.remove('recording');
        btnRecord.textContent = '⏺ 記録';
        btnRecord.disabled = false;
      }
      // Recording stops when user clicks stop on the indicator
      // stopRecording is called from the indicator window
    });
  }

  document.getElementById('btn-editor-open')?.addEventListener('click', async () => {
    if (await confirmDiscardChanges()) openProject();
  });
  document.getElementById('btn-editor-save')?.addEventListener('click', () => saveProject());
  document.getElementById('btn-undo')?.addEventListener('click', undo);
  document.getElementById('btn-redo')?.addEventListener('click', redo);

  document.getElementById('btn-template')?.addEventListener('click', () => {
    state.selectedTemplate = state.project.template;
    openModal('modal-template');
  });

  document.getElementById('btn-export')?.addEventListener('click', openExportModal);

  // ── Title bar buttons ──────────────────────────────────────────────────────
  document.getElementById('btn-home')?.addEventListener('click', async () => {
    if (state.project.modified) {
      const res = await window.opesna.showConfirmDialog({
        title:   '未保存の変更',
        message: '保存されていない変更があります。',
        detail:  'ホームに戻る前に保存しますか？',
        buttons: ['保存して戻る', '保存せず戻る', '取消し'],
      });
      if (res === 2) return;          // 取消し
      if (res === 0) await saveProject(); // 保存して戻る
      // res === 1 → 保存せず戻る
    }
    showScreen('home');
    await refreshProjectFolders();
    renderHome();
  });

  // ネイティブ×ボタンで「保存して終了」を選んだとき: 保存成功後にウィンドウを閉じる
  if (window.opesna && window.opesna.onSaveAndQuit) {
    window.opesna.onSaveAndQuit(async () => {
      await saveProject();
      // 保存ダイアログをキャンセルした場合は modified のまま → 終了を中断
      if (!state.project.modified) window.opesna.windowClose?.();
    });
  }

  // ── Annotation tool buttons ────────────────────────────────────────────────
  document.querySelectorAll('.ann-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tool === 'delete-selected') {
        deleteSelectedAnnotation();
        return;
      }
      selectTool(btn.dataset.tool);
    });
  });

  // ── Color palette (toolbar) ────────────────────────────────────────────────
  document.querySelectorAll('#color-palette .color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('#color-palette .color-dot').forEach(d => {
        d.classList.remove('active');
        d.setAttribute('aria-checked', 'false');
      });
      dot.classList.add('active');
      dot.setAttribute('aria-checked', 'true');
      state.editor.color = dot.dataset.color;

      // Sync right-panel palette
      document.querySelectorAll('#prop-color-palette .color-dot').forEach(d => {
        const isMatch = d.dataset.color === dot.dataset.color;
        d.classList.toggle('active', isMatch);
        d.setAttribute('aria-checked', String(isMatch));
      });
    });
  });

  // ── Stroke width (toolbar) ─────────────────────────────────────────────────
  document.getElementById('stroke-width')?.addEventListener('change', e => {
    state.editor.strokeWidth = parseInt(e.target.value, 10);
    const propSW = document.getElementById('prop-stroke-width');
    if (propSW) propSW.value = e.target.value;
  });

  // ── Step list ──────────────────────────────────────────────────────────────
  document.getElementById('btn-add-step')?.addEventListener('click', addStep);

  // ── Project name ───────────────────────────────────────────────────────────
  document.getElementById('prop-name')?.addEventListener('input', e => {
    state.project.name = e.target.value || '無題';
    state.project.modified = true;
    updateTitleBar();
    updateModifiedIndicator();
  });

  // ── Category selector ──────────────────────────────────────────────────────
  document.getElementById('prop-category')?.addEventListener('change', async e => {
    const val = e.target.value;
    if (val === '__new__') {
      const name = prompt('新しいフォルダ名を入力してください:');
      if (name && name.trim()) {
        try {
          await window.opesna.createProjectFolder(name.trim());
          await refreshProjectFolders();
          state.project.category = name.trim();
          const catEl = document.getElementById('prop-category');
          if (catEl) catEl.value = name.trim();
          state.project.modified = true;
          updateModifiedIndicator();
        } catch (err) {
          showToast('フォルダの作成に失敗しました', 'error');
          const catEl = document.getElementById('prop-category');
          if (catEl) catEl.value = state.project.category || '';
        }
      } else {
        const catEl = document.getElementById('prop-category');
        if (catEl) catEl.value = state.project.category || '';
      }
    } else {
      state.project.category = val || null;
      state.project.modified = true;
      updateModifiedIndicator();
    }
  });

  // ── Step properties (right panel) ─────────────────────────────────────────
  document.getElementById('step-title-input')?.addEventListener('input', () => {
    const step = getCurrentStep();
    if (!step) return;
    step.title = document.getElementById('step-title-input').value;
    state.project.modified = true;
    updateModifiedIndicator();
    // Debounce step list re-render to avoid flickering
    clearTimeout(renderStepList._debounce);
    renderStepList._debounce = setTimeout(renderStepList, 300);
  });

  document.getElementById('step-desc-input')?.addEventListener('input', () => {
    const step = getCurrentStep();
    if (!step) return;
    step.description = document.getElementById('step-desc-input').value;
    state.project.modified = true;
    updateModifiedIndicator();
    updateExportPreview();
  });

  // ── Right panel: annotation style ─────────────────────────────────────────
  document.getElementById('prop-stroke-width')?.addEventListener('change', e => {
    const val = parseInt(e.target.value, 10);
    state.editor.strokeWidth = val;
    const sw = document.getElementById('stroke-width');
    if (sw) sw.value = e.target.value;
    const ann = state.editor.selectedAnnotation;
    if (ann) { pushUndo(); ann.strokeWidth = val; renderCanvas(); markModified(); }
  });

  // スライダーはドラッグで input が連続発火するため、ひと続きの操作につき
  // undo を1回だけ積む (change でリセット)
  let opacityUndoPushed = false;
  document.getElementById('prop-opacity')?.addEventListener('input', e => {
    const val = parseInt(e.target.value, 10) / 100;
    state.editor.opacity = val;
    const valEl = document.getElementById('prop-opacity-val');
    if (valEl) valEl.textContent = e.target.value + '%';
    const ann = state.editor.selectedAnnotation;
    if (ann) {
      if (!opacityUndoPushed) { pushUndo(); opacityUndoPushed = true; }
      ann.opacity = val;
      renderCanvas();
      markModified();
    }
  });
  document.getElementById('prop-opacity')?.addEventListener('change', () => {
    opacityUndoPushed = false;
  });

  document.querySelectorAll('#prop-color-palette .color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('#prop-color-palette .color-dot').forEach(d => {
        d.classList.remove('active');
        d.setAttribute('aria-checked', 'false');
      });
      dot.classList.add('active');
      dot.setAttribute('aria-checked', 'true');
      state.editor.color = dot.dataset.color;

      // Sync toolbar palette
      document.querySelectorAll('#color-palette .color-dot').forEach(d => {
        const isMatch = d.dataset.color === dot.dataset.color;
        d.classList.toggle('active', isMatch);
        d.setAttribute('aria-checked', String(isMatch));
      });

      // Apply to selected annotation
      const ann = state.editor.selectedAnnotation;
      if (ann) { pushUndo(); ann.color = dot.dataset.color; if (ann.type === 'badge') ann.badgeColor = dot.dataset.color; renderCanvas(); markModified(); }
    });
  });

  // Font size (text/callout/badge)
  document.getElementById('prop-font-size')?.addEventListener('change', e => {
    const val = parseInt(e.target.value, 10);
    state.editor.fontSize = val;
    const ann = state.editor.selectedAnnotation;
    if (ann && (ann.type === 'text' || ann.type === 'callout' || ann.type === 'badge')) {
      pushUndo();
      ann.fontSize = val;
      renderCanvas();
      renderStepList();
      markModified();
    }
  });

  // Arrow styles
  document.getElementById('prop-arrow-head')?.addEventListener('change', e => {
    state.editor.arrowHead = e.target.value;
    const ann = state.editor.selectedAnnotation;
    if (ann && ann.type === 'arrow') { pushUndo(); ann.arrowHead = e.target.value; renderCanvas(); markModified(); }
  });

  document.getElementById('prop-arrow-tail')?.addEventListener('change', e => {
    state.editor.arrowTail = e.target.value;
    const ann = state.editor.selectedAnnotation;
    if (ann && ann.type === 'arrow') { pushUndo(); ann.arrowTail = e.target.value; renderCanvas(); markModified(); }
  });

  document.getElementById('prop-line-style')?.addEventListener('change', e => {
    state.editor.lineStyle = e.target.value;
    const ann = state.editor.selectedAnnotation;
    if (ann && ann.type === 'arrow') { pushUndo(); ann.lineStyle = e.target.value; renderCanvas(); markModified(); }
  });

  // ── Right panel: badge settings ────────────────────────────────────────────
  // 既定値を更新しつつ、バッジ選択中はそのバッジにも反映する
  document.getElementById('prop-badge-shape')?.addEventListener('change', e => {
    state.editor.badgeShape = e.target.value;
    const ann = state.editor.selectedAnnotation;
    if (ann && ann.type === 'badge') { pushUndo(); ann.badgeShape = e.target.value; renderCanvas(); markModified(); }
  });

  document.getElementById('prop-badge-size')?.addEventListener('change', e => {
    state.editor.badgeSize = e.target.value;
    const ann = state.editor.selectedAnnotation;
    if (ann && ann.type === 'badge') { pushUndo(); ann.badgeSize = e.target.value; renderCanvas(); markModified(); }
  });

  document.querySelectorAll('#prop-badge-color .color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('#prop-badge-color .color-dot').forEach(d => {
        d.classList.remove('active');
        d.setAttribute('aria-checked', 'false');
      });
      dot.classList.add('active');
      dot.setAttribute('aria-checked', 'true');
      state.editor.badgeColor = dot.dataset.color;
      const ann = state.editor.selectedAnnotation;
      if (ann && ann.type === 'badge') { pushUndo(); ann.badgeColor = dot.dataset.color; ann.color = dot.dataset.color; renderCanvas(); markModified(); }
    });
  });

  document.getElementById('prop-badge-num')?.addEventListener('change', e => {
    state.editor.badgeNextNum = parseInt(e.target.value, 10) || 1;
  });

  // ── Capture modal ──────────────────────────────────────────────────────────
  document.querySelectorAll('.capture-item').forEach(item => {
    item.addEventListener('click', () => startCapture(item.dataset.mode));
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') startCapture(item.dataset.mode);
    });
  });

  // ── Template modal ─────────────────────────────────────────────────────────
  document.querySelectorAll('.tmpl-cat').forEach(cat => {
    cat.addEventListener('click', () => {
      document.querySelectorAll('.tmpl-cat').forEach(c => c.classList.remove('active'));
      cat.classList.add('active');
      renderTemplateGrid(cat.dataset.cat);
    });
    cat.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') cat.click();
    });
  });

  document.getElementById('btn-apply-template')?.addEventListener('click', () => {
    if (state.selectedTemplate) {
      state.project.template = state.selectedTemplate;
      state.project.modified = true;
      updateModifiedIndicator();
      updateExportPreview();
    }
    closeModal('modal-template');
    showToast('テンプレートを適用しました', 'ok');
  });

  // ── Export modal ───────────────────────────────────────────────────────────
  document.querySelectorAll('.export-fmt').forEach(fmt => {
    fmt.addEventListener('click', () => {
      document.querySelectorAll('.export-fmt').forEach(f => {
        f.classList.remove('active');
        f.setAttribute('aria-checked', 'false');
      });
      fmt.classList.add('active');
      fmt.setAttribute('aria-checked', 'true');
      updateExportFormatVisibility(fmt.dataset.fmt); // 形式ごとに関係ある項目だけ出す（E6）
      scheduleExportPreviewUpdate();
    });
    fmt.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') fmt.click();
    });
  });

  // 選択を変えたらプレビューを自動更新する（300ms デバウンス、E6）
  ['export-pagesize', 'export-orientation', 'export-toc', 'export-pagenums', 'export-header', 'export-png-range']
    .forEach(id => {
      document.getElementById(id)?.addEventListener('change', scheduleExportPreviewUpdate);
    });

  document.getElementById('export-template-select')?.addEventListener('change', e => {
    state.project.template = e.target.value;
    state.project.modified = true;
    updateModifiedIndicator();
    scheduleExportPreviewUpdate();
  });

  document.getElementById('btn-do-export')?.addEventListener('click', doExport);
  document.getElementById('btn-refresh-preview')?.addEventListener('click', updateExportModalPreview);

  // ── Shortcuts modal ────────────────────────────────────────────────────────
  document.getElementById('btn-shortcuts-reset')?.addEventListener('click', () => {
    state.shortcuts = { ...DEFAULT_SHORTCUTS };
    renderShortcutsTable();
    showToast('デフォルトに戻しました', 'ok');
  });

  document.getElementById('btn-shortcuts-save')?.addEventListener('click', async () => {
    try {
      await window.opesna.saveShortcuts(state.shortcuts);
      closeModal('modal-shortcuts');
      setupKeyboardShortcuts();
      applyShortcutTooltips();
      showToast('ショートカットを保存しました', 'ok');
    } catch (e) {
      showToast('保存に失敗しました', 'error');
    }
  });

  // ── Preferences modal ──────────────────────────────────────────────────────
  document.querySelectorAll('.prefs-cat').forEach(cat => {
    cat.addEventListener('click', () => {
      document.querySelectorAll('.prefs-cat').forEach(c => {
        c.classList.remove('active');
        c.setAttribute('aria-selected', 'false');
      });
      cat.classList.add('active');
      cat.setAttribute('aria-selected', 'true');
      state.currentPrefsTab = cat.dataset.pref;
      renderPrefs(state.currentPrefsTab);
    });
    cat.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') cat.click();
    });
  });

  document.getElementById('btn-prefs-save')?.addEventListener('click', async () => {
    try {
      await window.opesna.saveSettings(state.settings);
      closeModal('modal-prefs');
      startAutoSaveTimer(); // re-apply auto-save interval
      showToast('設定を保存しました', 'ok');
    } catch (e) {
      showToast('保存に失敗しました', 'error');
    }
  });

  // ── Modal close buttons & backdrop click ───────────────────────────────────
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) closeModal(backdrop.id);
    });
  });

  // Escape key closes topmost open modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const open = document.querySelector('.modal-backdrop.open');
      if (open) {
        closeModal(open.id);
        e.preventDefault();
      }
    }
  });

  // ── Zoom controls ──────────────────────────────────────────────────────────
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => setZoom(state.editor.zoom + 0.25));
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => setZoom(state.editor.zoom - 0.25));
  document.getElementById('btn-zoom-fit')?.addEventListener('click', () => setZoom(1.0));

  document.getElementById('canvas-scroll')?.addEventListener('wheel', e => {
    if (e.ctrlKey) {
      e.preventDefault();
      setZoom(state.editor.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
    }
  }, { passive: false });

  // ── Window grid (inside modal-window-select) ───────────────────────────────
  // handled per-card in showWindowSelectModal
}

// ─────────────────────────────────────────────────────────────────────────────
// KEYBOARD SHORTCUTS
// ─────────────────────────────────────────────────────────────────────────────

function setupKeyboardShortcuts() {
  // Remove old listener if any
  if (setupKeyboardShortcuts._handler) {
    document.removeEventListener('keydown', setupKeyboardShortcuts._handler);
  }
  setupKeyboardShortcuts._handler = handleKeyboardShortcut;
  document.addEventListener('keydown', setupKeyboardShortcuts._handler);
}

function handleKeyboardShortcut(e) {
  // Skip when typing in an input
  const tag = document.activeElement ? document.activeElement.tagName : '';
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;

  // Skip when a modal is open (except Escape, handled elsewhere)
  if (document.querySelector('.modal-backdrop.open') && e.key !== 'Escape') return;

  ensureShortcuts();
  const sc = state.shortcuts;
  const combo = buildCombo(e);

  // Global shortcuts
  if (combo === sc.save)       { e.preventDefault(); saveProject(); return; }
  if (combo === sc.open)       { e.preventDefault(); (async () => { if (await confirmDiscardChanges()) openProject(); })(); return; }
  if (combo === sc.newProject) { e.preventDefault(); (async () => { if (await confirmDiscardChanges()) newProject(); })(); return; }
  if (combo === sc.undo)       { e.preventDefault(); undo(); return; }
  if (combo === sc.redo)       { e.preventDefault(); redo(); return; }
  if (combo === sc.export)       { e.preventDefault(); openExportModal(); return; }
  if (combo === sc.exportRepeat) { e.preventDefault(); exportWithSameSettings(); return; }
  if (combo === sc.capture)      { e.preventDefault(); if (state.screen === 'editor') openModal('modal-capture'); return; }

  if (state.screen !== 'editor') return;

  if (combo === sc.addStep) { e.preventDefault(); addStep(); return; }
  if (combo === sc.deleteAnnotation) {
    // 注釈が選択されているときのみ削除。未選択時にステップごと消すのは
    // 破壊的すぎるため何もしない (ステップ削除は一覧の×ボタン/右クリックから)。
    if (state.editor.selectedAnnotation) {
      e.preventDefault();
      deleteSelectedAnnotation();
    }
    return;
  }
  if (combo === sc.zoomIn)           { e.preventDefault(); setZoom(state.editor.zoom + 0.25); return; }
  if (combo === sc.zoomOut)          { e.preventDefault(); setZoom(state.editor.zoom - 0.25); return; }
  if (combo === sc.zoomReset)        { e.preventDefault(); setZoom(1.0); return; }

  // Single-key tool shortcuts (no modifiers)
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const key = e.key.toUpperCase();
  // 設定されたキーのみで判定する (既定英字をハードコードすると
  // ユーザーがキーを再割り当てしても旧キーが元のツールを奪ってしまう)
  const singleKey = k => (k && k.length === 1) ? k.toUpperCase() : null;

  const toolKeys = [
    [sc.selectTool,    'select'],
    [sc.arrowTool,     'arrow'],
    [sc.rectTool,      'rect'],
    [sc.ellipseTool,   'ellipse'],
    [sc.calloutTool,   'callout'],
    [sc.textTool,      'text'],
    [sc.highlightTool, 'highlight'],
    [sc.mosaicTool,    'mosaic'],
    [sc.badgeTool,     'badge'],
  ];
  for (const [binding, tool] of toolKeys) {
    if (singleKey(binding) && key === singleKey(binding)) { selectTool(tool); return; }
  }
}

function buildCombo(e) {
  return comboFromKeyEvent(e);
}
