'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  screen: 'home',
  project: {
    filePath: null,
    name: '無題',
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
    drawStart: { x: 0, y: 0 },
    undoStack: [],
    redoStack: []
  },
  settings: {},
  shortcuts: {},
  recent: [],
  templates: [],
  selectedTemplate: null,
  editingShortcutKey: null,
  currentPrefsTab: 'general'
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
    badgeColor: '#2d7dd2',
    badgeShape: 'circle',
    layout: 'business',
    background: '#f0f4f8',
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

  renderHome();
  setupEventListeners();
  setupKeyboardShortcuts();
  startAutoSaveTimer();
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

async function renderHome() {
  const grid = document.getElementById('file-grid');

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

  if (!projects || projects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'file-card-empty';
    empty.textContent = 'プロジェクトがありません';
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
    const stepLabel = (proj.steps || 0) > 0
      ? proj.steps + ' steps'
      : '0 steps';

    card.innerHTML = `
      <div class="file-thumb" style="background:${colors[colorIdx]}">
        📋
        <div class="file-thumb-badge">${stepLabel}</div>
      </div>
      <div class="file-info">
        <div class="file-name">${escapeHtml(proj.name || '無題')}</div>
        <div class="file-meta">${date}${proj.exported ? ' · エクスポート済' : ''}</div>
      </div>
    `;

    // Left click: open via dialog (open-by-path fallback)
    card.addEventListener('click', async () => {
      try {
        if (proj.filePath) {
          // Try to open directly by path if the main process supports it
          // Fallback to dialog
          openProject();
        } else {
          openProject();
        }
      } catch (e) {
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
      action: () => openProject()
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
        if (proj.filePath && confirm(`「${proj.name}」を削除しますか？`)) {
          try {
            await window.opesna.deleteProject(proj.filePath);
            showToast('削除しました', 'ok');
            renderHome();
          } catch (err) {
            showToast('削除に失敗しました', 'error');
          }
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

function newProject(initialImage = null) {
  state.project = {
    filePath: null,
    name: '無題',
    modified: false,
    template: 'simple',
    steps: []
  };
  state.editor.undoStack = [];
  state.editor.redoStack = [];
  state.editor.selectedAnnotation = null;
  state.editor.badgeNextNum = 1;

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

async function saveProject() {
  saveCurrentStepProps();

  const data = {
    version: '1.0',
    name: state.project.name,
    template: state.project.template,
    steps: state.project.steps,
    savedAt: new Date().toISOString()
  };

  try {
    if (state.project.filePath) {
      await window.opesna.saveProject({ filePath: state.project.filePath, data });
      state.project.modified = false;
      updateTitleBar();
      updateModifiedIndicator();
      await window.opesna.addRecent(state.project.filePath);
      showToast('保存しました', 'ok');
    } else {
      const filePath = await window.opesna.saveProjectDialog(data);
      if (filePath) {
        state.project.filePath = filePath;
        state.project.name = filePath.split(/[\\/]/).pop().replace(/\.opn$/i, '');
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

async function openProject() {
  try {
    const result = await window.opesna.openProjectDialog();
    if (!result) return;

    const { filePath, data } = result;

    state.project = {
      filePath,
      name: data.name || filePath.split(/[\\/]/).pop().replace(/\.opn$/i, ''),
      modified: false,
      template: data.template || 'simple',
      steps: data.steps || []
    };

    if (state.project.steps.length === 0) {
      state.project.steps.push(createStep('ステップ 1'));
    }

    state.editor.currentStep = 0;
    state.editor.undoStack = [];
    state.editor.redoStack = [];
    state.editor.selectedAnnotation = null;
    state.editor.badgeNextNum = 1;

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

  const img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;

    canvas.style.width = (img.width * state.editor.zoom) + 'px';
    canvas.style.height = (img.height * state.editor.zoom) + 'px';

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    step.annotations.forEach(ann => {
      const isSelected = state.editor.selectedAnnotation &&
        state.editor.selectedAnnotation.id === ann.id;
      drawAnnotation(ann, isSelected);
    });
  };
  img.src = step.imageDataUrl;
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
      drawArrow(ann.x, ann.y, ann.x2, ann.y2);
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

    case 'mosaic':
      applyMosaic(ann.x, ann.y, ann.x2 - ann.x, ann.y2 - ann.y);
      break;

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
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#0080ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    const padding = 6;
    const x1 = Math.min(ann.x, ann.x2 !== undefined ? ann.x2 : ann.x) - padding;
    const y1 = Math.min(ann.y, ann.y2 !== undefined ? ann.y2 : ann.y) - padding;
    const w = Math.abs((ann.x2 !== undefined ? ann.x2 : ann.x) - ann.x) + padding * 2;
    const h = Math.abs((ann.y2 !== undefined ? ann.y2 : ann.y) - ann.y) + padding * 2;
    ctx.strokeRect(x1, y1, w || 20, h || 20);
    ctx.setLineDash([]);
  }

  ctx.restore();
}

function drawArrow(x1, y1, x2, y2) {
  const headLen = 16;
  const angle = Math.atan2(y2 - y1, x2 - x1);

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
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

function applyMosaic(x, y, w, h) {
  if (w <= 0 || h <= 0) return;
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  const cw = canvas.width;
  const ch = canvas.height;
  if (x < 0 || y < 0 || x + w > cw || y + h > ch) return;

  const blockSize = 12;
  const imgData = ctx.getImageData(x, y, w, h);
  for (let bx = 0; bx < w; bx += blockSize) {
    for (let by = 0; by < h; by += blockSize) {
      const bw = Math.min(blockSize, w - bx);
      const bh = Math.min(blockSize, h - by);
      const px = (by * w + bx) * 4;
      const r = imgData.data[px];
      const g = imgData.data[px + 1];
      const b = imgData.data[px + 2];
      for (let fx = 0; fx < bw; fx++) {
        for (let fy = 0; fy < bh; fy++) {
          const idx = ((by + fy) * w + (bx + fx)) * 4;
          imgData.data[idx]     = r;
          imgData.data[idx + 1] = g;
          imgData.data[idx + 2] = b;
        }
      }
    }
  }
  ctx.putImageData(imgData, x, y);
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
    const found = step.annotations.slice().reverse().find(a => hitTest(a, pos));
    state.editor.selectedAnnotation = found || null;
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

  // text and callout wait for mouseup / dblclick
}

function onCanvasMouseMove(e) {
  if (!state.editor.drawing) return;
  if (state.editor.tool === 'select') return;
  if (state.editor.tool === 'badge') return;
  if (state.editor.tool === 'text' || state.editor.tool === 'callout') return;

  const pos = getCanvasPos(e);
  renderCanvas();
  drawPreview(state.editor.drawStart, pos);
}

function onCanvasMouseUp(e) {
  if (!state.editor.drawing) return;
  if (state.editor.tool === 'select' || state.editor.tool === 'badge') {
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

  const ann = {
    id: crypto.randomUUID(),
    type: state.editor.tool,
    x: start.x,
    y: start.y,
    x2: pos.x,
    y2: pos.y,
    color: state.editor.color,
    strokeWidth: state.editor.strokeWidth,
    opacity: state.editor.opacity
  };

  addAnnotation(ann);
}

function onCanvasDoubleClick(e) {
  const pos = getCanvasPos(e);
  if (state.editor.tool === 'text' || state.editor.tool === 'callout') {
    showTextInput(pos, state.editor.tool);
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
  }

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// TEXT / CALLOUT INPUT OVERLAY
// ─────────────────────────────────────────────────────────────────────────────

function showTextInput(pos, type) {
  const overlay = document.getElementById('text-input-overlay');
  const textarea = document.getElementById('text-input-area');
  if (!overlay || !textarea) return;

  const rect = canvas.getBoundingClientRect();
  const scrollEl = document.getElementById('canvas-scroll');
  const scale = rect.width / canvas.width;

  // Position relative to viewport; overlay is position:absolute inside canvas-wrapper
  // So we need to calculate offset within canvas-wrapper
  const wrapper = document.getElementById('canvas-wrapper');
  const wrapperRect = wrapper.getBoundingClientRect();

  overlay.style.display = 'block';
  overlay.style.left = (pos.x * scale + (rect.left - wrapperRect.left)) + 'px';
  overlay.style.top = (pos.y * scale + (rect.top - wrapperRect.top)) + 'px';
  textarea.value = '';
  textarea.focus();

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
        fontSize: 14
      });
    }
    overlay.style.display = 'none';
    textarea.removeEventListener('keydown', onKey);
    textarea.removeEventListener('blur', commit);
  }

  function cancel() {
    committed = true;
    overlay.style.display = 'none';
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

function pushUndo() {
  const step = getCurrentStep();
  if (!step) return;
  state.editor.undoStack.push(JSON.stringify(step.annotations));
  if (state.editor.undoStack.length > 50) state.editor.undoStack.shift();
  state.editor.redoStack = [];
}

function undo() {
  if (state.editor.undoStack.length === 0) return;
  const step = getCurrentStep();
  if (!step) return;
  state.editor.redoStack.push(JSON.stringify(step.annotations));
  step.annotations = JSON.parse(state.editor.undoStack.pop());
  state.editor.selectedAnnotation = null;
  state.project.modified = true;
  renderCanvas();
  renderStepList();
  updateStatusBar();
  updateModifiedIndicator();
}

function redo() {
  if (state.editor.redoStack.length === 0) return;
  const step = getCurrentStep();
  if (!step) return;
  state.editor.undoStack.push(JSON.stringify(step.annotations));
  step.annotations = JSON.parse(state.editor.redoStack.pop());
  state.editor.selectedAnnotation = null;
  state.project.modified = true;
  renderCanvas();
  renderStepList();
  updateStatusBar();
  updateModifiedIndicator();
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

function hitTest(ann, pos) {
  const padding = 8;
  const x1 = Math.min(ann.x, ann.x2 !== undefined ? ann.x2 : ann.x) - padding;
  const y1 = Math.min(ann.y, ann.y2 !== undefined ? ann.y2 : ann.y) - padding;
  const x2 = Math.max(ann.x, ann.x2 !== undefined ? ann.x2 : ann.x) + padding;
  const y2 = Math.max(ann.y, ann.y2 !== undefined ? ann.y2 : ann.y) + padding;

  // For badge / text / callout, use a wider hit area around the origin point
  if (ann.type === 'badge' || ann.type === 'text' || ann.type === 'callout') {
    const r = 30;
    return pos.x >= ann.x - r && pos.x <= ann.x + r &&
           pos.y >= ann.y - r && pos.y <= ann.y + r;
  }

  return pos.x >= x1 && pos.x <= x2 && pos.y >= y1 && pos.y <= y2;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP LIST
// ─────────────────────────────────────────────────────────────────────────────

function renderStepList() {
  const list = document.getElementById('step-list');
  if (!list) return;
  list.innerHTML = '';

  state.project.steps.forEach((step, idx) => {
    const div = document.createElement('div');
    div.className = 'step-item' + (idx === state.editor.currentStep ? ' active' : '');
    div.dataset.index = idx;
    div.setAttribute('role', 'listitem');
    div.setAttribute('aria-label', `ステップ ${idx + 1}: ${step.title || ''}`);

    div.innerHTML = `
      <div class="step-thumb">
        <canvas class="step-thumb-canvas" data-step="${idx}" width="150" height="90"></canvas>
        <div class="step-num-badge">${idx + 1}</div>
      </div>
      <div class="step-info">
        <div class="step-item-title">${escapeHtml(step.title || 'ステップ ' + (idx + 1))}</div>
        <div class="step-item-sub">${step.annotations.length}個の注釈</div>
      </div>
      <button class="step-menu-btn" data-index="${idx}" title="メニュー" aria-label="ステップメニュー">⋮</button>
    `;

    div.addEventListener('click', e => {
      if (e.target.classList.contains('step-menu-btn')) return;
      selectStep(idx);
    });

    div.querySelector('.step-menu-btn').addEventListener('click', e => {
      e.stopPropagation();
      showStepContextMenu(idx, e);
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
  state.editor.undoStack = [];
  state.editor.redoStack = [];

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
  const step = createStep('ステップ ' + (state.project.steps.length + 1));
  state.project.steps.push(step);
  state.editor.currentStep = state.project.steps.length - 1;
  state.editor.selectedAnnotation = null;
  state.editor.undoStack = [];
  state.editor.redoStack = [];
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
  state.project.steps.splice(idx, 1);
  if (state.editor.currentStep >= state.project.steps.length) {
    state.editor.currentStep = state.project.steps.length - 1;
  }
  state.editor.selectedAnnotation = null;
  state.editor.undoStack = [];
  state.editor.redoStack = [];
  state.project.modified = true;

  renderStepList();
  renderCanvas();
  loadStepProps();
  updateStatusBar();
  updateModifiedIndicator();
}

function duplicateStep(idx) {
  const orig = state.project.steps[idx];
  const copy = JSON.parse(JSON.stringify(orig));
  copy.id = crypto.randomUUID();
  copy.title = copy.title + ' (コピー)';
  copy.annotations = copy.annotations.map(a => ({ ...a, id: crypto.randomUUID() }));
  state.project.steps.splice(idx + 1, 0, copy);
  state.editor.currentStep = idx + 1;
  state.editor.selectedAnnotation = null;
  state.editor.undoStack = [];
  state.editor.redoStack = [];
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
    { label: '削除', action: () => deleteStep(idx), danger: true }
  ];

  items.forEach(item => {
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
    try {
      const windows = await window.opesna.captureWindow();
      if (windows && windows.length > 0) {
        showWindowSelectModal(windows);
      } else {
        showToast('ウィンドウが見つかりませんでした', 'warn');
      }
    } catch (e) {
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

  await new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      step.imageDataUrl = dataUrl;
      step.imageWidth = img.width;
      step.imageHeight = img.height;
      resolve();
    };
    img.onerror = resolve;
    img.src = dataUrl;
  });

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

function buildExportHTML() {
  const tmpl = state.templates.find(t => t.id === state.project.template) ||
    state.templates[0] ||
    BUILTIN_TEMPLATES[0];

  saveCurrentStepProps();

  const toc = document.getElementById('export-toc')?.checked;
  const pageNums = document.getElementById('export-pagenums')?.checked;
  const header = document.getElementById('export-header')?.checked;
  const pageSize = document.getElementById('export-pagesize')?.value || 'A4';
  const orientation = document.getElementById('export-orientation')?.value || 'portrait';

  let tocHtml = '';
  if (toc && state.project.steps.length > 1) {
    tocHtml = `
      <nav class="toc" style="margin-bottom:32px;padding:16px;background:#f7f4ef;border-radius:6px">
        <div style="font-weight:700;margin-bottom:8px;font-size:13px">目次</div>
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
    stepsHtml += `
      <div class="step" id="step-${i + 1}" style="margin-bottom:40px;page-break-inside:avoid">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="width:28px;height:28px;border-radius:${tmpl.badgeShape === 'square' ? '4px' : '50%'};background:${tmpl.badgeColor || '#1f4e8c'};color:#fff;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:monospace">${i + 1}</div>
          <h3 style="margin:0;font-size:${(tmpl.fontSize || 13) + 2}px">${escapeHtml(step.title || 'ステップ ' + (i + 1))}</h3>
        </div>
        ${step.imageDataUrl ? `<img src="${step.imageDataUrl}" alt="ステップ${i + 1}" style="max-width:100%;border-radius:4px;margin-bottom:10px;border:1px solid #d4cfc7;display:block">` : ''}
        ${step.description ? `<p style="margin:0;color:#5c5650;font-size:${tmpl.fontSize || 13}px;line-height:1.7">${escapeHtml(step.description).replace(/\n/g, '<br>')}</p>` : ''}
      </div>
    `;
  });

  const headerHtml = header
    ? `<h1 style="background:${tmpl.headerColor || '#1f4e8c'};color:#fff;padding:16px 24px;margin:-32px -32px 32px;font-size:20px;font-weight:700">${escapeHtml(state.project.name || '操作マニュアル')}</h1>`
    : `<h1 style="font-size:20px;margin-bottom:24px">${escapeHtml(state.project.name || '操作マニュアル')}</h1>`;

  const pageNumCss = pageNums
    ? `@page { margin: 20mm; } @bottom-center { content: counter(page); font-size: 10px; }`
    : '';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(state.project.name || 'エクスポート')}</title>
<style>
  @page { size: ${pageSize} ${orientation}; ${pageNumCss} }
  * { box-sizing: border-box; }
  body {
    font-family: 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic UI', sans-serif;
    margin: 0;
    padding: 32px;
    background: ${tmpl.background || '#fff'};
    color: #18150f;
    font-size: ${tmpl.fontSize || 13}px;
    line-height: 1.7;
  }
  h3 { color: #18150f; }
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

function buildExportMarkdown() {
  saveCurrentStepProps();
  let md = `# ${state.project.name || '操作マニュアル'}\n\n`;
  state.project.steps.forEach((step, i) => {
    md += `## ${i + 1}. ${step.title || 'ステップ ' + (i + 1)}\n\n`;
    if (step.description) md += `${step.description}\n\n`;
    if (step.imageDataUrl) md += `![ステップ${i + 1}](step-${i + 1}.png)\n\n`;
  });
  return md;
}

async function doExport() {
  const fmtEl = document.querySelector('.export-fmt.active');
  const fmt = fmtEl ? fmtEl.dataset.fmt : 'pdf';
  const filename = (document.getElementById('export-filename')?.value || state.project.name || 'export').trim();

  closeModal('modal-export');

  try {
    if (fmt === 'pdf') {
      const html = buildExportHTML();
      await window.opesna.exportPDF({ html, fileName: filename + '.pdf' });
      showToast('PDFをエクスポートしました', 'ok');
    } else if (fmt === 'html') {
      const html = buildExportHTML();
      await window.opesna.exportHTML({ html, fileName: filename + '.html' });
      showToast('HTMLをエクスポートしました', 'ok');
    } else if (fmt === 'markdown') {
      const markdown = buildExportMarkdown();
      await window.opesna.exportMarkdown({ markdown, fileName: filename + '.md' });
      showToast('Markdownをエクスポートしました', 'ok');
    } else if (fmt === 'png') {
      const step = getCurrentStep();
      if (!step || !step.imageDataUrl) {
        showToast('画像がありません', 'warn');
        return;
      }
      if (!canvas) {
        showToast('キャンバスが初期化されていません', 'warn');
        return;
      }
      const link = document.createElement('a');
      link.download = filename + '.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      showToast('PNGをエクスポートしました', 'ok');
    }
  } catch (e) {
    showToast('エクスポートに失敗しました: ' + (e.message || e), 'error');
  }
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
    card.className = 'template-card' +
      (tmpl.id === (state.selectedTemplate || state.project.template) ? ' selected' : '');
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
      document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
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
  const color = tmpl.headerColor || '#1f4e8c';
  const badge = tmpl.badgeColor || '#1f4e8c';
  const bg = tmpl.background || '#fff';

  return `<div style="padding:6px;height:100%;background:${bg};border-radius:3px;overflow:hidden">
    <div style="height:10px;background:${color};border-radius:2px;margin-bottom:5px"></div>
    ${[1, 2].map(n => `
      <div style="display:flex;gap:5px;margin-bottom:4px;align-items:flex-start">
        <div style="width:14px;height:14px;border-radius:${tmpl.badgeShape === 'square' ? '2px' : '50%'};background:${badge};flex-shrink:0;margin-top:1px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:8px;font-family:monospace;font-weight:700">${n}</div>
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

const DEFAULT_SHORTCUTS = {
  capture:          'Ctrl+Shift+C',
  save:             'Ctrl+S',
  open:             'Ctrl+O',
  newProject:       'Ctrl+N',
  undo:             'Ctrl+Z',
  redo:             'Ctrl+Y',
  export:           'Ctrl+E',
  addStep:          'Ctrl+Shift+N',
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
  trimTool:         'X',
  zoomIn:           'Ctrl+=',
  zoomOut:          'Ctrl+-',
  zoomReset:        'Ctrl+0'
};

function ensureShortcuts() {
  // Fill in missing shortcuts with defaults
  Object.keys(DEFAULT_SHORTCUTS).forEach(k => {
    if (!state.shortcuts[k]) state.shortcuts[k] = DEFAULT_SHORTCUTS[k];
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

    const parts = [];
    if (e.ctrlKey)  parts.push('Ctrl');
    if (e.metaKey)  parts.push('Meta');
    if (e.altKey)   parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    if (!['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
      const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      parts.push(k);
      const combo = parts.join('+');
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
    },
    { key: 'backup', label: '自動バックアップ', type: 'toggle' }
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

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');

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
  if (canvas) canvas.style.cursor = cursors[tool] || 'default';
}

function setZoom(z) {
  state.editor.zoom = Math.max(0.25, Math.min(4, Math.round(z * 100) / 100));
  const zoomValEl = document.getElementById('zoom-val');
  if (zoomValEl) zoomValEl.textContent = Math.round(state.editor.zoom * 100) + '%';
  renderCanvas();
}

function updateTitleBar() {
  const name = state.project.name || '無題';
  try {
    window.opesna.setTitle(`Opesna — ${name}`);
  } catch (e) {}
  const nameEl = document.getElementById('titlebar-name');
  if (nameEl) nameEl.textContent = `Opesna — ${name}`;
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
  const ind = document.getElementById('modified-indicator');
  if (ind) ind.style.display = state.project.modified ? 'inline' : 'none';
  updateStatusBar();
}

function showToast(msg, type) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'toast ' + (type || 'ok') + ' show';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2500);
}

function updateExportPreview() {
  const preview = document.getElementById('preview-body');
  if (!preview) return;

  const tmpl = state.templates.find(t => t.id === state.project.template) ||
    state.templates[0] ||
    BUILTIN_TEMPLATES[0];

  const badgeColor = tmpl ? (tmpl.badgeColor || '#1f4e8c') : '#1f4e8c';
  const badgeRadius = tmpl && tmpl.badgeShape === 'square' ? '2px' : '50%';

  preview.innerHTML = state.project.steps.slice(0, 4).map((step, i) => `
    <div style="display:flex;gap:5px;align-items:flex-start;margin-bottom:6px">
      <div style="width:14px;height:14px;border-radius:${badgeRadius};background:${badgeColor};color:#fff;font-size:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:monospace;margin-top:1px">${i + 1}</div>
      ${step.imageDataUrl
        ? `<div style="width:40px;height:26px;background:#e5edf8;border-radius:2px;flex-shrink:0;overflow:hidden"><img src="${step.imageDataUrl}" style="width:100%;height:100%;object-fit:cover;display:block" alt=""></div>`
        : ''}
      <div style="font-size:9px;color:#5c5650;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80px">${escapeHtml(step.title || 'ステップ ' + (i + 1))}</div>
    </div>
  `).join('');
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
    if (
      state.settings.autoSave &&
      state.screen === 'editor' &&
      state.project.modified &&
      state.project.filePath
    ) {
      saveProject();
    }
  };

  const minutes = Number(state.settings.autoSaveMin) || 5;
  autoSaveTimer = setInterval(check, minutes * 60 * 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────────────────

function setupEventListeners() {
  // ── Home screen ────────────────────────────────────────────────────────────
  document.getElementById('btn-new')?.addEventListener('click', () => newProject());
  document.getElementById('btn-new-2')?.addEventListener('click', () => newProject());
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

  // Sidebar navigation (visual only, no routing)
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    });
  });

  // ── Editor toolbar ──────────────────────────────────────────────────────────
  document.getElementById('btn-capture')?.addEventListener('click', () => openModal('modal-capture'));
  document.getElementById('btn-capture-empty')?.addEventListener('click', () => openModal('modal-capture'));
  document.getElementById('btn-editor-open')?.addEventListener('click', openProject);
  document.getElementById('btn-editor-save')?.addEventListener('click', saveProject);
  document.getElementById('btn-undo')?.addEventListener('click', undo);
  document.getElementById('btn-redo')?.addEventListener('click', redo);

  document.getElementById('btn-template')?.addEventListener('click', () => {
    state.selectedTemplate = state.project.template;
    openModal('modal-template');
  });

  document.getElementById('btn-export')?.addEventListener('click', () => {
    const filenameEl = document.getElementById('export-filename');
    if (filenameEl) filenameEl.value = state.project.name || 'export';
    openModal('modal-export');
  });

  document.getElementById('btn-close-editor')?.addEventListener('click', () => {
    if (state.project.modified) {
      if (!confirm('保存されていない変更があります。ホームに戻りますか？')) return;
    }
    showScreen('home');
    renderHome();
  });

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
    state.editor.strokeWidth = parseInt(e.target.value, 10);
    const sw = document.getElementById('stroke-width');
    if (sw) sw.value = e.target.value;
  });

  document.getElementById('prop-opacity')?.addEventListener('input', e => {
    state.editor.opacity = parseInt(e.target.value, 10) / 100;
    const valEl = document.getElementById('prop-opacity-val');
    if (valEl) valEl.textContent = e.target.value + '%';
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
    });
  });

  // ── Right panel: badge settings ────────────────────────────────────────────
  document.getElementById('prop-badge-shape')?.addEventListener('change', e => {
    state.editor.badgeShape = e.target.value;
  });

  document.getElementById('prop-badge-size')?.addEventListener('change', e => {
    state.editor.badgeSize = e.target.value;
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
    });
    fmt.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') fmt.click();
    });
  });

  document.getElementById('btn-do-export')?.addEventListener('click', doExport);

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
  if (combo === sc.open)       { e.preventDefault(); openProject(); return; }
  if (combo === sc.newProject) { e.preventDefault(); newProject(); return; }
  if (combo === sc.undo)       { e.preventDefault(); undo(); return; }
  if (combo === sc.redo)       { e.preventDefault(); redo(); return; }
  if (combo === sc.export)     { e.preventDefault(); if (state.screen === 'editor') { const filenameEl = document.getElementById('export-filename'); if (filenameEl) filenameEl.value = state.project.name || 'export'; openModal('modal-export'); } return; }
  if (combo === sc.capture)    { e.preventDefault(); if (state.screen === 'editor') openModal('modal-capture'); return; }

  if (state.screen !== 'editor') return;

  if (combo === sc.addStep)          { e.preventDefault(); addStep(); return; }
  if (combo === sc.deleteAnnotation) { e.preventDefault(); deleteSelectedAnnotation(); return; }
  if (combo === sc.zoomIn)           { e.preventDefault(); setZoom(state.editor.zoom + 0.25); return; }
  if (combo === sc.zoomOut)          { e.preventDefault(); setZoom(state.editor.zoom - 0.25); return; }
  if (combo === sc.zoomReset)        { e.preventDefault(); setZoom(1.0); return; }

  // Single-key tool shortcuts (no modifiers)
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const key = e.key.toUpperCase();
  const singleKey = k => k && k.length === 1 && k.toUpperCase();

  if (key === singleKey(sc.selectTool)    || key === 'V') { selectTool('select');    return; }
  if (key === singleKey(sc.arrowTool)     || key === 'A') { selectTool('arrow');     return; }
  if (key === singleKey(sc.rectTool)      || key === 'R') { selectTool('rect');      return; }
  if (key === singleKey(sc.ellipseTool)   || key === 'E') { selectTool('ellipse');   return; }
  if (key === singleKey(sc.calloutTool)   || key === 'B') { selectTool('callout');   return; }
  if (key === singleKey(sc.textTool)      || key === 'T') { selectTool('text');      return; }
  if (key === singleKey(sc.highlightTool) || key === 'H') { selectTool('highlight'); return; }
  if (key === singleKey(sc.mosaicTool)    || key === 'M') { selectTool('mosaic');    return; }
  if (key === singleKey(sc.badgeTool)     || key === 'N') { selectTool('badge');     return; }
  if (key === singleKey(sc.trimTool)      || key === 'X') { selectTool('trim');      return; }
}

function buildCombo(e) {
  const parts = [];
  if (e.ctrlKey)  parts.push('Ctrl');
  if (e.metaKey)  parts.push('Meta');
  if (e.altKey)   parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (!['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
    const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    parts.push(k);
  }
  return parts.join('+');
}
