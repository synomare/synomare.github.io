# Notes（ブログ）の運用メモ

`notes/` 以下は Markdown 原稿から記事 HTML と一覧データを生成する簡易な仕組みです。
生成は `scripts/new-post.mjs` が担当し、依存は `gray-matter` と `marked` のみです。

## 記事を新規作成する
1. ターミナルでリポジトリ直下に移動します。
2. 次のコマンドで記事を生成します。
   ```
   node scripts/new-post.mjs slug "タイトル" --date=YYYY-MM-DD --summary="概要文" --tags=タグ1,タグ2
   ```
   - `slug` は英小文字・数字・ハイフンのみ。URL は `notes/<slug>.html` になります。
   - `--date` を省略すると当日の日付が入ります。
   - `--summary` は一覧やメタ情報に使われる 1〜2 文です。
   - `--tags` はカンマ区切り、または複数回の `--tag` 指定で追加できます。
3. スクリプトが自動で以下を生成・更新します。
   - `notes/content/<slug>.md`: フロントマター付き Markdown 原稿
   - `notes/posts.json`: 投稿メタデータ（ソート済み）
   - `notes/posts.js`: フロント側で読み込む派生データ
   - `notes/<slug>.html`: テンプレートを元にした記事 HTML
4. 生成された Markdown を編集し、本文やメタ情報を整えます。
5. 編集後は `node scripts/new-post.mjs --rebuild` を実行し、HTML と `posts.js` を最新化します。

## 既存記事の編集
- 公開済み記事は `notes/content/<slug>.md` を編集します。
- 編集後に `node scripts/new-post.mjs --rebuild` を実行すると、HTML と一覧データが最新状態になります。

## 再生成のみ行うとき
- Markdown のみ更新した場合は、次のコマンドで一括再生成できます。
  ```
  node scripts/new-post.mjs --rebuild
  ```

## Markdown の埋め込み記法
- 段落中に YouTube のリンク（`youtube.com/watch?v=...` または `youtu.be/...`）だけを置くと、`--rebuild` 時に自動でプレイヤーの iframe に変換されます。
- 同様に X / Twitter のステータス URL だけの段落は埋め込みブロックに変換されます。
- 記事内の最初の画像はサムネイル（`image`）として `posts.json` / `posts.js` に記録されます。

## 参考
- 投稿テンプレートは `notes/post-template.html` にまとまっています。スタイルや構造を変えたいときはテンプレートを編集してから再生成してください。
- `notes/posts.js` にはタグ配列のほか `year` や `yearMonth` などの派生プロパティが含まれているため、アーカイブやフィルタ機能を実装する際に利用できます。
