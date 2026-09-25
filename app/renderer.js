'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  screen: 'home',
  homeView: 'home',
  project: {
    id: null,
    filePath: null,
    name: '無題',
    category: null,
    modified: false,
    // 編集のたびに増える版番号。保存開始時の値と一致するときだけ保存後に modified=false
    // にする（F18）。保存中に別の編集が入っても「未保存」の印を消さないための仕組み。
    revision: 0,
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
    badgeNextNumManual: false, // E9: ユーザーが「次の番号」を手で変えたら、ステップを切り替えるまで上書きしない
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
    redoStack: [],
    zoomMode: 'fit', // 'fit' | 'manual'（U2: 画面に合わせる／手動倍率の切り替え）
    mosaicHintShown: false // S4: 「画像に直接書き込む」案内はセッション中1回だけ
  },
  settings: {},
  shortcuts: {},
  recent: [],
  templates: [],
  projectFolders: [],
  selectedTemplate: null,
  editingShortcutKey: null,
  currentPrefsTab: 'general',
  recording: false,
  // 自動更新（WP8）。checkResult は window.opesna.updateCheck() の戻り値をそのまま持つ
  update: {
    checkResult: null,   // { status, currentVersion, latestTag, message, canApply }
    checking: false,
    applying: false,
    progress: null,      // 0〜100 or null
    bannerTag: null       // 帯に出している版（onUpdateAvailable から受け取る）
  }
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

// エラーメッセージの日本語化・.opn の検証は、main.js とも共有する app/errorMessages.js /
// app/projectData.js に共通化されている（index.html で renderer.js より前に読み込む）。
const { toUserMessage } = window.OpesnaErrorMessages;
const { normalizeProject } = window.OpesnaProjectData;

// 保存中に連打されても同じ Promise を返す（F18）。saveProject・saveProjectAs で共有する。
let pendingSavePromise = null;

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
  await checkAutosaveRecovery();
});

/**
 * 起動時、前回終了時に保存されなかったプロジェクトの復旧ファイルが残っていれば、
 * 復元するかどうかを尋ねる（F6）。複数残っていても、最も新しいものだけを尋ねる。
 */
async function checkAutosaveRecovery() {
  let entries = [];
  try {
    entries = await window.opesna.autosaveList();
  } catch (_) {
    entries = [];
  }
  if (!Array.isArray(entries) || entries.length === 0) return;

  entries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const entry = entries[0];

  const res = await window.opesna.showConfirmDialog({
    title:   '前回保存されなかったプロジェクト',
    message: '前回保存されなかったプロジェクトがあります。',
    detail:  `「${entry.name || '無題'}」を復元しますか？`,
    buttons: ['復元する', '破棄する', 'あとで'],
  });

  if (res === 0) {
    let data = null;
    try {
      data = await window.opesna.autosaveLoad(entry.id);
    } catch (_) {
      data = null;
    }
    const normalized = data && normalizeProject(data, {});
    if (!normalized) {
      showToast('復元できませんでした', 'error');
      return;
    }
    if (state.project.id && !state.project.filePath) clearAutosaveFor(state.project.id);
    state.project = {
      id:       normalized.id,
      filePath: null,
      name:     normalized.name,
      category: normalized.category,
      modified: true, // 復元したものは未保存状態で開く
      revision: 0,
      template: normalized.template,
      steps:    normalized.steps
    };
    resetEditorForProjectSwitch();
    showScreen('editor');
    renderStepList();
    renderCanvas();
    loadStepProps();
    updateTitleBar();
    updateStatusBar();
  } else if (res === 1) {
    clearAutosaveFor(entry.id);
  }
  // res === 2（あとで）: 何もしない。次回起動時にまた尋ねる。
}

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
    item.addEventListener('contextmenu', e => {
      e.preventDefault();
      showFolderContextMenu(folderName, e.clientX, e.clientY);
    });
    container.appendChild(item);
  });

  // "＋ フォルダを追加" button
  const addBtn = document.createElement('div');
  addBtn.className = 'sidebar-add-folder';
  addBtn.textContent = '＋ フォルダを追加';
  addBtn.addEventListener('click', async () => {
    const name = await showInputDialog({ title: 'フォルダを追加', label: 'フォルダ名', okLabel: '作成' });
    if (!name) return;
    const result = await window.opesna.createProjectFolder(name);
    if (!result || !result.ok) {
      showToast(result && result.code === 'EEXIST' ? '同じ名前のフォルダがあります' : toUserMessage(result, 'フォルダの作成'), 'error');
      return;
    }
    await refreshProjectFolders();
    state.homeView = 'folder:' + result.name;
    renderHome();
  });
  container.appendChild(addBtn);
}

/** サイドバーのフォルダ項目の右クリックメニュー（F5: 名前を変更・削除）。 */
function showFolderContextMenu(folderName, x, y) {
  const items = [
    {
      label: '名前を変更',
      action: async () => {
        const newName = await showInputDialog({
          title: 'フォルダ名を変更', label: '新しいフォルダ名', value: folderName, okLabel: '変更',
        });
        if (!newName || newName === folderName) return;
        const result = await window.opesna.renameProjectFolder(folderName, newName);
        if (!result || !result.ok) {
          showToast(result && result.code === 'EEXIST' ? '同じ名前のフォルダがあります' : toUserMessage(result, 'フォルダの名前変更'), 'error');
          return;
        }
        // 開いているプロジェクトがこのフォルダの中にあれば、state もフォルダの移動先に追随させる。
        if (state.project.filePath && result.oldDir &&
            (state.project.filePath === result.oldDir ||
             state.project.filePath.startsWith(result.oldDir + '\\') ||
             state.project.filePath.startsWith(result.oldDir + '/'))) {
          state.project.filePath = result.newDir + state.project.filePath.slice(result.oldDir.length);
          if (state.project.category === folderName) {
            state.project.category = result.name;
            const catEl = document.getElementById('prop-category');
            if (catEl) catEl.value = result.name;
          }
        }
        if (state.homeView === 'folder:' + folderName) state.homeView = 'folder:' + result.name;
        await refreshProjectFolders();
        renderHome();
        showToast('フォルダ名を変更しました', 'ok');
      },
    },
    {
      label: '削除',
      danger: true,
      action: async () => {
        const res = await window.opesna.showConfirmDialog({
          title:   'フォルダの削除',
          message: `「${folderName}」フォルダを削除しますか？`,
          detail:  '空のフォルダだけ削除できます。',
          buttons: ['削除', 'キャンセル'],
          defaultId: 1,
          cancelId:  1,
        });
        if (res !== 0) return;
        const result = await window.opesna.deleteProjectFolder(folderName);
        if (!result || !result.ok) {
          const msg = result && result.code === 'ENOTEMPTY'
            ? 'フォルダ内のプロジェクトを移動または削除してから削除してください'
            : toUserMessage(result, 'フォルダの削除');
          showToast(msg, 'error');
          return;
        }
        if (state.homeView === 'folder:' + folderName) state.homeView = 'home';
        await refreshProjectFolders();
        renderHome();
        showToast('フォルダを削除しました', 'ok');
      },
    },
  ];
  showContextMenu(items, x, y);
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

/**
 * プロパティパネルのフォルダセレクトで選び直したときの実処理（E2）。
 * 保存済み（filePath があり、PROJECTS_DIR 配下）なら .opn を実際に移動する。
 * 未保存ならフォルダの分類（category）だけ変えて、次の保存でそのフォルダへ保存する。
 * PROJECTS_DIR の外に保存されたプロジェクトは移動できないため、分類だけ変える。
 */
async function applyCategoryChange(newFolder) {
  const oldFolder = state.project.category || null;
  if (newFolder === oldFolder) return;

  if (!state.project.filePath) {
    state.project.category = newFolder;
    markModified();
    return;
  }

  const result = await window.opesna.moveProject({ filePath: state.project.filePath, folder: newFolder });
  const catEl = document.getElementById('prop-category');

  if (!result || !result.ok) {
    if (result && result.code === 'EPERM') {
      // PROJECTS_DIR の外にあるプロジェクト: 移動はしないが、分類だけは変える
      state.project.category = newFolder;
      markModified();
      showToast('このプロジェクトはプロジェクトフォルダの外にあるため移動しません', 'info');
      return;
    }
    showToast(toUserMessage(result, 'フォルダの移動'), 'error');
    if (catEl) catEl.value = oldFolder || '';
    return;
  }

  // 実際にファイルを移動できたので、これは「保存済みの状態の変化」であり未保存にはしない。
  state.project.filePath = result.filePath;
  state.project.category = newFolder;
  await window.opesna.addRecent(result.filePath);
  showToast('フォルダを移動しました', 'ok');
}

// renderHome の呼び出し世代番号。サイドバーを素早く切り替えたときに、古い呼び出しの
// 結果（IPC が遅れて返ってきたもの）でカードが二重に並ばないようにする（F20）。
let homeRenderGeneration = 0;

async function renderHome() {
  const generation = ++homeRenderGeneration;
  const grid = document.getElementById('file-grid');
  if (!grid) return;

  // Update sidebar active state
  document.querySelectorAll('.sidebar-item[data-view]').forEach(item => {
    item.classList.toggle('active', item.dataset.view === state.homeView);
  });

  // Update section label（E14: 「ホーム」＝最近更新したプロジェクト、
  // 「最近使ったもの」＝最近開いたプロジェクト、と意味を分ける）
  let sectionLabel = '最近開いたプロジェクト';
  if (state.homeView === 'home') sectionLabel = '最近更新したプロジェクト';
  else if (state.homeView === 'all') sectionLabel = 'すべてのファイル';
  else if (state.homeView.startsWith('folder:')) sectionLabel = state.homeView.slice(7);
  const labelEl = document.querySelector('.section-label');
  if (labelEl) labelEl.textContent = sectionLabel;

  const newBtn = grid.querySelector('.file-card-new');
  grid.querySelectorAll('.file-card, .file-card-empty, .file-card-skeleton').forEach(el => el.remove());

  // U4: 取得中はスケルトンのプレースホルダを出す
  for (let i = 0; i < 3; i++) {
    const sk = document.createElement('div');
    sk.className = 'file-card-skeleton';
    grid.insertBefore(sk, newBtn);
  }

  let projects = null;
  try {
    if (state.homeView === 'recent') {
      // E14: 「最近開いたプロジェクト」は recent.json の順そのまま
      projects = await window.opesna.getRecentProjects();
    } else {
      projects = await window.opesna.getProjects();
      if (state.homeView === 'home') {
        projects = projects.slice(0, 20); // 最近更新した順に最大20件
      } else if (state.homeView.startsWith('folder:')) {
        const folderName = state.homeView.slice(7);
        projects = projects.filter(p => p.folder === folderName);
      }
      // 'all' はすべて
    }
  } catch (e) {
    console.warn('getProjects failed:', e);
    projects = null;
  }

  if (generation !== homeRenderGeneration) return; // 古い呼び出し（F20）

  grid.querySelectorAll('.file-card-skeleton').forEach(el => el.remove());

  if (projects === null) {
    renderHomeErrorState(grid, newBtn);
    return;
  }
  projects = projects || [];

  if (projects.length === 0) {
    renderHomeEmptyState(grid, newBtn);
    return;
  }

  projects.forEach(proj => {
    const card = document.createElement('div');
    card.className = 'file-card';
    const date = proj.modified
      ? new Date(proj.modified).toLocaleDateString('ja-JP')
      : '—';
    const colorIdx = (proj.name || '').length % 4;
    const stepLabel = (proj.steps || 0) + ' ステップ';
    const folderLabel = proj.folder ? escapeHtml(proj.folder) : '';

    card.innerHTML = `
      <div class="file-thumb${proj.thumb ? '' : ' file-thumb-color-' + colorIdx}">
        ${proj.thumb ? `<img src="${proj.thumb}" alt="">` : '📋'}
        <div class="file-thumb-badge">${stepLabel}</div>
        <button type="button" class="file-card-menu-btn" aria-label="操作メニュー" title="操作メニュー">⋮</button>
      </div>
      <div class="file-info">
        <div class="file-name" title="${escapeHtml(proj.name || '無題')}">${escapeHtml(proj.name || '無題')}</div>
        <div class="file-meta">${date}${folderLabel ? ' ・ 📂' + folderLabel : ''}</div>
      </div>
    `;

    // Left click: open directly by path
    card.addEventListener('click', async (e) => {
      if (e.target.closest('.file-card-menu-btn')) return; // ⋮ ボタンはメニューだけ開く
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
      showContextMenu(buildProjectCardMenuItems(proj), e.clientX, e.clientY);
    });

    // ⋮ ボタン: ホバーで出るメニューボタン（E11）。右クリックと同じ項目。
    const menuBtn = card.querySelector('.file-card-menu-btn');
    menuBtn?.addEventListener('click', e => {
      e.stopPropagation();
      const rect = menuBtn.getBoundingClientRect();
      showContextMenu(buildProjectCardMenuItems(proj), rect.left, rect.bottom + 2);
    });

    grid.insertBefore(card, newBtn);
  });
}

/** U6: プロジェクトが0件のとき／選んだフォルダが空のときの案内。 */
function renderHomeEmptyState(grid, newBtn) {
  const empty = document.createElement('div');
  empty.className = 'file-card-empty';
  if (state.homeView.startsWith('folder:')) {
    const folderName = state.homeView.slice(7);
    empty.innerHTML = `
      <div class="file-card-empty-title">「${escapeHtml(folderName)}」フォルダにはプロジェクトがありません</div>
      <div class="file-card-empty-actions">
        <button type="button" class="btn btn-primary" data-empty-action="new-in-folder">新規作成</button>
      </div>
    `;
    empty.querySelector('[data-empty-action="new-in-folder"]')?.addEventListener('click', async () => {
      if (!(await confirmDiscardChanges())) return;
      newProject(null, folderName);
    });
  } else {
    empty.innerHTML = `
      <div class="file-card-empty-title">まだプロジェクトがありません</div>
      <div class="file-card-empty-actions">
        <button type="button" class="btn btn-primary" data-empty-action="new">新規作成</button>
        <button type="button" class="btn btn-ghost" data-empty-action="record">記録を始める</button>
        <button type="button" class="btn btn-ghost" data-empty-action="from-image">画像ファイルを読み込む</button>
      </div>
    `;
    empty.querySelector('[data-empty-action="new"]')?.addEventListener('click', () => document.getElementById('btn-new')?.click());
    empty.querySelector('[data-empty-action="record"]')?.addEventListener('click', () => document.getElementById('btn-record-home')?.click());
    empty.querySelector('[data-empty-action="from-image"]')?.addEventListener('click', () => document.getElementById('btn-from-image')?.click());
  }
  grid.insertBefore(empty, newBtn);
}

/** U6: 一覧の取得に失敗したときの案内。 */
function renderHomeErrorState(grid, newBtn) {
  const empty = document.createElement('div');
  empty.className = 'file-card-empty';
  empty.innerHTML = `
    <div class="file-card-empty-title">プロジェクトの一覧を読み込めませんでした</div>
    <div class="file-card-empty-actions">
      <button type="button" class="btn btn-primary" data-empty-action="retry">再読み込み</button>
    </div>
  `;
  empty.querySelector('[data-empty-action="retry"]')?.addEventListener('click', () => renderHome());
  grid.insertBefore(empty, newBtn);
}

/**
 * 右クリックメニュー（ホームのカード・ステップ一覧で共通）。U9:
 * ウィンドウからはみ出さないよう位置調整し、Esc・外側クリック・リサイズ・スクロールで
 * 閉じ、上下キーで項目移動・Enter で実行できるようにする。見た目は styles.css の
 * .context-menu 系クラスにまとめ、インライン style は使わない。
 * items: [{ label, action, danger?, disabled? } | { separator: true }]
 */
function showContextMenu(items, x, y) {
  const existing = document.querySelector('.context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';

  const itemEls = [];
  items.forEach(item => {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'context-menu-sep';
      sep.setAttribute('role', 'separator');
      menu.appendChild(sep);
      return;
    }
    const el = document.createElement('div');
    el.className = 'context-menu-item' + (item.danger ? ' danger' : '') + (item.disabled ? ' disabled' : '');
    el.textContent = item.label;
    el.setAttribute('role', 'menuitem');
    if (item.disabled) {
      el.setAttribute('aria-disabled', 'true');
    } else {
      el.tabIndex = -1;
      el.addEventListener('click', () => { close(); item.action(); });
      itemEls.push(el);
    }
    menu.appendChild(el);
  });

  document.body.appendChild(menu);

  // ウィンドウからはみ出す分だけ左・上へずらす
  const rect = menu.getBoundingClientRect();
  const pos = window.OpesnaEditorLogic.computeMenuPosition(
    x, y, rect.width, rect.height, window.innerWidth, window.innerHeight
  );
  menu.style.left = pos.left + 'px';
  menu.style.top  = pos.top  + 'px';

  let focusedIdx = -1;
  function focusItem(i) {
    if (itemEls.length === 0) return;
    if (itemEls[focusedIdx]) itemEls[focusedIdx].classList.remove('kbd-focus');
    focusedIdx = ((i % itemEls.length) + itemEls.length) % itemEls.length;
    itemEls[focusedIdx].classList.add('kbd-focus');
    itemEls[focusedIdx].focus();
  }

  function close() {
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('resize', close);
    document.removeEventListener('scroll', close, true);
    if (menu.parentNode) menu.parentNode.removeChild(menu);
  }

  function onOutside(ev) {
    if (!menu.contains(ev.target)) close();
  }

  function onKeydown(ev) {
    if (ev.key === 'Escape')    { ev.preventDefault(); close(); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); focusItem(focusedIdx + 1); }
    else if (ev.key === 'ArrowUp')   { ev.preventDefault(); focusItem(focusedIdx - 1); }
    else if (ev.key === 'Enter')     { ev.preventDefault(); if (itemEls[focusedIdx]) itemEls[focusedIdx].click(); }
  }

  // 開いた瞬間のクリック（この右クリック自体）で即座に閉じないよう次のイベントループで登録
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
  }, 0);

  focusItem(0);

  return { close };
}

/**
 * ホームのカードの操作メニュー項目（E11）。右クリック・「⋮」ボタンの両方から使う。
 * 開く／名前を変更／フォルダへ移動／エクスプローラーで表示／削除。
 */
function buildProjectCardMenuItems(proj) {
  return [
    {
      label: '開く',
      action: async () => {
        if (!(await confirmDiscardChanges())) return;
        proj.filePath ? openProjectByPath(proj.filePath) : openProject();
      }
    },
    {
      label: '名前を変更',
      action: async () => {
        if (!proj.filePath) return;
        const newName = await showInputDialog({
          title: '名前を変更', label: '新しい名前', value: proj.name || '無題', okLabel: '変更',
        });
        if (!newName) return;
        const result = await window.opesna.renameProject({ filePath: proj.filePath, newName });
        if (!result || !result.ok) {
          showToast(result && result.code === 'EEXIST' ? '同じ名前のプロジェクトがあります' : toUserMessage(result, '名前の変更'), 'error');
          return;
        }
        // 名前を付けて保存でユーザーが付けた名前を後から上書きしないのと同じ理由で、
        // 開いているプロジェクトなら state もここで一緒に更新する。
        if (state.project.filePath === proj.filePath) {
          state.project.filePath = result.filePath;
          state.project.name = newName;
          updateTitleBar();
          const nameInput = document.getElementById('prop-name');
          if (nameInput) nameInput.value = newName;
        }
        showToast('名前を変更しました', 'ok');
        renderHome();
      }
    },
    {
      label: 'フォルダへ移動',
      action: async () => {
        if (!proj.filePath) return;
        const folder = await showInputDialog({
          title: 'フォルダへ移動', label: '移動先のフォルダ名（空でフォルダの外へ）', value: proj.folder || '', okLabel: '移動',
        });
        if (folder === null) return;
        const targetFolder = folder.trim() || null;
        const result = await window.opesna.moveProject({ filePath: proj.filePath, folder: targetFolder });
        if (!result || !result.ok) {
          showToast(toUserMessage(result, 'フォルダへの移動'), 'error');
          return;
        }
        if (state.project.filePath === proj.filePath) {
          state.project.filePath = result.filePath;
          state.project.category = targetFolder;
          const catEl = document.getElementById('prop-category');
          if (catEl) catEl.value = targetFolder || '';
        }
        await refreshProjectFolders();
        showToast('フォルダへ移動しました', 'ok');
        renderHome();
      }
    },
    {
      label: 'エクスプローラーで表示',
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
        // E11: 「キャンセル」を既定のボタンにする（Enter で誤って削除されないように）。
        const res = await window.opesna.showConfirmDialog({
          title:   '削除の確認',
          message: `「${proj.name}」を削除しますか？`,
          detail:  'この操作は元に戻せません。',
          buttons: ['削除', 'キャンセル'],
          defaultId: 1,
          cancelId:  1,
        });
        if (res !== 0) return;
        try {
          const result = await window.opesna.deleteProject(proj.filePath);
          if (!result || !result.ok) {
            // 失敗時はカードを残す（renderHome を呼ばない）
            showToast(toUserMessage(result, '削除'), 'error');
            return;
          }
          showToast('削除しました', 'ok');
          renderHome();
        } catch (err) {
          showToast(toUserMessage(err, '削除'), 'error');
        }
      }
    }
  ];
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
    const saved = await saveProject();
    if (!saved) return false; // 保存ダイアログがキャンセルされた・保存に失敗した
  }
  return true;
}

/** 現在の（未保存かもしれない）プロジェクトの、自動保存の復旧ファイルを消す（F6）。 */
function clearAutosaveFor(projectId) {
  if (!projectId) return;
  window.opesna.autosaveClear(projectId).catch(() => {});
}

function makeEmptyProjectState(folder) {
  return {
    id: crypto.randomUUID(),
    filePath: null,
    name: '無題',
    category: folder || null,
    modified: false,
    revision: 0,
    template: 'simple',
    steps: []
  };
}

/** newProject / openProject / openProjectByPath / 復旧・破棄で共通の編集状態リセット。 */
function resetEditorForProjectSwitch() {
  state.editor.currentStep = 0;
  state.editor.undoStack = [];
  state.editor.redoStack = [];
  state.editor.selectedAnnotation = null;
  state.editor.zoomMode = 'fit'; // U2: 新規・開いた直後は画面に合わせる
  // 番号バッジの「次の番号」はステップごとに loadStepProps() で再計算するため
  // （WP3）、ここでは全ステップを走査した badgeNextNum の計算はしない。
  updateUndoRedoButtons();
}

function newProject(initialImage = null, folderHint = null) {
  // Inherit the currently selected folder from the home sidebar
  const folder = folderHint ||
    (state.homeView && state.homeView.startsWith('folder:') ? state.homeView.slice(7) : null);

  // 置き換える前のプロジェクトが未保存のまま（ファイルなし）だった場合、その復旧ファイルは
  // もう要らない（F6）。
  if (state.project.id && !state.project.filePath) clearAutosaveFor(state.project.id);

  state.project = makeEmptyProjectState(folder);

  const firstStep = createStep('ステップ 1');
  if (initialImage) {
    firstStep.imageDataUrl = initialImage.dataUrl;
    firstStep.imageWidth = initialImage.width || 0;
    firstStep.imageHeight = initialImage.height || 0;
  }
  state.project.steps.push(firstStep);

  resetEditorForProjectSwitch();
  showScreen('editor');

  renderStepList();
  loadStepProps(); // 「次の番号」の初期化（E9）もここで行われる
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

/** 保存用データを組み立てる（saveProject・saveProjectAs・自動保存で共通）。 */
function buildProjectSaveData() {
  saveCurrentStepProps();
  return {
    id:       state.project.id,
    version:  '1.0',
    name:     state.project.name,
    category: state.project.category || null,
    template: state.project.template,
    steps:    state.project.steps,
    exportSettings: state.project.exportSettings || null, // エクスポートのモーダル設定を .opn に持たせる（E5）
    savedAt:  new Date().toISOString()
  };
}

/**
 * プロジェクトを保存する。Ctrl+S 連打などで実行中に呼ばれた場合は、新しい保存を
 * 始めず進行中の Promise を返す（F18・二重実行対策）。
 * @returns {Promise<boolean>} true = 保存できた / false = 失敗またはダイアログをキャンセル
 */
async function saveProject({ silent = false } = {}) {
  if (pendingSavePromise) return pendingSavePromise;
  pendingSavePromise = doSaveProject({ silent }).finally(() => {
    pendingSavePromise = null;
  });
  return pendingSavePromise;
}

async function doSaveProject({ silent = false } = {}) {
  const revisionAtStart = state.project.revision;
  const data = buildProjectSaveData();

  try {
    if (state.project.filePath) {
      const result = await window.opesna.saveProject({ filePath: state.project.filePath, data });
      if (!result || !result.ok) {
        showToast(toUserMessage(result, '保存'), 'error');
        return false;
      }
      // 保存中に編集が増えていたら、まだ「未保存」のままにする（F18）。
      if (state.project.revision === revisionAtStart) state.project.modified = false;
      updateTitleBar();
      updateModifiedIndicator();
      await window.opesna.addRecent(state.project.filePath);
      clearAutosaveFor(state.project.id);
      if (!silent) showToast('保存しました', 'ok');
      return true;
    }

    const result = await window.opesna.saveProjectDialog({ data, folder: state.project.category || null });
    if (!result) return false; // キャンセル
    if (!result.ok) {
      showToast(toUserMessage(result, '保存'), 'error');
      return false;
    }
    state.project.filePath = result.filePath;
    // Keep user-set name; fall back to filename only if name is still default
    if (!state.project.name || state.project.name === '無題') {
      state.project.name = result.filePath.split(/[\\/]/).pop().replace(/\.opn$/i, '');
      const nameInput = document.getElementById('prop-name');
      if (nameInput) nameInput.value = state.project.name;
    }
    if (state.project.revision === revisionAtStart) state.project.modified = false;
    updateTitleBar();
    updateModifiedIndicator();
    await window.opesna.addRecent(result.filePath);
    clearAutosaveFor(state.project.id);
    showToast('保存しました', 'ok');
    return true;
  } catch (e) {
    showToast(toUserMessage(e, '保存'), 'error');
    return false;
  }
}

/** 常に「名前を付けて保存」ダイアログを開く（filePath があっても上書きしない）。 */
async function saveProjectAs() {
  const revisionAtStart = state.project.revision;
  const data = buildProjectSaveData();
  try {
    const result = await window.opesna.saveProjectDialog({ data, folder: state.project.category || null });
    if (!result) return false; // キャンセル
    if (!result.ok) {
      showToast(toUserMessage(result, '保存'), 'error');
      return false;
    }
    const oldId = state.project.id;
    const oldHadFile = !!state.project.filePath;
    state.project.filePath = result.filePath;
    // E11: 利用者が付けた名前を上書きしない。name がまだ既定の「無題」のときだけ
    // ファイル名から作る（doSaveProject の初回保存と同じ規則）。
    if (!state.project.name || state.project.name === '無題') {
      state.project.name = result.filePath.split(/[\\/]/).pop().replace(/\.opn$/i, '');
      const nameInput = document.getElementById('prop-name');
      if (nameInput) nameInput.value = state.project.name;
    }
    if (state.project.revision === revisionAtStart) state.project.modified = false;
    updateTitleBar();
    updateModifiedIndicator();
    await window.opesna.addRecent(result.filePath);
    if (!oldHadFile) clearAutosaveFor(oldId);
    showToast('保存しました', 'ok');
    return true;
  } catch (e) {
    showToast(toUserMessage(e, '保存'), 'error');
    return false;
  }
}

/**
 * open-project-dialog / open-project-by-path の結果を、検証してから一度に state へ
 * 反映する（F17）。normalizeProject が null を返す＝壊れている・信用できない場合は、
 * state を一切変えずにエラーを出す。
 */
async function applyOpenedProject(result) {
  if (!result) return false;
  const { filePath, data } = result;
  const fileBase = filePath ? filePath.split(/[\\/]/).pop() : null;
  const normalized = normalizeProject(data, { fileName: fileBase });
  if (!normalized) {
    showToast('開けませんでした。壊れているか、Opesna のプロジェクトではありません。', 'error');
    return false;
  }

  if (state.project.id && !state.project.filePath) clearAutosaveFor(state.project.id);

  state.project = {
    id:       normalized.id,
    filePath,
    name:     normalized.name,
    category: normalized.category,
    modified: false,
    revision: 0,
    template: normalized.template,
    steps:    normalized.steps,
    exportSettings: normalized.exportSettings // E5: 前回のエクスポート設定を復元する
  };

  resetEditorForProjectSwitch();
  showScreen('editor');
  renderStepList();
  renderCanvas();
  loadStepProps();
  updateTitleBar();
  updateStatusBar();

  await window.opesna.addRecent(filePath);
  return true;
}

async function openProjectByPath(filePath) {
  try {
    const result = await window.opesna.openProjectByPath(filePath);
    if (!result) { showToast('ファイルを開けませんでした', 'error'); return; }
    await applyOpenedProject(result);
  } catch (e) {
    showToast(toUserMessage(e, '読み込み'), 'error');
  }
}

async function openProject() {
  try {
    const result = await window.opesna.openProjectDialog();
    if (!result) return;
    await applyOpenedProject(result);
  } catch (e) {
    showToast(toUserMessage(e, '読み込み'), 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS INIT & RENDER
// ─────────────────────────────────────────────────────────────────────────────

function initCanvas() {
  setupCanvasResizeObserver(); // 既に初期化済みでも監視だけは張り直す必要がないので先に
  if (canvas) return; // already initialized
  canvas = document.getElementById('main-canvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');

  canvas.addEventListener('mousedown', onCanvasMouseDown);
  canvas.addEventListener('mousemove', onCanvasMouseMove);
  canvas.addEventListener('mouseup', onCanvasMouseUp);
  canvas.addEventListener('dblclick', onCanvasDoubleClick);
}

// U2: 「画面に合わせる」モードのとき、キャンバス領域の大きさが変わったら倍率を再計算する
let canvasResizeObserver = null;
function setupCanvasResizeObserver() {
  if (canvasResizeObserver || typeof ResizeObserver === 'undefined') return;
  const wrapper = document.getElementById('canvas-wrapper');
  if (!wrapper) return;
  canvasResizeObserver = new ResizeObserver(() => {
    if (state.editor.zoomMode === 'fit') renderCanvas();
  });
  canvasResizeObserver.observe(wrapper);
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
    applyZoomDisplay();
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  canvas.style.display = 'block';

  const img = getStepImage(step);
  const paint = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    // U2: 「画面に合わせる」モードでは、キャンバス領域の内寸に収まる倍率（最大100%）を
    // 使う。手動倍率のときはユーザーが選んだ state.editor.zoom をそのまま使う。
    if (state.editor.zoomMode === 'fit') {
      const wrapper = document.getElementById('canvas-wrapper');
      const availW = wrapper ? wrapper.clientWidth  : img.naturalWidth;
      const availH = wrapper ? wrapper.clientHeight : img.naturalHeight;
      state.editor.zoom = window.OpesnaEditorLogic.computeFitZoom(
        img.naturalWidth, img.naturalHeight, availW, availH, 1.0
      );
    }

    // 表示サイズは常に「元の寸法 × 倍率」にする（縦横比を保つ）。はみ出した分は
    // .canvas-scroll の overflow:auto でスクロールする。
    canvas.style.width = (img.naturalWidth * state.editor.zoom) + 'px';
    canvas.style.height = (img.naturalHeight * state.editor.zoom) + 'px';
    applyZoomDisplay();

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

    markModified();
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

  // S4: モザイクは注釈として残さず、描いた時点で画像そのものに焼き込む
  if (state.editor.tool === 'mosaic') {
    applyMosaicToStep(start, pos);
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
    return;
  }

  // E7: 選択ツールでテキスト・吹き出しをダブルクリックしたら、今の文字入りで編集する
  if (state.editor.tool === 'select') {
    const step = getCurrentStep();
    if (!step) return;
    const found = step.annotations.slice().reverse()
      .find(a => (a.type === 'text' || a.type === 'callout') && hitTest(a, pos));
    if (!found) return;
    state.editor.selectedAnnotation = found;
    syncPropsToSelectedAnnotation(found);
    renderCanvas();
    showTextInput(e.clientX, e.clientY, found.type, { x: found.x, y: found.y }, found);
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

    // F25: 元の形式が JPEG ならそのまま JPEG（品質0.92）で保存し、PNG化による肥大を避ける
    const fmt = window.OpesnaEditorLogic.exportFormatFor(step.imageDataUrl);
    step.imageDataUrl = offscreen.toDataURL(fmt.mime, fmt.quality);
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

    markModified();
    renderCanvas();
    renderStepList();
    updateStatusBar();
    updateModifiedIndicator();
    showToast('トリミングしました', 'ok');
  };
  img.src = step.imageDataUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOSAIC TOOL（S4: 注釈にせず画像へ直接焼き込む）
// ─────────────────────────────────────────────────────────────────────────────

function applyMosaicToStep(start, end) {
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
    offscreen.width  = img.naturalWidth;
    offscreen.height = img.naturalHeight;
    const offCtx = offscreen.getContext('2d');
    offCtx.drawImage(img, 0, 0);

    pushUndo(); // F4 の浅いコピーにより imageDataUrl の参照が戻るので、焼き込み前に戻せる

    // 選択範囲をキャンバス内に収める
    const cx = Math.max(0, x);
    const cy = Math.max(0, y);
    const cw = Math.min(w, offscreen.width  - cx);
    const ch = Math.min(h, offscreen.height - cy);
    if (cw > 0 && ch > 0) applyMosaicOnCtx(offCtx, cx, cy, cw, ch);

    // S4: 元の形式が JPEG ならそのまま JPEG（品質0.92）、それ以外は PNG
    const fmt = window.OpesnaEditorLogic.exportFormatFor(step.imageDataUrl);
    step.imageDataUrl = offscreen.toDataURL(fmt.mime, fmt.quality);

    markModified();
    renderCanvas();
    renderStepList();
    updateStatusBar();
    updateModifiedIndicator();

    if (!state.editor.mosaicHintShown) {
      state.editor.mosaicHintShown = true;
      showToast('モザイクは画像に直接書き込まれます（元に戻すで取り消せます）', 'info');
    }
  };
  img.src = step.imageDataUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEXT / CALLOUT INPUT OVERLAY
// ─────────────────────────────────────────────────────────────────────────────

// clientX/clientY: viewport mouse position; canvasPos: canvas-pixel position
// existingAnn（E7）: 指定すると新規作成ではなく、そのテキスト・吹き出し注釈を編集する
function showTextInput(clientX, clientY, type, canvasPos, existingAnn) {
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

  textarea.value = existingAnn ? (existingAnn.text || '') : '';
  // Use setTimeout to avoid blur from the current click being processed first
  setTimeout(() => { textarea.focus(); textarea.select(); }, 0);

  let committed = false;

  function commit() {
    if (committed) return;
    committed = true;

    const text = textarea.value.trim();

    if (existingAnn) {
      // E7: 既存注釈の編集。空で確定したら削除する。
      const step = getCurrentStep();
      if (step) {
        pushUndo();
        if (text) {
          existingAnn.text = text;
        } else {
          step.annotations = step.annotations.filter(a => a.id !== existingAnn.id);
          if (state.editor.selectedAnnotation && state.editor.selectedAnnotation.id === existingAnn.id) {
            state.editor.selectedAnnotation = null;
          }
        }
        markModified();
        renderCanvas();
        renderStepList();
        updateStatusBar();
        updateModifiedIndicator();
      }
    } else if (text) {
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
  markModified();

  renderCanvas();
  renderStepList();
  updateStatusBar();
  updateModifiedIndicator();
}

function makeUndoSnapshot() {
  // F4: JSON.parse(JSON.stringify(...)) は base64 画像 (imageDataUrl) まで丸ごと複製し
  // メモリを食う。文字列は不変なので参照共有で十分 ── ステップと注釈だけ浅くコピーする。
  return {
    steps:       window.OpesnaEditorLogic.cloneStepsShallow(state.project.steps),
    currentStep: state.editor.currentStep,
  };
}

function restoreUndoSnapshot(snap) {
  // 復元後にこのスナップショットを直接書き換えると、undo/redo を往復したときに
  // 過去のスナップショットまで書き換わってしまうため、ここでももう一度浅くコピーする。
  state.project.steps = window.OpesnaEditorLogic.cloneStepsShallow(snap.steps);
  state.editor.currentStep = Math.max(0, Math.min(snap.currentStep, state.project.steps.length - 1));
  state.editor.selectedAnnotation = null;
  markModified();
  renderCanvas();
  renderStepList();
  loadStepProps(); // 「次の番号」の再計算（E9）もここで行われる
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
  const wasBadge = state.editor.selectedAnnotation.type === 'badge';
  step.annotations = step.annotations.filter(a => a.id !== id);
  if (wasBadge) {
    // E9: 残りのバッジを番号順に1から振り直す
    step.annotations = window.OpesnaEditorLogic.renumberBadges(step.annotations);
    updateBadgeNextNumForCurrentStep();
  }
  state.editor.selectedAnnotation = null;
  markModified();

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
  if (ann.type === 'badge') {
    const r = 30;
    return pos.x >= ann.x - r && pos.x <= ann.x + r &&
           pos.y >= ann.y - r && pos.y <= ann.y + r;
  }
  // E7: テキストは実際の描画幅（ctx.measureText）× フォントの高さの矩形、
  // 吹き出しは drawCallout が描く枠の矩形で当たり判定する（選びやすくする）。
  if (ann.type === 'text' && ctx) {
    const fontSize = ann.fontSize || 16;
    ctx.save();
    ctx.font = `bold ${fontSize}px sans-serif`;
    const w = ctx.measureText(ann.text || '').width;
    ctx.restore();
    // fillText の基準は alphabetic ベースライン (ann.y) なので、上方向にフォント高さ分広げる
    return pos.x >= ann.x - padding && pos.x <= ann.x + w + padding &&
           pos.y >= ann.y - fontSize - padding && pos.y <= ann.y + padding;
  }
  if (ann.type === 'callout' && ctx) {
    const fontSize = ann.fontSize || 13;
    ctx.save();
    ctx.font = `bold ${fontSize}px sans-serif`;
    const w = ctx.measureText(ann.text || 'テキスト').width + 16;
    ctx.restore();
    const h = fontSize + 12 + 8; // 吹き出しの矢羽根ぶんも含める
    return pos.x >= ann.x - padding && pos.x <= ann.x + w + padding &&
           pos.y >= ann.y - padding && pos.y <= ann.y + h + padding;
  }
  if (ann.type === 'text' || ann.type === 'callout') {
    // ctx が無い（テスト環境等）ときの簡易フォールバック
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
        <div class="step-item-sub">注釈 ${step.annotations.length}個</div>
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

    // E16: ステップ一覧の項目自体を右クリックしても ⋮ と同じメニューを出す
    div.addEventListener('contextmenu', e => {
      e.preventDefault();
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
      const img = new Image();
      img.onload = () => drawStepThumb(thumbCanvas, img, step.annotations);
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
  state.editor.zoomMode = 'fit'; // U2: ステップを開いた直後は画面に合わせる

  renderStepList();
  renderCanvas();
  loadStepProps();
  updateStatusBar();
}

// 右パネルの入力欄が「今どのステップの内容を表示しているか」を覚えておく。
// F8: 記録中の onStepCaptured は currentStep を直接差し替えるため、saveCurrentStepProps が
// 呼ばれた時点で入力欄の中身がどのステップのものか（loadStepProps されたステップ）と
// 実際の currentStep がずれていることがある。ずれていたら書き込まない。
let loadedStepPropsId = null;

function loadStepProps() {
  const step = getCurrentStep();
  const titleInput = document.getElementById('step-title-input');
  const descInput = document.getElementById('step-desc-input');
  loadedStepPropsId = step ? step.id : null;
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

  updateBadgeNextNumForCurrentStep();
  updateExportPreview();
}

/**
 * 「次の番号」を現在のステップの通し番号（バッジの最大値+1）に合わせる（E9）。
 * ステップを切り替えるたびに loadStepProps から呼ばれ、ユーザーが手で変えた値は
 * 次に切り替えるまでのその場限りなのでここでリセットしてよい。
 */
function updateBadgeNextNumForCurrentStep() {
  const step = getCurrentStep();
  state.editor.badgeNextNum = window.OpesnaEditorLogic.nextBadgeNumber(step ? step.annotations : []);
  state.editor.badgeNextNumManual = false;
  const badgeNumInput = document.getElementById('prop-badge-num');
  if (badgeNumInput) badgeNumInput.value = state.editor.badgeNextNum;
}

function saveCurrentStepProps() {
  const step = getCurrentStep();
  if (!step) return;
  // 入力欄が別のステップの内容を表示中なら、その内容を今のステップへ書き込まない（F8）。
  if (step.id !== loadedStepPropsId) return;
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
  markModified();

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
  markModified();

  renderStepList();
  renderCanvas();
  loadStepProps();
  updateStatusBar();
  updateModifiedIndicator();

  // E16: 確認ダイアログは出さず、代わりに元に戻す導線を出す
  showToast('ステップを削除しました', 'info', { actionLabel: '元に戻す', onAction: undo });
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
  markModified();

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
  markModified();

  renderStepList();
  renderCanvas();
  loadStepProps();
  updateStatusBar();
  updateModifiedIndicator();
}


function showStepContextMenu(idx, e) {
  const items = [
    { label: '画像を差し替える', action: () => replaceStepImage(idx) },
    { label: '複製', action: () => duplicateStep(idx) },
    { label: '上へ移動', action: () => moveStep(idx, idx - 1), disabled: idx === 0 },
    { label: '下へ移動', action: () => moveStep(idx, idx + 1), disabled: idx === state.project.steps.length - 1 },
    { separator: true },
    { label: '削除', action: () => deleteStep(idx), danger: true }
  ];

  showContextMenu(items, e.clientX, e.clientY);
}

/**
 * U1: ステップ一覧のサムネイルを、枠に収まるよう縦横比を保って中央に描く
 * （object-fit: contain 相当）。注釈もその倍率・オフセットに合わせて描く。
 */
function drawStepThumb(thumbCanvas, img, annotations) {
  const tctx = thumbCanvas.getContext('2d');
  const cw = thumbCanvas.width, ch = thumbCanvas.height;
  tctx.clearRect(0, 0, cw, ch);
  if (!img.naturalWidth || !img.naturalHeight) return;

  const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
  const dw = img.naturalWidth  * scale;
  const dh = img.naturalHeight * scale;
  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;

  tctx.drawImage(img, dx, dy, dw, dh);

  tctx.save();
  tctx.translate(dx, dy);
  (annotations || []).forEach(ann => drawAnnotationScaled(tctx, ann, scale, scale));
  tctx.restore();
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

// F19+E4: null のときは「今のステップに入れる／新しいステップを作って入れる」という
// 通常の決め方を使う。ステップの番号が入っているときは、そのステップの画像だけを
// 差し替える（ステップのメニューの「画像を差し替える」から使う）。
let captureReplaceIndex = null;

/** ステップのメニュー「画像を差し替える」: そのステップの画像だけをキャプチャで置き換える。 */
function replaceStepImage(idx) {
  captureReplaceIndex = idx;
  openModal('modal-capture');
}

const IMPORT_IMAGE_MAX_EDGE = 4096;

/**
 * 取り込む画像の長辺が 4096px を超えていたら縮小する（F25）。
 * それ以外はそのまま返す。
 */
async function downscaleImageIfNeeded(dataUrl) {
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload  = () => resolve(im);
    im.onerror = () => reject(new Error('decode error'));
    im.src = dataUrl;
  });

  const longEdge = Math.max(img.width, img.height);
  if (longEdge <= IMPORT_IMAGE_MAX_EDGE || longEdge === 0) {
    return { dataUrl, width: img.width, height: img.height, resized: false };
  }

  const scale = IMPORT_IMAGE_MAX_EDGE / longEdge;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  off.getContext('2d').drawImage(img, 0, 0, w, h);

  return { dataUrl: off.toDataURL('image/png'), width: w, height: h, resized: true };
}

async function startCapture(mode) {
  closeModal('modal-capture');

  if (mode === 'import') {
    try {
      const result = await window.opesna.importImage();
      if (result === null) return; // キャンセル
      if (!result.ok) {
        showToast(toUserMessage(result, '画像の読み込み'), 'error');
        return;
      }
      const resized = await downscaleImageIfNeeded(result.dataUrl);
      if (resized.resized) showToast('画像が大きいため縮小して取り込みました', 'info');
      await setStepImage(resized.dataUrl);
    } catch (e) {
      showToast(toUserMessage(e, '画像の読み込み'), 'error');
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
  const runCapture = async () => {
    try {
      const dataUrl = await window.opesna.captureScreen();
      if (dataUrl) await setStepImage(dataUrl);
    } catch (e) {
      showToast('キャプチャに失敗しました', 'error');
    }
  };
  // U4: 遅延ありのときは、最小化される前に「何秒後に撮るか」を短く知らせる
  if (delay > 0) {
    showToast(`${delay}秒後に撮影します`, 'info', { duration: 700 });
  }
  setTimeout(runCapture, delay * 1000 + 300);
}

async function setStepImage(dataUrl) {
  const replaceIdx = captureReplaceIndex;
  const isReplace  = replaceIdx !== null && replaceIdx !== undefined
    && replaceIdx >= 0 && replaceIdx < state.project.steps.length;
  captureReplaceIndex = null;

  const decoded = await new Promise(resolve => {
    const img = new Image();
    img.onload  = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });

  // デコード失敗時は壊れた画像を設定しない
  if (!decoded) {
    showToast('画像の読み込みに失敗しました', 'error');
    return;
  }

  pushUndo();

  let step;
  if (isReplace) {
    // メニューの「画像を差し替える」: そのステップの画像だけを置き換える
    step = state.project.steps[replaceIdx];
    state.editor.currentStep = replaceIdx;
  } else {
    const current = getCurrentStep();
    if (current && !current.imageDataUrl) {
      // F19+E4: 今のステップに画像が無ければ、そこへ入れる
      step = current;
    } else {
      // 今のステップに画像があれば、直後に新しいステップを挿入してそこへ入れる
      // （末尾に空ステップを残す自動追加はしない。追加したステップを選択状態にする）
      step = createStep('ステップ ' + (state.project.steps.length + 1));
      const insertAt = state.editor.currentStep + 1;
      state.project.steps.splice(insertAt, 0, step);
      state.editor.currentStep = insertAt;
    }
  }

  step.imageDataUrl = dataUrl;
  step.imageWidth   = decoded.width;
  step.imageHeight  = decoded.height;
  state.editor.selectedAnnotation = null;

  markModified();
  state.editor.zoomMode = 'fit'; // U2: 新しい画像が入った直後は画面に合わせる
  renderCanvas();
  renderStepList();
  loadStepProps();
  updateStatusBar();
  showToast(isReplace ? '画像を差し替えました' : '画像を設定しました', 'ok');
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
    // F10: 一覧のサムネイルは低解像度なので、選んだ1枚だけ高解像度で撮り直す
    // （取れなければ一覧のサムネイルをそのまま使う）
    const pickWindow = async () => {
      closeModal('modal-window-select');
      let dataUrl = w.dataUrl;
      try {
        const full = await window.opesna.captureWindowFull?.(w.id);
        if (full) dataUrl = full;
      } catch (_) { /* 取れなければ一覧のサムネイルを使う */ }
      setStepImage(dataUrl);
    };
    card.addEventListener('click', pickWindow);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') pickWindow();
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
    // 「カーソルを含める」は desktopCapturer では実現できず、切り替えても何も起きなかったため外した。
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
    }
    // 「キャプチャ後に自動でステップ追加」は setStepImage の新しい決め方（画像の有無で
    // 入れ先を決め、選択状態にする）に置き換えたため外した。
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
  ],
  // 「バージョン情報」タブ。環境設定の画面の作りは後で作り直す予定なので（brief.md 参照）、
  // 既存の仕組み（PREFS_CONFIG の項目 + renderPrefs 末尾の追加ブロック）に最小限で乗せている。
  version: [
    { key: 'checkUpdatesOnStartup', label: '起動時に新しい版があるか確認する', type: 'toggle' }
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

  if (tab === 'version') renderVersionTabExtras(content);
}

/**
 * 「バージョン情報」タブの、PREFS_CONFIG の汎用項目（トグル等）だけでは表せない部分
 * （現在の版・問い合わせ先の表示・「更新を確認」「更新する」「リリースページを開く」
 * 「通信を確かめる」）。仕様書 U-01・U-02・U-05・U-08。
 */
function renderVersionTabExtras(content) {
  const box = document.createElement('div');
  box.className = 'update-version-box';
  box.innerHTML = `
    <div class="update-version-row">
      <span class="update-version-label">現在の版</span>
      <span id="update-current-version">確認中…</span>
    </div>
    <div class="update-version-row">
      <span class="update-version-label">問い合わせ先</span>
      <span id="update-feed-url" class="update-feed-url"></span>
    </div>
    <div class="update-version-actions">
      <button type="button" class="btn btn-primary" id="btn-update-check">更新を確認</button>
      <button type="button" class="btn btn-ghost" id="btn-update-test-connection">通信を確かめる</button>
    </div>
    <div id="update-check-result" class="update-check-result" role="status"></div>
    <div id="update-progress-row" class="update-progress-row" hidden>
      <div class="update-progress-bar"><div id="update-progress-fill" class="update-progress-fill"></div></div>
      <span id="update-progress-text"></span>
      <button type="button" class="btn btn-ghost btn-sm" id="btn-update-cancel">キャンセル</button>
    </div>
  `;
  content.appendChild(box);

  const currentVersionEl = document.getElementById('update-current-version');
  const feedUrlEl = document.getElementById('update-feed-url');
  if (feedUrlEl) feedUrlEl.textContent = state.settings.updateFeedUrl || '(未設定)';

  window.opesna.updateGetState?.().then(s => {
    if (currentVersionEl && s) currentVersionEl.textContent = `v${s.currentVersion}`;
  }).catch(() => {
    if (currentVersionEl) currentVersionEl.textContent = '(取得できませんでした)';
  });

  document.getElementById('btn-update-check')?.addEventListener('click', runUpdateCheckFromPrefs);
  document.getElementById('btn-update-test-connection')?.addEventListener('click', runUpdateTestConnection);
  document.getElementById('btn-update-cancel')?.addEventListener('click', cancelUpdateApply);

  // タブを開き直したときに、ダウンロード中なら進み具合の行を出したままにする
  const progressRow = document.getElementById('update-progress-row');
  if (progressRow) progressRow.hidden = !state.update.applying;

  renderUpdateCheckResult();
}

/** 「更新を確認」の結果表示を、state.update.checkResult から描き直す。 */
function renderUpdateCheckResult() {
  const el = document.getElementById('update-check-result');
  if (!el) return; // バージョン情報タブが開いていない

  if (state.update.checking) {
    el.innerHTML = '<span class="update-status">確認中…</span>';
    return;
  }
  const result = state.update.checkResult;
  if (!result) { el.innerHTML = ''; return; }

  const statusClass = result.status === 'available' ? 'ok' : (result.status === 'error' ? 'error' : 'muted');
  let html = `<span class="update-status update-status-${statusClass}">${escapeHtml(result.message)}</span>`;

  if (result.status === 'available') {
    html += '<div class="update-check-actions">';
    if (result.canApply) {
      html += `<button type="button" class="btn btn-primary btn-sm" id="btn-update-apply">更新する</button>`;
    }
    html += `<button type="button" class="btn btn-ghost btn-sm" id="btn-update-open-page">リリースページを開く</button>`;
    html += '</div>';
  }
  el.innerHTML = html;

  document.getElementById('btn-update-apply')?.addEventListener('click', () => startUpdateApply());
  document.getElementById('btn-update-open-page')?.addEventListener('click', () => {
    window.opesna.updateOpenReleasePage?.();
  });
}

async function runUpdateCheckFromPrefs() {
  state.update.checking = true;
  renderUpdateCheckResult();
  try {
    const result = await window.opesna.updateCheck();
    state.update.checkResult = result;
  } catch (e) {
    state.update.checkResult = {
      status: 'error', message: OpesnaErrorMessages.toUserMessage(e, '更新の確認'),
    };
  } finally {
    state.update.checking = false;
    renderUpdateCheckResult();
  }
}

async function runUpdateTestConnection() {
  const btn = document.getElementById('btn-update-test-connection');
  if (btn) btn.disabled = true;
  const toast = showToast('通信を確かめています…', 'info', { persistent: true });
  try {
    const result = await window.opesna.updateTestConnection();
    toast.update(result.message, result.ok ? 'ok' : 'error');
  } catch (e) {
    toast.update(OpesnaErrorMessages.toUserMessage(e, '通信の確認'), 'error');
  } finally {
    if (btn) btn.disabled = false;
    setTimeout(() => toast.close(), 4000);
  }
}

/** 「更新する」。未保存の変更があれば先に保存してから、ダウンロードと入れ替えに入る（仕様書 U-04）。 */
async function startUpdateApply() {
  if (state.update.applying) return;

  if (state.project.modified) {
    const res = await window.opesna.showConfirmDialog({
      title: '更新',
      message: '保存されていない変更があります。',
      detail: '更新する前に保存しますか？',
      buttons: ['保存して更新', 'キャンセル'],
    });
    if (res !== 0) return; // キャンセル（またはダイアログを閉じた）
    const saved = await trySaveForUpdate();
    if (!saved) return;
  }

  state.update.applying = true;
  state.update.progress = 0;
  renderUpdateCheckResult();
  const progressRow = document.getElementById('update-progress-row');
  if (progressRow) progressRow.hidden = false;

  try {
    const result = await window.opesna.updateDownloadAndApply();
    if (!result.ok) {
      state.update.applying = false;
      if (progressRow) progressRow.hidden = true;
      // キャンセル（利用者が「キャンセル」を押した）は失敗として騒がしく出さない
      if (result.reason !== 'cancelled') {
        showToast(result.message || '更新に失敗しました', 'error');
      } else {
        showToast(result.message || 'キャンセルしました。', 'info');
      }
      renderUpdateCheckResult();
    }
    // 成功時は main 側がアプリを終了するので、ここでは何もしない
  } catch (e) {
    state.update.applying = false;
    if (progressRow) progressRow.hidden = true;
    showToast(OpesnaErrorMessages.toUserMessage(e, '更新'), 'error');
    renderUpdateCheckResult();
  }
}

/** 進み具合の行の「キャンセル」ボタン。ダウンロード中の一時ファイルは updater.js 側が消す。 */
async function cancelUpdateApply() {
  const btn = document.getElementById('btn-update-cancel');
  if (btn) btn.disabled = true;
  try {
    await window.opesna.updateCancel?.();
  } catch (e) {
    showToast(OpesnaErrorMessages.toUserMessage(e, '更新のキャンセル'), 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
  // 実際の後始末（applying=false・進み具合の行を隠す・トースト表示）は
  // updateDownloadAndApply() の呼び出し元（startUpdateApply）が結果を受けて行う。
}

/** 既存の保存処理を流用し、失敗したら false を返す（更新を続けさせない）。 */
async function trySaveForUpdate() {
  try {
    await saveProject();
    return !state.project.modified; // 保存ダイアログをキャンセルした場合は modified が残る
  } catch (e) {
    showToast(OpesnaErrorMessages.toUserMessage(e, '保存'), 'error');
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE BANNER（起動時の確認・仕様書 U-06）
// ─────────────────────────────────────────────────────────────────────────────

function showUpdateBanner(tag) {
  const banner = document.getElementById('update-banner');
  const text = document.getElementById('update-banner-text');
  if (!banner || !text) return;
  state.update.bannerTag = tag;
  text.textContent = `新しい版 ${tag} が利用できます`;
  banner.hidden = false;
}

function hideUpdateBanner() {
  const banner = document.getElementById('update-banner');
  if (banner) banner.hidden = true;
}

function setupUpdateBanner() {
  document.getElementById('update-banner-apply')?.addEventListener('click', () => {
    openModal('modal-prefs');
    state.currentPrefsTab = 'version';
    document.querySelectorAll('.prefs-cat').forEach(el => {
      const active = el.dataset.pref === 'version';
      el.classList.toggle('active', active);
      el.setAttribute('aria-selected', String(active));
    });
    renderPrefs('version');
    runUpdateCheckFromPrefs();
  });
  document.getElementById('update-banner-detail')?.addEventListener('click', () => {
    openModal('modal-prefs');
    state.currentPrefsTab = 'version';
    renderPrefs('version');
  });
  document.getElementById('update-banner-close')?.addEventListener('click', () => {
    hideUpdateBanner();
    window.opesna.updateDismissPending?.();
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
  if (id === 'modal-capture') {
    // F15: 遅延の初期値は環境設定の値を使う（変更してもその回だけで、設定には保存しない）
    const delayEl = document.getElementById('capture-delay');
    if (delayEl) delayEl.value = String(state.settings.captureDelay ?? 0);
  }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
  // showInputDialog() の Promise がまだ待たれている状態で、×・キャンセル・Esc・
  // 背景クリックのどれで閉じても「キャンセル」として解決する（F5）。
  if (id === 'modal-input' && inputDialogResolve) {
    const resolve = inputDialogResolve;
    inputDialogResolve = null;
    resolve(null);
  }
  // フォーカスを開く前の要素へ戻す
  if (modalPrevFocus && typeof modalPrevFocus.focus === 'function') {
    modalPrevFocus.focus();
  }
  modalPrevFocus = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// INPUT DIALOG（F5: Electron は window.prompt を実装しておらず使えないため）
// ─────────────────────────────────────────────────────────────────────────────

let inputDialogResolve = null;

/**
 * アプリ内の入力ダイアログを開く。Enter で決定、Esc・×・背景クリックでキャンセル。
 * @param {{title?:string, label?:string, value?:string, okLabel?:string}} opts
 * @returns {Promise<string|null>} 決定した文字列（前後の空白を除く）。キャンセルなら null。
 */
function showInputDialog({ title = '入力', label = '', value = '', okLabel = 'OK' } = {}) {
  return new Promise(resolve => {
    inputDialogResolve = resolve;
    const titleEl = document.getElementById('modal-input-title');
    const labelEl = document.getElementById('input-dialog-label');
    const fieldEl = document.getElementById('input-dialog-field');
    const okBtn   = document.getElementById('input-dialog-ok');
    if (titleEl) titleEl.textContent = title;
    if (labelEl) labelEl.textContent = label;
    if (fieldEl) fieldEl.value = value || '';
    if (okBtn) {
      okBtn.textContent = okLabel;
      okBtn.disabled = !(value || '').trim();
    }
    openModal('modal-input');
    if (fieldEl) { fieldEl.focus(); fieldEl.select(); }
  });
}

/** OK ボタン・Enter で入力ダイアログを閉じ、入力値で Promise を解決する。 */
function resolveInputDialog() {
  const fieldEl = document.getElementById('input-dialog-field');
  const val = fieldEl ? fieldEl.value.trim() : '';
  if (!val) return;
  if (inputDialogResolve) {
    const resolve = inputDialogResolve;
    inputDialogResolve = null;
    resolve(val);
  }
  closeModal('modal-input');
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

/**
 * 手動倍率にする。拡大・縮小ボタンやショートカット、倍率表示クリック（100%表示）から呼ぶ。
 * 「画面に合わせる」に戻すには setZoomFit() を使う。
 */
function setZoom(z) {
  state.editor.zoomMode = 'manual';
  state.editor.zoom = Math.max(0.25, Math.min(4, Math.round(z * 100) / 100));
  renderCanvas(); // renderCanvas 内の applyZoomDisplay() が表示とボタン状態を更新する
}

/** 「画面に合わせる」モードに戻す（U2）。実際の倍率は renderCanvas が再計算する。 */
function setZoomFit() {
  state.editor.zoomMode = 'fit';
  renderCanvas();
}

/** ズーム表示・ズームボタンの有効状態・fitボタンの選択状態を、現在の state.editor に合わせる。 */
function applyZoomDisplay() {
  const zoomValEl = document.getElementById('zoom-val');
  if (zoomValEl) zoomValEl.textContent = Math.round(state.editor.zoom * 100) + '%';
  const zoomInBtn  = document.getElementById('btn-zoom-in');
  const zoomOutBtn = document.getElementById('btn-zoom-out');
  if (zoomInBtn)  zoomInBtn.disabled  = state.editor.zoom >= 4;
  if (zoomOutBtn) zoomOutBtn.disabled = state.editor.zoom <= 0.25;
  const fitBtn = document.getElementById('btn-zoom-fit');
  if (fitBtn) fitBtn.classList.toggle('active', state.editor.zoomMode === 'fit');
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

  if (stepEl) {
    // U6: ステップが無いときは「ステップ 0 / 0」を出さない。記録中かどうかで文言を変える。
    if (total === 0) {
      stepEl.textContent = state.recording ? '記録中…' : 'ステップなし';
    } else {
      stepEl.textContent = `ステップ ${idx + 1} / ${total}`;
    }
  }
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
  // 版番号を増やす。保存開始時の版番号と食い違うときは、保存が終わっても
  // modified=false にしない（F18。保存中に増えた編集を「保存済み」に見せない）。
  state.project.revision = (state.project.revision || 0) + 1;
  updateModifiedIndicator();
}

// トースト表示の状態。#toast は画面に1つだけなので、新しいトーストが出たら古いものは
// 中身ごと置き換える。ただし置き換えられた古いトーストの close()/update() を後から呼んでも、
// 新しいトーストに影響しないよう、呼び出しごとに世代番号（token）を振って照合する。
const toastState = { token: 0, timer: null };

/**
 * トーストを表示する。type は 'ok' | 'warn' | 'error' | 'info'。
 * opts:
 *   actionLabel, onAction: 指定するとトーストにボタンを出し、押すと onAction() を呼んで閉じる
 *   duration:  自動で消えるまでの ms（既定 2500。action があるときは 6000）
 *   persistent: true なら自動で消さない（処理中の表示などに使う）
 * 戻り値 { close(), update(msg, type) } で、呼び出し側から後追いで操作できる。
 */
function showToast(msg, type, opts) {
  opts = opts || {};
  const toast = document.getElementById('toast');
  const noop = { close() {}, update() {} };
  if (!toast) return noop;

  const resolvedType = type || 'ok';
  const token = ++toastState.token;
  clearTimeout(toastState.timer);
  toastState.timer = null;

  const hasAction = typeof opts.onAction === 'function' && !!opts.actionLabel;

  toast.innerHTML = '';
  toast.className = 'toast ' + resolvedType + (hasAction ? ' has-action' : '') + ' show';

  const msgEl = document.createElement('span');
  msgEl.className = 'toast-msg';
  msgEl.textContent = msg;
  toast.appendChild(msgEl);

  if (hasAction) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = opts.actionLabel;
    btn.addEventListener('click', () => {
      if (toastState.token !== token) return;
      opts.onAction();
      closeToast(token);
    });
    toast.appendChild(btn);
  }

  function closeToast(forToken) {
    if (toastState.token !== forToken) return; // すでに次のトーストに置き換わっている
    clearTimeout(toastState.timer);
    toast.classList.remove('show');
  }

  if (!opts.persistent) {
    const duration = opts.duration != null ? opts.duration : (hasAction ? 6000 : 2500);
    toastState.timer = setTimeout(() => closeToast(token), duration);
  }

  return {
    close() { closeToast(token); },
    update(newMsg, newType) {
      if (toastState.token !== token) return; // すでに次のトーストに置き換わっている
      if (newType) {
        toast.className = 'toast ' + newType + (hasAction ? ' has-action' : '') + ' show';
      }
      if (newMsg != null) msgEl.textContent = newMsg;
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

/** 保存済みファイルが無い、空でないプロジェクトかどうか（自動保存の対象になるか）。 */
function projectHasContent() {
  const steps = state.project.steps || [];
  if (steps.length > 1) return true;
  const s = steps[0];
  return !!(s && s.imageDataUrl);
}

/** 未保存プロジェクトを、復旧用に data/autosave/<id>.opn へ保存する（F6）。 */
async function writeAutosaveRecovery() {
  if (!state.project.id) return;
  try {
    await window.opesna.autosaveSave(state.project.id, buildProjectSaveData());
  } catch (_) {
    // 復旧用の自動保存は失敗しても利用者には知らせない（本来の保存とは別の安全策のため）
  }
}

function startAutoSaveTimer() {
  if (autoSaveTimer) clearInterval(autoSaveTimer);

  const check = () => {
    if (state.screen !== 'editor' || !state.project.modified) return;

    if (state.project.filePath) {
      // filePath 必須: 未保存の新規プロジェクトで保存ダイアログが
      // 勝手に開くのを避ける。silent: タイマー保存でトーストを出さない。
      if (state.settings.autoSave) saveProject({ silent: true });
    } else if (projectHasContent()) {
      // まだどこにも保存していないプロジェクトは、上書き先が無いので通常の保存はできない。
      // 代わりに復旧用の自動保存だけ行う（自動保存がオフでも、復旧のためにこちらは動かす）。
      writeAutosaveRecovery();
    }
  };

  // 自動保存がオフのときも、復旧用の自動保存は既定の間隔（5分）で動かす（F6）。
  const minutes = state.settings.autoSave ? (Number(state.settings.autoSaveMin) || 5) : 5;
  autoSaveTimer = setInterval(check, minutes * 60 * 1000);
}

/**
 * 注釈の色パレット用ドット群の選択状態を同期する（複数のパレットで再利用）。
 */
function syncColorDots(selector, color) {
  document.querySelectorAll(selector + ' .color-dot').forEach(d => {
    const match = d.dataset.color === color;
    d.classList.toggle('active', match);
    d.setAttribute('aria-checked', String(match));
  });
}

/**
 * E8: 色をツールバー・右パネルの共通処理として適用する。
 * 選択中の注釈があればそれに適用（pushUndo・markModified）、無ければ次に描く既定値を変える。
 * バッジは色を別のパレット（#prop-badge-color / ann.badgeColor）で持つのでここでは触らない。
 */
function applyAnnotationColor(color) {
  state.editor.color = color;
  syncColorDots('#color-palette', color);
  syncColorDots('#prop-color-palette', color);

  const ann = state.editor.selectedAnnotation;
  if (ann && ann.type !== 'badge') {
    pushUndo();
    ann.color = color;
    renderCanvas();
    markModified();
  }
}

/**
 * E8: 線の太さをツールバー・右パネルの共通処理として適用する。
 * 選択中の注釈があればそれに適用、無ければ次に描く既定値を変える。
 */
function applyAnnotationStrokeWidth(width) {
  state.editor.strokeWidth = width;
  const toolbarSW = document.getElementById('stroke-width');
  if (toolbarSW) toolbarSW.value = String(width);
  const propSW = document.getElementById('prop-stroke-width');
  if (propSW) propSW.value = String(width);

  const ann = state.editor.selectedAnnotation;
  if (ann) {
    pushUndo();
    ann.strokeWidth = width;
    renderCanvas();
    markModified();
  }
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

  // Color（E8: ツールバー・右パネルの両方を同期する）
  if (ann.type !== 'badge') {
    syncColorDots('#prop-color-palette', ann.color);
    syncColorDots('#color-palette', ann.color);
  }

  // Stroke width（ツールバー・右パネルの両方を同期する）
  if (ann.strokeWidth) {
    const swEl = document.getElementById('prop-stroke-width');
    if (swEl) swEl.value = String(ann.strokeWidth);
    const toolbarSW = document.getElementById('stroke-width');
    if (toolbarSW) toolbarSW.value = String(ann.strokeWidth);
  }

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

/** 記録中の「⏺ 記録」ボタン（ツールバー・ホーム両方）の見た目をそろえる。 */
function updateRecordButtons() {
  const recording = !!state.recording;
  ['btn-record', 'btn-record-home'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('recording', recording);
    btn.disabled = recording;
    // E12: 記録中はツールチップに停止のショートカットを出す
    btn.title = recording ? '記録を停止（Ctrl+Shift+F9）' : '操作を記録してステップを自動生成';
    const titleEl = btn.querySelector('.quick-title');
    if (titleEl) {
      titleEl.textContent = recording ? '記録中…' : '記録';
    } else {
      btn.textContent = recording ? '● 記録中...' : '⏺ 記録';
    }
  });
}

/** 記録を開始する（ツールバー・ホーム・メニューの「記録を開始」の共通処理）。 */
async function beginRecording() {
  if (state.recording) return;
  state.recording = true;
  updateRecordButtons();

  let result = null;
  try {
    result = await window.opesna.startRecording();
  } catch (_) {
    result = false;
  }

  if (result !== true) {
    state.recording = false;
    updateRecordButtons();
    if (result === 'cancelled') {
      // 利用者が確認ダイアログでキャンセルした（S5）。失敗ではないので何も出さない。
    } else if (result === 'no-hook') {
      // U5: 開発者向けの案内（npm install ...）を利用者向けの文言に置き換える
      showToast('記録機能を利用できません。Opesna を最新版に入れ直してください。', 'warn');
    } else {
      showToast('記録を開始できませんでした。', 'warn');
    }
  }
  // Recording stops when user clicks stop on the indicator, or via the stop
  // hotkey / インジケーターを閉じる操作（main.js の stopRecordingFlow がまとめて処理する）。
}

function setupEventListeners() {
  // ── Native menu actions ────────────────────────────────────────────────────
  if (window.opesna.onMenuAction) {
    window.opesna.onMenuAction((action) => {
      switch (action) {
        case 'new':      (async () => { if (await confirmDiscardChanges()) newProject(); })(); break;
        case 'open':     (async () => { if (await confirmDiscardChanges()) openProject(); })(); break;
        // ホーム画面には保存できるプロジェクトが無いので何もしない（F16）
        case 'save':     if (state.screen === 'editor') saveProject(); break;
        case 'save-as':  if (state.screen === 'editor') saveProjectAs(); break;
        case 'export':        openExportModal(); break;
        case 'export-repeat': exportWithSameSettings(); break;
        case 'undo':
          // F7: 入力欄にフォーカスがあるときはプロジェクトの undo ではなく、
          // その入力欄自体の入力履歴を戻す（メニューのアクセラレータは focus を見ずに
          // 常に 'undo' を送ってくるため、ここで判定する）
          if (isTypingInField()) { document.execCommand('undo'); break; }
          undo();
          break;
        case 'redo':
          if (isTypingInField()) { document.execCommand('redo'); break; }
          redo();
          break;
        case 'add-step':
          if (isTypingInField()) break; // 入力中にステップを追加するのは意図しない誤操作になりやすい
          if (state.screen === 'editor') addStep();
          break;
        case 'zoom-in':  setZoom(state.editor.zoom + 0.25); break;
        case 'zoom-out': setZoom(state.editor.zoom - 0.25); break;
        case 'zoom-reset': setZoom(1.0); break;
        case 'start-recording':
          // E12: エディタでは今のプロジェクトへ、ホームでは新規で（onRecordingStart 側が判断する）
          (async () => {
            if (state.screen !== 'editor') {
              if (!(await confirmDiscardChanges())) return;
            }
            beginRecording();
          })();
          break;
        case 'open-update-check':
          openModal('modal-prefs');
          state.currentPrefsTab = 'version';
          document.querySelectorAll('.prefs-cat').forEach(el => {
            const active = el.dataset.pref === 'version';
            el.classList.toggle('active', active);
            el.setAttribute('aria-selected', String(active));
          });
          renderPrefs('version');
          runUpdateCheckFromPrefs();
          break;
      }
    });
  }

  // ── 自動更新: 起動時の確認・ダウンロードの進み具合 ─────────────────────────
  setupUpdateBanner();
  if (window.opesna && window.opesna.onUpdateAvailable) {
    window.opesna.onUpdateAvailable(({ tag }) => showUpdateBanner(tag));
  }
  if (window.opesna && window.opesna.onUpdateProgress) {
    window.opesna.onUpdateProgress((percent) => {
      state.update.progress = percent;
      const fill = document.getElementById('update-progress-fill');
      const text = document.getElementById('update-progress-text');
      if (fill) fill.style.width = `${percent}%`;
      if (text) text.textContent = `${percent}%`;
    });
  }

  // ── Recording: real-time step pipeline ────────────────────────────────────
  if (window.opesna && window.opesna.onRecordingStart) {
    window.opesna.onRecordingStart(() => {
      // Prepare the project to receive incoming real-time steps
      // F21: 「空とみなす」条件を厳しくする。どれか1つでも欠けたら（画像なしのステップが
      // 1つだけの既存プロジェクトでも）置き換えず、末尾へ記録のステップを追加する。
      const onlyStep = state.project.steps.length === 1 ? state.project.steps[0] : null;
      const isEffectivelyEmpty = !!onlyStep &&
        !state.project.filePath &&
        !onlyStep.imageDataUrl &&
        (!onlyStep.annotations || onlyStep.annotations.length === 0) &&
        !onlyStep.description &&
        onlyStep.title === 'ステップ 1';

      if (state.screen !== 'editor' || isEffectivelyEmpty) {
        // New project: snapshot the old state so this whole recording is undoable.
        // Preserve folder selection from the previous project or current home view.
        pushUndo();
        const preservedFolder = state.project.category ||
          (state.homeView && state.homeView.startsWith('folder:') ? state.homeView.slice(7) : null);
        // 置き換える前のプロジェクトが未保存のまま（ファイルなし）だった場合、
        // その復旧ファイルはもう要らない（F6）。
        if (state.project.id && !state.project.filePath) clearAutosaveFor(state.project.id);
        state.project = {
          id:       crypto.randomUUID(),
          filePath: null,
          name:     '記録 ' + getTimestampString(),
          category: preservedFolder,
          modified: false,
          revision: 0,
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
        // E10: 記録のステップは題名だけにする（description は main.js 側も空にしている）。
        // '' は falsy なので || で補うと題名と同じ文で上書きしてしまう。
        description:  step.description != null ? step.description : '',
        imageDataUrl: step.imageDataUrl || null,
        imageWidth:   step.imageWidth   || 1920,
        imageHeight:  step.imageHeight  || 1080,
        annotations:  step.annotations  || [],
      };
      state.project.steps.push(s);
      markModified();
      state.editor.currentStep   = state.project.steps.length - 1;

      // Show editor on first step (window is minimized but DOM updates fine)
      if (state.screen !== 'editor') showScreen('editor');

      // F8: currentStep を変えたら右パネルの入力欄も一緒に更新する。そうしないと、
      // 自動保存や Ctrl+S のときに saveCurrentStepProps が「1つ前のステップの入力欄の内容」を
      // 今のステップへ書き込んでしまう（id が違えば書き込まない保険は saveCurrentStepProps 側にもある）。
      renderStepList();
      loadStepProps();
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
      updateRecordButtons();
      // Steps already added in real-time; just render the current step and notify user
      renderCanvas();
      loadStepProps();
      updateStatusBar();
      if (count > 0) showToast(`${count}ステップを記録しました`, 'ok');
      // 記録直後は特に失いたくない内容なので、通常の自動保存とは別にすぐ1回復旧用の
      // 自動保存をしておく（F6。未保存のまま＝filePath が無いときのみ）。
      if (!state.project.filePath && projectHasContent()) writeAutosaveRecovery();
    });
  }

  // F22: 記録中に要素情報が一度も取れなかったとき、その旨を1回だけ知らせる
  if (window.opesna && window.opesna.onRecordingUiaUnavailable) {
    window.opesna.onRecordingUiaUnavailable(() => {
      showToast('クリックした場所の枠と名前を自動で付けられませんでした（PowerShell を利用できない可能性があります）', 'info');
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
      const result = await window.opesna.importImage();
      if (result === null) return; // キャンセル
      if (!result.ok) {
        showToast(toUserMessage(result, '画像の読み込み'), 'error');
        return;
      }
      const resized = await downscaleImageIfNeeded(result.dataUrl);
      if (resized.resized) showToast('画像が大きいため縮小して取り込みました', 'info');
      newProject({ dataUrl: resized.dataUrl, width: resized.width, height: resized.height });
    } catch (e) {
      showToast(toUserMessage(e, '画像の読み込み'), 'error');
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
  document.getElementById('btn-record')?.addEventListener('click', beginRecording);
  document.getElementById('btn-record-home')?.addEventListener('click', async () => {
    // E12: ホームの「記録」は、未保存の変更があれば既存の確認を通してから始める
    // （新規プロジェクトの用意そのものは onRecordingStart 側が行う）
    if (!(await confirmDiscardChanges())) return;
    beginRecording();
  });

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
        buttons: ['保存して戻る', '保存せず戻る', 'キャンセル'],
      });
      if (res === 2) return; // キャンセル
      if (res === 0) {
        const saved = await saveProject(); // 保存して戻る
        if (!saved) return; // 保存に失敗・ダイアログをキャンセル → ホームに戻らない
      } else if (res === 1) {
        // 保存せず戻る: メモリ上の変更を捨てる（F16）。捨てずに残すと、終了時の
        // 既定ボタン「保存して終了」や、ホーム画面での Ctrl+S で書き込まれてしまう。
        if (state.project.id) clearAutosaveFor(state.project.id);
        state.project = makeEmptyProjectState(null);
        updateTitleBar(); // main 側の「未保存の変更あり」フラグも false に戻す
      }
    }
    showScreen('home');
    await refreshProjectFolders();
    renderHome();
  });

  // ネイティブ×ボタンで「保存して終了」を選んだとき: 保存成功後にウィンドウを閉じる
  if (window.opesna && window.opesna.onSaveAndQuit) {
    window.opesna.onSaveAndQuit(async () => {
      const saved = await saveProject();
      // 保存ダイアログをキャンセルした・保存に失敗した場合は終了を中断する
      if (saved) window.opesna.windowClose?.();
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
  // E8: ツールバーと右パネルの色パレットは同じ applyAnnotationColor() を呼び、
  // 選択中の注釈があればそれに適用し、無ければ既定値だけを変える。両方の見た目も常に同期する。
  document.querySelectorAll('#color-palette .color-dot').forEach(dot => {
    dot.addEventListener('click', () => applyAnnotationColor(dot.dataset.color));
  });

  // ── Stroke width (toolbar) ─────────────────────────────────────────────────
  document.getElementById('stroke-width')?.addEventListener('change', e => {
    applyAnnotationStrokeWidth(parseInt(e.target.value, 10));
  });

  // ── Step list ──────────────────────────────────────────────────────────────
  document.getElementById('btn-add-step')?.addEventListener('click', addStep);

  // ── Project name ───────────────────────────────────────────────────────────
  document.getElementById('prop-name')?.addEventListener('input', e => {
    state.project.name = e.target.value || '無題';
    markModified();
  });

  // ── Category selector（E2: フォルダを変えたら .opn も一緒に移動する） ───────────
  document.getElementById('prop-category')?.addEventListener('change', async e => {
    const val = e.target.value;
    const catEl = document.getElementById('prop-category');
    if (val === '__new__') {
      const name = await showInputDialog({ title: '新しいフォルダを作成', label: 'フォルダ名', okLabel: '作成' });
      if (!name) {
        if (catEl) catEl.value = state.project.category || '';
        return;
      }
      const result = await window.opesna.createProjectFolder(name);
      if (!result || !result.ok) {
        showToast(result && result.code === 'EEXIST' ? '同じ名前のフォルダがあります' : toUserMessage(result, 'フォルダの作成'), 'error');
        if (catEl) catEl.value = state.project.category || '';
        return;
      }
      await refreshProjectFolders();
      await applyCategoryChange(result.name);
      const catEl2 = document.getElementById('prop-category');
      if (catEl2) catEl2.value = result.name;
    } else {
      await applyCategoryChange(val || null);
    }
  });

  // ── Step properties (right panel) ─────────────────────────────────────────
  document.getElementById('step-title-input')?.addEventListener('input', () => {
    const step = getCurrentStep();
    if (!step) return;
    step.title = document.getElementById('step-title-input').value;
    markModified();
    // Debounce step list re-render to avoid flickering
    clearTimeout(renderStepList._debounce);
    renderStepList._debounce = setTimeout(renderStepList, 300);
  });

  document.getElementById('step-desc-input')?.addEventListener('input', () => {
    const step = getCurrentStep();
    if (!step) return;
    step.description = document.getElementById('step-desc-input').value;
    markModified();
    updateExportPreview();
  });

  // ── Right panel: annotation style ─────────────────────────────────────────
  document.getElementById('prop-stroke-width')?.addEventListener('change', e => {
    applyAnnotationStrokeWidth(parseInt(e.target.value, 10));
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
    dot.addEventListener('click', () => applyAnnotationColor(dot.dataset.color));
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
    state.editor.badgeNextNumManual = true; // E9: 次にステップを切り替えるまでこの値を使う
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
      markModified();
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
    markModified();
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
      const ok = await window.opesna.saveShortcuts(state.shortcuts);
      if (!ok) {
        showToast(toUserMessage(null, 'ショートカットの保存'), 'error');
        return;
      }
      closeModal('modal-shortcuts');
      setupKeyboardShortcuts();
      applyShortcutTooltips();
      showToast('ショートカットを保存しました', 'ok');
    } catch (e) {
      showToast(toUserMessage(e, 'ショートカットの保存'), 'error');
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
      const ok = await window.opesna.saveSettings(state.settings);
      if (!ok) {
        showToast(toUserMessage(null, '設定の保存'), 'error');
        return;
      }
      closeModal('modal-prefs');
      startAutoSaveTimer(); // re-apply auto-save interval
      showToast('設定を保存しました', 'ok');
    } catch (e) {
      showToast(toUserMessage(e, '設定の保存'), 'error');
    }
  });

  // ── Modal close buttons & backdrop click ───────────────────────────────────
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // ── Input dialog（F5） ────────────────────────────────────────────────────
  const inputDialogField = document.getElementById('input-dialog-field');
  inputDialogField?.addEventListener('input', e => {
    const okBtn = document.getElementById('input-dialog-ok');
    if (okBtn) okBtn.disabled = !e.target.value.trim();
  });
  inputDialogField?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); resolveInputDialog(); }
  });
  document.getElementById('input-dialog-ok')?.addEventListener('click', resolveInputDialog);

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
  document.getElementById('btn-zoom-fit')?.addEventListener('click', setZoomFit);
  // 倍率表示のクリックで100%表示（手動倍率）にする
  document.getElementById('zoom-val')?.addEventListener('click', () => setZoom(1.0));
  document.getElementById('zoom-val')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setZoom(1.0); }
  });

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

/** 入力欄（input/textarea/select/contenteditable）にフォーカスがあるか（F7）。 */
function isTypingInField() {
  const el = document.activeElement;
  if (!el) return false;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true;
  return !!el.isContentEditable;
}

function handleKeyboardShortcut(e) {
  // Skip when typing in an input
  if (isTypingInField()) return;

  // Skip when a modal is open (except Escape, handled elsewhere)
  if (document.querySelector('.modal-backdrop.open') && e.key !== 'Escape') return;

  ensureShortcuts();
  const sc = state.shortcuts;
  const combo = buildCombo(e);

  // Global shortcuts
  // ホーム画面には保存できるプロジェクトが無いので何もしない（F16）
  if (combo === sc.save)       { e.preventDefault(); if (state.screen === 'editor') saveProject(); return; }
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
    // 破壊的すぎるため何もしない (ステップ削除はステップ一覧の ⋮ ボタン/右クリックから)。
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
