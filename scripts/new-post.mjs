#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { marked } from 'marked';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const notesDir = path.join(repoRoot, 'notes');
const contentDir = path.join(notesDir, 'content');
const postsJsonPath = path.join(notesDir, 'posts.json');
const postsJsPath = path.join(notesDir, 'posts.js');
const templatePath = path.join(notesDir, 'post-template.html');

function logError(message) {
  console.error(`\n\x1b[31mError:\x1b[0m ${message}\n`);
}

function usage() {
  console.log(`Usage:\n` +
    `  node scripts/new-post.mjs <slug> <title> [--date=YYYY-MM-DD] [--summary="テキスト"] [--tags=タグ1,タグ2] [--tag=タグ]...\n` +
    `  node scripts/new-post.mjs --rebuild\n\n` +
    `Options:\n` +
    `  --rebuild             Markdown ファイルから HTML とメタデータを再生成します。\n` +
    `  --date=YYYY-MM-DD     新規作成時の日付を指定します。\n` +
    `  --summary="テキスト"  新規作成時のサマリーを指定します。\n` +
    `  --tags=タグ1,タグ2    新規作成時のタグをカンマ区切りで指定します。\n` +
    `  --tag=タグ            --tags を複数回指定する書式です。\n\n` +
    `例:\n` +
    `  node scripts/new-post.mjs my-new-post "新しい記事" --summary="概要文" --tags=diary,update\n`);
}

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eqIndex = arg.indexOf('=');
    let key;
    let value;
    if (eqIndex !== -1) {
      key = arg.slice(2, eqIndex);
      value = arg.slice(eqIndex + 1);
    } else {
      key = arg.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        value = argv[i + 1];
        i++;
      } else {
        value = '';
      }
    }
    if (key === 'tag' || key === 'tags') {
      if (!options.tags) options.tags = [];
      if (value !== '') options.tags.push(value);
    } else {
      options[key] = value;
    }
  }
  return { positional, options };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}

function escapeRegExp(str) {
  return str.replace(/[\^$.*+?()[\]{}|]/g, '\\$&');
}

async function ensureTemplate() {
  try {
    await fs.access(templatePath);
  } catch {
    throw new Error(`テンプレートが見つかりません: ${path.relative(repoRoot, templatePath)}`);
  }
}

function sortPosts(posts) {
  posts.sort((a, b) => {
    const aDate = typeof a.date === 'string' ? a.date : '';
    const bDate = typeof b.date === 'string' ? b.date : '';
    if (aDate === bDate) {
      const aSlug = typeof a.slug === 'string' ? a.slug : '';
      const bSlug = typeof b.slug === 'string' ? b.slug : '';
      return aSlug.localeCompare(bSlug);
    }
    return aDate < bDate ? 1 : -1;
  });
  return posts;
}

function validateSlug(slug) {
  if (!slug) throw new Error('slug が指定されていません。');
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error('slug は英小文字・数字・ハイフンのみで指定してください。');
  }
}

function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('date は YYYY-MM-DD 形式で指定してください。');
  }
  const time = Date.parse(value + 'T00:00:00Z');
  if (Number.isNaN(time)) {
    throw new Error('date の値を解釈できませんでした。');
  }
}

async function writeJson(posts) {
  const json = JSON.stringify(posts, null, 2) + '\n';
  await fs.writeFile(postsJsonPath, json, 'utf8');
}

async function writePostsJs(posts) {
  const postsForJs = posts.map(post => {
    const year = (post.date || '').slice(0, 4);
    const yearMonth = (post.date || '').slice(0, 7);
    return {
      slug: post.slug,
      title: post.title,
      date: post.date,
      summary: post.summary || '',
      tags: Array.isArray(post.tags) ? post.tags : [],
      image: post.image || '',
      href: post.href || `${post.slug}.html`,
      year,
      yearMonth,
      path: `notes/${post.slug}.html`
    };
  });
  const literal = JSON.stringify(postsForJs, null, 2);
  const content = `(function(){\n  window.__SYNOMARE_POSTS__ = ${literal};\n})();\n`;
  await fs.writeFile(postsJsPath, content, 'utf8');
}

async function writeHtml({ slug, title, date, summary, contentHtml }) {
  const tpl = await fs.readFile(templatePath, 'utf8');
  const replacements = new Map([
    ['{{TITLE}}', escapeHtml(title)],
    ['{{DATE}}', escapeHtml(date)],
    ['{{SUMMARY}}', escapeHtml(summary)],
    ['{{SLUG}}', escapeHtml(slug)],
    ['{{CONTENT}}', contentHtml]
  ]);
  let html = tpl;
  replacements.forEach((value, key) => {
    const pattern = new RegExp(escapeRegExp(key), 'g');
    html = html.replace(pattern, () => value);
  });
  const targetPath = path.join(notesDir, `${slug}.html`);
  await fs.writeFile(targetPath, html, 'utf8');
  return targetPath;
}

async function createPost({ slug, title, date, summary, tags }) {
  const frontmatter = {
    title,
    date,
    summary,
    tags
  };
  const fileContent = matter.stringify('\n<!-- ここに本文を書いてください -->\n', frontmatter);
  const targetPath = path.join(contentDir, `${slug}.md`);

  try {
    await fs.access(targetPath);
    throw new Error(`既にファイルが存在します: ${path.relative(repoRoot, targetPath)}`);
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }

  await fs.writeFile(targetPath, fileContent, 'utf8');
  console.log(`\nMarkdown ファイルを作成しました: ${path.relative(repoRoot, targetPath)}`);

  // 自動でリビルドして HTML も生成しておく
  await rebuildPosts();
}

function transformEmbeds(tokens) {
  for (const token of tokens) {
    if (token.type === 'paragraph' && token.tokens.length === 1 && token.tokens[0].type === 'link') {
      const link = token.tokens[0];
      const href = link.href;

      // YouTube
      const ytMatch = href.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
      if (ytMatch) {
        token.type = 'html';
        token.text = `<div class="video-container"><iframe src="https://www.youtube.com/embed/${ytMatch[1]}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
        continue;
      }

      // Twitter
      const twMatch = href.match(/(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/);
      if (twMatch) {
        token.type = 'html';
        token.text = `<blockquote class="twitter-tweet"><a href="${href}"></a></blockquote>`;
        continue;
      }
    }
  }
}

function findThumbnail(tokens) {
  for (const t of tokens) {
    if (t.type === 'image') return t.href;
    if (t.tokens) {
      const img = findThumbnail(t.tokens);
      if (img) return img;
    }
  }
  return null;
}

async function rebuildPosts() {
  const files = await fs.readdir(contentDir);
  const mdFiles = files.filter(f => f.endsWith('.md'));
  const posts = [];

  for (const file of mdFiles) {
    const filePath = path.join(contentDir, file);
    const content = await fs.readFile(filePath, 'utf8');
    const { data, content: markdownBody } = matter(content);

    const slug = path.basename(file, '.md');
    const title = data.title || 'No Title';
    const date = data.date ? (data.date instanceof Date ? data.date.toISOString().slice(0, 10) : String(data.date)) : '';
    const summary = data.summary || '';
    const tags = Array.isArray(data.tags) ? data.tags : [];

    // Markdown processing
    const tokens = marked.lexer(markdownBody);

    // Thumbnail extraction
    const image = findThumbnail(tokens) || '';

    // Auto-embeds
    transformEmbeds(tokens);

    const contentHtml = marked.parser(tokens);

    posts.push({ slug, title, date, summary, tags, image, contentHtml });
  }

  sortPosts(posts);

  // メタデータ保存用（HTMLを含まない）
  const metaPosts = posts.map(({ contentHtml, ...meta }) => meta);
  await writeJson(metaPosts);
  await writePostsJs(metaPosts);

  // HTML生成
  for (const post of posts) {
    await writeHtml(post);
  }

  console.log('\nサイトを再生成しました。');
  console.log(`- 記事数: ${posts.length}`);
  console.log(`- メタデータ: ${path.relative(repoRoot, postsJsonPath)}`);
}

(async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const rebuildMode = Object.prototype.hasOwnProperty.call(options, 'rebuild');

  try {
    await ensureTemplate();
    // contentDir がなければ作る
    await fs.mkdir(contentDir, { recursive: true });

    if (rebuildMode) {
      await rebuildPosts();
      return;
    }

    if (positional.length < 2) {
      usage();
      process.exit(1);
    }

    const [slugRaw, ...titleParts] = positional;
    const title = titleParts.join(' ').trim();
    if (!title) {
      logError('タイトルを指定してください。');
      usage();
      process.exit(1);
    }
    validateSlug(slugRaw);
    const slug = slugRaw;

    const date = options.date ? String(options.date) : today();
    validateDate(date);

    const summary = (options.summary ? String(options.summary) : 'ここに記事の概要を1〜2文で書いてください。').trim();
    const tagsRaw = Array.isArray(options.tags) ? options.tags : (options.tags ? [options.tags] : []);
    const tags = Array.from(new Set(tagsRaw
      .flatMap(value => String(value).split(','))
      .map(tag => tag.trim())
      .filter(Boolean)
    ));

    await createPost({ slug, title, date, summary, tags });

  } catch (err) {
    logError(err.message);
    process.exit(1);
  }
})();
