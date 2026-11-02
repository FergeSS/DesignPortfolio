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
    for (let end = start; end < Math.min(items.length, start + 3); end++) {
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

// Regroup only nearby portrait/square covers. Two large posters should share
// their own row rather than compete with smaller covers between them.
export function mosaicLayout(covers, width, gap = 24) {
  const items = covers.map((cover, index) => ({ cover, index,
    ratio: cover?.width > 0 && cover?.height > 0 ? cover.width / cover.height : null,
    pixels: cover?.width * cover?.height || 0,
  }));
  const groups = [];
  let pending = [];
  const flush = () => { if (pending.length) groups.push(pending); pending = []; };
  for (let start = 0; start < items.length;) {
    let end = start;
    if (width > 600) {
      while (end < Math.min(items.length, start + 6) && items[end].ratio > 0 && items[end].ratio <= 1.2) end++;
    }
    const neighbors = items.slice(start, end);
    const smallest = Math.min(...neighbors.map((item) => item.pixels));
    const isPoster = (item) => item.ratio < .9 && item.pixels >= Math.max(4_000_000, smallest * 4);
    const posters = neighbors.filter(isPoster);
    const others = neighbors.filter((item) => !isPoster(item));
    if (posters.length >= 2 && others.length) {
      pending.push(...others);
      flush();
      groups.push(posters);
      start = end;
    } else {
      pending.push(items[start++]);
    }
  }
  flush();
  const widths = Array(covers.length);
  const order = [];
  for (const group of groups) {
    const sizes = mosaicWidths(group.map((item) => item.cover), width, gap);
    group.forEach((item, index) => { widths[item.index] = sizes[index]; order.push(item.index); });
  }
  return { widths, order };
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
      const { widths, order } = mosaicLayout(covers, width, gap);
      visible.forEach((card, i) => { const value = `${widths[i].toFixed(3)}px`; if (card.style.width !== value) card.style.width = value; });
      const arranged = order.map((index) => visible[index]);
      const current = [...grid.querySelectorAll('.card')].filter((card) => !card.hidden);
      // Keep keyboard navigation in the same order as the visible mosaic.
      if (arranged.some((card, index) => card !== current[index])) grid.append(...arranged);
      request = undefined;
      grid.dispatchEvent(new window.CustomEvent('mosaiclayout'));
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
