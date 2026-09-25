'use strict';
// 記録インジケーター（app/recording-indicator.html）の挙動。
// 以前は index.html 内の <script> に直書きしていたが、CSP を script-src 'self' に
// 締めるため（S3）、外部ファイルへ切り出した。preload.js 経由の window.opesna しか使わない。

const labelEl = document.getElementById('label');
const countEl = document.getElementById('count');
const stopBtn = document.getElementById('stop-btn');

stopBtn.addEventListener('click', () => {
  stopBtn.disabled = true;
  stopBtn.textContent = '停止中...';
  window.opesna.stopRecording();
});

// Listen for step count updates from main process
if (window.opesna && window.opesna.onStepCount) {
  window.opesna.onStepCount((count) => {
    countEl.textContent = count + ' ステップ';
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
