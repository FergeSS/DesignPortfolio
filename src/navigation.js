const [media, motion, ui] = await Promise.all(['media.js', 'motion.js', 'portfolio-ui.js'].map((file) => {
  const url = new URL(file, import.meta.url);
  url.search = new URL(import.meta.url).search;
  return import(url.href);
}));

export function canNavigate(event, link, currentUrl) {
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (link.hasAttribute('download') || (link.target && link.target !== '_self')) return false;
  const target = new URL(link.href, currentUrl);
  const current = new URL(currentUrl);
  return target.origin === current.origin && (target.pathname !== current.pathname || target.search !== current.search);
}

const projectKey = (url) => /\/projects\/([^/]+)\/?$/.exec(url.pathname)?.[1];
const transitionOptions = { duration: 620, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' };

export function initNavigation({ document, window, fetchImpl = window.fetch.bind(window) }) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const version = document.querySelector('meta[name="portfolio-version"]')?.content;
  const entries = new Map();
  let serial = 0;
  let currentUrl = new URL(window.location.href);
  for (const link of document.head.querySelectorAll('link[href]')) link.href = new URL(link.getAttribute('href'), currentUrl).href;
  let currentState = { ...window.history.state, portfolioKey: window.history.state?.portfolioKey || `portfolio-${Date.now()}-${serial++}`, scroll: window.scrollY, url: currentUrl.href, page: document.body.dataset.page };
  window.history.replaceState(currentState, '', currentUrl.href);
  const previousRestoration = window.history.scrollRestoration;
  window.history.scrollRestoration = 'manual';
  let disposePage = () => {};
  let stopTransition = () => {};
  let pending;

  function mountPage() {
    for (const link of document.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      if (!href.startsWith('#')) link.href = new URL(href, window.location.href).href;
    }
    const loader = media.mountMedia({ document, window, publicUrl: document.querySelector('meta[name="portfolio-source"]')?.content });
    const disposeUI = ui.initPortfolioUI({ document, window });
    const disposeMotion = motion.initMotion({ document, window });
    const disposeCards = motion.initCardInteractions({ document, window });
    disposePage = () => { disposeCards(); disposeMotion(); disposeUI(); loader.destroy(); };
  }

  function remember(write = true) {
    currentState = { ...currentState, scroll: window.scrollY, filter: document.querySelector('.filter.active')?.dataset.filter || '' };
    entries.set(currentState.portfolioKey, currentState);
    while (entries.size > 32) entries.delete(entries.keys().next().value);
    if (write) window.history.replaceState(currentState, '', window.location.href);
  }

  function animate(element, frames, options) {
    if (!element?.animate || reduced.matches) return null;
    return element.animate(frames, options);
  }

  function frameForKey(key) {
    if (!key) return null;
    const card = [...document.querySelectorAll('.card')].find((node) => node.dataset.projectKey === key);
    if (card) return card.querySelector('.cover.remote-media');
    const gallery = document.querySelector('.gallery');
    return gallery?.dataset.projectKey === key ? gallery.querySelector('.gallery-frame:not([hidden])') : null;
  }

  function visibleBounds(element) {
    const rect = element?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight ? rect : null;
  }

  function sourceFor(link, url) {
    const card = link?.closest('.card');
    const key = card?.dataset.projectKey || projectKey(url) || document.querySelector('.gallery')?.dataset.projectKey;
    const frame = card?.querySelector('.cover.remote-media') || link?.querySelector('.next-preview .remote-media') || frameForKey(key);
    const image = frame?.querySelector('.remote-image');
    const bounds = visibleBounds(frame);
    if (!bounds || !image?.complete || !image.naturalWidth) return { key };
    const clone = image.cloneNode(false);
    clone.className = 'work-transition-image';
    clone.src = image.currentSrc || image.src;
    clone.alt = '';
    return { key, image: clone, bounds, path: frame.dataset.diskPath, revision: frame.dataset.diskRevision, ratio: `${image.naturalWidth} / ${image.naturalHeight}`, radius: window.getComputedStyle(frame).borderRadius };
  }

  async function navigate(url, { link, state, pop = false } = {}) {
    pending?.abort();
    stopTransition();
    const controller = new AbortController();
    pending = controller;
    const card = link?.closest('.card');
    card?.classList.add('is-opening');
    link?.setAttribute('aria-busy', 'true');
    const animations = [];
    let overlay;
    let target;
    let previewTimer;
    const cleanTransition = () => {
      animations.splice(0).forEach((animation) => animation?.cancel());
      overlay?.remove();
      overlay = undefined;
      target?.classList.remove('transition-target');
    };
    stopTransition = cleanTransition;
    try {
      const response = await fetchImpl(url.href, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), headers: { Accept: 'text/html' } });
      if (!response.ok) throw new Error(`Page HTTP ${response.status}`);
      const next = new window.DOMParser().parseFromString(await response.text(), 'text/html');
      if (next.querySelector('meta[name="portfolio-version"]')?.content !== version || !['home', 'project'].includes(next.body.dataset.page)) throw new Error('A complete page load is required');
      if (controller.signal.aborted) return;

      const source = sourceFor(link, url);
      if (!pop) remember();
      const home = next.body.dataset.page === 'home';
      const lastHome = [...entries.values()].reverse().find((entry) => entry.page === 'home' && new URL(entry.url).pathname === url.pathname);
      const restore = pop ? entries.get(state?.portfolioKey) || state : (home && link?.classList.contains('back') ? lastHome : null);
      const targetScroll = restore?.scroll ?? 0;

      if (source.image && !reduced.matches) {
        overlay = document.createElement('div');
        overlay.className = 'work-transition';
        overlay.setAttribute('aria-hidden', 'true');
        Object.assign(overlay.style, { left: `${source.bounds.left}px`, top: `${source.bounds.top}px`, width: `${source.bounds.width}px`, height: `${source.bounds.height}px`, borderRadius: source.radius });
        overlay.append(source.image.cloneNode(false));
        document.body.append(overlay);
      }
      const outgoing = animate(document.querySelector('.shell'), [{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-out', fill: 'both' });
      animations.push(outgoing);
      if (outgoing) await outgoing.finished.catch(() => {});
      if (controller.signal.aborted) return;

      disposePage();
      if (!pop) {
        state = { portfolioKey: `portfolio-${Date.now()}-${serial++}`, scroll: targetScroll, url: url.href, page: next.body.dataset.page };
        window.history.pushState(state, '', url.href);
      }
      currentUrl = url;
      currentState = { ...state, url: url.href, page: next.body.dataset.page };
      document.body.replaceChildren(...[...next.body.childNodes].map((node) => document.importNode(node, true)));
      document.body.dataset.page = next.body.dataset.page;
      document.title = next.title;
      const description = next.querySelector('meta[name="description"]')?.content;
      if (description) document.querySelector('meta[name="description"]').content = description;
      if (overlay) document.body.append(overlay);

      if (restore?.filter) {
        for (const button of document.querySelectorAll('.filter')) {
          const active = button.dataset.filter === restore.filter;
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', String(active));
        }
        for (const item of document.querySelectorAll('.card')) item.hidden = item.dataset.category !== restore.filter;
      }
      target = frameForKey(source.key);
      if (target && source.image && target.dataset.diskPath === source.path && target.dataset.diskRevision === source.revision) {
        target.style.setProperty('--media-ratio', source.ratio);
        const preview = source.image.cloneNode(false);
        preview.className = 'transition-preview';
        target.classList.add('has-transition-preview');
        target.append(preview);
        const clearPreview = () => { preview.remove(); target?.classList.remove('has-transition-preview'); };
        preview.addEventListener('error', clearPreview, { once: true });
        target.addEventListener('mediaready', () => { previewTimer = window.setTimeout(clearPreview, 500); }, { once: true });
      }
      // Dimensions and the mosaic are restored before measuring the destination cover.
      if (home && restore) target?.closest('.card')?.classList.add('is-visible');
      mountPage();
      const disposeMounted = disposePage;
      disposePage = () => { window.clearTimeout(previewTimer); disposeMounted(); };
      window.scrollTo({ top: targetScroll, behavior: 'instant' });
      if (!restore && url.hash) document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView({ behavior: 'instant' });
      window.dispatchEvent(new window.Event('resize'));
      document.dispatchEvent(new window.CustomEvent('portfolio:navigate'));
      const incoming = animate(document.querySelector('.shell'), [{ opacity: 0 }, { opacity: 1 }], { duration: 440, delay: 80, easing: 'ease-out', fill: 'both' });
      animations.push(incoming);

      const targetBounds = visibleBounds(target);
      let morph;
      if (overlay && targetBounds && target?.dataset.diskPath === source.path) {
        target.classList.add('transition-target');
        morph = animate(overlay, [
          { left: `${source.bounds.left}px`, top: `${source.bounds.top}px`, width: `${source.bounds.width}px`, height: `${source.bounds.height}px`, borderRadius: source.radius },
          { left: `${targetBounds.left}px`, top: `${targetBounds.top}px`, width: `${targetBounds.width}px`, height: `${targetBounds.height}px`, borderRadius: window.getComputedStyle(target).borderRadius },
        ], transitionOptions);
        animations.push(morph);
      } else overlay?.remove();
      const finished = morph || incoming;
      if (finished) await finished.finished.catch(() => {});
      if (controller.signal.aborted) return;
      cleanTransition();
      const focus = home ? target?.closest('.card')?.querySelector('a') : document.querySelector('h1');
      if (focus) { if (!home) focus.tabIndex = -1; focus.focus({ preventScroll: true }); }
      remember();
    } catch (error) {
      if (!controller.signal.aborted) window.location.assign(url.href);
    } finally {
      cleanTransition();
      card?.classList.remove('is-opening');
      link?.removeAttribute('aria-busy');
      if (stopTransition === cleanTransition) stopTransition = () => {};
      if (pending === controller) pending = undefined;
    }
  }

  function click(event) {
    const link = event.target.closest('a.card-link,a.back,a.next-project,a.brand');
    if (!canNavigate(event, link, window.location.href)) return;
    event.preventDefault();
    void navigate(new URL(link.href), { link });
  }
  function pop(event) {
    const url = new URL(window.location.href);
    remember(false);
    if (url.pathname === currentUrl.pathname && url.search === currentUrl.search) {
      pending?.abort();
      stopTransition();
      const restore = entries.get(event.state?.portfolioKey) || event.state;
      const sameEntry = restore?.portfolioKey === currentState.portfolioKey;
      currentUrl = url;
      currentState = { ...currentState, ...restore, url: url.href };
      if (sameEntry && url.hash) document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView({ behavior: 'instant' });
      else window.scrollTo({ top: restore?.scroll || 0, behavior: 'instant' });
      window.dispatchEvent(new window.Event('resize'));
      return;
    }
    void navigate(url, { state: event.state, pop: true });
  }
  document.addEventListener('click', click);
  window.addEventListener('popstate', pop);
  const hide = () => { pending?.abort(); stopTransition(); };
  const motionPreference = () => { if (reduced.matches) stopTransition(); };
  window.addEventListener('pagehide', hide);
  reduced.addEventListener('change', motionPreference);
  mountPage();
  return () => {
    pending?.abort(); stopTransition(); disposePage();
    document.removeEventListener('click', click); window.removeEventListener('popstate', pop);
    window.removeEventListener('pagehide', hide); reduced.removeEventListener('change', motionPreference);
    window.history.scrollRestoration = previousRestoration;
  };
}

if (typeof document !== 'undefined') initNavigation({ document, window });
