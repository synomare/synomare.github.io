#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.SYNOMARE_REPO_ROOT
  ? path.resolve(process.env.SYNOMARE_REPO_ROOT)
  : path.resolve(__dirname, '..');
const worksDir = path.join(repoRoot, 'works');
const contentDir = path.join(worksDir, 'content');
const worksHtmlPath = path.join(repoRoot, 'works.html');
const worksJsonPath = path.join(worksDir, 'works.json');
const startMarker = '<!-- WORKS:START -->';
const endMarker = '<!-- WORKS:END -->';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function validateSlug(slug, file) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`${file}: slug は英小文字・数字・ハイフンのみで指定してください。`);
  }
}

function requiredString(value, name, file) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${file}: ${name} は必須です。`);
  }
  return value.trim();
}

function optionalString(value, name, file) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw new Error(`${file}: ${name} は文字列で指定してください。`);
  return value.trim();
}

function validateUrl(value, file) {
  const url = optionalString(value, 'url', file);
  if (!url) return '';
  if (/^(?:javascript|data):/i.test(url)) throw new Error(`${file}: url に使用できない形式が含まれています。`);
  if (!/^(?:https:\/\/|\/|\.\/|\.\.\/)/.test(url)) {
    throw new Error(`${file}: url は / から始まるサイト内パスか https:// URLで指定してください。`);
  }
  return url;
}

function validateImage(value, file) {
  const image = optionalString(value, 'image', file);
  if (!image) return '';
  if (!/^(?:https:\/\/|\/|\.\/|\.\.\/)/.test(image)) {
    throw new Error(`${file}: image は / から始まるサイト内パスか https:// URLで指定してください。`);
  }
  return image;
}

function validateDraft(value, file) {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`${file}: draft は true または false で指定してください。`);
  }
  return value === true;
}

function normalizeWork(slug, data, file) {
  validateSlug(slug, file);
  const title = requiredString(data.title, 'title', file);
  const year = String(data.year ?? '').trim();
  if (!/^\d{4}(?:[–-]\d{2,4})?$/.test(year)) {
    throw new Error(`${file}: year は 2025 または 2024-2025 の形式で指定してください。`);
  }
  const summary = requiredString(data.summary, 'summary', file);
  const type = requiredString(data.type, 'type', file);
  const url = validateUrl(data.url, file);
  const image = validateImage(data.image, file);
  const priority = data.priority == null || data.priority === '' ? 0 : Number(data.priority);
  if (!Number.isInteger(priority)) throw new Error(`${file}: priority は整数で指定してください。`);
  const draft = validateDraft(data.draft, file);
  return { slug, title, year, summary, type, url, image, priority, draft };
}

function sortWorks(works) {
  return works.sort((a, b) =>
    b.priority - a.priority ||
    b.year.localeCompare(a.year, 'ja') ||
    a.title.localeCompare(b.title, 'ja')
  );
}

async function readWorks() {
  await fs.mkdir(contentDir, { recursive: true });
  const files = (await fs.readdir(contentDir)).filter(file => file.endsWith('.md'));
  const works = [];
  for (const file of files) {
    const filePath = path.join(contentDir, file);
    const source = await fs.readFile(filePath, 'utf8');
    const { data } = matter(source);
    const relative = path.relative(repoRoot, filePath);
    works.push(normalizeWork(path.basename(file, '.md'), data, relative));
  }
  return sortWorks(works);
}

function renderWork(work) {
  const tag = work.url ? 'a' : 'div';
  const external = /^https:\/\//.test(work.url);
  const attributes = work.url
    ? ` href="${escapeHtml(work.url)}"${external ? ' target="_blank" rel="noopener"' : ''}`
    : '';
  const image = work.image
    ? `\n        <span class="w-thumb"><img src="${escapeHtml(work.image)}" alt="${escapeHtml(work.title)}" loading="lazy" decoding="async"></span>`
    : '';
  const search = `${work.title} ${work.summary} ${work.type}`.toLocaleLowerCase('ja');
  return `      <${tag} class="work-row${work.image ? ' has-image' : ''}"${attributes} data-search="${escapeHtml(search)}" data-type="${escapeHtml(work.type)}" data-year="${escapeHtml(work.year)}">
        <span class="w-no">${escapeHtml(work.year)}</span>${image}
        <span class="w-main">
          <span class="w-title">${escapeHtml(work.title)}</span>
          <span class="w-desc">${escapeHtml(work.summary)}</span>
        </span>
        <span class="w-type">${escapeHtml(work.type)}</span>
      </${tag}>`;
}

async function writeWorks(works) {
  const html = await fs.readFile(worksHtmlPath, 'utf8');
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('works.html に作品一覧の生成マーカーがありません。');
  }
  const publishedWorks = works.filter(work => !work.draft);
  const rendered = publishedWorks.length
    ? publishedWorks.map(renderWork).join('\n\n')
    : '      <p class="works-empty">まだ作品が登録されていません。</p>';
  const nextHtml = `${html.slice(0, start + startMarker.length)}\n${rendered}\n      ${html.slice(end)}`;
  await fs.writeFile(worksHtmlPath, nextHtml, 'utf8');
  await fs.mkdir(worksDir, { recursive: true });
  await fs.writeFile(worksJsonPath, JSON.stringify(publishedWorks.map(({ draft, ...work }) => work), null, 2) + '\n', 'utf8');
}

(async () => {
  try {
    const works = await readWorks();
    if (process.argv.includes('--check')) {
      const published = works.filter(work => !work.draft).length;
      console.log(`Works の検証に成功しました（全${works.length}件 / 公開${published}件 / 下書き${works.length - published}件）。`);
      return;
    }
    if (!process.argv.includes('--rebuild')) {
      throw new Error('--rebuild または --check を指定してください。');
    }
    await writeWorks(works);
    const published = works.filter(work => !work.draft).length;
    console.log(`Works を再生成しました（公開${published}件 / 下書き${works.length - published}件）。`);
  } catch (error) {
    console.error(`\n\x1b[31mError:\x1b[0m ${error.message}\n`);
    process.exit(1);
  }
})();
