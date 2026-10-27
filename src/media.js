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
      url.searchParams.set('preview_crop', 'false');
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
  const ratioKey = (frame) => `portfolio-ratio:${frame.dataset.diskPath}:${frame.dataset.diskRevision}`;
  for (const frame of frames) {
    states.set(frame, { generation: 0 });
    try {
      const saved = window.localStorage?.getItem(ratioKey(frame));
      if (/^\d+ \/ \d+$/.test(saved)) frame.style.setProperty('--media-ratio', saved);
    } catch { /* Storage can be disabled in private browsing. */ }
  }

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
      if (image.naturalWidth && image.naturalHeight) {
        const ratio = `${image.naturalWidth} / ${image.naturalHeight}`;
        frame.style.setProperty('--media-ratio', ratio);
        try { window.localStorage?.setItem(ratioKey(frame), ratio); } catch { /* Optional layout cache. */ }
        if (window.CustomEvent) frame.dispatchEvent(new window.CustomEvent('mediaready', { bubbles: true }));
      }
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
  const gallery = [...document.querySelectorAll('.gallery-frame')];
  const thumbnails = [...document.querySelectorAll('[data-select-image]')];
  let selected = 0;
  let viewerController;
  const pad = (n) => String(n).padStart(2, '0');
  const count = () => `${pad(selected + 1)} / ${pad(gallery.length)}`;
  const dimensions = (frame) => {
    const image = frame?.querySelector('img');
    return image?.naturalWidth && image?.naturalHeight ? `${image.naturalWidth} × ${image.naturalHeight}` : '—';
  };
  function updateInformation() {
    const frame = gallery[selected];
    if (!frame) return;
    for (const node of document.querySelectorAll('[data-image-count]')) node.textContent = count();
    for (const node of document.querySelectorAll('[data-image-dimensions]')) node.textContent = dimensions(frame);
    for (const node of document.querySelectorAll('[data-image-format]')) node.textContent = frame.dataset.format;
    for (const node of document.querySelectorAll('[data-image-summary]')) node.textContent = `${dimensions(frame)} · ${frame.dataset.format}`;
    const thumb = thumbnails[selected]?.querySelector('.remote-media');
    if (thumb) thumb.style.setProperty('--media-ratio', frame.style.getPropertyValue('--media-ratio'));
  }
  function select(index) {
    if (!gallery.length) return;
    const previous = gallery[selected];
    selected = (index + gallery.length) % gallery.length;
    gallery.forEach((frame, i) => { frame.hidden = i !== selected; });
    thumbnails.forEach((button, i) => { button.classList.toggle('selected', i === selected); button.setAttribute('aria-pressed', String(i === selected)); });
    if (previous !== gallery[selected]) { visible.delete(previous); release(previous); }
    visible.add(gallery[selected]);
    void show(gallery[selected]);
    updateInformation();
  }
  gallery.forEach((frame, index) => {
    frame.setAttribute('role', 'button');
    frame.setAttribute('tabindex', '0');
    frame.setAttribute('aria-label', `На весь экран: ${frame.dataset.name}`);
    frame.addEventListener('mediaready', updateInformation);
    frame.addEventListener('click', (event) => { if (event.target.closest('button,a')) return; selected = index; void openViewer(); });
    frame.addEventListener('keydown', (event) => { if (event.target === frame && ['Enter', ' '].includes(event.key)) { event.preventDefault(); selected = index; void openViewer(); } });
  });
  thumbnails.forEach((button, index) => button.addEventListener('click', () => select(index)));
  document.querySelector('.expand-viewer')?.addEventListener('click', () => { void openViewer(); });
  async function openViewer() {
    const frame = gallery[selected];
    if (!viewer || !frame) return;
    viewerController?.abort();
    viewerController = new AbortController();
    const { signal } = viewerController;
    const image = viewer.querySelector('.viewer-image');
    const status = viewer.querySelector('.viewer-status');
    const link = viewer.querySelector('.viewer-source');
    const revision = frame.dataset.diskRevision;
    image.removeAttribute('src');
    image.alt = frame.querySelector('img').alt;
    status.textContent = 'Загрузка изображения…';
    status.hidden = false;
    link.href = publicUrl;
    link.hidden = true;
    viewer.querySelector('.viewer-title').textContent = document.querySelector('.gallery').dataset.projectTitle;
    viewer.querySelector('.viewer-count').textContent = count();
    viewer.querySelector('.viewer-dimensions').textContent = `${dimensions(frame)} · ${frame.dataset.format}`;
    viewer.querySelector('.viewer-navigation').hidden = gallery.length < 2;
    if (!viewer.open) { viewer.showModal(); document.body.style.overflow = 'hidden'; }
    try {
      const options = { mode: 'full', revision, signal };
      const url = await resolveMedia(frame.dataset.diskPath, options);
      try { await loadImage(image, url, signal); }
      catch (error) {
        if (signal.aborted) throw error;
        await loadImage(image, await resolveMedia(frame.dataset.diskPath, { ...options, fresh: true }), signal);
      }
      if (!signal.aborted) {
        status.hidden = true;
        viewer.querySelector('.viewer-dimensions').textContent = `${image.naturalWidth} × ${image.naturalHeight} · ${frame.dataset.format}`;
      }
    } catch {
      if (signal.aborted) return;
      resolveMedia.clear();
      status.textContent = 'Не удалось загрузить изображение. Попробуй открыть его ещё раз.';
      link.hidden = false;
    }
  }
  function step(delta) { select(selected + delta); void openViewer(); }
  if (viewer) {
    viewer.querySelector('.close-viewer')?.addEventListener('click', () => viewer.close());
    viewer.querySelector('.viewer-prev')?.addEventListener('click', () => step(-1));
    viewer.querySelector('.viewer-next')?.addEventListener('click', () => step(1));
    viewer.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1); }
    });
    viewer.addEventListener('close', () => {
      viewerController?.abort();
      document.body.style.overflow = '';
      viewer.querySelector('.viewer-image').removeAttribute('src');
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
