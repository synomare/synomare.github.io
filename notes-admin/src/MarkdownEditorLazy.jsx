import { lazy, Suspense } from 'react';
import LazyModuleBoundary from './LazyModuleBoundary.jsx';
import { createRetryableLazyModule } from './retryableLazy.js';

const editorModule = createRetryableLazyModule(
  () => import('./MarkdownEditor.jsx'),
  pathname => pathname.endsWith('/MarkdownEditor.jsx') || /\/assets\/MarkdownEditor-[\w-]+\.js$/.test(pathname)
);
let Editor = lazy(editorModule.load);

function resetEditor() {
  editorModule.prepareRetry();
  Editor = lazy(editorModule.loadRetry);
}

function EditorLoading() {
  return <div className="editor-loading" role="status" aria-live="polite">
    <span>EDITOR LOADING</span>
    <div className="editor-loading-lines" aria-hidden="true"><i/><i/><i/></div>
    <small>記事本文を準備しています。</small>
  </div>;
}

function EditorUnavailable({ onRetry }) {
  return <div className="editor-load-error" role="alert">
    <span>EDITOR UNAVAILABLE</span>
    <h2>本文エディターを読み込めませんでした。</h2>
    <p>通信状態を確認して、もう一度お試しください。この画面の原稿は削除されません。</p>
    <button type="button" onClick={onRetry}>RETRY EDITOR</button>
  </div>;
}

export function preloadMarkdownEditor() {
  return editorModule.preload();
}

export default function MarkdownEditorLazy(props) {
  return <LazyModuleBoundary onRetry={resetEditor} renderError={retry => <EditorUnavailable onRetry={retry}/>} renderContent={() => {
    const CurrentEditor = Editor;
    return <Suspense fallback={<EditorLoading/>}><CurrentEditor {...props}/></Suspense>;
  }}/>;
}
