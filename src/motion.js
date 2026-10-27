export function initMotion({ document, window }) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
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
  return () => { reduced.removeEventListener('change', resetMotion); observer?.disconnect(); root.classList.remove('motion-ready'); };
}
if (typeof document !== 'undefined') initMotion({ document, window });
