import test from 'node:test';
import assert from 'node:assert/strict';
import { mosaicWidths } from '../src/portfolio-ui.js';

test('cover mosaic preserves ratios, fills each row and aligns the outside perimeter', () => {
  const ratios = [2.5, 16 / 9, 16 / 9, .75, 1.5, 1];
  const widths = mosaicWidths(ratios, 1280);
  assert.equal(widths[0], 1280);
  assert.deepEqual(widths.slice(1, 3), [628, 628]);
  assert.ok(Math.abs(widths.slice(3).reduce((a, b) => a + b) + 48 - 1280) < .001);
  const heights = widths.slice(3).map((w, i) => (w - 22) / ratios[i + 3]);
  assert.ok(heights.every((h) => Math.abs(h - heights[0]) < .001));
  assert.deepEqual(mosaicWidths(ratios, 350, 16), ratios.map(() => 350));
  assert.deepEqual(mosaicWidths([], 1280), []);
});
