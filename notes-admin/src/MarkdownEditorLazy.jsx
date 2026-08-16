import { lazy, Suspense } from 'react';

const Editor = lazy(() => import('./MarkdownEditor.jsx'));

export default function MarkdownEditorLazy(props) {
  return <Suspense fallback={<div className="editor-loading">EDITOR LOADING…</div>}><Editor {...props} /></Suspense>;
}
