export function initMotion({ document, window }) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  let frame;
  const updateProgress = () => {
    const length = root.scrollHeight - window.innerHeight;
    root.style.setProperty('--scroll-progress', length > 0 ? Math.min(1, window.scrollY / length) : 0);
    frame = undefined;
  };
  const onScroll = () => { if (frame === undefined) frame = window.requestAnimationFrame(updateProgress); };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  updateProgress();
  let observer;
  if (!reduced.matches && window.IntersectionObserver) {
    observer = new window.IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.06 });
    root.classList.add('motion-ready');
    for (const element of document.querySelectorAll('[data-reveal]')) observer.observe(element);
  }
  const resetMotion = () => {
    if (!reduced.matches) return;
    observer?.disconnect();
    root.classList.remove('motion-ready');
  };
  reduced.addEventListener('change', resetMotion);
  if (!reduced.matches && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    for (const card of document.querySelectorAll('.card-media')) {
      card.addEventListener('pointermove', (event) => {
        if (reduced.matches) return;
        const bounds = card.getBoundingClientRect();
        card.style.setProperty('--cursor-x', `${event.clientX - bounds.left}px`);
        card.style.setProperty('--cursor-y', `${event.clientY - bounds.top}px`);
      }, { passive: true });
    }

  }
  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    reduced.removeEventListener('change', resetMotion);
    observer?.disconnect();
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    root.classList.remove('motion-ready');
  };
}
if (typeof document !== 'undefined') initMotion({ document, window });
