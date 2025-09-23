
=======
### 公開記事として作成
1. ターミナルでリポジトリ直下（`synomare site`）に移動します。
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
5. 編集後は必要に応じて `node scripts/new-post.mjs --rebuild` を実行し、HTML と `posts.js` を最新化します。

### ドラフトとして作成
- 公開前の下書きは `--draft` を付けて生成します。
  ```
  node scripts/new-post.mjs slug "下書きタイトル" --draft
  ```
- Markdown ファイルは `notes/content/drafts/<slug>.md` に保存され、公開一覧には含まれません。
- ドラフトを確認したいときは `node scripts/new-post.mjs --list-drafts` を実行してください。
- 公開準備ができたら `node scripts/new-post.mjs --publish slug` を実行すると、ドラフトが `notes/content/<slug>.md` に移動し、自動で再生成されます。

## 既存記事の編集
- 公開済み記事は `notes/content/<slug>.md` を編集します。
- 編集後に `node scripts/new-post.mjs --rebuild` を実行すると、HTML と一覧データが最新状態になります。

## 再生成のみ行うとき
- Markdown のみ更新した場合や CI で静的ファイルを生成したい場合は、次のコマンドで一括再生成できます。
  ```
  node scripts/new-post.mjs --rebuild
  ```

## 参考
- 投稿テンプレートは `notes/post-template.html` にまとまっています。スタイルや構造を変えたいときはテンプレートを編集してから再生成してください。
- `notes/posts.js` にはタグ配列のほか `year` や `yearMonth` などの派生プロパティが含まれているため、アーカイブやフィルタ機能を実装する際に利用できます。
- ドラフトの Markdown はそのまま Git 管理できるので、レビューや差分確認にも使えます。

## GitHub Pages への自動デプロイ
- `.github/workflows/deploy.yml` が main ブランチへの push（または手動実行）をトリガーにサイトを再生成し、GitHub Pages へ公開します。
- 初回はリポジトリの Settings → Pages でソースを "GitHub Actions" に設定してください。
- ドラフトを公開したら忘れずに `git push` すれば、ワークフローが走って最新の HTML が公開されます。
- Markdown を編集しただけでコミットした場合も自動で `node scripts/new-post.mjs --rebuild` が実行されるため、手元で HTML を生成し忘れても同期されます。

> 自動デプロイの全体像

  - やることは2段階: 1) main ブランチへ push（または手動でワークフロー実行）す
  る。2) GitHub Actions が自動でビルド→Pagesへ公開する。手元で --rebuild を忘れ
  ていても、Actions が Markdown から再生成してくれるので安心です。
  - 準備は3つだけ
      - .github/workflows/deploy.yml を置く（もう配置済み）。
      - リポジトリ設定の Settings → Pages で “Source: GitHub Actions” を選ぶ（初
  回のみ）。
      - main ブランチに push できる状態を用意する（ドラフトなら --publish → git
  add/commit/push）。

  ワークフローの動き（deploy.yml）

  - push（main）と workflow_dispatch がトリガー。
  - Node.js 20 を入れて node scripts/new-post.mjs --rebuild で HTML/JSON を再
  生成。
  - 出来上がった静的ファイル一式を Artifact 化し、actions/deploy-pages@v4 で
  Pages に反映。

  日常運用の流れ

  1. Markdown を編集、必要なら --draft で下書き作成 → --publish で公開。
  2. 作業がまとまったら git add . → git commit → git push origin main。
  3. push 完了後、Actions タブで Deploy site to GitHub Pages が走る。成功すると
  Pages に即反映。

  補足

  - ローカルで確認したい時は node scripts/new-post.mjs --rebuild を手動で実行し
  て HTML を生成し、ブラウザで開くだけ。
  - 手動でデプロイをやり直したい時は Actions 画面から対象ワークフローを開き “Run
  workflow” を押す。
  - 雑に編集して push しても Pages 側は常に最新 Markdown から再生成されるので、
  ビルド漏れの心配がないのが最大のメリットです。
>>>>>>> 75ff897 (Initial commit)
