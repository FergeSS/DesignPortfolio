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
  if (!reduced.matches && window.IntersectionObserver) {
    observer = new window.IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, { threshold: .06 });
    root.classList.add('motion-ready');
    for (const element of document.querySelectorAll('[data-reveal]')) observer.observe(element);
  }
  const resetMotion = () => {
    if (reduced.matches) { observer?.disconnect(); root.classList.remove('motion-ready'); }
  };
  reduced.addEventListener('change', resetMotion);
  return () => { destroyHeroScroll(); reduced.removeEventListener('change', resetMotion); observer?.disconnect(); root.classList.remove('motion-ready'); };
}
if (typeof document !== 'undefined') initMotion({ document, window });
