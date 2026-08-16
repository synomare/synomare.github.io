import YAML from 'yaml';

export function jstDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function generateSlug(existing = [], date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(date);
  const value = type => parts.find(part => part.type === type)?.value || '00';
  const base = `${value('year')}${value('month')}${value('day')}-${value('hour')}${value('minute')}${value('second')}`;
  if (!existing.includes(base)) return base;
  const bytes = crypto.getRandomValues(new Uint8Array(2));
  return `${base}-${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
export function parseDocument(source, fallbackSlug = '') {
  const match = String(source).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const data = match ? (YAML.parse(match[1]) || {}) : {};
  return {
    slug: fallbackSlug,
    title: String(data.title || ''), date: String(data.date || jstDate()),
    summary: String(data.summary || ''), tags: Array.isArray(data.tags) ? data.tags : [], aliases: Array.isArray(data.aliases) ? data.aliases : [],
    cardSize: ['s', 'm', 'l'].includes(data.card_size) ? data.card_size : 'm', cardExcerpt: String(data.card_excerpt || ''),
    draft: data.draft === true, body: match ? source.slice(match[0].length) : source, existing: true
  };
}
export function excerptFromBody(body, max = 160) {
  const text = String(body).replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label || target).replace(/[#*_>`~\[\]()]/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim() || '本文を読む';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
export function tagsFromBody(body) {
  return [...new Set([...String(body).matchAll(/(?:^|\s)#([^\s#.,!?、。]+)/gu)].map(match => match[1]))].slice(0, 20);
}
export function serializeDocument(note) {
  const summary = note.summary.trim() || excerptFromBody(note.body);
  const tags = note.tags.length ? note.tags : (tagsFromBody(note.body).length ? tagsFromBody(note.body) : ['未分類']);
  const data = { title: note.title.trim(), date: note.date || jstDate(), summary, tags, aliases: note.aliases, card_size: note.cardSize || 'm' };
  if (note.cardExcerpt.trim()) data.card_excerpt = note.cardExcerpt.trim();
  data.draft = note.draft === true;
  return `---\n${YAML.stringify(data).trim()}\n---\n\n${note.body.trim()}\n`;
}
export function parseOAuthMessage(message) {
  if (typeof message !== 'string' || !message.startsWith('authorization:github:success:')) return '';
  try { return JSON.parse(message.slice('authorization:github:success:'.length)).token || ''; } catch { return ''; }
}
export function outgoingFromBody(body) {
  return [...String(body).matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)].map(match => ({ target: match[1].trim(), label: (match[2] || match[1]).trim() }));
}
export function newNote(existing = []) {
  return { slug: generateSlug(existing), title: '', date: jstDate(), summary: '', tags: [], aliases: [], cardSize: 'm', cardExcerpt: '', draft: false, body: '', existing: false };
}
