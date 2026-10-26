const filters = document.querySelectorAll('[data-filter]');
const scriptUrl = document.currentScript?.src;
const currentVersion = document.querySelector('meta[name="portfolio-version"]')?.content;
// Check the published catalog version. Media itself loads directly from Disk.
if (scriptUrl && currentVersion) {
  const siteRoot = new URL('./', scriptUrl);
  let checking = false;
  async function checkSiteVersion() {
    if (checking || document.hidden || document.querySelector('#lightbox')?.open) return;
    checking = true;
    try {
      const url = new URL('site-version.json', siteRoot);
      url.searchParams.set('check', Date.now());
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) return;
      const data = await response.json();
      if (!data.version || data.version === currentVersion) return;
      const path = location.pathname.slice(siteRoot.pathname.length);
      const slug = /^projects\/([^/]+)\//.exec(path)?.[1];
      const target = new URL(slug && !data.projects?.includes(slug) ? siteRoot.href : location.href);
      target.searchParams.set('v', data.version.slice(0, 12));
      location.replace(target.href);
    } catch {
      // A temporary network failure must leave the current page usable.
    } finally { checking = false; }
  }
  setInterval(checkSiteVersion, 60000);
  document.addEventListener('visibilitychange', checkSiteVersion);
}
const cards = document.querySelectorAll('.card');
for (const button of filters) {
  button.addEventListener('click', () => {
    for (const filter of filters) {
      const active = filter === button;
      filter.classList.toggle('active', active);
      filter.setAttribute('aria-pressed', String(active));
    }
    for (const card of cards) card.hidden = Boolean(button.dataset.filter && card.dataset.category !== button.dataset.filter);
    document.querySelector('.empty-filter').hidden = [...cards].some((card) => !card.hidden);
  });
}
