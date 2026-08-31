function retryUrlFromError(error, isExpectedPath) {
  const detail = `${error?.message || ''}\n${error?.stack || ''}`;
  const match = detail.match(/https?:\/\/[^\s)]+(?:\.jsx|\.js)(?:\?[^\s)]*)?/i);
  if (!match) return '';
  try {
    const url = new URL(match[0].replace(/[),.;]+$/, ''));
    return url.origin === location.origin && isExpectedPath(url.pathname) ? url.href : '';
  } catch {
    return '';
  }
}

export function createRetryableLazyModule(loader, isExpectedPath) {
  let modulePromise = null;
  let retryUrl = '';

  const load = retry => {
    if (!modulePromise) {
      const request = retry && retryUrl
        ? (() => {
            const url = new URL(retryUrl);
            url.searchParams.set('retry', Date.now().toString(36));
            return import(/* @vite-ignore */ url.href);
          })()
        : loader();
      modulePromise = request.catch(error => {
        retryUrl = retryUrlFromError(error, isExpectedPath) || retryUrl;
        modulePromise = null;
        throw error;
      });
    }
    return modulePromise;
  };

  return {
    load: () => load(false),
    loadRetry: () => load(true),
    preload: () => load(false),
    prepareRetry: () => { modulePromise = null; }
  };
}
