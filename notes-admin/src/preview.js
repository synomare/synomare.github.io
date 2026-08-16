import { marked } from 'marked';

export function previewHtml(body) {
  const escaped = String(body || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const linked = escaped.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => `[${label || target}](#wikilink-${encodeURIComponent(target.trim())})`);
  return marked.parse(linked, { gfm: true }).replace(/\s(?:href|src)="(?:javascript|data):[^"]*"/gi, '');
}
