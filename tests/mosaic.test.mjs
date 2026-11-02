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
  const posterRow = mosaicWidths([.75, 2.5], 1280);
  assert.ok(Math.abs(posterRow[0] + posterRow[1] + 24 - 1280) < .001);
  assert.ok(Math.abs((posterRow[0] - 22) / .75 - (posterRow[1] - 22) / 2.5) < .001, 'a portrait and a wide cover share a row without stretching the poster');
});

test('resolution influences row packing without changing proportions or project order', () => {
  const preceding = [2.5, 16 / 9, 16 / 9];
  const small = mosaicWidths([...preceding, { width: 225, height: 300 }], 1280);
  const poster = mosaicWidths([...preceding, { width: 3000, height: 4000 }], 1280);
  assert.ok(poster[3] > small[3] * 1.5, 'the large poster receives more room with the same aspect ratio and surrounding covers');
  assert.ok(small[3] < 1280 / 4, 'a small portrait does not become a full-width orphan');
  assert.ok(Math.abs(small.slice(1).reduce((sum, value) => sum + value, 48) - 1280) < .001);
  assert.ok(Math.abs(poster[2] + poster[3] + 24 - 1280) < .001);
  assert.ok(Math.abs((poster[2] - 22) / (16 / 9) - (poster[3] - 22) / .75) < .001);
});

test('small trailing covers share a row and extreme resolutions remain a soft preference', () => {
  for (const width of [640, 900, 1280, 1920]) {
    const covers = [16 / 9, 16 / 9, { width: 200, height: 300 }];
    const sizes = mosaicWidths(covers, width);
    assert.ok(sizes[2] < width / 2, 'a low-resolution final cover can share the previous row');
    const lastRow = Math.abs(sizes[0] - width) < .001 ? sizes.slice(1) : sizes;
    assert.ok(Math.abs(lastRow.reduce((sum, value) => sum + value, 24 * (lastRow.length - 1)) - width) < .001);
  }
  const sizes = mosaicWidths([{ width: 1, height: 1 }, { width: 40000, height: 40000 }], 1280);
  assert.deepEqual(sizes, [628, 628], 'resolution does not override a balanced two-card row');
  assert.deepEqual(mosaicWidths([{ width: 200, height: 300 }, .75], 390, 16), [390, 390]);
});

test('mixed and missing dimensions produce finite justified rows', () => {
  const covers = [{ width: 3000, height: 4000 }, undefined, { width: 0, height: 300 }, NaN, 3, { width: 200, height: 300 }, 1];
  const ratios = [.75, 16 / 9, 16 / 9, 16 / 9, 3, 2 / 3, 1];
  for (const width of [640, 1280, 1800]) {
    const sizes = mosaicWidths(covers, width);
    let rowWidth = 0, rowHeight;
    for (let i = 0; i < sizes.length; i++) {
      assert.ok(Number.isFinite(sizes[i]) && sizes[i] > 22 && sizes[i] <= width);
      const height = (sizes[i] - 22) / ratios[i];
      if (rowWidth) assert.ok(Math.abs(height - rowHeight) < .001, 'covers in a row retain their original aspect ratios');
      rowHeight = height;
      rowWidth += (rowWidth ? 24 : 0) + sizes[i];
      if (Math.abs(rowWidth - width) < .001) { rowWidth = 0; rowHeight = undefined; }
    }
    assert.equal(rowWidth, 0, 'every row ends at the same outside edge');
  }
});
