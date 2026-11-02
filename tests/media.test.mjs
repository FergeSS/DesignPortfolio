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

function fakePage(resolver, viewer = null, { mode = 'full', storage } = {}) {
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
    dataset: { diskPath: '/Работа/01.png', diskMode: mode, diskRevision: '1' },
    style: { setProperty: (key, value) => dimensions.set(key, value) },
    querySelector: (selector) => ({ img: image, '.media-status': status, '.media-actions': actions, '.transition-preview': preview })[selector],
    closest: () => ({ querySelector: () => glow }),
  };
  const timers = new Set();
  let observer;
  const window = {
    localStorage: storage,
    IntersectionObserver: class {
      constructor(callback) { observer = callback; }
      observe() {}
      disconnect() {}
    },
    setTimeout: (callback) => { timers.add(callback); return callback; },
    clearTimeout: (callback) => timers.delete(callback),
    addEventListener() {}, removeEventListener() {},
  };
  const document = Object.assign(new EventTarget(), { body: { style: { overflow: 'hidden' } }, querySelectorAll: (selector) => selector === '.remote-media' ? [frame] : [], querySelector: (selector) => selector === '#lightbox' ? viewer : null });
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

function galleryPage(reducedMotion = false) {
  const animations = [], scrolls = [], focused = [];
  class Node extends EventTarget {
    dataset = {}; attrs = new Map(); styles = new Map(); classes = new Set();
    style = { setProperty: (key, value) => this.styles.set(key, value), getPropertyValue: (key) => this.styles.get(key) || '' };
    classList = { toggle: (key, enabled) => enabled ? this.classes.add(key) : this.classes.delete(key), remove: (key) => this.classes.delete(key) };
    setAttribute(key, value) { this.attrs.set(key, value); }
    closest(selector) { return selector === '.gallery, .gallery-controls' ? this : null; }
    focus(options) { focused.push({ node: this, options }); }
  }
  class Image extends Node {
    naturalWidth = 1200; naturalHeight = 800;
    set src(value) { this.url = value; queueMicrotask(() => this.dispatchEvent(new Event('load'))); }
    removeAttribute() { this.url = undefined; }
  }
  const gallery = Array.from({ length: 4 }, (_, index) => {
    const frame = new Node(), image = new Image(), status = {};
    frame.dataset = { diskPath: `/Работа/${index}.png`, diskMode: 'full', format: 'PNG', name: `${index}.png` };
    frame.hidden = index !== 0;
    frame.querySelector = (selector) => selector === 'img' ? image : selector === '.media-status' ? status : null;
    frame.animate = (frames, options) => { const animation = { index, frames, options, cancelled: false, cancel() { this.cancelled = true; } }; animations.push(animation); return animation; };
    return frame;
  });
  const thumbnails = gallery.map((frame, index) => {
    const button = new Node(); button.offsetLeft = index * 90; button.offsetWidth = 80;
    button.querySelector = () => frame;
    return button;
  });
  const strip = { clientWidth: 180, scrollWidth: 360, scrollTo: (options) => scrolls.push(options) };
  const previous = new Node(), next = new Node(), count = {};
  previous.dataset.galleryStep = '-1'; next.dataset.galleryStep = '1';
  const viewer = Object.assign(new Node(), { open: false, querySelector: () => null });
  const document = Object.assign(new EventTarget(), {
    body: { style: {} },
    querySelector: (selector) => ({ '#lightbox': viewer, '.thumbnails': strip })[selector] || null,
    querySelectorAll: (selector) => ({ '.remote-media': gallery, '.gallery-frame': gallery, '[data-select-image]': thumbnails, '[data-gallery-step]': [previous, next], '[data-image-count]': [count] })[selector] || [],
  });
  const window = Object.assign(new EventTarget(), {
    matchMedia: () => ({ matches: reducedMotion }), clearTimeout() {},
    IntersectionObserver: class { observe() {} disconnect() {} },
  });
  const resolver = async () => 'https://media.example/full'; resolver.clear = () => {};
  const loader = mountMedia({ document, window, publicUrl: 'https://disk.yandex.ru/d/test', resolveMedia: resolver });
  const key = (name, target) => { const event = Object.assign(new Event('keydown', { cancelable: true }), { key: name }); Object.defineProperty(event, 'target', { value: target }); document.dispatchEvent(event); return event; };
  return { loader, gallery, thumbnails, previous, next, count, viewer, key, window, animations, scrolls, focused };
}

test('gallery arrows wrap, update selection and animate only the thumbnail strip without scrolling the page', async () => {
  const page = galleryPage();
  page.next.dispatchEvent(new Event('click'));
  await new Promise((done) => setImmediate(done));
  assert.equal(page.count.textContent, '02 / 04');
  assert.equal(page.gallery[1].hidden, false); assert.equal(page.gallery[0].hidden, true);
  assert.equal(page.thumbnails[1].attrs.get('aria-pressed'), 'true');
  assert.deepEqual(page.scrolls.at(-1), { left: 40, behavior: 'smooth' });
  assert.equal(page.animations[0].frames[0].transform, 'translateX(18px)');
  assert.equal(page.key('ArrowRight', page.thumbnails[1]).defaultPrevented, true);
  assert.equal(page.count.textContent, '03 / 04');
  assert.deepEqual(page.focused.at(-1), { node: page.thumbnails[2], options: { preventScroll: true } });
  assert.equal(page.animations[0].cancelled, true, 'rapid navigation cancels an unfinished transition');
  page.next.dispatchEvent(new Event('click')); page.next.dispatchEvent(new Event('click'));
  assert.equal(page.count.textContent, '01 / 04');
  page.previous.dispatchEvent(new Event('click'));
  assert.equal(page.count.textContent, '04 / 04');
  assert.deepEqual(page.scrolls.at(-1), { left: 180, behavior: 'smooth' });
  page.viewer.open = true; page.key('ArrowLeft', page.thumbnails[3]);
  assert.equal(page.count.textContent, '04 / 04', 'fullscreen keyboard handling must not trigger a second gallery step');
  page.viewer.open = false; page.key('ArrowLeft', { closest: () => null });
  assert.equal(page.count.textContent, '04 / 04', 'keys outside the gallery stay native');
  page.loader.destroy(); page.key('ArrowLeft', page.thumbnails[3]);
  assert.equal(page.count.textContent, '04 / 04', 'SPA cleanup removes document keyboard handlers');
});

test('gallery honors reduced motion and recenters the active thumbnail after resize', () => {
  const page = galleryPage(true);
  page.next.dispatchEvent(new Event('click'));
  assert.equal(page.animations.length, 0);
  assert.deepEqual(page.scrolls.at(-1), { left: 40, behavior: 'instant' });
  page.window.dispatchEvent(new Event('resize'));
  assert.deepEqual(page.scrolls.at(-1), { left: 40, behavior: 'instant' });
  page.loader.destroy();
});

test('preview dimensions cannot overwrite the original resolution cached for mosaic layout', async () => {
  const entries = new Map();
  const storage = { getItem: (key) => entries.get(key), setItem: (key, value) => entries.set(key, value) };
  const resolver = async () => 'https://media.example/image';
  resolver.clear = () => {};
  const full = fakePage(resolver, null, { storage });
  full.image.naturalWidth = 3000;
  full.image.naturalHeight = 4000;
  await full.loader.show(full.frame);
  const preview = fakePage(resolver, null, { mode: 'preview', storage });
  preview.image.naturalWidth = 225;
  preview.image.naturalHeight = 300;
  await preview.loader.show(preview.frame);
  const restored = fakePage(resolver, null, { storage });
  assert.equal(restored.dimensions.get('--media-ratio'), '3000 / 4000');
  const restoredPreview = fakePage(resolver, null, { mode: 'preview', storage });
  assert.equal(restoredPreview.dimensions.get('--media-ratio'), '225 / 300');
  for (const page of [full, preview, restored, restoredPreview]) page.loader.destroy();
});
