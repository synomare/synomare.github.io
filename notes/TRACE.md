# Trace / Field / Fold

`/admin/notes/?view=stream` は、記事を書く前の断片をタイトルなしで蓄積し、複数の射影で俯瞰し、線形テクストへFoldするローカルファーストの作業面です。

上部の `STREAM / FIELD / FOLDS` で三つのSurfaceを切り替えます。

## 保存層

- **LOCAL ONLY**: ブラウザの IndexedDB にだけ保存します。公開リポジトリへは送信しません。
- **PUBLIC REPO**: まず IndexedDB へ保存し、`SYNC PUBLIC` を押したときだけ `notes/traces/<trace-id>.md` として `main` へ同期します。
- **FOLD**: 現在はすべてIndexedDBへローカル保存します。Trace本文を複製せず、Trace IDを参照します。
- GitHub OAuth token は既存 Notes Editor と同じくメモリにだけ保持し、IndexedDB・localStorage・リポジトリへ保存しません。
- TraceはSTREAMの `EXPORT TRACES / IMPORT TRACES`、FoldはFOLDSの `EXPORT FOLDS / IMPORT FOLDS` で個別にバックアップします。

公開済み Trace を LOCAL ONLY に戻すと、次回同期時に現在の Markdown ファイルを削除します。ただし Git の履歴から完全に消えるわけではありません。秘密情報は一度も PUBLIC REPO にしないでください。

## Trace

各 Trace は本文のほか、作成・更新時刻、Motif、NOTE / QUESTION、関係、改稿履歴を持ちます。入力時の必須項目は本文だけです。

関係は以下の5種類です。

- `continues`: 続き・展開
- `contrasts`: 反論・差異
- `exemplifies`: 具体例
- `answers`: 過去の問いへの応答
- `cites`: 出典・引用

Traceカードの `SELECT` で複数の断片を選び、Fold Studioへ送れます。

## Plate

- `STREAM`: 作成時刻順の全 Trace
- `RETURNED`: 7日以上を隔てた改稿・接続がある Trace
- `QUESTIONS`: QUESTION として記録した Trace
- `TENSIONS`: `contrasts` の両端にある Trace
- `UNUSED`: まだどのFoldにも使われていないTrace

Echo は LLM や embedding を使わず、共通語と共通 Motif を根拠付きで提示します。

## Field

Fieldはforce-directed graphではありません。以下の決定的な射影を表示します。

- `MOTIF × TIME`: Motifを行、月を列にした密度行列。同じTraceは複数のMotif行へ反復して現れます。
- `OVERPRINT`: 二つのMotifの交差にあるTraceを抽出します。
- `RELATION PLATE`: 実際に作成した5種類のRelation数を集計します。

Fieldのセルや交差Traceを押すと、そのTrace群を選択できます。

## Fold

FoldはTraceを線形テクストへ圧縮する作業面です。

- 選択したTraceをFoldへ追加する
- Trace blockを上下へ並べ替える
- Trace間にBridge Textを書く
- `LIVE`では元Traceの最新版を参照する
- `PINNED`ではその時点の本文・更新時刻・revision数を固定する
- Markdown化すると、文末に表示されない `trace-source` 参照定義を付け、由来を保持する

`SEND TO LOCAL NOTES DRAFT` は、Foldを既存Notes Editorの `note:new` ローカル下書きへ渡します。移動後に `＋ NEW NOTE` を開くと復元されます。PUBLIC REPOへは自動送信しません。

## 同期競合

同期時には `main` の SHA と remote Trace を先に読みます。ローカルと remote の両方が前回同期後に変化している場合、Trace は `CONFLICT` になり、自動上書きしません。`KEEP LOCAL / REPUBLISH` または `USE REMOTE` を選んでから再同期します。
