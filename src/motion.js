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
  const elements = [...document.querySelectorAll('[data-reveal]')];
  elements.forEach((element, i) => element.style.setProperty('--entry-angle', `${i % 2 ? .8 : -.8}deg`));
  function reveal() {
    if (reduced.matches || !window.IntersectionObserver) return;
    observer = new window.IntersectionObserver((entries) => {
      const entering = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
      entering.forEach((entry, index) => {
        entry.target.style.setProperty('--entry-delay', `${Math.min(index, 3) * 80}ms`);
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: .08 });
    root.classList.add('motion-ready');
    for (const element of elements) if (!element.classList.contains('is-visible')) observer.observe(element);
  }
  reveal();
  const resetMotion = () => {
    observer?.disconnect();
    root.classList.remove('motion-ready');
    if (reduced.matches) elements.forEach((element) => element.classList.add('is-visible'));
    else reveal();
  };
  reduced.addEventListener('change', resetMotion);
  return () => { destroyHeroScroll(); reduced.removeEventListener('change', resetMotion); observer?.disconnect(); root.classList.remove('motion-ready'); };
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
    active.classList.remove('is-tilting');
    const surface = active.querySelector('.card-tilt');
    for (const name of ['--tilt-x', '--tilt-y', '--glare-x', '--glare-y', '--glare-opacity']) surface?.style.removeProperty(name);
    active = undefined;
  }
  function paint() {
    request = undefined;
    if (!active) return;
    const bounds = active.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (pointer.x - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (pointer.y - bounds.top) / bounds.height));
    const surface = active.querySelector('.card-tilt');
    if (!surface) return;
    surface.style.setProperty('--tilt-x', `${((.5 - y) * 4).toFixed(2)}deg`);
    surface.style.setProperty('--tilt-y', `${((x - .5) * 5).toFixed(2)}deg`);
    surface.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`);
    surface.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`);
    surface.style.setProperty('--glare-opacity', '1');
  }
  function move(event) {
    if (reduced.matches || !hover.matches || event.pointerType !== 'mouse') return;
    const card = event.target.closest('.card');
    if (!card) return;
    if (card !== active) { reset(); active = card; active.classList.add('is-tilting'); }
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
