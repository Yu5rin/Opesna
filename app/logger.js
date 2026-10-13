'use strict';
// 更新まわりの記録を data/logs/update.log へ残す処理（main 側専用）。
//
// なぜ要るか: Pane では「更新が失敗した」としか残らず、繋がらなかったのか途中で
// 切れたのかが分からず、会社のPCで一度も更新できない原因（問い合わせ回数の上限）を
// 突き止めるのに手戻りが起きた（/home/user/yu5rin/pane/docs/調査記録/
// 修正-更新の失敗を追えるようにする.md、修正-会社で更新できなかった原因.md）。
// 同じ轍を踏まないよう、最初から「例外の連鎖（cause）・コード・状態コードまで書く」
// 「どこへ繋ぎに行ったかを残す」形にしておく。
//
// ホームフォルダのパスは "~" に置き換える（利用者のフォルダ名がそのままログへ残らないように）。
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_BYTES = 512 * 1024; // これを超えたら .1 へ回して新しく書く

// fileName は既定で 'update.log'（自動更新用）。error.log（予期しない例外用、S6）も
// 同じ作り（512KB で回す・ホームフォルダを "~" に置き換える）で残したいだけなので、
// ここに2つ目のログ種別を増やすのではなく、置き場所だけ差し替えられるようにした。
//
// 置き場所: 第1引数は data フォルダ（設定・ログ・プロジェクトをまとめた場所）で、ログは
// その下の logs/ に書く。PC の引っ越しで data をコピーするだけで済むようにするため。
// 文字列のほか、data フォルダを返す関数も受け取る。書き込めない場所から userData へ
// 切り替わる（起動時）前にログを作っても、書くたびにその時点の場所を使えるようにするため。
function createLogger(dataDir, fileName = 'update.log') {
  const currentDir = () => path.join(typeof dataDir === 'function' ? dataDir() : dataDir, 'logs');
  const home = os.homedir();

  function redactHome(text) {
    if (!home) return text;
    return text.split(home).join('~');
  }

  function rotateIfNeeded(file) {
    try {
      const stat = fs.statSync(file);
      if (stat.size < MAX_BYTES) return;
      const old = file + '.1';
      try { fs.unlinkSync(old); } catch (_) { /* 無ければそのまま */ }
      fs.renameSync(file, old);
    } catch (_) {
      // ファイルが無い（初回）ときは何もしない
    }
  }

  function write(level, message) {
    try {
      const dir = currentDir();
      const file = path.join(dir, fileName);
      fs.mkdirSync(dir, { recursive: true });
      rotateIfNeeded(file);
      const line = `${new Date().toISOString()} [${level}] ${redactHome(String(message))}\n`;
      fs.appendFileSync(file, line, 'utf8');
    } catch (_) {
      // ログが書けなくても更新処理自体は止めない
    }
  }

  /**
   * 例外の連鎖（err.cause）を、型名・メッセージ・コード・状態コードまで展開して1行にする。
   * ネットワークの失敗は本当の理由が cause 側に入ることが多いため（Pane と同じ知見）。
   */
  function describeError(err) {
    const parts = [];
    let current = err;
    let depth = 0;
    while (current && depth < 10) {
      const name = current.name || (current.constructor && current.constructor.name) || 'Error';
      const message = current.message || String(current);
      const code = current.code ? ` code=${current.code}` : '';
      const status = current.status || current.statusCode;
      const statusText = status ? ` status=${status}` : '';
      parts.push(`${name}: ${message}${code}${statusText}`);
      current = current.cause;
      depth += 1;
    }
    return parts.join(' ← ') || String(err);
  }

  return {
    info(message) { write('情報', message); },
    warn(message) { write('警告', message); },
    error(message) { write('エラー', message); },
    /** 例外つきの失敗を、連鎖・コード・状態コードまで含めて記録する。 */
    exception(message, err) { write('エラー', `${message}: ${describeError(err)}`); },
    describeError,
    // 待ち役（別プロセス）へ渡すログの場所。参照した時点の場所を返す
    get filePath() { return path.join(currentDir(), fileName); },
  };
}

module.exports = { createLogger };
