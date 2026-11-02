import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnimationSettings } from '../src/animation-settings.js';

function scene(enabled, systemReduced = false) {
  const system = Object.assign(new EventTarget(), { matches: systemReduced });
  const document = { documentElement: { getAttribute: () => enabled ? 'on' : 'off' } };
  const window = { matchMedia: () => system, get localStorage() { throw new Error('Browser preferences must not override the code setting'); } };
  return { system, settings: createAnimationSettings({ document, window }) };
}

test('the code setting disables every animation regardless of browser preferences', () => {
  const { system, settings } = scene(false);
  assert.equal(settings.preference.matches, true);
  let changes = 0;
  settings.preference.addEventListener('change', () => changes++);
  system.matches = true;
  system.dispatchEvent(new Event('change'));
  system.matches = false;
  system.dispatchEvent(new Event('change'));
  assert.equal(settings.preference.matches, true);
  assert.equal(changes, 0);
  settings.destroy();
});

test('enabling motion in code restores animation and respects system reduced motion', () => {
  const { system, settings } = scene(true);
  assert.equal(settings.preference.matches, false);
  let changes = 0;
  settings.preference.addEventListener('change', () => changes++);
  system.matches = true;
  system.dispatchEvent(new Event('change'));
  assert.equal(settings.preference.matches, true);
  system.matches = false;
  system.dispatchEvent(new Event('change'));
  assert.equal(settings.preference.matches, false);
  assert.equal(changes, 2);
  settings.destroy();
  system.dispatchEvent(new Event('change'));
  assert.equal(changes, 2);
});
