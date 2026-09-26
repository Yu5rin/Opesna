# Opesna（プロジェクト固有の指示）

## 言語

言語・応答スタイル・作業の進め方は、ユーザーのグローバル方針（`~/.claude/CLAUDE.md`）に従う。
ここには Opesna に固有のことだけを書く。

## 見た目

- 絵文字は使用しない。アイコンと記号はすべて SVG（線幅1.75、16px。viewBox 24、
  stroke-linecap/linejoin round、fill none、色は currentColor）。
- 配色・書体・角丸・影は `app/theme.css` の CSS 変数（`--paper` `--surface` `--ink`
  `--ink-mute` `--rule` `--accent` `--accent-soft` `--accent-ink` `--on-accent`
  `--chrome-bg` `--chrome-fg` `--canvas-bg` `--danger` `--danger-soft` `--ok` `--warn`
  `--shade` `--shadow-pop` / `--font-body` `--font-heading` `--font-mono`）に従う。
  ここにない色・フォントを新たに増やさない。増やす代わりに `color-mix()` で
  上の色から作る。
- 影は `--shadow-pop` だけを、浮いて重なるもの（メニュー・ダイアログ・トースト・
  注釈の小さなバー）にだけ使う。ほかは面と1pxの罫線（`--rule`）で区切る。
- アクセント（塗りの `--accent-ink`）は1画面に1か所まで。選択中・押されている
  状態は塗りつぶしではなく `--accent-soft` の面 + `--accent-ink` の文字で示す。
- ダークモードはライトと同格（後付けの反転ではない）。CSS は `:root` にライトの値、
  `@media (prefers-color-scheme: dark)` にダークの値を置く2段構成のみとし、
  `data-theme` は付けない。テーマの切り替えは `settings.theme` を
  `nativeTheme.themeSource` へ反映することで行う（main.js）。
- 注釈の6色（赤・オレンジ・緑・青・紫・黒）は画像に焼き込まれる「内容の色」なので、
  テーマを切り替えても値を変えない。
- エクスポートした PDF・HTML は印刷物なので、UI のテーマではなくテンプレート
  （`templates/*.json`）の配色で描く。

## リリース

リリースする版が決まったら、次の手順をそのまま提示する。省略しない。
タグの push は開発コンテナからできない（GitHub への push が HTTP 403 で拒否される）ため、
ユーザーの手元で実行してもらう。

1. `package.json` の `version` を上げたコミットが main に入っていること
   （CHANGELOG.txt があれば、その版の節も足す）。
   `.github/workflows/release.yml` の「タグと package.json の版が一致するか確かめる」の
   ステップが、タグ（`v` を除いたもの）と `package.json` の `version` の一致を確かめており、
   ずれているとビルドが失敗する
2. 次のコマンドを1つの PowerShell コードブロックとして提示する（`vX.Y.Z` は実際の版に置き換え、
   Windows PowerShell 5.1 で動く形にする）

   ```powershell
   cd C:\Users\YUGO\Opesna; git fetch origin main; git tag vX.Y.Z origin/main; git push origin vX.Y.Z
   ```

   タグの `v` は必ず半角で打つ（全角の `ｖ` では `.github/workflows/release.yml` の
   `on.push.tags` の条件に合わず、何も起きない）。
3. タグを push すると GitHub Actions（`.github/workflows/release.yml`）が Windows 版の
   `Opesna.exe` を作り、**下書きの**リリースを用意する。SHA256（表示用）とサイズは自動で入る。
   下書きができたら、添付・SHA256・本文を確かめて報告し、**下書きの URL を毎回必ず添える**
   （下書きの間は `…/releases/tag/untagged-…` の仮の URL になる。公開すると `…/releases/tag/vX.Y.Z` に変わる。
   URL は GitHub のリリース一覧の `html_url` で分かる）
4. **リリース本文の案をこちらで用意して添える。** 利用者向けの言葉で書き、内部の用語
   （関数名・IPC のチャンネル名・HTTP の状態コードなど）は出さない。見出しは
   「## 変更点」から始め、最後に「## ダウンロード」の表を置く形で揃える
   （本文に何を書き、何を書かないかは下の「リリース本文とREADMEの分担」に従う）
5. 公開はユーザーが行う。こちらから公開しない

## リリース本文とREADMEの分担

説明は README、リリースは変更点だけ。

- **README に置くもの**: アプリの説明・主な特徴・動作環境・インストール・更新方法・
  使い方の入口・ビルド。版をまたいで変わらない説明はすべてこちら
- **リリース本文に置くもの**: 「## 変更点」と「## ダウンロード」（ファイル・サイズ・SHA256の表）、
  最後に README への案内を1行だけ。これ以外の見出しを作らない
- **リリース本文に書かないもの**: 導入方法・更新方法・主な機能・動作環境・外部通信の説明など、
  README と重複する内容。書きたくなったら README の方を直す
- **その版に上げるときだけ要る注意**（手で入れ替えるときの手順など）は、別の見出しにせず
  「## 変更点」の中の項目として書く
- リリースのタイトルはタグと同じ表記（`v1.2.3`）。本文に「Opesna vX.Y.Z」のような題名は書かない
- 下書きの骨組みは `.github/workflows/release.yml` が作る。形を変えるときはそちらを直す

## 自動更新（app/updater.js）が前提にしていること

自動更新はリリースの形に規則で依存している。リリースの作り方を変えるときは、ここも一緒に確かめる。

- 配布物の添付名は **`Opesna.exe`**（`package.json` の `build.win.artifactName` と
  `app/updateLogic.js` のダウンロード URL の組み立てが、この名前で一致している必要がある）
- タグの表記は **`vX.Y.Z`**（`app/updateLogic.js` の `parseVersion` が読める形）
- Atom フィード（`https://github.com/Yu5rin/Opesna/releases.atom`）に載るのは
  **公開済みのリリースだけ**。下書きのままでは自動更新は気づかない
- SHA256 の照合は、リリース本文の表からではなく、**GitHub API が返す digest**
  （`releases/tags/{tag}` の `assets[].digest`）から取る。本文は人が書き換える
  Markdown なので、自動更新の判断材料にはしない
