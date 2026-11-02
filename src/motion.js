export function initHeroScroll({ document, window, reduced = window.matchMedia('(prefers-reduced-motion: reduce)') }) {
  const hero = document.querySelector('.hero');
  const works = document.querySelector('#works');
  const copy = document.querySelector('.hero-copy');
  if (!hero || !works) return () => {};
  const root = document.documentElement;
  let request;
  let start = 0;
  let distance = 1;
  let spread = 0;
  let heroHeight = 1;
  let lastScroll;

  function render() {
    request = undefined;
    if (reduced.matches) return;
    const scroll = Math.max(0, window.scrollY);
    if (scroll === lastScroll) return;
    lastScroll = scroll;
    const progress = Math.min(1, Math.max(0, (scroll - start) / distance));
    const eased = progress * progress * (3 - 2 * progress);
    hero.style.setProperty('--hero-spread', `${(eased * spread).toFixed(2)}px`);
    hero.style.setProperty('--hero-tilt', `${(eased * 5).toFixed(2)}deg`);
    hero.style.setProperty('--hero-opacity', (1 - Math.max(0, (progress - .78) / .22)).toFixed(3));
    copy?.style.setProperty('--hero-copy-opacity', String(Math.max(0, 1 - scroll / (heroHeight * .45))));
  }

  function measure() {
    if (request !== undefined) { window.cancelAnimationFrame(request); request = undefined; }
    root.classList.remove('hero-scroll-ready');
    lastScroll = undefined;
    if (reduced.matches) return;
    // Measure the normal document flow, including when opening a direct #works link.
    const rect = hero.getBoundingClientRect();
    const worksTop = works.getBoundingClientRect().top + window.scrollY;
    heroHeight = Math.max(1, rect.height);
    start = Math.max(0, worksTop - window.innerHeight * .92);
    distance = Math.max(heroHeight * .8, worksTop - window.innerHeight * .18 - start, 1);
    spread = Math.max(rect.width * .68, window.innerWidth * .58);
    hero.style.setProperty('--hero-height', `${rect.height.toFixed(2)}px`);
    hero.style.setProperty('--hero-pin-top', `${Math.max(0, rect.top + window.scrollY).toFixed(2)}px`);
    root.classList.add('hero-scroll-ready');
    render();
  }

  const schedule = () => {
    if (!reduced.matches && request === undefined) request = window.requestAnimationFrame(render);
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', measure);
  window.addEventListener('pageshow', measure);
  reduced.addEventListener('change', measure);
  measure();
  return () => {
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', measure);
    window.removeEventListener('pageshow', measure);
    reduced.removeEventListener('change', measure);
    if (request !== undefined) window.cancelAnimationFrame(request);
    root.classList.remove('hero-scroll-ready');
    for (const name of ['--hero-spread', '--hero-tilt', '--hero-opacity', '--hero-pin-top', '--hero-height']) hero.style.removeProperty(name);
    copy?.style.removeProperty('--hero-copy-opacity');
  };
}

export function initMotion({ document, window }) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  const destroyHeroScroll = initHeroScroll({ document, window, reduced });
  let observer;
  let resetObserver;
  const elements = [...document.querySelectorAll('[data-reveal]')];
  const grid = document.querySelector('.grid');
  let request;
  let lastScroll = window.scrollY;
  let lastTime = window.performance?.now() ?? Date.now();
  const finishVisible = () => {
    request = undefined;
    if (reduced.matches) return;
    for (const element of elements) {
      if (element.hidden) continue;
      const bounds = element.getBoundingClientRect();
      if (bounds.bottom <= 0 || bounds.top >= window.innerHeight || bounds.height <= 0) continue;
      element.style.setProperty('--entry-delay', '0ms');
      element.classList.add('is-reveal-immediate');
      element.classList.add('is-visible');
    }
  };
  const scheduleFinish = () => { if (request === undefined) request = window.requestAnimationFrame(finishVisible); };
  const onScroll = () => {
    const now = window.performance?.now() ?? Date.now();
    const distance = Math.abs(window.scrollY - lastScroll);
    const elapsed = Math.max(16, Math.min(100, now - lastTime));
    lastScroll = window.scrollY;
    lastTime = now;
    // A fast scroll must never leave a loaded card waiting on its entrance.
    if (!reduced.matches && (distance >= 96 || distance / elapsed > 1.5)) scheduleFinish();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', scheduleFinish);
  grid?.addEventListener('mosaiclayout', scheduleFinish);
  function reveal() {
    if (reduced.matches || !window.IntersectionObserver || !elements.length) return;
    observer = new window.IntersectionObserver((entries) => {
      const entering = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
      entering.forEach((entry, index) => {
        if (entry.target.classList.contains('is-visible')) return;
        entry.target.style.setProperty('--entry-delay', `${Math.min(index, 2) * 60}ms`);
        entry.target.classList.add('is-visible');
      });
    }, { threshold: 0, rootMargin: '420px 0px' });
    // Rearm only well outside the viewport, so reversing a small scroll never flickers.
    resetObserver = new window.IntersectionObserver((entries) => {
      for (const entry of entries) if (!entry.isIntersecting) {
        const bounds = entry.target.getBoundingClientRect();
        // Ignore a stale exit notification if a fast scroll has brought it back.
        if (entry.target.hidden || bounds.bottom < -1000 || bounds.top > window.innerHeight + 1000) {
          entry.target.classList.remove('is-visible');
          entry.target.classList.remove('is-reveal-immediate');
        }
      }
    }, { threshold: 0, rootMargin: '1000px 0px' });
    finishVisible();
    root.classList.add('motion-ready');
    for (const element of elements) { observer.observe(element); resetObserver.observe(element); }
  }
  reveal();
  const resetMotion = () => {
    observer?.disconnect();
    resetObserver?.disconnect();
    if (request !== undefined) window.cancelAnimationFrame(request);
    request = undefined;
    root.classList.remove('motion-ready');
    if (reduced.matches) elements.forEach((element) => element.classList.add('is-visible'));
    else reveal();
  };
  reduced.addEventListener('change', resetMotion);
  return () => {
    destroyHeroScroll(); reduced.removeEventListener('change', resetMotion);
    window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', scheduleFinish);
    grid?.removeEventListener('mosaiclayout', scheduleFinish);
    if (request !== undefined) window.cancelAnimationFrame(request);
    observer?.disconnect(); resetObserver?.disconnect(); root.classList.remove('motion-ready');
    elements.forEach((element) => { element.style.removeProperty('--entry-delay'); element.classList.remove('is-reveal-immediate'); });
  };
}

export function initCardInteractions({ document, window }) {
  const grid = document.querySelector('.grid');
  if (!grid) return () => {};
  const hover = window.matchMedia('(hover: hover) and (pointer: fine)');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let active;
  let request;
  let pointer;
  function reset() {
    if (request !== undefined) window.cancelAnimationFrame(request);
    request = undefined;
    if (!active) return;
    const surface = active.querySelector('.card-surface');
    for (const name of ['--glare-x', '--glare-y', '--glare-opacity']) surface?.style.removeProperty(name);
    active = undefined;
  }
  function paint() {
    request = undefined;
    if (!active) return;
    const bounds = active.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (pointer.x - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (pointer.y - bounds.top) / bounds.height));
    const surface = active.querySelector('.card-surface');
    if (!surface) return;
    surface.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`);
    surface.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`);
    surface.style.setProperty('--glare-opacity', '1');
  }
  function move(event) {
    if (reduced.matches || !hover.matches || event.pointerType !== 'mouse') return;
    const card = event.target.closest('.card');
    if (!card) return;
    if (card !== active) { reset(); active = card; }
    pointer = { x: event.clientX, y: event.clientY };
    if (request === undefined) request = window.requestAnimationFrame(paint);
  }
  const leave = (event) => { if (active && !active.contains(event.relatedTarget)) reset(); };
  grid.addEventListener('pointermove', move, { passive: true });
  grid.addEventListener('pointerout', leave);
  grid.addEventListener('pointercancel', reset);
  document.addEventListener('visibilitychange', reset);
  window.addEventListener('blur', reset);
  reduced.addEventListener('change', reset);
  hover.addEventListener('change', reset);
  return () => {
    reset(); grid.removeEventListener('pointermove', move); grid.removeEventListener('pointerout', leave); grid.removeEventListener('pointercancel', reset);
    document.removeEventListener('visibilitychange', reset); window.removeEventListener('blur', reset);
    reduced.removeEventListener('change', reset); hover.removeEventListener('change', reset);
  };
}
