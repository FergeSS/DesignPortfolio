// The build sets data-animations from animationsEnabled in portfolio.config.json.
export function createAnimationSettings({ document, window }) {
  const enabled = document.documentElement.getAttribute('data-animations') !== 'off';
  const system = window.matchMedia('(prefers-reduced-motion: reduce)');
  const preference = new EventTarget();
  Object.defineProperty(preference, 'matches', { get: () => !enabled || system.matches });
  const changed = () => { if (enabled) preference.dispatchEvent(new Event('change')); };
  system.addEventListener('change', changed);
  return {
    preference,
    destroy() { system.removeEventListener('change', changed); },
  };
}
