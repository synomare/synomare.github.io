import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../infra/decap-oauth/worker.mjs';

const env = {
  GITHUB_OAUTH_ID: 'client-id',
  GITHUB_OAUTH_SECRET: 'client-secret',
  ALLOWED_ORIGIN: 'https://synomare.github.io'
};

test('OAuth開始時にstate cookieと限定scopeを設定する', async () => {
  const response = await worker.fetch(
    new Request('https://oauth.example/auth?provider=github'),
    env
  );
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /scope=public_repo/);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  const location = new URL(response.headers.get('location'));
  assert.ok(location.searchParams.get('state').length >= 64);
});

test('OAuth callbackで不一致stateを拒否する', async () => {
  const response = await worker.fetch(
    new Request('https://oauth.example/callback?provider=github&code=abc&state=wrong', {
      headers: { Cookie: 'decap_oauth_state=expected' }
    }),
    env
  );
  assert.equal(response.status, 403);
  assert.equal(await response.text(), 'Invalid OAuth state');
});

test('OAuth tokenを許可したoriginだけへ返す', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({ access_token: 'test-token' });

  const response = await worker.fetch(
    new Request('https://oauth.example/callback?provider=github&code=abc&state=expected', {
      headers: { Cookie: 'decap_oauth_state=expected' }
    }),
    env
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /https:\/\/synomare\.github\.io/);
  assert.doesNotMatch(html, /postMessage\([^)]*,\s*['"]\*['"]\)/);
  assert.match(html, /test-token/);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
