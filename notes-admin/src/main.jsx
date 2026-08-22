import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './overrides.css';
import './trace.css';

const NotesApp = lazy(() => import('./App.jsx'));
const TraceApp = lazy(() => import('./TraceApp.jsx'));
const isTraceView = new URLSearchParams(location.search).get('view') === 'stream';

function Root() {
  return <Suspense fallback={<main className="trace-loading">LOADING…</main>}>
    {isTraceView ? <TraceApp/> : <><NotesApp/><a className="surface-jump" href="?view=stream" aria-label="Trace Streamを開く">TRACE STREAM</a></>}
  </Suspense>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><Root/></React.StrictMode>);
