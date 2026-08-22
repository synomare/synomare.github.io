# Trace Stream

`/admin/notes/?view=stream` は、記事を書く前の断片をタイトルなしで蓄積するローカルファーストの入力面です。

## 保存層

- **LOCAL ONLY**: ブラウザの IndexedDB にだけ保存します。公開リポジトリへは送信しません。
- **PUBLIC REPO**: まず IndexedDB へ保存し、`SYNC PUBLIC` を押したときだけ `notes/traces/<trace-id>.md` として `main` へ同期します。
- GitHub OAuth token は既存 Notes Editor と同じくメモリにだけ保持し、IndexedDB・localStorage・リポジトリへ保存しません。
- LOCAL ONLY のバックアップは `EXPORT JSON`、復元は `IMPORT JSON` を使用します。

公開済み Trace を LOCAL ONLY に戻すと、次回同期時に現在の Markdown ファイルを削除します。ただし Git の履歴から完全に消えるわけではありません。秘密情報は一度も PUBLIC REPO にしないでください。

## Trace の構造

各 Trace は本文のほか、作成・更新時刻、Motif、NOTE / QUESTION、関係、改稿履歴を持ちます。入力時の必須項目は本文だけです。

関係は以下の5種類です。

- `continues`: 続き・展開
- `contrasts`: 反論・差異
- `exemplifies`: 具体例
- `answers`: 過去の問いへの応答
- `cites`: 出典・引用

## Plate

- `STREAM`: 作成時刻順の全 Trace
- `RETURNED`: 7日以上を隔てた改稿・接続がある Trace
- `QUESTIONS`: QUESTION として記録した Trace
- `TENSIONS`: `contrasts` の両端にある Trace

Echo は LLM や embedding を使わず、共通語と共通 Motif を根拠付きで提示します。

## 同期競合

同期時には `main` の SHA と remote Trace を先に読みます。ローカルと remote の両方が前回同期後に変化している場合、Trace は `CONFLICT` になり、自動上書きしません。`KEEP LOCAL / REPUBLISH` または `USE REMOTE` を選んでから再同期します。
