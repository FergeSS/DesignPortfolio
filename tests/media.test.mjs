import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaResolver, mountMedia } from '../src/media.js';

test('media URLs: Unicode paths, fresh preview vs original, cache expiry and no image-body downloads', async () => {
  const calls = [];
  let time = 1000;
  const resolveMedia = createMediaResolver({
    publicUrl: 'https://disk.yandex.ru/d/test',
    now: () => time,
    fetchImpl: async (input, options) => {
      const url = new URL(input);
      calls.push({ url, options });
      return Response.json(url.pathname.endsWith('/download') ? { href: `https://downloader.example/full-${calls.length}` } : { preview: `https://downloader.example/preview-${calls.length}` });
    },
  });
  const path = '/Кофейня с пробелом/обложка.png';
  const first = await resolveMedia(path, { mode: 'preview', revision: '1' });
  assert.equal(await resolveMedia(path, { mode: 'preview', revision: '1' }), first);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get('path'), path);
  assert.equal(calls[0].url.searchParams.get('preview_size'), 'XL');
  assert.equal(calls[0].url.searchParams.get('preview_crop'), 'false', 'mosaic previews must keep the original cover proportions');
  assert.equal(calls[0].options.credentials, 'omit');
  const full = await resolveMedia(path);
  assert.notEqual(full, first);
  assert.ok(calls[1].url.pathname.endsWith('/download'));
  assert.notEqual(await resolveMedia(path, { fresh: true }), full);
  time += 6 * 60 * 1000;
  assert.notEqual(await resolveMedia(path, { mode: 'preview', revision: '1' }), first);
  assert.ok(calls.every(({ url }) => url.hostname === 'cloud-api.yandex.net'), 'resolver requests only metadata, not the media body');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(resolveMedia(path, { signal: controller.signal }), { name: 'AbortError' });
});

test('media resolver bounds concurrency and handles denied or invalid URLs', async () => {
  const gates = [];
  let active = 0;
  let maximum = 0;
  const resolver = createMediaResolver({ publicUrl: 'https://disk.yandex.ru/d/test', fetchImpl: async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => gates.push(resolve));
    active--;
    return Response.json({ href: 'https://downloader.example/file' });
  } });
  const requests = Array.from({ length: 8 }, (_, i) => resolver(`/file${i}.png`));
  await Promise.resolve();
  assert.equal(gates.length, 4);
  gates.splice(0).forEach((resolve) => resolve());
  // Wait for metadata promises and the semaphore's next batch.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gates.length, 4);
  gates.splice(0).forEach((resolve) => resolve());
  await Promise.all(requests);
  assert.equal(maximum, 4);
  const denied = createMediaResolver({ publicUrl: 'https://disk.yandex.ru/d/test', fetchImpl: async () => new Response('', { status: 429 }) });
  await assert.rejects(denied('/image.png'), /429/);
  const invalid = createMediaResolver({ publicUrl: 'https://disk.yandex.ru/d/test', fetchImpl: async () => Response.json({ href: 'http://insecure.example/image' }) });
  await assert.rejects(invalid('/image.png'), /не выдал ссылку/);
});

function fakePage(resolver, viewer = null) {
  class Image extends EventTarget {
    naturalWidth = 1200;
    naturalHeight = 800;
    removed = 0;
    set src(value) { this.value = value; queueMicrotask(() => this.dispatchEvent(new Event(value.includes('expired') ? 'error' : 'load'))); }
    get src() { return this.value; }
    removeAttribute(name) { if (name === 'src') { this.value = undefined; this.removed++; } }
  }
  const image = new Image();
  const status = { hidden: false, textContent: '' };
  const actions = { hidden: true };
  const preview = { removed: false, remove() { this.removed = true; } };
  const dimensions = new Map();
  const glowClasses = new Set();
  const glowDraws = [];
  const glow = { width: 0, height: 0, classList: { add: (value) => glowClasses.add(value), remove: (value) => glowClasses.delete(value) }, getContext: () => ({ drawImage: (...args) => glowDraws.push(args) }) };
  const frame = {
    dataset: { diskPath: '/Работа/01.png', diskMode: 'full', diskRevision: '1' },
    style: { setProperty: (key, value) => dimensions.set(key, value) },
    querySelector: (selector) => ({ img: image, '.media-status': status, '.media-actions': actions, '.transition-preview': preview })[selector],
    closest: () => ({ querySelector: () => glow }),
  };
  const timers = new Set();
  let observer;
  const window = {
    IntersectionObserver: class {
      constructor(callback) { observer = callback; }
      observe() {}
      disconnect() {}
    },
    setTimeout: (callback) => { timers.add(callback); return callback; },
    clearTimeout: (callback) => timers.delete(callback),
    addEventListener() {}, removeEventListener() {},
  };
  const document = { body: { style: { overflow: 'hidden' } }, querySelectorAll: (selector) => selector === '.remote-media' ? [frame] : [], querySelector: (selector) => selector === '#lightbox' ? viewer : null };
  const loader = mountMedia({ document, window, publicUrl: 'https://disk.yandex.ru/d/test', resolveMedia: resolver });
  return { loader, image, status, actions, frame, dimensions, timers, glow, glowClasses, glowDraws, preview, observer: (entries) => observer(entries) };
}

test('visible media loads on demand, refreshes expired links, unloads outside the viewport and keeps its dimensions', async () => {
  const calls = [];
  const resolver = async (path, options) => { calls.push({ path, options }); return options.fresh ? 'https://media.example/fresh' : 'https://media.example/expired'; };
  resolver.clear = () => {};
  const page = fakePage(resolver);
  assert.equal(calls.length, 0, 'offscreen media does not load during initialization');
  await page.loader.show(page.frame);
  assert.equal(calls.length, 2, 'an expired link is resolved once more');
  assert.equal(page.frame.dataset.state, 'loaded');
  assert.equal(page.status.hidden, true);
  assert.equal(page.glowClasses.has('is-ready'), true);
  assert.equal(page.glow.width * page.glow.height, 1536, 'glow retains only a tiny copy of the preview');
  assert.equal(page.glowDraws[0][0], page.image, 'glow reuses the loaded image without another media request');
  assert.equal(page.dimensions.get('--media-ratio'), '1200 / 800');
  assert.equal(page.dimensions.get('--media-width'), '1200px', 'gallery scaling must retain the intrinsic width to avoid enlargement');
  page.observer([{ target: page.frame, isIntersecting: false }]);
  for (const timer of [...page.timers]) timer();
  assert.equal(page.image.src, undefined);
  assert.equal(page.preview.removed, true, 'offscreen transition previews must be released with the original media');
  assert.equal(page.frame.dataset.state, 'idle');
  assert.equal(page.glowClasses.has('is-ready'), false);
  assert.equal(page.glow.width * page.glow.height, 0, 'offscreen glow releases its backing store');
  assert.equal(page.dimensions.get('--media-ratio'), '1200 / 800', 'unloading must not collapse the gallery');
  await page.loader.show(page.frame);
  assert.equal(page.frame.dataset.state, 'loaded');
  page.loader.destroy();
});

test('unload cancels pending media and network errors show a retry state', async () => {
  let complete;
  let signal;
  const resolver = (path, options) => { signal = options.signal; return new Promise((resolve) => { complete = resolve; }); };
  resolver.clear = () => {};
  const page = fakePage(resolver);
  const pending = page.loader.show(page.frame);
  page.loader.release(page.frame);
  assert.equal(signal.aborted, true);
  complete('https://media.example/file');
  await pending;
  assert.equal(page.frame.dataset.state, 'idle');
  assert.equal(page.image.src, undefined);
  page.loader.destroy();
  const failing = async () => { throw new Error('Network failure'); };
  failing.clear = () => {};
  const failed = fakePage(failing);
  await failed.loader.show(failed.frame);
  assert.equal(failed.frame.dataset.state, 'error');
  assert.equal(failed.actions.hidden, false);
  assert.ok(failed.status.textContent.includes('недоступно'));
  failed.loader.destroy();
});

test('closing the viewer releases the original image and keeps its close icon', () => {
  const original = { src: 'https://media.example/original', removeAttribute(name) { if (name === 'src') delete this.src; } };
  const icon = { src: '../../assets/close.svg', removeAttribute(name) { if (name === 'src') delete this.src; } };
  const viewer = new EventTarget();
  const close = new EventTarget();
  viewer.querySelector = (selector) => ({ '.viewer-image': original, img: icon, '.close-viewer': close })[selector];
  const resolver = () => {};
  resolver.clear = () => {};
  const page = fakePage(resolver, viewer);
  viewer.dispatchEvent(new Event('close'));
  assert.equal(original.src, undefined);
  assert.equal(icon.src, '../../assets/close.svg');
  page.loader.destroy();
});
