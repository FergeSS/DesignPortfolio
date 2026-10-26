const API = 'https://cloud-api.yandex.net/v1/disk/public/resources';

// Cache only short-lived URL strings, never image bytes. Resolve again on error.
export function createMediaResolver({ publicUrl, fetchImpl = fetch, now = Date.now, maxEntries = 128 } = {}) {
  const cache = new Map();
  const waiting = [];
  let active = 0;
  async function limited(task, signal) {
    if (active < 4) active++;
    else await new Promise((resolve) => waiting.push(resolve));
    try { signal?.throwIfAborted(); return await task(); }
    finally { const next = waiting.shift(); if (next) next(); else active--; }
  }
  async function api(endpoint, path, mode, signal) {
    const url = new URL(API + endpoint);
    url.searchParams.set('public_key', publicUrl);
    url.searchParams.set('path', path);
    if (mode === 'preview' && !endpoint) {
      url.searchParams.set('preview_size', 'XL');
      url.searchParams.set('preview_crop', 'true');
    }
    const timeout = AbortSignal.timeout(20000);
    const response = await limited(() => fetchImpl(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, credentials: 'omit', cache: 'no-store' }), signal);
    if (!response.ok) throw new Error(`Яндекс Диск недоступен (HTTP ${response.status}).`);
    return response.json();
  }
  async function resolveMedia(path, { mode = 'full', revision = '', signal, fresh = false } = {}) {
    signal?.throwIfAborted();
    const key = JSON.stringify([path, mode, revision]);
    const previous = cache.get(key);
    if (!fresh && previous?.expires > now()) return previous.url;
    let url;
    if (mode === 'preview') {
      const resource = await api('', path, mode, signal);
      url = resource.preview || resource.file;
    }
    if (!url) url = (await api('/download', path, mode, signal)).href;
    if (!url || new URL(url).protocol !== 'https:') throw new Error('Диск не выдал ссылку на изображение.');
    signal?.throwIfAborted();
    cache.delete(key);
    cache.set(key, { url, expires: now() + 5 * 60 * 1000 });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    return url;
  }
  resolveMedia.clear = () => cache.clear();
  return resolveMedia;
}

export function loadImage(image, url, signal) {
  return new Promise((resolve, reject) => {
    function cleanup() {
      image.removeEventListener('load', loaded);
      image.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
    }
    function loaded() { cleanup(); resolve(); }
    function failed() { cleanup(); reject(new Error('Не удалось загрузить изображение.')); }
    function aborted() { cleanup(); reject(signal.reason || new DOMException('Aborted', 'AbortError')); }
    if (signal.aborted) { aborted(); return; }
    image.addEventListener('load', loaded);
    image.addEventListener('error', failed);
    signal.addEventListener('abort', aborted, { once: true });
    image.src = url;
  });
}

export function mountMedia({ document, window, publicUrl, resolveMedia = createMediaResolver({ publicUrl }) }) {
  const frames = [...document.querySelectorAll('.remote-media')];
  const states = new WeakMap();
  const visible = new Set();
  for (const frame of frames) states.set(frame, { generation: 0 });

  async function show(frame, fresh = false) {
    const state = states.get(frame);
    window.clearTimeout(state.unloadTimer);
    if (!fresh && (state.loaded || state.loading)) return;
    state.controller?.abort();
    state.controller = new AbortController();
    const { signal } = state.controller;
    const generation = ++state.generation;
    state.loading = true;
    const image = frame.querySelector('img');
    const status = frame.querySelector('.media-status');
    const actions = frame.querySelector('.media-actions');
    frame.dataset.state = 'loading';
    status.hidden = false;
    status.textContent = 'Загрузка изображения…';
    if (actions) actions.hidden = true;
    try {
      const options = { mode: frame.dataset.diskMode, revision: frame.dataset.diskRevision, signal, fresh };
      const url = await resolveMedia(frame.dataset.diskPath, options);
      try { await loadImage(image, url, signal); }
      catch (error) {
        if (signal.aborted) throw error;
        // A previously issued URL may expire. Ask Disk for a fresh one once.
        await loadImage(image, await resolveMedia(frame.dataset.diskPath, { ...options, fresh: true }), signal);
      }
      if (state.generation !== generation) return;
      state.loaded = true;
      if (image.naturalWidth && image.naturalHeight) frame.style.setProperty('--media-ratio', `${image.naturalWidth} / ${image.naturalHeight}`);
      frame.dataset.state = 'loaded';
      status.hidden = true;
    } catch (error) {
      if (signal.aborted || state.generation !== generation) return;
      state.loaded = false;
      resolveMedia.clear();
      frame.dataset.state = 'error';
      status.textContent = 'Изображение временно недоступно';
      if (actions) actions.hidden = false;
    } finally { if (state.generation === generation) state.loading = false; }
  }

  function release(frame) {
    const state = states.get(frame);
    window.clearTimeout(state.unloadTimer);
    state.generation++;
    state.controller?.abort();
    state.loading = false;
    state.loaded = false;
    frame.querySelector('img').removeAttribute('src');
    frame.dataset.state = 'idle';
  }

  const observer = window.IntersectionObserver ? new window.IntersectionObserver((entries) => {
    for (const entry of entries) {
      const state = states.get(entry.target);
      if (entry.isIntersecting) {
        visible.add(entry.target);
        void show(entry.target);
      } else {
        visible.delete(entry.target);
        state.unloadTimer = window.setTimeout(() => release(entry.target), 1500);
      }
    }
  }, { rootMargin: '300px' }) : null;

  for (const frame of frames) {
    frame.querySelector('.media-retry')?.addEventListener('click', () => { void show(frame, true); });
    const link = frame.querySelector('.media-source');
    if (link) link.href = publicUrl;
    if (observer) observer.observe(frame);
    else { visible.add(frame); void show(frame); }
  }

  const viewer = document.querySelector('#lightbox');
  let viewerController;
  if (viewer) {
    const image = viewer.querySelector('img');
    const status = viewer.querySelector('.viewer-status');
    const link = viewer.querySelector('.viewer-source');
    link.href = publicUrl;
    for (const button of document.querySelectorAll('[data-disk-full]')) {
      button.addEventListener('click', async () => {
        viewerController?.abort();
        viewerController = new AbortController();
        const { signal } = viewerController;
        const revision = button.closest('.remote-media').dataset.diskRevision;
        image.alt = button.querySelector('img').alt;
        status.textContent = 'Загрузка изображения…';
        status.hidden = false;
        link.hidden = true;
        viewer.showModal();
        document.body.style.overflow = 'hidden';
        try {
          const url = await resolveMedia(button.dataset.diskFull, { mode: 'full', revision, signal });
          try { await loadImage(image, url, signal); }
          catch (error) {
            if (signal.aborted) throw error;
            await loadImage(image, await resolveMedia(button.dataset.diskFull, { mode: 'full', revision, signal, fresh: true }), signal);
          }
          if (!signal.aborted) status.hidden = true;
        } catch {
          if (signal.aborted) return;
          resolveMedia.clear();
          status.textContent = 'Не удалось загрузить изображение. Попробуй открыть его ещё раз.';
          link.hidden = false;
        }
      });
    }
    viewer.querySelector('button').addEventListener('click', () => viewer.close());
    viewer.addEventListener('click', (event) => { if (event.target === viewer) viewer.close(); });
    viewer.addEventListener('close', () => {
      viewerController?.abort();
      document.body.style.overflow = '';
      image.removeAttribute('src');
    });
  }

  const hide = () => { for (const frame of frames) release(frame); if (viewer?.open) viewer.close(); resolveMedia.clear(); };
  const restore = () => { for (const frame of visible) void show(frame); };
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', restore);
  return { show, release, destroy() { hide(); observer?.disconnect(); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', restore); } };
}

if (typeof document !== 'undefined') {
  const publicUrl = document.querySelector('meta[name="portfolio-source"]')?.content;
  if (publicUrl) mountMedia({ document, window, publicUrl });
}
