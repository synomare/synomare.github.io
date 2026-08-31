import { lazy, Suspense } from 'react';
import LazyModuleBoundary from './LazyModuleBoundary.jsx';
import { createRetryableLazyModule } from './retryableLazy.js';

const previewModule = createRetryableLazyModule(
  () => import('./MarkdownPreview.jsx'),
  pathname => pathname.endsWith('/MarkdownPreview.jsx') || /\/assets\/MarkdownPreview-[\w-]+\.js$/.test(pathname)
);
let Preview = lazy(previewModule.load);

function resetPreview() {
  previewModule.prepareRetry();
  Preview = lazy(previewModule.loadRetry);
}

function PreviewLoading() {
  return <section className="markdown-preview editor-loading" role="status" aria-live="polite">
    <span>PREVIEW LOADING</span>
    <div className="editor-loading-lines" aria-hidden="true"><i/><i/><i/></div>
    <small>公開前の表示を準備しています。</small>
  </section>;
}

function PreviewUnavailable({ onRetry }) {
  return <section className="markdown-preview editor-load-error preview-load-error" role="alert">
    <span>PREVIEW UNAVAILABLE</span>
    <h2>プレビューを読み込めませんでした。</h2>
    <p>本文はそのまま編集できます。通信状態を確認して、もう一度お試しください。</p>
    <button type="button" onClick={onRetry}>RETRY PREVIEW</button>
  </section>;
}

export function preloadMarkdownPreview() {
  return previewModule.preload();
}

export default function MarkdownPreviewLazy(props) {
  return <LazyModuleBoundary onRetry={resetPreview} renderError={retry => <PreviewUnavailable onRetry={retry}/>} renderContent={() => {
    const CurrentPreview = Preview;
    return <Suspense fallback={<PreviewLoading/>}><CurrentPreview {...props}/></Suspense>;
  }}/>;
}
