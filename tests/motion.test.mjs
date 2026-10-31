import test from 'node:test';
import assert from 'node:assert/strict';
import { initHeroScroll, initMotion, initCardInteractions } from '../src/motion.js';

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

test('card glare follows the mouse without rotation, ignores touch and resets on leave', () => {
  const grid = new EventTarget();
  const document = new EventTarget();
  const window = new EventTarget();
  const hover = new EventTarget(); hover.matches = true;
  const reduced = new EventTarget(); reduced.matches = false;
  const pending = new Map(); let serial = 0;
  window.matchMedia = (query) => query.includes('hover') ? hover : reduced;
  window.requestAnimationFrame = (callback) => { pending.set(++serial, callback); return serial; };
  window.cancelAnimationFrame = (id) => pending.delete(id);
  document.querySelector = () => grid;
  const properties = new Map();
  const classes = new Set();
  const surface = { style: { setProperty: (name, value) => properties.set(name, value), removeProperty: (name) => properties.delete(name) } };
  const card = { classList: { add: (value) => classes.add(value), remove: (value) => classes.delete(value) }, querySelector: () => surface, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 200 }), contains: () => false };
  grid.closest = () => card;
  const pointer = (pointerType) => { const event = new Event('pointermove'); Object.assign(event, { pointerType, clientX: 360, clientY: 20 }); grid.dispatchEvent(event); };
  const destroy = initCardInteractions({ document, window });
  pointer('touch'); assert.equal(pending.size, 0);
  pointer('mouse'); pointer('mouse'); assert.equal(pending.size, 1);
  const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach((callback) => callback());
  assert.equal(properties.get('--glare-x'), '90.0%');
  assert.equal(properties.get('--glare-y'), '10.0%');
  assert.equal(properties.has('--tilt-x'), false);
  assert.equal(properties.has('--tilt-y'), false);
  assert.equal(properties.get('--glare-opacity'), '1');
  grid.dispatchEvent(new Event('pointerout'));
  assert.equal(properties.size, 0);
  pointer('mouse'); reduced.matches = true; reduced.dispatchEvent(new Event('change'));
  assert.equal(pending.size, 0);
  assert.equal(classes.size, 0);
  pointer('mouse'); assert.equal(pending.size, 0);
  reduced.matches = false; pointer('mouse'); destroy();
  assert.equal(pending.size, 0);
  assert.equal(properties.size, 0);
});

test('scroll entrances stagger, rearm only outside the viewport and respect reduced motion', () => {
  const reduced = new EventTarget(); reduced.matches = false;
  const list = () => {
    const values = new Set();
    return { add: (key) => values.add(key), remove: (key) => values.delete(key), contains: (key) => values.has(key) };
  };
  const cards = [0, 1].map(() => {
    const properties = new Map();
    return { classList: list(), style: { setProperty: (key, value) => properties.set(key, value), removeProperty: (key) => properties.delete(key) }, properties };
  });
  const observers = [];
  const window = {
    matchMedia: () => reduced,
    IntersectionObserver: class {
      constructor(callback, options) { Object.assign(this, { callback, options, targets: new Set() }); observers.push(this); }
      observe(target) { this.targets.add(target); }
      disconnect() { this.targets.clear(); }
    },
  };
  const document = { documentElement: { classList: list() }, querySelector: () => null, querySelectorAll: () => cards };
  cards[0].classList.add('is-visible'); // A cover restored by project navigation stays visible.
  const destroy = initMotion({ document, window });
  const [entrance, reset] = observers;
  assert.equal(entrance.targets.size, 2);
  assert.equal(cards[0].classList.contains('is-visible'), true);
  const entry = (target, isIntersecting, left = 0) => ({ target, isIntersecting, boundingClientRect: { top: 500, left } });
  reset.callback([entry(cards[0], false), entry(cards[1], false)]);
  entrance.callback([entry(cards[1], true, 300), entry(cards[0], true)]);
  assert.equal(cards[0].properties.get('--entry-delay'), '0ms');
  assert.equal(cards[1].properties.get('--entry-delay'), '110ms');
  entrance.callback([entry(cards[0], false)]);
  assert.equal(cards[0].classList.contains('is-visible'), true, 'a small reverse scroll does not hide the card');
  reset.callback([entry(cards[0], false)]);
  assert.equal(cards[0].classList.contains('is-visible'), false);
  entrance.callback([entry(cards[0], true)]);
  assert.equal(cards[0].classList.contains('is-visible'), true, 'returning cards reveal again');
  reduced.matches = true; reduced.dispatchEvent(new Event('change'));
  assert.equal(document.documentElement.classList.contains('motion-ready'), false);
  assert.ok(cards.every((card) => card.classList.contains('is-visible')));
  assert.equal(entrance.targets.size + reset.targets.size, 0);
  reduced.matches = false; reduced.dispatchEvent(new Event('change'));
  destroy();
  assert.ok(observers.every((observer) => !observer.targets.size));
  assert.ok(cards.every((card) => !card.properties.size));
});
