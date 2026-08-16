const API = 'https://api.github.com';
const OWNER = 'synomare';
const REPO = 'synomare.github.io';
const headers = token => ({ Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' });

async function request(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { ...headers(token), ...(options.headers || {}) } });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload.message || `GitHub API ${response.status}`); error.status = response.status; throw error; }
  return payload;
}
function decodeBase64(value) {
  const bytes = Uint8Array.from(atob(value.replace(/\n/g, '')), char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
export async function loadRepository(token) {
  const [repo, ref, files] = await Promise.all([
    request(`/repos/${OWNER}/${REPO}`, token), request(`/repos/${OWNER}/${REPO}/git/ref/heads/main`, token), request(`/repos/${OWNER}/${REPO}/contents/notes/content?ref=main`, token)
  ]);
  if (!repo.permissions?.push) throw new Error('このGitHubアカウントにはpush権限がありません。');
  const markdownFiles = files.filter(file => file.name.endsWith('.md'));
  const contents = await Promise.all(markdownFiles.map(file => request(`/repos/${OWNER}/${REPO}/contents/${file.path}?ref=main`, token)));
  return { baseSha: ref.object.sha, documents: contents.map(file => ({ path: file.path, slug: file.name.replace(/\.md$/, ''), source: decodeBase64(file.content) })) };
}
function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer); let binary = ''; const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) binary += String.fromCharCode(...bytes.subarray(index, index + size));
  return btoa(binary);
}
export async function publishAtomic({ token, baseSha, slug, markdown, images = [], existing }) {
  const currentRef = await request(`/repos/${OWNER}/${REPO}/git/ref/heads/main`, token);
  if (currentRef.object.sha !== baseSha) { const error = new Error('mainが別の更新で進んでいます。再読み込みして変更を確認してください。'); error.code = 'CONFLICT'; throw error; }
  const baseCommit = await request(`/repos/${OWNER}/${REPO}/git/commits/${baseSha}`, token);
  const markdownBlob = await request(`/repos/${OWNER}/${REPO}/git/blobs`, token, { method: 'POST', body: JSON.stringify({ content: markdown, encoding: 'utf-8' }) });
  const imageBlobs = await Promise.all(images.map(async image => ({ path: image.path, sha: (await request(`/repos/${OWNER}/${REPO}/git/blobs`, token, { method: 'POST', body: JSON.stringify({ content: bytesToBase64(await image.file.arrayBuffer()), encoding: 'base64' }) })).sha })));
  const tree = await request(`/repos/${OWNER}/${REPO}/git/trees`, token, { method: 'POST', body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: [{ path: `notes/content/${slug}.md`, mode: '100644', type: 'blob', sha: markdownBlob.sha }, ...imageBlobs.map(image => ({ ...image, mode: '100644', type: 'blob' }))] }) });
  const commit = await request(`/repos/${OWNER}/${REPO}/git/commits`, token, { method: 'POST', body: JSON.stringify({ message: `content: ${existing ? 'update' : 'create'} Note ${slug}`, tree: tree.sha, parents: [baseSha] }) });
  try { await request(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, token, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) }); }
  catch (error) { if (error.status === 422) { error.code = 'CONFLICT'; error.message = '公開直前にmainが更新されました。下書きは残っています。'; } throw error; }
  return commit.sha;
}
