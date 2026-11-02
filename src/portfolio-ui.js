const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Covers can be ratios (unknown resolution) or original pixel dimensions.
// Compare complete row arrangements so a small final cover can share an earlier row.
export function mosaicWidths(covers, width, gap = 24) {
  if (!covers.length) return [];
  if (width <= 600) return covers.map(() => Math.max(0, width));
  const inset = 22;
  const targetHeight = clamp(width / 3.4, 240, 360);
  const items = covers.map((cover) => {
    const known = Number.isFinite(cover?.width) && cover.width > 0 && Number.isFinite(cover?.height) && cover.height > 0;
    const value = known ? cover.width / cover.height : cover;
    const ratio = Number.isFinite(value) && value > 0 ? value : 16 / 9;
    // Resolution has a restrained influence: a 12 MP poster gets more room than
    // a tiny logo, without making layout sizes proportional to file dimensions.
    const pixels = known ? Math.sqrt(cover.width * cover.height) : 1000;
    const preference = targetHeight * clamp((pixels / 1000) ** .2, .65, 1.35);
    return { ratio, preference, height: known ? cover.height : null };
  });
  const best = Array(items.length + 1).fill(Infinity);
  const rows = Array(items.length);
  best[items.length] = 0;
  for (let start = items.length - 1; start >= 0; start--) {
    let ratioSum = 0;
    for (let end = start; end < Math.min(items.length, start + 4); end++) {
      ratioSum += items[end].ratio;
      const count = end - start + 1;
      const height = (width - gap * (count - 1) - inset * count) / ratioSum;
      if (height <= 0) continue;
      let cost = .06;
      for (let index = start; index <= end; index++) {
        const item = items[index];
        cost += Math.log(height / item.preference) ** 2;
        // Softly discourage enlarging low-resolution originals. Cap the penalty
        // so an unusually small file cannot dictate every surrounding row.
        if (item.height) cost += .8 * Math.log(clamp(height / item.height, 1, 4)) ** 2;
        const imageWidth = height * item.ratio;
        cost += 3 * Math.max(0, (Math.min(180, width * .18) - imageWidth) / 180) ** 2;
      }
      cost += 6 * Math.max(0, height / Math.min(600, width * .65) - 1) ** 2;
      if (cost + best[end + 1] < best[start]) {
        best[start] = cost + best[end + 1];
        rows[start] = { end, height };
      }
    }
  }
  const result = [];
  for (let start = 0; start < items.length;) {
    const { end, height } = rows[start];
    for (let index = start; index <= end; index++) result.push(height * items[index].ratio + inset);
    start = end + 1;
  }
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
  const gallery = document.querySelector('.gallery');
  if (gallery) {
    const controls = document.querySelector('.gallery-controls');
    const heading = document.querySelector('.project-heading');
    let request;
    const fit = () => {
      request = undefined;
      const top = gallery.getBoundingClientRect().top + window.scrollY;
      const controlsHeight = controls ? controls.getBoundingClientRect().height + parseFloat(window.getComputedStyle(controls).marginTop) : 0;
      const height = Math.max(160, window.innerHeight - top - controlsHeight - 24);
      gallery.style.setProperty('--gallery-height', `${height.toFixed(2)}px`);
    };
    const schedule = () => { if (request === undefined) request = window.requestAnimationFrame(fit); };
    const resize = new window.ResizeObserver(schedule);
    if (heading) resize.observe(heading);
    if (controls) resize.observe(controls);
    window.addEventListener('resize', schedule);
    fit();
    cleanups.push(() => { resize.disconnect(); window.removeEventListener('resize', schedule); if (request !== undefined) window.cancelAnimationFrame(request); gallery.style.removeProperty('--gallery-height'); });
  }
  const grid = document.querySelector('.grid');
  if (grid) {
    const cards = [...grid.querySelectorAll('.card')];
    let request;
    const layout = () => {
      const visible = cards.filter((card) => !card.hidden);
      const covers = visible.map((card) => {
        const cover = card.querySelector('.remote-media');
        const dimensions = cover?.style.getPropertyValue('--media-ratio').split('/').map(Number);
        return dimensions?.length === 2 ? { width: dimensions[0], height: dimensions[1] } : 16 / 9;
      });
      const width = grid.getBoundingClientRect().width;
      const gap = parseFloat(window.getComputedStyle(grid).columnGap);
      const widths = mosaicWidths(covers, width, gap);
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
