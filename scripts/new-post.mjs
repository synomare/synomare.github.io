#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import convertHeic from 'heic-convert';
import { marked } from 'marked';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.SYNOMARE_REPO_ROOT ? path.resolve(process.env.SYNOMARE_REPO_ROOT) : path.resolve(__dirname, '..');
const notesDir = path.join(repoRoot, 'notes');
const contentDir = path.join(notesDir, 'content');
const postsJsonPath = path.join(notesDir, 'posts.json');
const postsJsPath = path.join(notesDir, 'posts.js');
const templatePath = path.join(notesDir, 'post-template.html');
const generatedImageDir = path.join(repoRoot, 'assets', 'images', 'notes', 'generated');
const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
const CARD_SIZES = new Set(['auto', 's', 'm', 'l']);
const POST_TYPES = new Set(['text', 'photo']);
const WEB_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg']);
const HEIC_EXTENSIONS = new Set(['.heic', '.heif']);

function logError(message) { console.error(`\n\x1b[31mError:\x1b[0m ${message}\n`); }
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function escapeRegExp(value) { return value.replace(/[\^$.*+?()[\]{}|]/g, '\\$&'); }
function normalizeKey(value) { return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('ja'); }
function unique(values) { return [...new Set(values)]; }
function todayJst() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function stripMarkdown(value) {
  return String(value || '').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(WIKILINK_RE, (_, target, label) => label || target)
    .replace(/^#{1,6}\s+/gm, '').replace(/[*_>`~#]/g, '').replace(/\s+/g, ' ').trim();
}
function autoExcerpt(markdownBody, max = 180) {
  const paragraphs = String(markdownBody).split(/\r?\n\s*\r?\n/).map(stripMarkdown).filter(text => text && !/^https?:\/\/\S+$/.test(text));
  const text = paragraphs[0] || '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
function autoTags(markdownBody) {
  const found = [];
  for (const match of String(markdownBody).matchAll(/(?:^|\s)#([^\s#.,!?、。]+)/gu)) found.push(match[1]);
  return unique(found).slice(0, 20);
}
function readFrontmatterValue(source, name) {
  const block = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!block) return undefined;
  const line = block[1].match(new RegExp(`^${escapeRegExp(name)}:\\s*(?:"([^"]*)"|'([^']*)'|([^\\s#]+))\\s*(?:#.*)?$`, 'm'));
  return line ? line.slice(1).find(value => value !== undefined) : undefined;
}
function validateSlug(slug) { if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '')) throw new Error('slug は英小文字・数字・ハイフンのみで指定してください。'); }
function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error('date は YYYY-MM-DD 形式で指定してください。');
  const [year, month, day] = value.split('-').map(Number); const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error('date の値を解釈できませんでした。');
}
function validateStringList(value, name, file, { min = 0, max = 20 } = {}) {
  if (value === undefined && min === 0) return [];
  if (!Array.isArray(value) || value.length < min || value.length > max || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${file}: ${name} は${min ? `${min}〜` : ''}${max}個までの文字列の配列で指定してください。`);
  }
  return unique(value.map(item => item.trim()));
}
function validatePost({ slug, data, markdownBody, rawDate, file }) {
  validateSlug(slug);
  const postType = data.post_type === undefined ? 'text' : String(data.post_type);
  if (!POST_TYPES.has(postType)) throw new Error(`${file}: post_type は text または photo で指定してください。`);
  if (postType === 'text' && (typeof data.title !== 'string' || !data.title.trim())) throw new Error(`${file}: テキスト投稿では title は必須です。`);
  if (postType === 'text' && (typeof markdownBody !== 'string' || !markdownBody.trim())) throw new Error(`${file}: テキスト投稿では本文は必須です。`);
  if (data.title !== undefined && typeof data.title !== 'string') throw new Error(`${file}: title は文字列で指定してください。`);
  const photo = typeof data.photo === 'string' ? data.photo.trim() : '';
  if (postType === 'photo' && !photo) throw new Error(`${file}: 写真投稿では photo は必須です。`);
  const date = rawDate || (data.date instanceof Date ? data.date.toISOString().slice(0, 10) : String(data.date || '')); validateDate(date);
  if (data.draft !== undefined && typeof data.draft !== 'boolean') throw new Error(`${file}: draft は true または false で指定してください。`);
  const explicitTags = validateStringList(data.tags, 'tags', file); const aliases = validateStringList(data.aliases, 'aliases', file);
  const cardSizeMode = data.card_size === undefined ? 'auto' : String(data.card_size);
  if (!CARD_SIZES.has(cardSizeMode)) throw new Error(`${file}: card_size は auto、s、m、l のいずれかで指定してください。`);
  if (data.summary !== undefined && (typeof data.summary !== 'string' || !data.summary.trim())) throw new Error(`${file}: summary は空にできません。`);
  if (data.card_excerpt !== undefined && (typeof data.card_excerpt !== 'string' || !data.card_excerpt.trim())) throw new Error(`${file}: card_excerpt は空にできません。`);
  const title = data.title?.trim() || '';
  const summary = data.summary?.trim() || autoExcerpt(markdownBody, 160) || (title || `写真 ${date.replaceAll('-', '.')}`); const detectedTags = autoTags(markdownBody);
  return { postType, photo, title, displayTitle: title || `Photo ${date.replaceAll('-', '.')}`, date, summary,
    tags: explicitTags.length ? explicitTags : (detectedTags.length ? detectedTags : [postType === 'photo' ? '写真' : '未分類']), aliases,
    cardSizeMode, cardExcerpt: data.card_excerpt?.trim() || (postType === 'photo' ? '' : summary), draft: data.draft === true };
}
// Keep the newest publication first. New Notes use a JST timestamp slug, so
// descending slug order gives same-day posts the same order as their creation.
function sortPosts(posts) { return posts.sort((a, b) => b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug)); }
function addIndex(map, key, post) {
  const normalized = normalizeKey(key); if (!normalized) return; const list = map.get(normalized) || [];
  if (!list.some(item => item.slug === post.slug)) list.push(post); map.set(normalized, list);
}
function buildLinkResolver(posts) {
  const slug = new Map(); const title = new Map(); const alias = new Map();
  for (const post of posts) { addIndex(slug, post.slug, post); addIndex(title, post.title, post); for (const value of post.aliases) addIndex(alias, value, post); }
  return target => {
    const key = normalizeKey(target);
    for (const map of [slug, title, alias]) { const matches = map.get(key) || []; if (matches.length === 1) return { status: 'resolved', post: matches[0] }; if (matches.length > 1) return { status: 'ambiguous', matches }; }
    return { status: 'unresolved', matches: [] };
  };
}
function wikilinkContexts(markdownBody, resolver) {
  const outgoing = [];
  for (const paragraph of String(markdownBody).split(/\r?\n\s*\r?\n/)) {
    for (const match of paragraph.matchAll(WIKILINK_RE)) {
      const result = resolver(match[1]); if (result.status !== 'resolved') continue;
      outgoing.push({ slug: result.post.slug, title: result.post.displayTitle, label: (match[2] || match[1]).trim(), href: `${result.post.slug}.html`, context: autoExcerpt(paragraph, 140) });
    }
  }
  return outgoing.filter((item, index) => outgoing.findIndex(other => other.slug === item.slug) === index);
}
function replaceWikilinks(markdownBody, resolver) {
  return String(markdownBody).replace(WIKILINK_RE, (_, targetRaw, labelRaw) => {
    const target = targetRaw.trim(); const label = (labelRaw || target).trim(); const result = resolver(target);
    if (result.status === 'resolved') return `<a class="wikilink" href="${escapeHtml(result.post.slug)}.html" data-note="${escapeHtml(result.post.slug)}">${escapeHtml(label)}</a>`;
    return `<span class="wikilink is-${result.status}" title="${result.status === 'ambiguous' ? '同名の候補が複数あります' : 'リンク先がまだありません'}">${escapeHtml(label)}</span>`;
  });
}
function transformEmbeds(tokens) {
  for (const token of tokens) {
    if (token.type !== 'paragraph' || token.tokens?.length !== 1 || token.tokens[0].type !== 'link') continue;
    const href = token.tokens[0].href; const youtube = href.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/); const twitter = href.match(/(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/);
    if (youtube) { token.type = 'html'; token.text = `<div class="video-container"><iframe src="https://www.youtube.com/embed/${youtube[1]}" title="YouTube video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`; }
    else if (twitter) { token.type = 'html'; token.text = `<blockquote class="twitter-tweet"><a href="${escapeHtml(href)}"></a></blockquote>`; }
  }
}
function encodePublicPath(value) {
  return value.split('/').map((part, index) => index === 0 ? '' : encodeURIComponent(part)).join('/');
}
function resolveLocalImage(href, sourceFile) {
  const value = String(href || '').trim();
  if (/^(?:https?:)?\/\//i.test(value)) return null;
  if (/^(?:data|blob|javascript):/i.test(value)) throw new Error(`${sourceFile}: 埋め込みデータURLやblob URLは画像に使用できません。画像ファイルをアップロードしてください。`);
  const clean = value.split(/[?#]/, 1)[0];
  let decoded;
  try { decoded = decodeURIComponent(clean); } catch { throw new Error(`${sourceFile}: 画像URLの文字エンコードが壊れています: ${value}`); }
  const publicPath = decoded.startsWith('/') ? path.posix.normalize(decoded)
    : decoded.startsWith('assets/') ? `/${path.posix.normalize(decoded)}`
      : path.posix.normalize(`/notes/${decoded}`);
  const filePath = path.resolve(repoRoot, `.${publicPath}`);
  const relative = path.relative(repoRoot, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${sourceFile}: サイト外の画像パスは使用できません: ${value}`);
  return { filePath, publicPath };
}
async function prepareImageHref(href, { sourceFile, writeAssets }) {
  const local = resolveLocalImage(href, sourceFile);
  if (!local) return href;
  try { await fs.access(local.filePath); } catch { throw new Error(`${sourceFile}: 画像ファイルが見つかりません: ${local.publicPath}`); }
  const extension = path.extname(local.filePath).toLowerCase();
  if (WEB_IMAGE_EXTENSIONS.has(extension)) return encodePublicPath(local.publicPath);
  if (!HEIC_EXTENSIONS.has(extension)) throw new Error(`${sourceFile}: ${extension || '拡張子なし'}画像はWeb表示に対応していません。JPEG・PNG・WebP・GIF・AVIF・BMP・SVG・HEICを使用してください。`);

  const input = await fs.readFile(local.filePath);
  let output;
  try { output = await convertHeic({ buffer: input, format: 'JPEG', quality: 0.88 }); }
  catch { throw new Error(`${sourceFile}: HEIC画像をJPEGへ変換できませんでした: ${local.publicPath}`); }
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 12);
  const filename = path.basename(local.filePath);
  const basename = filename.slice(0, -path.extname(filename).length).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'image';
  const outputName = `${basename}-${hash}.jpg`;
  if (writeAssets) {
    await fs.mkdir(generatedImageDir, { recursive: true });
    await fs.writeFile(path.join(generatedImageDir, outputName), output);
  }
  return `/assets/images/notes/generated/${outputName}`;
}
async function prepareImageTokens(tokens, options) {
  for (const token of tokens) {
    if (token.type === 'image') token.href = await prepareImageHref(token.href, options);
    if (token.tokens) await prepareImageTokens(token.tokens, options);
  }
}
function findThumbnail(tokens) { for (const token of tokens) { if (token.type === 'image') return token.href; if (token.tokens) { const image = findThumbnail(token.tokens); if (image) return image; } } return ''; }
function imageMeta(image) {
  if (!image) return ''; const absolute = image.startsWith('//') ? `https:${image}` : /^https?:\/\//i.test(image) ? image : `https://synomare.github.io${image.startsWith('/') ? image : `/${image}`}`;
  return `<meta property="og:image" content="${escapeHtml(absolute)}">\n  <meta name="twitter:image" content="${escapeHtml(absolute)}">`;
}
function relationList(title, items, emptyText, className) {
  const body = items.length ? `<ul>${items.map(item => `<li><a href="${escapeHtml(item.href)}">${escapeHtml(item.title)}</a>${item.context ? `<p>${escapeHtml(item.context)}</p>` : ''}</li>`).join('')}</ul>` : `<p class="relation-empty">${escapeHtml(emptyText)}</p>`;
  return `<section class="relation ${className}"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}
function graphFor(post) {
  const linked = [...post.outgoing, ...post.incoming, ...post.related.slice(0, 3)]; const nodes = [{ slug: post.slug, title: post.displayTitle, kind: 'current' }];
  for (const item of linked) if (!nodes.some(node => node.slug === item.slug)) nodes.push({ slug: item.slug, title: item.title, kind: 'note' });
  return { nodes, edges: linked.map(item => ({ from: post.slug, to: item.slug })) };
}
function relationsHtml(post) {
  return `<aside class="entry-side" aria-label="記事のつながり"><div class="graph-panel"><div class="side-label">LOCAL GRAPH</div><div class="mini-graph" data-graph="${escapeHtml(JSON.stringify(post.graph))}"></div></div></aside><div class="relations">${relationList('Links — この記事から', post.outgoing, 'この記事からのリンクはまだありません。', 'outgoing')}${relationList('Backlinks — この記事へ', post.incoming, 'この記事へのリンクはまだありません。', 'incoming')}${relationList('Related — 関連記事', post.related, '関連する記事はまだありません。', 'related')}</div>`;
}
function photoHtml(post) {
  const caption = post.title || (post.summary.startsWith('写真 ') ? '' : post.summary);
  return `<figure class="photo-detail"><img src="${escapeHtml(post.image)}" alt="${escapeHtml(post.title)}" decoding="async" fetchpriority="high"><div class="photo-detail-error" role="status"><strong>IMAGE COULD NOT BE DISPLAYED</strong><span>写真を読み込めませんでした。</span><a href="${escapeHtml(post.image)}" target="_blank" rel="noopener noreferrer">画像ファイルを開く</a></div>${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`;
}
async function readPosts({ writeAssets = false } = {}) {
  const files = (await fs.readdir(contentDir)).filter(file => file.endsWith('.md')); const rawPosts = [];
  for (const file of files) {
    const filePath = path.join(contentDir, file); const source = await fs.readFile(filePath, 'utf8'); const { data, content: markdownBody } = matter(source); const slug = path.basename(file, '.md');
    rawPosts.push({ slug, markdownBody, ...validatePost({ slug, data, markdownBody, rawDate: readFrontmatterValue(source, 'date'), file: path.relative(repoRoot, filePath) }) });
  }
  sortPosts(rawPosts); const published = rawPosts.filter(post => !post.draft); const resolver = buildLinkResolver(published);
  for (const post of published) post.outgoing = post.postType === 'photo' ? [] : wikilinkContexts(post.markdownBody, resolver);
  for (const post of published) {
    post.incoming = published.flatMap(source => source.outgoing.filter(link => link.slug === post.slug).map(link => ({ slug: source.slug, title: source.displayTitle, href: `${source.slug}.html`, context: link.context })));
    post.related = published.filter(other => other.slug !== post.slug).map(other => ({ slug: other.slug, title: other.displayTitle, href: `${other.slug}.html`, shared: other.tags.filter(tag => post.tags.includes(tag)).length }))
      .filter(item => item.shared > 0).sort((a, b) => b.shared - a.shared || published.findIndex(post => post.slug === a.slug) - published.findIndex(post => post.slug === b.slug)).slice(0, 6);
    const tokens = marked.lexer(replaceWikilinks(post.markdownBody, resolver));
    await prepareImageTokens(tokens, { sourceFile: `notes/content/${post.slug}.md`, writeAssets });
    post.image = post.postType === 'photo'
      ? await prepareImageHref(post.photo, { sourceFile: `notes/content/${post.slug}.md`, writeAssets })
      : findThumbnail(tokens);
    post.cardSize = post.cardSizeMode === 'auto' ? (post.postType === 'photo' ? 'l' : post.image ? 'm' : 's') : post.cardSizeMode;
    transformEmbeds(tokens); post.contentHtml = post.postType === 'photo' ? photoHtml(post) : marked.parser(tokens); post.graph = graphFor(post);
  }
  return { all: rawPosts, published };
}
function publicMeta(post) {
  return { slug: post.slug, postType: post.postType, title: post.title, displayTitle: post.displayTitle, date: post.date, summary: post.summary, cardExcerpt: post.cardExcerpt, cardSize: post.cardSize, cardSizeMode: post.cardSizeMode, tags: post.tags, aliases: post.aliases,
    image: post.image, href: `${post.slug}.html`, year: post.date.slice(0, 4), yearMonth: post.date.slice(0, 7), path: `notes/${post.slug}.html`, outgoing: post.outgoing, incoming: post.incoming, related: post.related, graph: post.graph };
}
async function writeData(posts) {
  const data = posts.map(publicMeta); await fs.writeFile(postsJsonPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.writeFile(postsJsPath, `(function(){\n  window.__SYNOMARE_POSTS__ = ${JSON.stringify(data, null, 2)};\n})();\n`, 'utf8');
}
async function previousSlugs() { try { return JSON.parse(await fs.readFile(postsJsonPath, 'utf8')).map(post => post.slug).filter(Boolean); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }
async function writeHtml(post) {
  let html = await fs.readFile(templatePath, 'utf8');
  const entryHead = post.postType === 'photo'
    ? `<header class="entry-head photo-head">${post.title ? `<h1>${escapeHtml(post.title)}</h1>` : ''}<time class="entry-date" datetime="${escapeHtml(post.date)}">${escapeHtml(post.date)}</time><span class="photo-kind">PHOTO</span></header>`
    : `<header class="entry-head"><h1>${escapeHtml(post.title)}</h1><time class="entry-date" datetime="${escapeHtml(post.date)}">${escapeHtml(post.date)}</time></header>`;
  const replacements = { '{{TITLE}}': escapeHtml(post.displayTitle), '{{BREADCRUMB_TITLE}}': escapeHtml(post.title || 'PHOTO'), '{{DATE}}': escapeHtml(post.date), '{{SUMMARY}}': escapeHtml(post.summary), '{{SLUG}}': escapeHtml(post.slug), '{{POST_TYPE}}': escapeHtml(post.postType), '{{BODY_CLASS}}': post.postType === 'photo' ? 'photo-page' : 'text-page', '{{ENTRY_CLASS}}': post.postType === 'photo' ? 'photo-entry' : 'text-entry', '{{ENTRY_HEAD}}': entryHead, '{{TWITTER_CARD}}': post.image ? 'summary_large_image' : 'summary', '{{IMAGE_META}}': imageMeta(post.image), '{{CONTENT}}': post.contentHtml, '{{RELATIONS}}': post.postType === 'photo' ? '' : relationsHtml(post) };
  for (const [key, value] of Object.entries(replacements)) html = html.replace(new RegExp(escapeRegExp(key), 'g'), () => value);
  await fs.writeFile(path.join(notesDir, `${post.slug}.html`), html, 'utf8');
}
async function rebuildPosts() {
  const oldSlugs = await previousSlugs(); await fs.rm(generatedImageDir, { recursive: true, force: true }); const { all, published } = await readPosts({ writeAssets: true }); await writeData(published); for (const post of published) await writeHtml(post);
  const current = new Set(published.map(post => post.slug)); for (const slug of oldSlugs) if (!current.has(slug)) await fs.rm(path.join(notesDir, `${slug}.html`), { force: true });
  console.log(`\nサイトを再生成しました。\n- 公開記事数: ${published.length}\n- 下書き数: ${all.length - published.length}\n- メタデータ: ${path.relative(repoRoot, postsJsonPath)}`);
}
async function createPost({ slug, title, date, summary, tags }) {
  const target = path.join(contentDir, `${slug}.md`); try { await fs.access(target); throw new Error(`既にファイルが存在します: ${path.relative(repoRoot, target)}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const source = matter.stringify('\n<!-- ここに本文を書いてください -->\n', { post_type: 'text', title, date, summary, tags: tags.length ? tags : ['未分類'], aliases: [], card_size: 'auto', draft: false });
  await fs.writeFile(target, source, 'utf8'); await rebuildPosts();
}
function parseArgs(argv) {
  const positional = []; const options = {};
  for (const arg of argv) { if (!arg.startsWith('--')) { positional.push(arg); continue; } const [key, ...rest] = arg.slice(2).split('='); const value = rest.join('='); if (key === 'tag' || key === 'tags') (options.tags ||= []).push(value); else options[key] = value; }
  return { positional, options };
}
(async () => {
  const { positional, options } = parseArgs(process.argv.slice(2));
  try {
    await fs.mkdir(contentDir, { recursive: true }); await fs.access(templatePath);
    if ('rebuild' in options) return await rebuildPosts();
    if ('check' in options) { const { all, published } = await readPosts(); console.log(`Notes の検証に成功しました（全${all.length}件 / 公開${published.length}件 / 下書き${all.length - published.length}件）。`); return; }
    if (positional.length < 2) throw new Error('slug とタイトルを指定してください。');
    const [slug, ...titleParts] = positional; validateSlug(slug); const date = options.date || todayJst(); validateDate(date);
    const tags = unique((options.tags || []).flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean));
    await createPost({ slug, title: titleParts.join(' ').trim(), date, summary: options.summary || '本文を読む', tags });
  } catch (error) { logError(error.message); process.exit(1); }
})();
