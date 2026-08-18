import { outgoingFromBody } from './lib.js';

export const INDENT_UNIT = '  ';

function selectedLineRange(source, from, to) {
  const text = String(source || '');
  const safeFrom = Math.max(0, Math.min(Number.isFinite(from) ? from : 0, text.length));
  const safeTo = Math.max(safeFrom, Math.min(Number.isFinite(to) ? to : safeFrom, text.length));
  const start = text.lastIndexOf('\n', safeFrom - 1) + 1;
  const nextBreak = text.indexOf('\n', safeTo);
  const end = nextBreak === -1 ? text.length : nextBreak;
  return { text, start, end, selected: text.slice(start, end) };
}

function headingMatch(line) {
  return line.match(/^(\s*)(#{1,6})([ \t]+)(.*)$/);
}

function quoteMatch(line) {
  return line.match(/^(\s*)((?:>[ \t]*)+)(.*)$/);
}

function listMatch(line) {
  return line.match(/^(\s*)(?:(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]*)?)(.*)$/);
}

function leadingSpaces(line) {
  return (line.match(/^[ \t]*/) || [''])[0];
}

function adjustHeading(line, delta) {
  const match = headingMatch(line);
  if (!match) return line;
  const level = Math.max(1, Math.min(6, match[2].length + delta));
  return `${match[1]}${'#'.repeat(level)}${match[3]}${match[4]}`;
}

function adjustQuote(line, delta) {
  const match = quoteMatch(line);
  if (delta > 0) {
    if (match) return `${match[1]}> ${match[2]}${match[3]}`;
    return `> ${line}`;
  }
  if (match) {
    const token = match[2].match(/^>[ \t]*/)?.[0] || '';
    return `${match[1]}${match[2].slice(token.length)}${match[3]}`;
  }
  const spaces = leadingSpaces(line);
  return `${spaces.slice(Math.min(INDENT_UNIT.length, spaces.length))}${line.slice(spaces.length)}`;
}

function adjustLine(line, delta) {
  if (!line.trim()) return line;
  if (headingMatch(line)) return adjustHeading(line, delta);
  if (quoteMatch(line)) return adjustQuote(line, delta);
  if (listMatch(line)) {
    if (delta > 0) return `${INDENT_UNIT}${line}`;
    const spaces = leadingSpaces(line);
    return `${spaces.slice(Math.min(INDENT_UNIT.length, spaces.length))}${line.slice(spaces.length)}`;
  }
  if (delta > 0) {
    const spaces = leadingSpaces(line);
    // A second level of a plain paragraph becomes a nested blockquote rather
    // than a four-space code block, keeping the generated Markdown readable.
    if (spaces.length >= INDENT_UNIT.length) return `${spaces}> ${line.slice(spaces.length)}`;
    return `${INDENT_UNIT}${line}`;
  }
  return adjustQuote(line, delta);
}

export function changeLineDepth(source, from, to, delta) {
  const range = selectedLineRange(source, from, to);
  const step = delta < 0 ? -1 : 1;
  const insert = range.selected.split('\n').map(line => adjustLine(line, step)).join('\n');
  return { ...range, insert, text: `${range.text.slice(0, range.start)}${insert}${range.text.slice(range.end)}`, from: range.start, to: range.start + insert.length };
}

export function changeHeadingLevel(source, from, to, delta) {
  const range = selectedLineRange(source, from, to);
  const insert = range.selected.split('\n').map(line => headingMatch(line) ? adjustHeading(line, delta < 0 ? -1 : 1) : line).join('\n');
  return { ...range, insert, text: `${range.text.slice(0, range.start)}${insert}${range.text.slice(range.end)}`, from: range.start, to: range.start + insert.length };
}

export function hierarchyDepthAt(source, position) {
  const text = String(source || '');
  const cursor = Math.max(0, Math.min(Number.isFinite(position) ? position : 0, text.length));
  const start = text.lastIndexOf('\n', cursor - 1) + 1;
  const line = text.slice(start, text.indexOf('\n', cursor) === -1 ? text.length : text.indexOf('\n', cursor));
  const heading = headingMatch(line);
  if (heading) return Math.max(0, heading[2].length - 1);
  const quote = quoteMatch(line);
  const spaces = leadingSpaces(line).replace(/\t/g, INDENT_UNIT);
  return Math.floor(spaces.length / INDENT_UNIT.length) + (quote ? (quote[2].match(/>/g) || []).length : 0);
}

export function continueMarkdownBlock(view) {
  const { from, to } = view.state.selection.main;
  if (from !== to) return false;
  const line = view.state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  const after = line.text.slice(from - line.from);
  const quote = before.match(/^(\s*(?:>[ \t]*)+)/);
  const list = before.match(/^(\s*)((?:[-+*]|\d+[.)])(?:[ \t]+(?:\[[ xX]\][ \t]*)?)?[ \t]+)/);
  const match = quote || list;
  if (!match) return false;
  const prefix = match[0];
  const content = before.slice(prefix.length).trim();
  if (!content && !after.trim()) {
    view.dispatch({ changes: { from: line.from, to: from, insert: '\n' }, selection: { anchor: line.from + 1 } });
    return true;
  }
  let nextPrefix = prefix;
  if (list && /^\s*\d+[.)]/.test(prefix)) {
    nextPrefix = prefix.replace(/(\d+)([.)])/, (_, number, punctuation) => `${Number(number) + 1}${punctuation}`);
  }
  view.dispatch({ changes: { from, to, insert: `\n${nextPrefix}` }, selection: { anchor: from + 1 + nextPrefix.length } });
  return true;
}

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
