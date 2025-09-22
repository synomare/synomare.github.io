#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const notesDir = path.join(repoRoot, 'notes');
const postsJsonPath = path.join(notesDir, 'posts.json');
const postsJsPath = path.join(notesDir, 'posts.js');
const templatePath = path.join(notesDir, 'post-template.html');

function logError(message){
  console.error(`\n\x1b[31mError:\x1b[0m ${message}\n`);
}

function usage(){
  console.log(`Usage:\n` +
    `  node scripts/new-post.mjs <slug> <title> [--date=YYYY-MM-DD] [--summary="テキスト"] [--tags=タグ1,タグ2] [--tag=タグ]...\n` +
    `  node scripts/new-post.mjs --rebuild\n\n` +
    `Options:\n` +
    `  --rebuild             既存の posts.json / posts.js を再生成します。\n` +
    `  --date=YYYY-MM-DD     新規作成時の日付を指定します。\n` +
    `  --summary="テキスト"  新規作成時のサマリーを指定します。\n` +
    `  --tags=タグ1,タグ2    新規作成時のタグをカンマ区切りで指定します。\n` +
    `  --tag=タグ            --tags を複数回指定する書式です。\n\n` +
    `例:\n` +
    `  node scripts/new-post.mjs my-new-post "新しい記事" --summary="概要文" --tags=diary,update\n`);
}

function parseArgs(argv){
  const options = {};
  const positional = [];
  for(let i=0;i<argv.length;i++){
    const arg = argv[i];
    if(!arg.startsWith('--')){
      positional.push(arg);
      continue;
    }
    const eqIndex = arg.indexOf('=');
    let key;
    let value;
    if(eqIndex !== -1){
      key = arg.slice(2, eqIndex);
      value = arg.slice(eqIndex + 1);
    }else{
      key = arg.slice(2);
      if(i + 1 < argv.length && !argv[i + 1].startsWith('--')){
        value = argv[i + 1];
        i++;
      }else{
        value = '';
      }
    }
    if(key === 'tag' || key === 'tags'){
      if(!options.tags) options.tags = [];
      if(value !== '') options.tags.push(value);
    }else{
      options[key] = value;
    }
  }
  return { positional, options };
}

function today(){
  return new Date().toISOString().slice(0,10);
}

function escapeHtml(str){
  return str.replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}

function escapeRegExp(str){
  return str.replace(/[\^$.*+?()[\]{}|]/g, '\$&');
}

async function ensureTemplate(){
  try{
    await fs.access(templatePath);
  }catch{
    throw new Error(`テンプレートが見つかりません: ${path.relative(repoRoot, templatePath)}`);
  }
}

async function readPosts(){
  try{
    const data = await fs.readFile(postsJsonPath, 'utf8');
    return JSON.parse(data);
  }catch(err){
    if(err.code === 'ENOENT') return [];
    throw err;
  }
}

function sortPosts(posts){
  posts.sort((a, b) => {
    const aDate = typeof a.date === 'string' ? a.date : '';
    const bDate = typeof b.date === 'string' ? b.date : '';
    if(aDate === bDate){
      const aSlug = typeof a.slug === 'string' ? a.slug : '';
      const bSlug = typeof b.slug === 'string' ? b.slug : '';
      return aSlug.localeCompare(bSlug);
    }
    return aDate < bDate ? 1 : -1;
  });
  return posts;
}

function validateSlug(slug){
  if(!slug) throw new Error('slug が指定されていません。');
  if(!/^[a-z0-9-]+$/.test(slug)){
    throw new Error('slug は英小文字・数字・ハイフンのみで指定してください。');
  }
}

function validateDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)){
    throw new Error('date は YYYY-MM-DD 形式で指定してください。');
  }
  const time = Date.parse(value + 'T00:00:00Z');
  if(Number.isNaN(time)){
    throw new Error('date の値を解釈できませんでした。');
  }
}

async function writeJson(posts){
  const json = JSON.stringify(posts, null, 2) + '\n';
  await fs.writeFile(postsJsonPath, json, 'utf8');
}

async function writePostsJs(posts){
  const postsForJs = posts.map(post => {
    const year = (post.date || '').slice(0,4);
    const yearMonth = (post.date || '').slice(0,7);
    return {
      slug: post.slug,
      title: post.title,
      date: post.date,
      summary: post.summary || '',
      tags: Array.isArray(post.tags) ? post.tags : [],
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

function buildContentPlaceholder(){
  const lines = [
    '<p><!-- TODO: ここに本文を書いてください。必要がなければこの段落を削除してください。 --></p>',
    '<p>必要に応じて段落や見出しを追加してください。</p>'
  ];
  return lines.map(line => '        ' + line).join('\n');
}

async function writeHtml({ slug, title, date, summary }){
  const tpl = await fs.readFile(templatePath, 'utf8');
  const replacements = new Map([
    ['{{TITLE}}', escapeHtml(title)],
    ['{{DATE}}', escapeHtml(date)],
    ['{{SUMMARY}}', escapeHtml(summary)],
    ['{{SLUG}}', escapeHtml(slug)],
    ['{{CONTENT}}', buildContentPlaceholder() + '\n']
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

async function rebuildPosts(){
  const posts = await readPosts();
  if(!Array.isArray(posts)){
    throw new Error(`${path.relative(repoRoot, postsJsonPath)} の内容が配列ではありません。`);
  }
  sortPosts(posts);
  await writeJson(posts);
  await writePostsJs(posts);

  console.log('\n投稿メタデータを再生成しました。');
  console.log(`- メタデータ: ${path.relative(repoRoot, postsJsonPath)}`);
  console.log(`- 一覧データ: ${path.relative(repoRoot, postsJsPath)}`);
  console.log(`- 対象件数: ${posts.length}`);
}

(async function main(){
  const { positional, options } = parseArgs(process.argv.slice(2));
  const rebuildMode = Object.prototype.hasOwnProperty.call(options, 'rebuild');

  if(rebuildMode){
    if(typeof options.rebuild === 'string' && options.rebuild !== ''){
      logError('再生成モードに値は指定できません。');
      usage();
      process.exit(1);
    }
    if(positional.length > 0){
      logError('再生成モードでは追加の引数を指定できません。');
      usage();
      process.exit(1);
    }
    try{
      await rebuildPosts();
      return;
    }catch(err){
      logError(err.message);
      process.exit(1);
    }
  }
  if(positional.length < 2){
    usage();
    process.exit(1);
  }
  const [slugRaw, ...titleParts] = positional;
  const title = titleParts.join(' ').trim();
  if(!title){
    logError('タイトルを指定してください。');
    usage();
    process.exit(1);
  }
  try{
    validateSlug(slugRaw);
  }catch(err){
    logError(err.message);
    process.exit(1);
  }
  const slug = slugRaw;
  const date = options.date ? String(options.date) : today();
  try{
    validateDate(date);
  }catch(err){
    logError(err.message);
    process.exit(1);
  }
  const summary = (options.summary ? String(options.summary) : 'ここに記事の概要を1〜2文で書いてください。').trim();
  const tagsRaw = Array.isArray(options.tags) ? options.tags : (options.tags ? [options.tags] : []);
  const tags = Array.from(new Set(tagsRaw
    .flatMap(value => String(value).split(',') )
    .map(tag => tag.trim())
    .filter(Boolean)
  ));

  try{
    await ensureTemplate();
    const posts = await readPosts();
    if(posts.some(post => post.slug === slug)){
      throw new Error(`既に同じ slug が存在します: ${slug}`);
    }
    const targetPath = path.join(notesDir, `${slug}.html`);
    try{
      await fs.access(targetPath);
      throw new Error(`既にファイルが存在します: ${path.relative(repoRoot, targetPath)}`);
    }catch(err){
      if(err && err.code !== 'ENOENT') throw err;
    }

    posts.push({ slug, title, date, summary, tags });
    sortPosts(posts);

    await writeJson(posts);
    await writePostsJs(posts);
    const createdPath = await writeHtml({ slug, title, date, summary });

    console.log('\n新しい記事を生成しました。');
    console.log(`- メタデータ: ${path.relative(repoRoot, postsJsonPath)}`);
    console.log(`- 一覧データ: ${path.relative(repoRoot, postsJsPath)}`);
    console.log(`- 記事ファイル: ${path.relative(repoRoot, createdPath)}`);
    console.log('\n記事本文を編集し、必要に応じてサマリーを調整してください。');
  }catch(err){
    logError(err.message);
    process.exit(1);
  }
})();
