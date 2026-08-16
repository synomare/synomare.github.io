import { lazy, Suspense } from 'react';

const Preview = lazy(() => import('./MarkdownPreview.jsx'));

export default function MarkdownPreviewLazy(props) {
  return <Suspense fallback={<section className="markdown-preview editor-loading">PREVIEW LOADING…</section>}><Preview {...props}/></Suspense>;
}
