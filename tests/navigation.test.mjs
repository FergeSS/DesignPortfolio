import test from 'node:test';
import assert from 'node:assert/strict';
import { canNavigate } from '../src/navigation.js';

test('animated navigation keeps modified clicks, downloads, external links and anchors native', () => {
  const current = 'https://portfolio.example/DesignPortfolio/?v=one';
  const event = { button: 0 };
  const link = (href, extra = {}) => ({ href, target: '', hasAttribute: () => false, ...extra });
  const work = link('https://portfolio.example/DesignPortfolio/projects/cover/?v=one');
  assert.equal(canNavigate(event, work, current), true);
  for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey', 'defaultPrevented']) assert.equal(canNavigate({ ...event, [modifier]: true }, work, current), false);
  assert.equal(canNavigate({ button: 1 }, work, current), false);
  assert.equal(canNavigate(event, { ...work, target: '_blank' }, current), false);
  assert.equal(canNavigate(event, { ...work, hasAttribute: () => true }, current), false);
  assert.equal(canNavigate(event, link('https://other.example/work'), current), false);
  assert.equal(canNavigate(event, link(current + '#works'), current), false);
  assert.equal(canNavigate(event, null, current), false);
});
