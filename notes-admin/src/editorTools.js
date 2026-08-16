import { outgoingFromBody } from './lib.js';

export function documentStats(body) {
  const source = String(body || '');
  const characters = source.replace(/\s/g, '').length;
  const words = source.trim() ? source.trim().split(/\s+/u).length : 0;
  const headings = outlineFromBody(source).length;
  return { characters, words, headings, minutes: Math.max(1, Math.ceil(characters / 500)) };
}

export function outlineFromBody(body) {
  return String(body || '').split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    return match ? [{ level: match[1].length, text: match[2].trim(), line: index + 1 }] : [];
  });
}

export function preflightIssues(note, documents = [], imageProcessing = false) {
  if (!note) return [];
  const issues = [];
  if (imageProcessing) issues.push({ level: 'error', text: '画像の処理が完了していません。' });
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(note.slug || '')) issues.push({ level: 'error', text: 'slugは英小文字・数字・ハイフンで指定してください。' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(note.date || '')) issues.push({ level: 'error', text: '公開日を指定してください。' });
  if (note.postType === 'photo') {
    if (!note.photo) issues.push({ level: 'error', text: '写真を1枚選択してください。' });
  } else {
    if (!note.title?.trim()) issues.push({ level: 'error', text: 'タイトルを入力してください。' });
    if (!note.body?.trim()) issues.push({ level: 'error', text: '本文を入力してください。' });
  }
  const duplicate = documents.find(doc => doc.slug !== note.slug && note.title?.trim() && doc.title?.trim() === note.title.trim());
  if (duplicate) issues.push({ level: 'warning', text: `同じタイトルの記事があります：${duplicate.slug}` });
  const known = new Set(documents.flatMap(doc => [doc.slug, doc.title, ...(doc.aliases || [])].filter(Boolean).map(value => value.normalize('NFKC').toLocaleLowerCase('ja'))));
  const unresolved = [...new Set(outgoingFromBody(note.body).filter(link => !known.has(link.target.normalize('NFKC').toLocaleLowerCase('ja'))).map(link => link.target))];
  if (unresolved.length) issues.push({ level: 'warning', text: `未解決リンク：${unresolved.join('、')}` });
  return issues;
}
