'use strict';
// 記録中のクリックを「シングルクリック / ダブルクリック」に判定する処理と、
// クリックを確定させる処理を「クリックした順に1件ずつ」実行するためのキューを扱う。
// main.js（require）から読む。
//
// なぜ切り出したか: 以前は commitClick が isCapturing 中のクリックを setTimeout(100) で
// 個別に再試行しており、複数のクリックの確定処理が並行に走って順序が入れ替わることがあった
// （スクリーンショット・UIA照会・画像の切り抜きはどれも非同期で、掛かる時間が毎回違うため）。
// また停止時は判定待ち（ダブルクリックかどうかのタイマー待ち）のクリックのタイマーを止めるだけで、
// そのクリック自体を捨てていた。
//
// 外の世界（Electron・DOM・ファイル・実際の時刻）に触れない判断ロジックだけをここに置き、
// test/recordingLogic.test.js から直接読んで確かめる。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.OpesnaRecordingLogic = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {

  /**
   * 直前の確定待ちクリック（pending）と、新しく来たクリック（next）が
   * 1組のダブルクリックとみなせるかを判定する。
   * pending / next は { clickType: 'left'|'right', x, y, time } の形。
   */
  function isDoubleClick(pending, next, opts) {
    const { doubleClickMs = 350, doubleClickPx = 20 } = opts || {};
    if (!pending || !next) return false;
    if (pending.clickType !== 'left' || next.clickType !== 'left') return false;
    if (next.time - pending.time < 0) return false;
    if (next.time - pending.time >= doubleClickMs) return false;
    if (Math.abs(next.x - pending.x) >= doubleClickPx) return false;
    if (Math.abs(next.y - pending.y) >= doubleClickPx) return false;
    return true;
  }

  /**
   * クリックの確定処理（非同期関数）を、積んだ順に1件ずつ実行するキュー。
   * ある1件が失敗しても後続は止めず、次の1件を続けて実行する。
   */
  function createClickQueue() {
    let tail = Promise.resolve();
    let pendingCount = 0;

    /** fn（Promiseを返す関数）を末尾に積み、それまでに積んだものがすべて終わってから実行する。 */
    function enqueue(fn) {
      pendingCount++;
      const settled = tail.then(() => fn()).catch(() => {});
      const result = settled.then(() => { pendingCount--; });
      tail = result;
      return settled;
    }

    /** まだ実行が終わっていない件数（実行中を含む）。 */
    function size() {
      return pendingCount;
    }

    /**
     * それまでに積んだものが全部終わるのを待つ。timeoutMs を過ぎたら諦めて false を返す
     * （キューを止めはしない。呼び出し側は「待ちきれなかった」ことだけを知る）。
     */
    function drain(timeoutMs) {
      return Promise.race([
        tail.then(() => true),
        new Promise(resolve => setTimeout(() => resolve(false), timeoutMs)),
      ]);
    }

    return { enqueue, size, drain };
  }

  return { isDoubleClick, createClickQueue };
});
