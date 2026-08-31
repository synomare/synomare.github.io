import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  hasQueuedDraft,
  hasQueuedSlug,
  nextPublication,
  publicationSummary,
  removeQueuedPublication,
  replacePublication,
  stopPublicationQueue
} from './publicationQueue.js';

export default function usePublicationQueue({ enabled, execute, onSuccess, onError }) {
  const [items, setItems] = useState([]);
  const [paused, setPaused] = useState(false);
  const itemsRef = useRef(items);
  const workerActive = useRef(false);
  const handlers = useRef({ execute, onSuccess, onError });
  handlers.current = { execute, onSuccess, onError };

  const commitItems = useCallback(updater => {
    const next = typeof updater === 'function' ? updater(itemsRef.current) : updater;
    itemsRef.current = next;
    setItems(next);
    return next;
  }, []);

  useEffect(() => {
    if (!enabled || paused || workerActive.current) return;
    const job = nextPublication(itemsRef.current);
    if (!job) return;
    workerActive.current = true;
    commitItems(current => replacePublication(current, job.id, { state: 'publishing', errorCode: '', errorMessage: '' }));
    void (async () => {
      try {
        const committedSha = await handlers.current.execute(job);
        await handlers.current.onSuccess?.(job, committedSha);
        workerActive.current = false;
        commitItems(current => replacePublication(current, job.id, { state: 'done', committedSha }));
      } catch (error) {
        await handlers.current.onError?.(job, error);
        workerActive.current = false;
        setPaused(true);
        commitItems(current => replacePublication(current, job.id, {
          state: 'error',
          errorCode: String(error?.code || ''),
          errorMessage: String(error?.message || '公開処理に失敗しました。')
        }));
      }
    })();
  }, [commitItems, enabled, items, paused]);

  const summary = useMemo(() => publicationSummary(items), [items]);

  useEffect(() => {
    if (!summary.active) return undefined;
    const warnBeforeExit = event => {
      event.preventDefault();
      event.returnValue = '';
    };
    addEventListener('beforeunload', warnBeforeExit);
    return () => removeEventListener('beforeunload', warnBeforeExit);
  }, [summary.active]);

  const enqueue = useCallback(job => {
    if (hasQueuedSlug(itemsRef.current, job.slug)) return false;
    commitItems(current => {
      const activeBatch = current.some(item => ['queued', 'publishing', 'error'].includes(item.state));
      return [...(activeBatch ? current : current.filter(item => item.state !== 'done')), job];
    });
    return true;
  }, [commitItems]);

  const retry = useCallback(id => {
    const failed = itemsRef.current.find(item => item.id === id && item.state === 'error');
    if (!failed) return false;
    commitItems(current => replacePublication(current, id, { state: 'queued', errorCode: '', errorMessage: '' }));
    setPaused(false);
    return true;
  }, [commitItems]);

  const cancel = useCallback(id => {
    const queued = itemsRef.current.find(item => item.id === id && item.state === 'queued');
    if (!queued) return null;
    commitItems(current => removeQueuedPublication(current, id));
    return queued;
  }, [commitItems]);

  const stop = useCallback(() => {
    commitItems(stopPublicationQueue);
    setPaused(false);
  }, [commitItems]);

  const clearCompleted = useCallback(() => commitItems(current => current.filter(item => item.state !== 'done')), [commitItems]);
  const hasSlug = useCallback(slug => hasQueuedSlug(itemsRef.current, slug), []);
  const hasDraft = useCallback(draftKey => hasQueuedDraft(itemsRef.current, draftKey), []);

  return {
    items,
    paused,
    summary,
    enqueue,
    retry,
    cancel,
    stop,
    clearCompleted,
    hasSlug,
    hasDraft
  };
}
