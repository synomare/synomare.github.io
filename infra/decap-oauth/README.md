# Decap CMS OAuth Worker

`https://synomare.github.io/admin/` と GitHub OAuth の間だけを中継する Cloudflare Worker です。

## 初回設定

1. `infra/decap-oauth/` で `npx wrangler@4.123.0 login` を実行します。
2. `npx wrangler@4.123.0 deploy` を実行し、発行された Worker URL を控えます。
3. GitHub Developer Settings で OAuth App を作成します。
   - Homepage URL: Worker URL
   - Authorization callback URL: `<Worker URL>/callback`
4. 次のコマンドで OAuth App の値を Cloudflare Secrets に登録します。値はファイルやコマンドライン引数へ書きません。

   ```text
   npx wrangler@4.123.0 secret put GITHUB_OAUTH_ID
   npx wrangler@4.123.0 secret put GITHUB_OAUTH_SECRET
   ```

5. `admin/config.yml` の `base_url` を Worker URL に置き換えます。

## セキュリティ

- OAuth state は有効期限10分の `HttpOnly` cookie と照合します。
- OAuth token は `https://synomare.github.io` の管理画面にだけ送信します。
- OAuth ID と secret は Cloudflare Secrets にのみ保存します。
- リポジトリは公開のため、OAuth scope は `public_repo` のみに限定します。
