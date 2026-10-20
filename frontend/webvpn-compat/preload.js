// Classic bundles contain all JS chunks; only lazily required CSS needs loading.
const pending = new Map();
export function t(load, dependencies) {
  const tasks = (dependencies || []).filter(path => path.endsWith('.css')).map(path => {
    const url = new URL('/w-editor/web/assets/' + path, document.baseURI).href;
    if (pending.has(url)) return pending.get(url);
    if (Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some(link => link.href === url)) return undefined;
    const promise = new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      const nonce = document.querySelector('meta[property="csp-nonce"]');
      if (nonce) link.setAttribute('nonce', nonce.nonce || nonce.getAttribute('nonce'));
      link.addEventListener('load', resolve);
      link.addEventListener('error', () => { pending.delete(url); reject(new Error('Unable to preload CSS for ' + url)); });
      document.head.appendChild(link);
    });
    pending.set(url, promise);
    return promise;
  });
  return Promise.all(tasks).then(load).catch(error => {
    const event = new Event('vite:preloadError', { cancelable: true });
    event.payload = error;
    window.dispatchEvent(event);
    if (!event.defaultPrevented) throw error;
  });
}
