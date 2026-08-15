# Notes（ブログ）の運用メモ

`notes/` 以下は Markdown 原稿から記事 HTML と一覧データを生成する簡易な仕組みです。
生成は `scripts/new-post.mjs` が担当し、依存は `gray-matter` と `marked` のみです。

## 管理画面から更新する（通常はこちら）

1. `https://synomare.github.io/admin/` を直接開きます。公開サイト上には管理画面へのリンクを置いていません。
2. **Login with GitHub** を選び、`synomare/synomare.github.io` へ push できる GitHub アカウントでログインします。
3. **Notes → New Note** から slug、タイトル、公開日、概要、タグ、本文を入力します。
   - slug は英小文字・数字・ハイフンだけを使用します。公開URLになるため、公開後は変更しません。
   - 本文内の画像ボタンからアップロードした画像は `assets/images/notes/` に保存されます。
   - 編集画面の Preview で本文の見え方を確認できます。
4. **Publish** を押すと Markdown と画像が `main` へ保存され、GitHub Actions が記事HTMLと一覧を自動生成します。
5. 数分後に `https://synomare.github.io/notes/` と記事URLを確認します。

記事を削除するときは、管理画面で対象記事を開き、上部（画面幅によってはメニュー内）の **Delete** を選んで確認します。確認すると削除コミットが作成され、Markdownと生成済み記事HTMLが取り除かれて数分後に一覧からも消えます。下書き承認と予約公開は無効です。

## Worksを管理画面から更新する

1. 管理画面の **Works → New Work** を開きます。
2. slug、作品名、制作年、説明、種別を入力します。
3. 必要に応じてリンク先、一覧画像、表示優先度を設定します。
4. **Publish** を押すと `works.html` が自動生成され、数分後に公開されます。
5. 削除するときは対象作品を開き、上部の **Delete** を選びます。

既存作品「嶼群（博物館（たち））」もWorksコレクションへ移行済みです。一覧画像を設定した作品だけ画像付きの行になり、未設定の場合は従来どおりテキスト行で表示されます。

### 公開に失敗した場合

- GitHub Actions の `Build and deploy GitHub Pages` が失敗した場合、公開中のサイトは直前の成功版のまま維持されます。
- 原稿の修正は管理画面から行い、再度 Publish します。
- 誤った更新を戻す必要がある場合は、GitHub のコミット履歴から該当ファイルを復元します。OAuth ID、secret、アクセストークンはリポジトリへ保存しません。

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
- 通常は管理画面から編集します。ローカル作業が必要な場合は `notes/content/<slug>.md` を編集します。
- 編集後に `node scripts/new-post.mjs --rebuild` を実行すると、HTML と一覧データが最新状態になります。

## 再生成のみ行うとき
- Markdown のみ更新した場合は、次のコマンドで一括再生成できます。
  ```
  node scripts/new-post.mjs --rebuild
  ```

## 検証

```text
npm test
npm run check:notes
```

- `npm test` は一時フォルダ内のfixtureでHTML生成、記事順、画像、YouTube/X埋め込み、不正slug、必須項目、壊れたfrontmatterを検証します。
- `npm run check:notes` は公開原稿を変更せず、現在の `notes/content/` 全体を検証します。

## Markdown の埋め込み記法
- 段落中に YouTube のリンク（`youtube.com/watch?v=...` または `youtu.be/...`）だけを置くと、`--rebuild` 時に自動でプレイヤーの iframe に変換されます。
- 同様に X / Twitter のステータス URL だけの段落は埋め込みブロックに変換されます。
- 記事内の最初の画像はサムネイル（`image`）として `posts.json` / `posts.js` に記録されます。

## 参考
- 投稿テンプレートは `notes/post-template.html` にまとまっています。スタイルや構造を変えたいときはテンプレートを編集してから再生成してください。
- `notes/posts.js` にはタグ配列のほか `year` や `yearMonth` などの派生プロパティが含まれているため、アーカイブやフィルタ機能を実装する際に利用できます。
