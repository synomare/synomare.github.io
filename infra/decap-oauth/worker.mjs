const STATE_COOKIE = 'decap_oauth_state';
const STATE_TTL_SECONDS = 600;

function securityHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...extra
  };
}

function randomState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const item of header.split(';')) {
    const [key, ...value] = item.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

function callbackUrl(url) {
  return `${url.origin}/callback`;
}

function errorResponse(message, status) {
  return new Response(message, {
    status,
    headers: securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' })
  });
}

async function handleAuth(request, env, url) {
  if (url.searchParams.get('provider') !== 'github') {
    return errorResponse('Invalid provider', 400);
  }
  if (!env.GITHUB_OAUTH_ID || !env.GITHUB_OAUTH_SECRET) {
    return errorResponse('OAuth is not configured', 503);
  }

  const state = randomState();
  const params = new URLSearchParams({
    client_id: env.GITHUB_OAUTH_ID,
    redirect_uri: callbackUrl(url),
    scope: 'public_repo',
    state
  });

  return new Response(null, {
    status: 302,
    headers: securityHeaders({
      Location: `https://github.com/login/oauth/authorize?${params}`,
      'Set-Cookie': `${STATE_COOKIE}=${state}; Path=/; Max-Age=${STATE_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`
    })
  });
}

async function exchangeCode(env, url, code) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'synomare-notes-oauth'
    },
    body: JSON.stringify({
      client_id: env.GITHUB_OAUTH_ID,
      client_secret: env.GITHUB_OAUTH_SECRET,
      code,
      redirect_uri: callbackUrl(url)
    })
  });
  const payload = await response.json();
  if (!response.ok || typeof payload.access_token !== 'string') {
    throw new Error('GitHub token exchange failed');
  }
  return payload.access_token;
}

function callbackPage(token, allowedOrigin) {
  const authorizationMessage = JSON.stringify(
    `authorization:github:success:${JSON.stringify({ token })}`
  );
  const origin = JSON.stringify(allowedOrigin);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Authorizing Notes Admin</title></head>
<body>
  <p>Authorizing Notes Admin…</p>
  <script>
    const allowedOrigin = ${origin};
    const receiveMessage = (event) => {
      if (event.origin !== allowedOrigin || event.source !== window.opener) return;
      window.opener.postMessage(${authorizationMessage}, allowedOrigin);
      window.removeEventListener('message', receiveMessage);
    };
    window.addEventListener('message', receiveMessage);
    window.opener.postMessage('authorizing:github', allowedOrigin);
  </script>
</body>
</html>`;
}

async function handleCallback(request, env, url) {
  const provider = url.searchParams.get('provider');
  if (provider && provider !== 'github') {
    return errorResponse('Invalid provider', 400);
  }
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = readCookie(request, STATE_COOKIE);
  if (!code) return errorResponse('Missing code', 400);
  if (!state || !expectedState || state !== expectedState) {
    return errorResponse('Invalid OAuth state', 403);
  }

  try {
    const token = await exchangeCode(env, url, code);
    return new Response(callbackPage(token, env.ALLOWED_ORIGIN), {
      headers: securityHeaders({
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': `${STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
      })
    });
  } catch {
    return errorResponse('GitHub authorization failed', 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return errorResponse('Method not allowed', 405);
    if (url.pathname === '/auth') return handleAuth(request, env, url);
    if (url.pathname === '/callback') return handleCallback(request, env, url);
    if (url.pathname === '/') {
      return new Response('synomare Notes OAuth proxy is running.', {
        headers: securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' })
      });
    }
    return errorResponse('Not found', 404);
  }
};
