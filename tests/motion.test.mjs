import test from 'node:test';
import assert from 'node:assert/strict';
import { initHeroScroll } from '../src/motion.js';

function scene({ reducedMotion = false, scroll = 0 } = {}) {
  const window = new EventTarget();
  Object.assign(window, { scrollY: scroll, innerWidth: 1280, innerHeight: 720 });
  const pending = new Map();
  let sequence = 0;
  window.requestAnimationFrame = (callback) => { pending.set(++sequence, callback); return sequence; };
  window.cancelAnimationFrame = (id) => pending.delete(id);
  const reduced = new EventTarget();
  reduced.matches = reducedMotion;
  const classes = new Set();
  const style = () => { const values = new Map(); return { values, setProperty: (key, value) => values.set(key, value), removeProperty: (key) => values.delete(key) }; };
  const hero = { style: style(), getBoundingClientRect: () => ({ top: 36 - window.scrollY, width: 1138, height: 520 }) };
  const copy = { style: style() };
  const works = { getBoundingClientRect: () => ({ top: 734 - window.scrollY }) };
  const document = { documentElement: { classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } }, querySelector: (selector) => ({ '.hero': hero, '#works': works, '.hero-copy': copy })[selector] };
  const destroy = initHeroScroll({ document, window, reduced });
  const flush = () => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach((callback) => callback()); };
  return { window, reduced, classes, hero, copy, pending, destroy, flush };
}

test('hero scroll opens with the works, reverses and coalesces rapid scroll events', () => {
  const page = scene();
  assert.equal(page.hero.style.values.get('--hero-spread'), '0.00px');
  page.window.scrollY = 288;
  page.window.dispatchEvent(new Event('scroll'));
  page.window.dispatchEvent(new Event('scroll'));
  assert.equal(page.pending.size, 1);
  page.flush();
  assert.ok(parseFloat(page.hero.style.values.get('--hero-spread')) > 200);
  page.window.scrollY = 1000;
  page.window.dispatchEvent(new Event('scroll')); page.flush();
  assert.equal(Number(page.hero.style.values.get('--hero-opacity')), 0);
  page.window.scrollY = 0;
  page.window.dispatchEvent(new Event('scroll')); page.flush();
  assert.equal(page.hero.style.values.get('--hero-spread'), '0.00px');
  assert.equal(page.copy.style.values.get('--hero-copy-opacity'), '1');
  page.destroy();
});

test('hero scroll respects reduced motion, restores deep links, resize and cleanup', () => {
  const page = scene({ reducedMotion: true, scroll: 800 });
  assert.equal(page.classes.has('hero-scroll-ready'), false);
  page.reduced.matches = false;
  page.reduced.dispatchEvent(new Event('change'));
  assert.equal(page.classes.has('hero-scroll-ready'), true);
  assert.equal(Number(page.hero.style.values.get('--hero-opacity')), 0);
  assert.equal(page.hero.style.values.get('--hero-pin-top'), '36.00px');
  page.window.dispatchEvent(new Event('scroll'));
  page.window.innerWidth = 390;
  page.window.dispatchEvent(new Event('resize'));
  assert.equal(page.pending.size, 0, 'resize cancels a stale animation frame');
  assert.equal(page.hero.style.values.get('--hero-pin-top'), '36.00px');
  page.reduced.matches = true;
  page.reduced.dispatchEvent(new Event('change'));
  assert.equal(page.classes.has('hero-scroll-ready'), false);
  page.reduced.matches = false;
  page.reduced.dispatchEvent(new Event('change'));
  page.window.dispatchEvent(new Event('scroll'));
  page.destroy();
  assert.equal(page.pending.size, 0);
  assert.equal(page.hero.style.values.size, 0);
  assert.equal(page.copy.style.values.size, 0);
  assert.equal(page.classes.has('hero-scroll-ready'), false);
});
