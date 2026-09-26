'use strict';
// 記録インジケーター（app/recording-indicator.html）の挙動。
// 以前は index.html 内の <script> に直書きしていたが、CSP を script-src 'self' に
// 締めるため（S3）、外部ファイルへ切り出した。preload.js 経由の window.opesna しか使わない。

const labelEl   = document.getElementById('label');
const countEl   = document.getElementById('count');
const elapsedEl = document.getElementById('elapsed');
const stopBtn   = document.getElementById('stop-btn');
const toastEl      = document.getElementById('step-toast');
const toastThumbEl = document.getElementById('step-toast-thumb');
const toastKEl      = document.getElementById('step-toast-k');
const toastTitleEl  = document.getElementById('step-toast-title');

stopBtn.addEventListener('click', () => {
  stopBtn.disabled = true;
  stopBtn.textContent = '停止中...';
  window.opesna.stopRecording();
});

// 経過時間（mm:ss）。この画面が開いた瞬間が記録の開始とほぼ同時なので、
// 読み込み時刻を基準にする（段階3）。
const startedAt = Date.now();
function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
setInterval(() => {
  elapsedEl.textContent = formatElapsed(Date.now() - startedAt);
}, 1000);

// メインプロセスからのステップ数の更新を受け取る
if (window.opesna && window.opesna.onStepCount) {
  window.opesna.onStepCount((count) => {
    countEl.textContent = count + ' ステップ';
  });
}

// 1枚撮るたびに、撮れた画面の小さなサムネイルと題名を2秒だけ出す（段階3）。
let toastHideTimer = null;
if (window.opesna && window.opesna.onStepThumb) {
  window.opesna.onStepThumb(({ count, thumbDataUrl, title }) => {
    toastThumbEl.src = thumbDataUrl || '';
    toastKEl.textContent = `ステップ ${count} を追加`;
    toastTitleEl.textContent = title || '';
    toastEl.classList.add('show');
    if (toastHideTimer) clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => toastEl.classList.remove('show'), 2000);
  });
}

// 停止処理でクリックの確定待ちを片付けている間、状態を伝える（F9）
if (window.opesna && window.opesna.onRecordingStatus) {
  window.opesna.onRecordingStatus((message) => {
    labelEl.textContent = message;
    stopBtn.disabled = true;
    stopBtn.textContent = '停止中...';
  });
}
