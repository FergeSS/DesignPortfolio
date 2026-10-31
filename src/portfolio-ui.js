// Each row shares one image height; card insets and captions stay identical.
export function mosaicWidths(ratios, width, gap = 24) {
  if (width <= 560) return ratios.map(() => width);
  const result = [];
  let row = [];
  function flush() {
    if (!row.length) return;
    const height = (width - gap * (row.length - 1) - 22 * row.length) / row.reduce((sum, ratio) => sum + ratio, 0);
    result.push(...row.map((ratio) => height * ratio + 22));
    row = [];
  }
  for (const value of ratios) {
    const ratio = Number.isFinite(value) && value > 0 ? value : 16 / 9;
    if (ratio >= 2.2) { flush(); result.push(width); continue; }
    row.push(ratio);
    const height = (width - gap * (row.length - 1) - 22 * row.length) / row.reduce((sum, r) => sum + r, 0);
    if ((row.length >= 2 && height <= 420) || row.length >= 3) flush();
  }
  flush();
  return result;
}

export function initPortfolioUI({ document, window }) {
  const contact = document.querySelector('.contact');
  const closeContact = (event) => { if (contact?.open && !contact.contains(event.target)) contact.open = false; };
  const escapeContact = (event) => {
    if (event.key === 'Escape' && contact?.open) { contact.open = false; contact.querySelector('summary').focus(); }
  };
  document.addEventListener('click', closeContact);
  document.addEventListener('keydown', escapeContact);
  const cleanups = [() => document.removeEventListener('click', closeContact), () => document.removeEventListener('keydown', escapeContact)];
  const grid = document.querySelector('.grid');
  if (grid) {
    const cards = [...grid.querySelectorAll('.card')];
    let request;
    const layout = () => {
      const visible = cards.filter((card) => !card.hidden);
      const ratios = visible.map((card) => {
        const cover = card.querySelector('.remote-media');
        const ratio = cover?.style.getPropertyValue('--media-ratio').split('/').map(Number);
        return ratio?.length === 2 ? ratio[0] / ratio[1] : 16 / 9;
      });
      const width = grid.getBoundingClientRect().width;
      const gap = parseFloat(window.getComputedStyle(grid).columnGap);
      const widths = mosaicWidths(ratios, width, gap);
      visible.forEach((card, i) => { const value = `${widths[i].toFixed(3)}px`; if (card.style.width !== value) card.style.width = value; });
      request = undefined;
    };
    const schedule = () => { if (!request) request = window.requestAnimationFrame(layout); };
    const resize = new window.ResizeObserver(schedule);
    resize.observe(grid);
    grid.addEventListener('mediaready', schedule);
    const mutations = new window.MutationObserver(schedule);
    mutations.observe(grid, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
    cleanups.push(() => { resize.disconnect(); mutations.disconnect(); grid.removeEventListener('mediaready', schedule); if (request) window.cancelAnimationFrame(request); });
    layout();
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}
