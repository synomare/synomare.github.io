import { parseTraceMarkdown, serializeTraceMarkdown } from './traces.js';

const API = 'https://api.github.com';
const OWNER = 'synomare';
const REPO = 'synomare.github.io';
export const TRACE_DIRECTORY = 'notes/traces';

const headers = token => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28'
});

async function request(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...headers(token), ...(options.headers || {}) }
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || `GitHub API ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function decodeBase64(value) {
  const bytes = Uint8Array.from(atob(String(value || '').replace(/\n/g, '')), char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function loadTraceRepository(token) {
  const [repo, ref] = await Promise.all([
    request(`/repos/${OWNER}/${REPO}`, token),
    request(`/repos/${OWNER}/${REPO}/git/ref/heads/main`, token)
  ]);
  if (!repo.permissions?.push) throw new Error('このGitHubアカウントにはpush権限がありません。');

  let files = [];
  try {
    const listing = await request(`/repos/${OWNER}/${REPO}/contents/${TRACE_DIRECTORY}?ref=main`, token);
    files = Array.isArray(listing) ? listing.filter(file => file.type === 'file' && file.name.startsWith('tr_') && file.name.endsWith('.md')) : [];
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  const contents = await Promise.all(files.map(file => request(`/repos/${OWNER}/${REPO}/contents/${file.path}?ref=main`, token)));
  const traces = contents.map(file => {
    const id = file.name.replace(/\.md$/, '');
    return parseTraceMarkdown(decodeBase64(file.content), id);
  });
  return { baseSha: ref.object.sha, traces };
}

export async function publishTraceBatch({ token, baseSha, traces = [], deletions = [] }) {
  const entries = traces.filter(trace => trace.visibility === 'public' && !trace.deleted && !trace.pendingDelete);
  const deleteIds = [...new Set(deletions.map(value => typeof value === 'string' ? value : value.id).filter(Boolean))];
  if (!entries.length && !deleteIds.length) return { sha: baseSha, changed: false };

  const currentRef = await request(`/repos/${OWNER}/${REPO}/git/ref/heads/main`, token);
  if (currentRef.object.sha !== baseSha) {
    const error = new Error('mainが別の更新で進んでいます。Traceを再同期して差分を確認してください。');
    error.code = 'CONFLICT';
    throw error;
  }
  const baseCommit = await request(`/repos/${OWNER}/${REPO}/git/commits/${baseSha}`, token);
  const blobs = await Promise.all(entries.map(async trace => ({
    path: `${TRACE_DIRECTORY}/${trace.id}.md`,
    sha: (await request(`/repos/${OWNER}/${REPO}/git/blobs`, token, {
      method: 'POST',
      body: JSON.stringify({ content: serializeTraceMarkdown(trace), encoding: 'utf-8' })
    })).sha
  })));

  const treeEntries = [
    ...blobs.map(blob => ({ ...blob, mode: '100644', type: 'blob' })),
    ...deleteIds.map(id => ({ path: `${TRACE_DIRECTORY}/${id}.md`, mode: '100644', type: 'blob', sha: null }))
  ];
  const tree = await request(`/repos/${OWNER}/${REPO}/git/trees`, token, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeEntries })
  });
  const commit = await request(`/repos/${OWNER}/${REPO}/git/commits`, token, {
    method: 'POST',
    body: JSON.stringify({
      message: `content: sync Traces (+${entries.length} / -${deleteIds.length})`,
      tree: tree.sha,
      parents: [baseSha]
    })
  });
  try {
    await request(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, token, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false })
    });
  } catch (error) {
    if (error.status === 422) {
      error.code = 'CONFLICT';
      error.message = '同期直前にmainが更新されました。ローカルTraceは保持されています。';
    }
    throw error;
  }
  return { sha: commit.sha, changed: true };
}
