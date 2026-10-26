import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('open pages detect new builds from the website and recover from network errors without querying Disk', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const requests = [];
  const redirects = [];
  const ticks = [];
  let reloads = 0;
  let version = 'original';
  let projects = ['ezh'];
  let offline = false;
  const viewer = { open: false, querySelector: () => ({ addEventListener() {} }), addEventListener() {} };
  const document = {
    currentScript: { src: 'https://portfolio.example/DesignPortfolio/app.js' },
    hidden: false,
    querySelector: (selector) => selector.includes('portfolio-version') ? { content: 'original' } : selector === '#lightbox' ? viewer : null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  runInNewContext(source, {
    document, URL, AbortSignal,
    location: { pathname: '/DesignPortfolio/projects/ezh/', reload: () => { reloads++; }, assign: (url) => redirects.push(url) },
    setInterval: (callback, delay) => ticks.push({ callback, delay }),
    fetch: async (url) => {
      requests.push(new URL(url));
      if (offline) throw new Error('offline');
      return { ok: true, json: async () => ({ version, projects }) };
    },
  });
  assert.equal(ticks.length, 1);
  await ticks[0].callback();
  assert.equal(reloads, 0);
  version = 'new-content';
  viewer.open = true;
  await ticks[0].callback();
  assert.equal(requests.length, 1, 'do not interrupt the image viewer');
  viewer.open = false;
  offline = true;
  await ticks[0].callback();
  assert.equal(reloads, 0);
  offline = false;
  await ticks[0].callback();
  assert.equal(reloads, 1);
  projects = [];
  await ticks[0].callback();
  assert.deepEqual(redirects, ['https://portfolio.example/DesignPortfolio/']);
  assert.ok(requests.every((url) => url.origin === 'https://portfolio.example' && url.pathname === '/DesignPortfolio/site-version.json'));
});
