'use strict';
// 待ち役（PowerShell）のスクリプト本体だけを切り出したもの。
//
// なぜ app/updater.js から分けたか: このファイルは electron に触れないため、
// test/updateLogic.test.js から electron をモックせずにそのまま require でき、
// 「.old を消す Remove-Item がループの外にしか無い」ことを文字列として検証できる
// （統合担当のレビューで指摘された、本体を失いうる不具合の再発防止）。
//
// なぜアプリの中で rename しないか（実機のログで判明した経緯）:
//   配布物はポータブル exe（NSIS の自己展開）。起動すると本体を一時フォルダへ展開して
//   起動し、自分（展開役）は本体の終了を待ち続けるが、そのあいだ自分自身の exe ファイルを
//   削除・改名を許さない共有モードで開いたままにしている。そのためアプリが動いている間は
//   Opesna.exe の rename が必ず EBUSY で失敗する（参考にした Pane は .NET の単一ファイル exe で
//   実行中でも改名が許される作りだったため、同じ手順が移植時にそのまま通っていた）。
//   そこで入れ替えはアプリの中でやめ、アプリ本体と展開役の両方が終わったあとに、
//   分離した待ち役（この PowerShell スクリプト）が行う。
//
// 2通りの使われ方がある（どちらも同じスクリプトで、-NoRestart の有無だけが違う）:
//   ・-NoRestart なし: 利用者が「更新する」「今すぐ再起動」を押した。入れ替えたら新しい版を
//     起動する。失敗したら元の版を起動し直して知らせる（従来どおり）。
//   ・-NoRestart あり: 準備済みの更新があるまま、利用者が普通に Opesna を閉じた。実行中は
//     exe を入れ替えられないので、閉じたこの瞬間に入れ替える。利用者は閉じたかったのだから、
//     成功しても失敗しても何も起動しない。閉じてすぐ開き直されて exe が使用中のままなら、
//     何も壊れていないので失敗の印は書かず、.download と準備済みの印を残して次に閉じたときに回す。
//
// パスなどはすべて -File の引数（app/updateLogic.js の buildWaiterArgs）として渡し、
// スクリプト自身には埋め込まない。実行時に fs.mkdtempSync() の中へ書き出して -File で使う
// （固定の -Command 文字列にすると、パスの引用が絡んで壊れやすいため）。
const WAITER_SCRIPT = `
param(
  [int]$MainPid = 0,
  [int]$ParentPid = 0,
  [string]$ExePath,
  [string]$DownloadPath,
  [string]$OldPath,
  [string]$MarkerOkPath,
  [string]$MarkerFailedPath,
  [string]$LogPath,
  [string]$ReadyMarkerPath = '',
  [string]$StartedPath = '',
  [int]$RetryCount = 20,
  [int]$RetryIntervalMs = 500,
  [int]$WaitTimeoutSec = 60,
  [switch]$NoRestart
)

# 動き出したことをアプリへ知らせる印。ログより前に書く（アプリはこのファイルができるのを
# 待ってから終了する。書けなくても入れ替えは続ける）。
if ($StartedPath) {
  try { [System.IO.File]::WriteAllText($StartedPath, '') } catch { }
}

function Write-OpesnaLog([string]$Level, [string]$Message) {
  try {
    $dir = Split-Path -Parent $LogPath
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    # 既存の update.log（Node 側が UTF-8・BOM無しで書いている）に揃えるため、
    # Add-Content ではなく .NET の File.AppendAllText を使う（BOM を足さないため）。
    $line = ('{0} [{1}] {2}' -f (Get-Date).ToString('o'), $Level, $Message) + "\`r\`n"
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::AppendAllText($LogPath, $line, $enc)
  } catch {
    # ログが書けなくても入れ替え自体は続ける
  }
}

Write-OpesnaLog '情報' ('更新の待ち役を起動した(本体PID={0}, 展開役PID={1})' -f $MainPid, $ParentPid)

# 本体（Electron のメインプロセス）と展開役（NSIS の自己展開部分）の両方が終わるまで待つ。
# 一方または両方がすでに終わっていても Wait-Process は例外を投げるので黙って続行する。
$idsToWait = @($MainPid, $ParentPid) | Where-Object { $_ -gt 0 } | Select-Object -Unique
if ($idsToWait.Count -gt 0) {
  Wait-Process -Id $idsToWait -Timeout $WaitTimeoutSec -ErrorAction SilentlyContinue
}

$exeLeaf = Split-Path -Leaf $ExePath
$oldLeaf = Split-Path -Leaf $OldPath

$succeeded = $false
$lastErrorMessage = $null
# 最後の周で失敗した段階（'rename-exe' = exe → .old、'rename-download' = .download → exe、'other'）。
# -NoRestart のとき「exe が使用中で最後まで入れ替えられなかっただけ」を見分けるのに使う。
$failStage = ''

# ─── 前回の残骸の後始末（ループに入る前に1回だけ） ───────────────────────────────
# .old を消してよいのは「exe が無事に存在していて、.old はもう要らない」と分かる
# ここだけ。exe が無く .old だけがある（前回の入れ替えが exe を .old へ動かした直後で
# 終わっている）場合は、.old が「本体そのもの」なので、消さずに exe へ戻す。
#
# なぜループの中で Remove-Item $OldPath をしてはいけないか:
#   ある周で exe を .old へ動かした直後に失敗し、しかも .old を exe へ戻すことにも
#   失敗した場合（ウイルス対策ソフトが一瞬つかんでいる等）、.old は「欠けた本体を直す
#   唯一の材料」になる。もし次の周の最初で「残っている .old だから」と問答無用に
#   消していたら、本体そのもの（唯一のコピー）を失ってしまう。だからループの中では
#   .old を戻すことはあっても、消すことは絶対にしない。
$normalizeFailed = $false
if (Test-Path -LiteralPath $ExePath) {
  if (Test-Path -LiteralPath $OldPath) {
    try {
      Remove-Item -LiteralPath $OldPath -Force -ErrorAction Stop
    } catch {
      # 消せなくても exe 自体は無事なので、入れ替えを諦めて失敗の経路（元の版の再起動）へ
      $lastErrorMessage = $_.Exception.Message
      $normalizeFailed = $true
    }
  }
} elseif (Test-Path -LiteralPath $OldPath) {
  try {
    Rename-Item -LiteralPath $OldPath -NewName $exeLeaf -Force -ErrorAction Stop
  } catch {
    $lastErrorMessage = $_.Exception.Message
    $normalizeFailed = $true
  }
} else {
  # exe も .old も無い（通常は起きない）。これ以上は手が無い
  $lastErrorMessage = 'Opesna.exe も .old も見つからない'
  $normalizeFailed = $true
}

if (-not $normalizeFailed) {
  for ($i = 0; $i -lt $RetryCount; $i++) {
    $failStage = ''
    if (-not (Test-Path -LiteralPath $ExePath) -and (Test-Path -LiteralPath $OldPath)) {
      # 前の周で exe を .old へ動かした直後に失敗し、戻すことにも失敗した状態。
      # .old は消さず、戻すことだけを試みる（入れ替え自体はまだ試さない）。
      $failStage = 'other'
      try {
        Rename-Item -LiteralPath $OldPath -NewName $exeLeaf -Force -ErrorAction Stop
      } catch {
        $lastErrorMessage = $_.Exception.Message
      }
      if ($i -lt ($RetryCount - 1)) { Start-Sleep -Milliseconds $RetryIntervalMs }
      continue
    }
    if (-not (Test-Path -LiteralPath $ExePath)) {
      # exe も .old も無い。待って様子を見る以外に手が無い
      $failStage = 'other'
      $lastErrorMessage = 'Opesna.exe も .old も見つからない'
      if ($i -lt ($RetryCount - 1)) { Start-Sleep -Milliseconds $RetryIntervalMs }
      continue
    }

    # ここに来る時点で exe があり .old は無い（保証済み）。入れ替えを試す。
    try {
      Rename-Item -LiteralPath $ExePath -NewName $oldLeaf -Force -ErrorAction Stop
      try {
        Rename-Item -LiteralPath $DownloadPath -NewName $exeLeaf -Force -ErrorAction Stop
        $succeeded = $true
        break
      } catch {
        $failStage = 'rename-download'
        $lastErrorMessage = $_.Exception.Message
        # .download → exe が失敗した。すぐに .old → exe を戻すことを試みる（消さない）。
        # ここでも戻せなければ、.old は残したまま次の周の先頭（上の分岐）に任せる。
        try { Rename-Item -LiteralPath $OldPath -NewName $exeLeaf -Force -ErrorAction Stop } catch { }
      }
    } catch {
      $failStage = 'rename-exe'
      $lastErrorMessage = $_.Exception.Message
    }
    if ($i -lt ($RetryCount - 1)) { Start-Sleep -Milliseconds $RetryIntervalMs }
  }
}

# -NoRestart で、exe が使用中のまま最後まで入れ替えられなかっただけ（何も動かしていない:
# exe はそのまま・.old は無い・.download は残っている）かどうか。
$busyOnly = $false
if ($NoRestart -and -not $succeeded -and -not $normalizeFailed -and $failStage -eq 'rename-exe') {
  if ((Test-Path -LiteralPath $ExePath) -and -not (Test-Path -LiteralPath $OldPath) -and (Test-Path -LiteralPath $DownloadPath)) {
    $busyOnly = $true
  }
}

if ($succeeded) {
  try { [System.IO.File]::WriteAllText($MarkerOkPath, '') } catch { }
  # 準備済みの印は役目を終えた（.download は exe になったので、もう無い）
  if ($ReadyMarkerPath) { try { Remove-Item -LiteralPath $ReadyMarkerPath -Force -ErrorAction SilentlyContinue } catch { } }
  Write-OpesnaLog '情報' '更新の適用: 入れ替えが完了した'
  if (-not $NoRestart) {
    try { Start-Process -FilePath $ExePath } catch {
      Write-OpesnaLog 'エラー' ('更新: 新しい版の起動に失敗した: {0}' -f $_.Exception.Message)
    }
  } else {
    Write-OpesnaLog '情報' '更新の適用: 閉じたときの入れ替えが完了した（新しい版は次に Opesna を開いたときから）'
  }
} elseif ($busyOnly) {
  # 閉じてすぐ開き直された等で、Opesna.exe がまだ使用中。何も壊れていないので失敗の印は
  # 書かず、.download と準備済みの印を残して、次に閉じたときに入れ替える。
  Write-OpesnaLog '警告' '更新の適用: 使用中のため次に閉じたときに入れ替える'
} else {
  $reason = if ($lastErrorMessage) { $lastErrorMessage } else { '不明なエラー' }
  # 保険: ここまでの再試行で元へ戻せていなければ、最後にもう一度だけ確かめる
  # （利用者が気づかないまま Opesna が消えた状態にしないため）。
  if (-not (Test-Path -LiteralPath $ExePath) -and (Test-Path -LiteralPath $OldPath)) {
    try {
      Rename-Item -LiteralPath $OldPath -NewName $exeLeaf -Force -ErrorAction Stop
      Write-OpesnaLog '警告' '更新の適用に失敗したため、元の版へ戻した'
    } catch {
      Write-OpesnaLog 'エラー' ('更新の適用に失敗し、元の版へ戻すこともできなかった: {0}' -f $_.Exception.Message)
    }
  }
  try {
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($MarkerFailedPath, ('入れ替えに失敗しました: {0}' -f $reason), $enc)
  } catch { }
  Write-OpesnaLog 'エラー' ('更新の適用に失敗した: {0}' -f $reason)
  if (-not $NoRestart) {
    try { Start-Process -FilePath $ExePath } catch {
      Write-OpesnaLog 'エラー' ('更新: 元の版の再起動に失敗した: {0}' -f $_.Exception.Message)
    }
  }
}
`;

module.exports = { WAITER_SCRIPT };
