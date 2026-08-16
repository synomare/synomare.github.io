import { previewHtml } from './preview.js';

export default function MarkdownPreview({ body }) {
  return <section className="markdown-preview" aria-label="記事プレビュー"><div dangerouslySetInnerHTML={{ __html: previewHtml(body) }}/></section>;
}
